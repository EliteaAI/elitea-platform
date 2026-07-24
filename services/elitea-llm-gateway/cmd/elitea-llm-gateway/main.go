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
	"fmt"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5/pgxpool"

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

	// account=nil → bootstrap account (zero providers). The vault-backed
	// Account is wired in by BF0.2-account.
	srv, err := server.New(ctx, cfg, logger, level, nil, mux)
	if err != nil {
		slog.Error("failed to initialise gateway", "err", err)
		os.Exit(1)
	}

	// Open the Postgres pool. It backs both the governance/failmode store
	// (FIX #0) and the synthetic /llm/v1/models resolver. The pool MUST live
	// for the entire server lifetime — closing it while the server is running
	// would break in-flight governance reads and model lookups.
	//
	// A configured-but-unreachable database is non-fatal: the /v1/models
	// surface reports an empty set, and the governance engine is simply not
	// wired (enforcement disabled with a loud warning).
	var (
		pool          *pgxpool.Pool
		modelResolver *llmproxy.ModelResolver
	)
	if pool, err = pgxpool.New(ctx, cfg.DatabaseURL); err != nil {
		logger.Warn("database pool unavailable; models resolver and budget enforcement disabled", "err", err)
	} else {
		// Defer pool.Close outside the if-block so it is ALWAYS called at
		// process exit, whether governance is wired or not.
		defer pool.Close()

		modelResolver = llmproxy.NewModelResolver(llmproxy.ModelResolverConfig{
			DB:     llmproxy.NewModelPoolQuerier(pool),
			Logger: logger,
		})
	}

	// FIX #0: assemble and wire the governance engine when both NATS and DB
	// are available. When either is absent, enforcement is DISABLED.
	var budgetOpts []llmproxy.HandlerOption
	nc := srv.NATS()
	if nc != nil && pool != nil {
		govStore, calcResult, govErr := buildGovernance(ctx, cfg, nc, pool, logger)
		if govErr != nil {
			logger.Error("BUDGET ENFORCEMENT DISABLED: governance assembly failed", "err", govErr)
		} else {
			budgetOpts = append(budgetOpts, llmproxy.WithBudgetGate(govStore, calcResult))
			logger.Info("budget enforcement ENABLED", "nats_url", cfg.NATSURL)
		}
	} else {
		logger.Warn("BUDGET ENFORCEMENT DISABLED: " + budgetDisabledReason(cfg, nc, pool))
	}

	// Mount the /llm dialect surface over the embedded bifrost/core client.
	handlerOpts := append(
		[]llmproxy.HandlerOption{llmproxy.WithModelResolver(modelResolver)},
		budgetOpts...,
	)
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

	// Drain in-flight streams (§9.5: ≥150s ceiling applied inside Shutdown).
	if err := srv.Shutdown(context.Background()); err != nil {
		slog.Error("gateway shutdown error", "err", err)
		os.Exit(1)
	}
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
		DegradedCapNano:     degradedCapNano,           // FIX #7
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
