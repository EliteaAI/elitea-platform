// Command elitea-llm-gateway is the standalone LLM gateway service. It embeds
// bifrost/core and serves the /llm surface as N stateless replicas,
// coordinating shared state through NATS JetStream.
//
// This entrypoint stands up the module on Go 1.26.4 with the §9.5 deployment
// settings (long shutdown drain, disabled SSE write timeout, tuned pools). The
// /llm chi handler is mounted below, and server.New connects the hardened NATS
// budget-path client when GATEWAY_NATS_URL is set (design §8; the connection is
// non-fatal at startup — the tiered-hybrid FSM owns degraded-mode policy).
//
// FIX #0: when NATS and DB are both available the governance engine (failmode +
// GovernanceStore + cost.Calculator) is assembled and wired into the handler
// via WithBudgetGate. When either is absent, enforcement is DISABLED with a
// loud startup warning.
// FIX #7: cfg.NATSDegradedCapUSD is converted to int64 nano-USD and set on
// failmode.Params.DegradedCapNano before the GovernanceStore is constructed.
// FIX #9: startup guard — GATEWAY_IDENTITY_SECRET must be non-empty when
// GATEWAY_NATS_URL is set (enforcement on), otherwise the HMAC is bypassable.
package main

import (
	"context"
	"expvar"
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/maximhq/bifrost/core/schemas"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/account"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/api"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/config"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/cost"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/governance"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/server"
)

func main() {
	cfg := config.FromEnv()

	level := new(slog.LevelVar)
	level.Set(parseLevel(cfg.LogLevel))
	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
	slog.SetDefault(logger)

	// FIX #9: if NATS enforcement is on, a missing identity secret lets any caller
	// forge the X-Elitea-Project-Id header and bypass per-project budget caps.
	if cfg.NATSURL != "" && cfg.IdentitySecret == "" {
		slog.Error("FATAL: GATEWAY_IDENTITY_SECRET required when budget enforcement is enabled (GATEWAY_NATS_URL is set); refusing to start")
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Base mux with a health endpoint. Passed to the server as its
	// http.Handler; the /llm chi router is mounted below once the embedded
	// bifrost client is available.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	// Open the Postgres pool BEFORE the server: it backs the vault-backed
	// Account (BFF.6), the governance/failmode store (FIX #0), and the
	// synthetic /llm/v1/models resolver. The pool MUST live for the entire
	// server lifetime — closing it while the server is running would break
	// in-flight credential resolution, governance reads, and model lookups.
	//
	// A configured-but-unreachable database is non-fatal: the /v1/models
	// surface reports an empty set, the governance engine is not wired
	// (enforcement disabled with a loud warning), and the gateway keeps the
	// zero-provider bootstrap account.
	var (
		pool          *pgxpool.Pool
		modelResolver *llmproxy.ModelResolver
	)
	pool, err := pgxpool.New(ctx, cfg.DatabaseURL)
	if err != nil {
		logger.Warn("database pool unavailable; provider credentials, models resolver and budget enforcement disabled", "err", err)
		pool = nil
	} else {
		// Defer pool.Close outside the if-block so it is ALWAYS called at
		// process exit, whether governance is wired or not.
		defer pool.Close()

		modelResolver = llmproxy.NewModelResolver(llmproxy.ModelResolverConfig{
			DB:     llmproxy.NewModelPoolQuerier(pool),
			Logger: logger,
		})
	}

	// BFF.6: assemble the vault-backed Account (BF0.2-account) so bifrost can
	// resolve real per-project provider credentials. Without a pool the
	// gateway keeps the zero-provider bootstrap account — it will start, but
	// every provider call fails until the database returns.
	var acct schemas.Account
	if pool != nil {
		vault, verr := account.NewFernetVault(account.NewPoolQuerier(pool))
		if verr != nil {
			// A malformed SECRETS_MASTER_KEY is a startup misconfiguration:
			// refusing to start beats silently failing every wrapped-key
			// decrypt at runtime.
			slog.Error("FATAL: Fernet vault init failed", "err", verr)
			os.Exit(1)
		}
		eliteaAcct, aerr := account.New(account.Config{
			DB:                  account.NewPoolQuerier(pool),
			Vault:               vault,
			ProviderConcurrency: cfg.ProviderConcurrency,
			SelfOrigins:         cfg.SelfLLMOrigins,
			Logger:              logger,
		})
		if aerr != nil {
			slog.Error("FATAL: vault-backed Account init failed", "err", aerr)
			os.Exit(1)
		}
		acct = eliteaAcct
		if len(cfg.SelfLLMOrigins) == 0 {
			logger.Warn("GATEWAY_SELF_LLM_ORIGINS is empty — the request-time SELF_REFERENTIAL_CREDENTIAL guard (spec §2.6 guard #1) is inert")
		}
		logger.Info("vault-backed Account ENABLED", "self_origins", len(cfg.SelfLLMOrigins))
	} else {
		logger.Warn("PROVIDER CREDENTIALS DISABLED: no database pool — gateway runs the zero-provider bootstrap account")
	}

	srv, err := server.New(ctx, cfg, logger, level, acct, mux)
	if err != nil {
		slog.Error("failed to initialise gateway", "err", err)
		os.Exit(1)
	}

	// FIX #0: assemble and wire the governance engine when both NATS and DB
	// are available. When either is absent, enforcement is DISABLED.
	//
	// Fix round-3 #1: hoist govStore to a scope visible at shutdown so
	// govStore.Drain() can be called in the graceful shutdown path.
	var (
		budgetOpts []llmproxy.HandlerOption
		govStore   *governance.GovernanceStore
	)
	nc := srv.NATS()
	if nc != nil && pool != nil {
		var calcResult *cost.Calculator
		var govErr error
		govStore, calcResult, govErr = buildGovernance(ctx, cfg, nc, pool, logger)
		if govErr != nil {
			logger.Error("BUDGET ENFORCEMENT DISABLED: governance assembly failed", "err", govErr)
			govStore = nil // ensure nil so drain is skipped on error path
		} else {
			budgetOpts = append(budgetOpts, llmproxy.WithBudgetGate(govStore, calcResult))
			logger.Info("budget enforcement ENABLED", "nats_url", cfg.NATSURL)
			recordBudgetEnforcementEnabled(true)
		}
	} else {
		logger.Warn("BUDGET ENFORCEMENT DISABLED: " + budgetDisabledReason(cfg, nc, pool))
		recordBudgetEnforcementEnabled(false)
	}

	// The soft-alert event publisher (gateway.events.*, spec §8.3) rides the
	// same NATS connection as the budget counters; without NATS the alert
	// still logs but nothing is published.
	if nc != nil {
		budgetOpts = append(budgetOpts, llmproxy.WithAlertEventPublisher(nc))
		// budget.unbilled_stream rides the same connection but a DIFFERENT,
		// operator-only subject: a tenant must not be told in real time which
		// of its streams the gateway failed to bill (gateway-review).
		budgetOpts = append(budgetOpts, llmproxy.WithOpsEventPublisher(nc))
	}

	// Mount the /llm dialect surface over the embedded bifrost/core client.
	// WithLoopBreaker arms circular-routing guard #2 (spec §2.6) — it MUST be
	// present in production wiring; TestMainWiring asserts it.
	// WithStreamGrace / WithStreamDrainLimit arm the disconnect-billing path
	// (issue #9): a streamed response whose client vanishes keeps its provider
	// stream alive for a bounded grace period so the authoritative usage
	// trailer can still be billed, with the concurrent drains bounded. Without
	// this wiring a mid-stream disconnect is free inference — a hard-budget
	// bypass; TestMainWiring asserts both are present.
	handlerOpts := append(
		[]llmproxy.HandlerOption{
			llmproxy.WithModelResolver(modelResolver),
			llmproxy.WithLoopBreaker(),
			llmproxy.WithStreamGrace(cfg.StreamGrace),
			llmproxy.WithStreamDrainLimit(cfg.StreamDrainLimit),
		},
		budgetOpts...,
	)
	logger.Info("stream disconnect billing configured",
		"grace", cfg.StreamGrace, "drain_max_inflight", cfg.StreamDrainLimit)
	handler := llmproxy.NewHandler(
		llmproxy.NewBifrostRouter(srv.Core()),
		logger,
		[]byte(cfg.IdentitySecret),
		handlerOpts...,
	)
	mux.Handle("/llm/", api.NewRouter(handler))

	errCh := make(chan error, 1)
	go func() { errCh <- srv.ListenAndServe() }()

	select {
	case err := <-errCh:
		if err != nil {
			slog.Error("gateway server error", "err", err)
			os.Exit(1)
		}
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	// Phase 1 (issue #9 / gateway-review): tell in-flight stream drains to stop
	// waiting for provider usage trailers BEFORE the HTTP drain, so the stream
	// grace can never extend the pod's termination window. Billing stays OPEN.
	handler.StopStreamGrace()

	// Drain in-flight streams (§9.5: ≥150s ceiling applied inside Shutdown).
	// This must run BEFORE the billing drain: SSE handlers are still live here,
	// and a stream that settles during this window — including a drain that
	// just recovered an authoritative usage trailer — must still be able to
	// bill. Draining billing first set billingClosing while handlers were
	// running, so recovered spend was refused and dropped on every deploy.
	if err := srv.Shutdown(context.Background()); err != nil {
		slog.Error("gateway shutdown error", "err", err)
		os.Exit(1)
	}

	// Fix round-3 #1/#2: drain billing goroutines before the governance store
	// drains its persist goroutines, and both before the pool closes.
	// Extracted into drainForShutdown so the WIRING is unit-testable — a unit
	// test of Drain() in isolation does NOT catch a future removal of this call
	// (that "built-but-not-wired" gap recurred three times in review).
	drainForShutdown(handler, govStore)
}

// buildGovernance assembles the full governance engine (failmode primitives +
// GovernanceStore + cost.Calculator) and calls Start before returning.
//
// FIX #7: cfg.NATSDegradedCapUSD (float64 USD) is converted to int64 nano-USD
// and set on failmode.Params.DegradedCapNano so the per-replica degraded cap is
// enforced by the FSM (previously it was silently 0 — never set).
func buildGovernance(
	ctx context.Context,
	cfg config.Config,
	nc server.NATSClient,
	pool *pgxpool.Pool,
	logger *slog.Logger,
) (*governance.GovernanceStore, *cost.Calculator, error) {
	// FIX #7: convert the float64 USD cap to int64 nano-USD.
	var degradedCapNano int64
	if cfg.NATSDegradedCapUSD > 0 {
		degradedCapNano = int64(math.Round(cfg.NATSDegradedCapUSD * float64(failmode.NanoUSD)))
	}

	db := failmode.NewPoolDB(pool)
	fmStore := failmode.NewStore(db)
	degraded := failmode.NewDegradedCounters()

	// The concrete *nats.Client satisfies failmode.Counter (ReadBudget,
	// IncrBudgetIdempotent, BudgetSubject). server.NATSClient declares all
	// three so the interface assertion is safe.
	counter, ok := nc.(failmode.Counter)
	if !ok {
		return nil, nil, fmt.Errorf("NATS client does not implement failmode.Counter; expected *nats.Client")
	}
	rec := failmode.NewReconciler(db, counter, degraded, logger)

	params := failmode.Params{
		Mode:                failmode.FailMode(cfg.NATSFailMode),
		PGFreshness:         cfg.PGFreshnessMin,
		ExpectedReplicas:    cfg.ExpectedReplicas,
		DegradedCapNano:     degradedCapNano,             // FIX #7
		DegradedMaxDuration: cfg.NATSDegradedMaxDuration, // FIX #8 consumed by GovernanceStore
	}
	if params.Mode == "" {
		params.Mode = failmode.ModeTieredHybrid
	}
	if params.ExpectedReplicas < 1 {
		params.ExpectedReplicas = 1
	}

	// governance.NewGovernanceStore accepts its own unexported natsClient
	// interface; *nats.Client from srv.NATS() satisfies it. Go's structural
	// typing allows passing server.NATSClient here because all required methods
	// are present (IncrBudget, IncrBudgetIdempotent, ReadBudget, PublishDelta,
	// TryAlertCooldown, OnBreakerStateChange, BreakerState).
	govStore := governance.NewGovernanceStore(nc, fmStore, degraded, rec, params, logger)
	govStore.Start(ctx)

	calc := cost.New(cost.Config{
		DB:     cost.NewPoolQuerier(pool),
		Logger: logger,
	})

	return govStore, calc, nil
}

// budgetDisabledReason returns a human-readable explanation for why enforcement
// is off (for the startup warning log line).
func budgetDisabledReason(cfg config.Config, nc server.NATSClient, pool *pgxpool.Pool) string {
	if cfg.NATSURL == "" && pool == nil {
		return "NATSURL/DB not configured"
	}
	if cfg.NATSURL == "" {
		return "GATEWAY_NATS_URL not configured"
	}
	if nc == nil {
		return "NATS client unavailable at startup (connect failed)"
	}
	if pool == nil {
		return "DATABASE_URL not configured or DB pool unavailable"
	}
	return "unknown reason"
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// budgetEnforcementEnabled is the scrapable expvar gauge for budget enforcement
// status (Fix round-3 #9). Set once at startup; operators can alert on 0.
//
//	gateway_budget_enforcement_enabled == 1 → enforcement active
//	gateway_budget_enforcement_enabled == 0 → enforcement DISABLED (loud startup warning already logged)
var budgetEnforcementEnabled = expvar.NewInt("gateway_budget_enforcement_enabled")

// recordBudgetEnforcementEnabled sets the expvar gauge. Called once at startup
// after governance assembly succeeds or fails.
func recordBudgetEnforcementEnabled(enabled bool) {
	if enabled {
		budgetEnforcementEnabled.Set(1)
	} else {
		budgetEnforcementEnabled.Set(0)
	}
}

// billingDrainer / govDrainer are the minimal shutdown-drain surfaces of
// *llmproxy.Handler and *governance.GovernanceStore, extracted so the shutdown
// WIRING is testable (see drainForShutdown + its test).
type billingDrainer interface{ DrainBilling() }
type govDrainer interface{ Drain() }

// drainForShutdown drains in-flight work in the order that avoids dropped spend
// and Add-after-Wait on the governance persist WaitGroup:
//  1. billing goroutines (they may still call the store's UpdateUsage), then
//  2. the governance store's persist goroutines.
//
// Must run AFTER srv.Shutdown() (so streams settling in the HTTP drain window
// can still bill — issue #9 / gateway-review) and BEFORE the deferred
// pool.Close(). gov may be nil when budget enforcement is disabled.
func drainForShutdown(h billingDrainer, gov govDrainer) {
	if h != nil {
		h.DrainBilling()
	}
	// A nil *GovernanceStore stored in a non-nil interface must be treated as
	// absent (enforcement disabled path passes a typed-nil).
	if gov != nil {
		if gs, ok := gov.(*governance.GovernanceStore); ok && gs == nil {
			return
		}
		gov.Drain()
	}
}
