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
// Issue #11 widened that guard: the credential-backed Account is a second,
// independent reason the secret is mandatory (see startupIdentityCheck).
package main

import (
	"context"
	"encoding/json"
	"expvar"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"strings"
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

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	// Base mux, passed to the server as its http.Handler; the /llm chi router
	// is mounted below once the embedded bifrost client is available. /healthz
	// (process liveness, no dependency calls) is mounted immediately below;
	// /readyz is registered further down, once govStore exists, so it can
	// probe the NATS circuit breaker.
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", livenessHandler)

	// Issue #465: mount the operator controls on THIS mux. expvar publishes
	// /debug/vars on http.DefaultServeMux, which this process never serves, so
	// every published variable was unreadable. /metrics serves an allowlist —
	// see gatewayMetrics for why the full expvar surface stays unpublished.
	mux.Handle("/metrics", makeMetricsHandler(gatewayMetrics()))

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
			DB:              llmproxy.NewModelPoolQuerier(pool),
			Logger:          logger,
			PublicProjectID: cfg.PublicProjectIDString(),
		})
	}

	// Issue #11: the identity-secret guard MUST run once the two conditions that
	// make the secret mandatory are both known — budget enforcement (NATSURL)
	// and the credential-backed Account (pool). It runs here, before
	// server.New and therefore before the listener accepts a single request.
	if err := startupIdentityCheck(cfg.IdentitySecret, cfg.NATSURL != "", pool != nil); err != nil {
		slog.Error("FATAL: refusing to start", "err", err)
		os.Exit(1)
	}

	// BFF.6: assemble the vault-backed Account (BF0.2-account) so bifrost can
	// resolve real per-project provider credentials. Without a pool the
	// gateway keeps the zero-provider bootstrap account — it will start, but
	// every provider call fails until the database returns.
	var acct schemas.Account
	// egressPolicy backs /llm/v1/check_connection (#319): it needs the exact
	// same egress-allowlist decision GetKeysForProvider applies to persisted
	// credentials, for a credential under test that has no row yet. nil (no
	// pool) leaves the endpoint refusing every request — fail closed, not
	// silently unchecked.
	var egressPolicy llmproxy.EgressPolicy
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
			EgressAllowlist:     cfg.EgressAllowlist,
			PublicProjectID:     cfg.PublicProjectIDString(),
			Logger:              logger,
		})
		if aerr != nil {
			slog.Error("FATAL: vault-backed Account init failed", "err", aerr)
			os.Exit(1)
		}
		acct = eliteaAcct
		egressPolicy = eliteaAcct
		if len(cfg.SelfLLMOrigins) == 0 {
			logger.Warn("GATEWAY_SELF_LLM_ORIGINS is empty — the request-time SELF_REFERENTIAL_CREDENTIAL guard (spec §2.6 guard #1) is inert")
		}
		// Issue #13: the two egress policy modes differ in whether a tenant can
		// steer the gateway at a private address at all. Say which one is armed
		// at startup — an operator must not have to read the code to find out.
		if eliteaAcct.EgressAllowlistConfigured() {
			logger.Info("EGRESS ALLOWLIST ARMED: tenant-authored api_base hosts are restricted to GATEWAY_EGRESS_ALLOWLIST; "+
				"private-network destinations are permitted for the self-hosted provider classes (vLLM, Ollama)",
				"entries", len(cfg.EgressAllowlist))
		} else {
			logger.Warn("GATEWAY_EGRESS_ALLOWLIST is empty — tenant-authored api_base hosts are UNRESTRICTED (public only). " +
				"bifrost's SSRF-safe dialer stays on for every provider, so self-hosted vLLM/Ollama on a private " +
				"network will NOT work until the allowlist names those hosts (issue #13)")
		}
		// Issue #316: say whether platform-shared models are reachable. With the
		// scope off, a project sees only its own credentials, so a deployment
		// that runs on shared models alone has no usable model at all.
		if id := cfg.PublicProjectIDString(); id != "" {
			logger.Info("SHARED MODEL SCOPE ARMED: the gateway also reads the public project's shared credentials and models",
				"public_project_id", id)
		} else {
			logger.Warn("ELITEA_AI_PROJECT_ID is unset — platform-shared models are UNREACHABLE. " +
				"Each project can use only its own credentials and models (issue #316)")
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

	// The NATS circuit-breaker state is invisible to Kubernetes readiness
	// probes unless /readyz surfaces it: without this, a pod whose
	// budget-enforcement path is dead (breaker open/half-open) stays in the
	// load-balancer rotation. /healthz (liveness) stays unconditional so a
	// NATS blip does not get the pod restarted — only removed from Service
	// endpoints — see issue #242. govStore is nil when enforcement is
	// disabled, in which case the route reports ready unconditionally.
	//
	// Issue #304: "unconditionally" was wrong for one specific case — NATS
	// CONFIGURED but never reachable, so server.New left the client nil and
	// govStore was never built. That pod serves /llm with no budget gate and
	// no billing for the whole life of the process (server.New connects once;
	// nats.MaxReconnects(-1) only ever resurrects a connection that succeeded
	// at least once, and there is no later re-wire), yet reported ready.
	//
	// This is NOT a new fail-open/closed policy — it removes an inconsistency.
	// Lose NATS one second AFTER boot and Ping already fails, so /readyz
	// already answers 503 and the pod already drains, in EVERY fail mode. Lose
	// it one second BEFORE boot and the same outage produced the opposite
	// outcome: ready, serving, unmetered. The gate below makes the two agree.
	//
	// Scoped to GATEWAY_NATS_URL being set, so the NATS-less dev/CI posture
	// (URL unset ⇒ enforcement deliberately off) still reports ready.
	unwired := budgetEnforcementUnwired(cfg, govStore)
	if unwired {
		logger.Error("READINESS GATED: budget enforcement is configured but was not wired; /readyz will report not_ready",
			"reason", budgetDisabledReason(cfg, nc, pool))
	}
	//
	// Passing govStore straight into the pinger parameter puts a typed nil
	// *GovernanceStore into a non-nil interface, so makeReadyzHandler's
	// `p != nil` guard stays true and this dispatches to Ping. That used to
	// panic — every /readyz request, whenever GATEWAY_NATS_URL was unset
	// (the standard local/dev posture AND the pre-NATS window in a cluster) —
	// but Ping itself is now nil-receiver safe (see GovernanceStore.Ping),
	// which is the one guard this needs: any future caller that boxes a typed
	// nil *GovernanceStore into an interface is covered too, not just this
	// call site. Measured against the standalone compose stack.
	mux.HandleFunc("/readyz", makeReadyzHandler(govStore, unwired))

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

	// Issue #12: the per-(project_id, model) backstop's numbers are operator
	// settings, and the resulting mode is logged ONCE here. It was a hardcoded
	// 5 req/s + 30 s lockout armed in production under the name
	// "circular-routing guard #2" — it does no hop detection at all, and a
	// 50-VU run against a single tuple measured 99.96% HTTP 429. An operator
	// must be able to see, from the startup log alone, whether it is armed and
	// at what numbers.
	breakerParams := llmproxy.LoopBreakerParams{
		Threshold: cfg.LoopBreakerThreshold,
		Window:    cfg.LoopBreakerWindow,
		OpenFor:   cfg.LoopBreakerOpenFor,
	}
	logLoopBreakerMode(logger, breakerParams)

	// Mount the /llm dialect surface over the embedded bifrost/core client.
	// WithLoopBreakerParams arms the amplification backstop (spec §2.6 guard
	// #2's implementation) — it MUST be present in production wiring;
	// TestMainWiring asserts it.
	// WithStreamGrace / WithStreamDrainLimit arm the disconnect-billing path
	// (issue #9): a streamed response whose client vanishes keeps its provider
	// stream alive for a bounded grace period so the authoritative usage
	// trailer can still be billed, with the concurrent drains bounded. Without
	// this wiring a mid-stream disconnect is free inference — a hard-budget
	// bypass; TestMainWiring asserts both are present.
	handlerOpts := append(
		[]llmproxy.HandlerOption{
			llmproxy.WithModelResolver(modelResolver),
			llmproxy.WithLoopBreakerParams(breakerParams),
			llmproxy.WithStreamGrace(cfg.StreamGrace),
			llmproxy.WithStreamDrainLimit(cfg.StreamDrainLimit),
			llmproxy.WithEgressPolicy(egressPolicy),
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

	// A serve error must NOT skip the shutdown sequence: in-flight streams may
	// still hold recovered provider usage, and exiting straight from here drops
	// it (and leaks the NATS client). Record the failure, run the sequence, then
	// exit non-zero.
	failed := false
	select {
	case err := <-errCh:
		if err != nil {
			slog.Error("gateway server error", "err", err)
			failed = true
		}
	case <-ctx.Done():
		slog.Info("shutdown signal received")
	}

	if err := shutdownSequence(context.Background(), handler, srv, handler, govStore); err != nil {
		slog.Error("gateway shutdown error", "err", err)
		failed = true
	}
	if failed {
		os.Exit(1)
	}
}

// The four seams shutdownSequence drives. They are interfaces so the ordering
// can be asserted by executing it (TestShutdownSequence), not by reading
// main.go's source — the textual guard that preceded this could not see an
// os.Exit sitting between two calls, and missed a live regression.
type (
	streamGraceStopper interface{ StopStreamGrace() }
	httpShutdowner     interface {
		ShutdownHTTP(context.Context) error
		Close()
	}
)

// shutdownSequence runs the ONE ordering in which no spend is lost:
//
//  1. ShutdownHTTP     — the request surface quiesces and live SSE streams
//     settle. Billing is open, NATS is up, AND the stream grace is still armed,
//     so a client that disconnects during the drain is billed exactly as it
//     would be on a normal day.
//  2. StopStreamGrace  — only now do in-flight drains stop waiting for provider
//     usage trailers, so the grace cannot extend the pod's termination window
//     past this point. Billing stays OPEN.
//  3. drainForShutdown — billing goroutines, then the governance store's
//     persist goroutines.
//  4. Close            — NATS last, once no further increment can be issued.
//
// StopStreamGrace MUST NOT be hoisted above ShutdownHTTP. It both sets
// drainsClosing and closes the drainClosing channel, so running it first gives
// every stream that disconnects during the ~150 s HTTP drain grace=0 and cuts
// every parked drain — turning disconnect billing OFF for the whole duration of
// every rolling deploy, which is precisely the issue-#9 bypass. That regression
// shipped once (review round 3) and was invisible to a test that observed the
// usage chunk before the failing write, so the drain never participated.
//
// Every step earned its place from a reproduced money loss; see
// DECISIONS.md 2026-08-05. A failed HTTP shutdown does NOT abort the sequence:
// a drain that timed out is when pending spend is most likely, not least. The
// error is returned so the caller can still exit non-zero.
func shutdownSequence(
	ctx context.Context,
	grace streamGraceStopper,
	srv httpShutdowner,
	h billingDrainer,
	gov govDrainer,
) error {
	var err error
	if srv != nil {
		// §9.5: ≥150s ceiling applied inside ShutdownHTTP. The grace stays
		// armed throughout: drains are detached goroutines, not HTTP requests,
		// so they do not extend this call.
		err = srv.ShutdownHTTP(ctx)
	}
	if grace != nil {
		grace.StopStreamGrace()
	}
	drainForShutdown(h, gov)
	if srv != nil {
		srv.Close()
	}
	return err
}

// startupIdentityCheck returns a non-nil error when the gateway would serve
// traffic with identity verification switched off while something downstream
// depends on that identity being authentic. main() turns the error into a FATAL
// log + exit(1) BEFORE the listener is created.
//
// verifySignature (internal/llmproxy/identity.go) treats an EMPTY secret as
// "verification disabled" and returns true unconditionally. Whatever the caller
// puts in X-Elitea-Project-Id is then taken as the project identity verbatim.
// Two independent consumers make that fatal rather than merely degraded:
//
//   - budgetEnforcement (GATEWAY_NATS_URL set) — an unverified project id lets
//     any caller spend against any project's budget (the original FIX #9).
//   - credentialAccount (a Postgres pool, so the vault-backed Account is wired)
//     — GetKeysForProvider resolves and DECRYPTS that project's provider keys
//     from the Fernet vault. An unverified project id therefore hands any
//     caller any tenant's decrypted provider credentials (issue #11). This is
//     the case the NATS-only condition missed: a NATS-less deployment with a
//     database still wires the Account.
//
// Note the operational consequence, recorded in DECISIONS.md: DATABASE_URL has
// a non-empty default and pgxpool.New only PARSES the DSN (it does not dial),
// so credentialAccount is true in effectively every deployment. The guard is
// therefore unconditional in practice — GATEWAY_IDENTITY_SECRET is a required
// setting, and the Helm chart marks its Secret non-optional to match.
func startupIdentityCheck(identitySecret string, budgetEnforcement, credentialAccount bool) error {
	if identitySecret != "" {
		return nil
	}
	switch {
	case credentialAccount && budgetEnforcement:
		return fmt.Errorf("GATEWAY_IDENTITY_SECRET is empty: identity verification is disabled while the " +
			"vault-backed Account resolves per-project provider credentials AND budget enforcement is on — " +
			"an unauthenticated X-Elitea-Project-Id would select any tenant's decrypted credentials and budget")
	case credentialAccount:
		return fmt.Errorf("GATEWAY_IDENTITY_SECRET is empty: identity verification is disabled while the " +
			"vault-backed Account resolves per-project provider credentials from the Fernet vault — " +
			"an unauthenticated X-Elitea-Project-Id would select any tenant's decrypted credentials (issue #11)")
	case budgetEnforcement:
		return fmt.Errorf("GATEWAY_IDENTITY_SECRET is empty: identity verification is disabled while budget " +
			"enforcement is enabled (GATEWAY_NATS_URL is set) — the per-project HMAC would be bypassable")
	}
	return nil
}

// logLoopBreakerMode states, once at startup, whether the per-(project, model)
// amplification backstop is armed and with what numbers (issue #12).
//
// Two failure modes this exists to prevent, both of which have happened here:
// a guard that is silently DISARMED while operators believe it is on, and a
// guard that is silently armed at numbers ordinary traffic trips. It resolves
// the same "unset ⇒ default" rules newLoopBreaker applies, so what is logged is
// what is enforced rather than the raw env values.
func logLoopBreakerMode(logger *slog.Logger, p llmproxy.LoopBreakerParams) {
	if p.Threshold < 0 {
		logger.Warn("LOOP BREAKER DISARMED: LLM_LOOP_BREAKER_THRESHOLD is negative — no per-(project, model) " +
			"amplification backstop is active on this replica (issue #12)")
		return
	}
	threshold := p.Threshold
	if threshold == 0 {
		threshold = llmproxy.DefaultLoopBreakerThreshold
	}
	window := p.Window
	if window <= 0 {
		window = llmproxy.DefaultLoopBreakerWindow
	}
	openFor := p.OpenFor
	if openFor <= 0 {
		openFor = llmproxy.DefaultLoopBreakerOpenFor
	}
	logger.Info("LOOP BREAKER ARMED: per-(project_id, model) amplification backstop — NOT a loop detector "+
		"(it does no hop detection; see issue #12). Requests for one tuple above the threshold within the "+
		"window are rejected with 429 for the open duration.",
		"threshold", threshold, "window", window, "open_for", openFor)
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

// budgetEnforcementUnwired reports whether this process was CONFIGURED to
// enforce budgets but could not wire enforcement at startup (issue #304).
//
// GATEWAY_NATS_URL being set is the operator's statement that this deployment
// enforces budgets; a nil govStore is the statement that it does not. When the
// two disagree the pod is serving /llm with no budget gate and no billing, and
// it will keep doing so until it is restarted — server.New dials NATS exactly
// once, and nothing rebuilds govStore afterwards. Callers use this to gate
// /readyz so the pod drains instead of silently serving unmetered traffic.
//
// govStore is a concrete pointer rather than an interface on purpose: the
// caller's variable is a typed *governance.GovernanceStore, and taking it as
// an interface here would reintroduce the typed-nil-in-non-nil-interface trap
// that already produced a /readyz panic once.
func budgetEnforcementUnwired(cfg config.Config, govStore *governance.GovernanceStore) bool {
	return cfg.NATSURL != "" && govStore == nil
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

// metricBudgetEnforcementEnabled is the name of the budget-enforcement gauge.
const metricBudgetEnforcementEnabled = "gateway_budget_enforcement_enabled"

// budgetEnforcementEnabled is the budget-enforcement gauge (Fix round-3 #9).
// It is set once at startup. The gateway serves it on GET /metrics, so an
// operator can alarm on the value 0.
//
//	gateway_budget_enforcement_enabled == 1 → enforcement active
//	gateway_budget_enforcement_enabled == 0 → enforcement DISABLED (loud startup warning already logged)
//
// Issue #465: this gauge had NO route for its whole life. expvar registers
// /debug/vars on http.DefaultServeMux, and this process never serves that mux.
// The alarm this gauge exists for could not be built. That mattered most for
// issue #304: a gateway that starts while NATS is unreachable enforces nothing
// for the life of the process, and this gauge is the control that reports it.
var budgetEnforcementEnabled = expvar.NewInt(metricBudgetEnforcementEnabled)

// recordBudgetEnforcementEnabled sets the gauge. Called once at startup
// after governance assembly succeeds or fails.
func recordBudgetEnforcementEnabled(enabled bool) {
	if enabled {
		budgetEnforcementEnabled.Set(1)
	} else {
		budgetEnforcementEnabled.Set(0)
	}
}

// gatewayMetric is one variable that GET /metrics serves.
type gatewayMetric struct {
	name string
	// kind is the Prometheus metric type: "gauge" or "counter".
	kind string
	help string
	v    expvar.Var
}

// gatewayMetrics lists every variable GET /metrics serves, in a fixed order.
//
// The list is an ALLOWLIST, and that is the answer to the second half of issue
// #465: /debug/vars must NOT be public. expvar.Handler() writes every variable
// the process publishes, which includes `cmdline` (the process arguments) and
// `memstats`, plus anything any dependency publishes. This route writes the
// gateway's own controls and nothing else.
//
// The listener that serves this route also serves /llm. In the shipped
// deployment that listener is a ClusterIP Service with mutual TLS, and the
// edge proxies only the /llm paths, so /metrics is reachable from inside the
// cluster and not from a tenant.
//
// The model-map names come from llmproxy.ModelMapMetricNames, so the package
// that publishes a counter also states its name. Nothing here copies a name
// from another file.
func gatewayMetrics() []gatewayMetric {
	metrics := []gatewayMetric{{
		name: metricBudgetEnforcementEnabled,
		kind: "gauge",
		help: "1 when this gateway enforces budgets. 0 when enforcement is off.",
		v:    budgetEnforcementEnabled,
	}}
	for _, name := range llmproxy.ModelMapMetricNames() {
		metrics = append(metrics, gatewayMetric{
			name: name,
			kind: "counter",
			help: "Count of requests the model map refused because it could not read the project model set.",
			v:    expvar.Get(name),
		})
	}
	// Issue #515: the budget-outage controls. A row that the recovery pass owns
	// holds back the durable spend for its scope, and before these two lines
	// nothing outside the log said so. The name and the value both come from
	// the failmode package, which publishes them.
	metrics = append(metrics,
		gatewayMetric{
			name: failmode.MetricBudgetOutageRows,
			kind: "gauge",
			help: "Accumulator rows the gateway recovery pass still owns. Above zero, the durable spend for those scopes does not advance.",
			v:    expvar.Get(failmode.MetricBudgetOutageRows),
		},
		gatewayMetric{
			name: failmode.MetricBudgetRecoveryFailuresTotal,
			kind: "counter",
			help: "Count of scopes a recovery pass could not reconcile. The rows stay held until a later pass succeeds.",
			v:    expvar.Get(failmode.MetricBudgetRecoveryFailuresTotal),
		},
	)
	return metrics
}

// makeMetricsHandler answers GET /metrics with the given variables, in the
// Prometheus text exposition format. That format is what an operator's alarm
// reads, and the gateway published no metrics route before issue #465.
//
// A variable that is not published writes an `# UNPUBLISHED` comment line. It
// does not write nothing: a name that silently disappears from a scrape looks
// the same as a control that reports zero, and this repository has lost several
// controls that way. TestGatewayMetrics_EveryListedMetricIsPublished fails
// before an operator ever sees such a line.
func makeMetricsHandler(metrics []gatewayMetric) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var b strings.Builder
		for _, m := range metrics {
			if m.v == nil {
				b.WriteString("# UNPUBLISHED " + m.name + "\n")
				continue
			}
			b.WriteString("# HELP " + m.name + " " + m.help + "\n")
			b.WriteString("# TYPE " + m.name + " " + m.kind + "\n")
			b.WriteString(m.name + " " + m.v.String() + "\n")
		}
		w.Header().Set("Content-Type", "text/plain; version=0.0.4; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = io.WriteString(w, b.String())
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
// Must run between srv.ShutdownHTTP() (so streams settling in the HTTP drain
// window can still bill) and srv.Close() (so increments still have a live NATS
// client) — see shutdownSequence. gov may be nil when budget enforcement is
// disabled.
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

type pinger interface {
	Ping(context.Context) error
}

// healthStatus mirrors elitea-main's health.Status shape
// (internal/api/health/handler.go) so both services' probes look the same to
// an operator reading a JSON body.
type healthStatus struct {
	Status string            `json:"status"`
	Checks map[string]string `json:"checks,omitempty"`
}

func writeHealthJSON(w http.ResponseWriter, code int, v healthStatus) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// livenessHandler answers /healthz: process-liveness only, no dependency
// calls, always 200 while the server loop is alive. A NATS blip must not
// fail this — that is what /readyz is for (issue #242).
func livenessHandler(w http.ResponseWriter, _ *http.Request) {
	writeHealthJSON(w, http.StatusOK, healthStatus{Status: "ok"})
}

// makeReadyzHandler answers /readyz: the dependency-checked probe. p is the
// NATS circuit breaker (govStore); a nil p means budget enforcement is
// disabled, so readiness is unconditional. This is the handler that used to
// be mounted at /healthz.
//
// enforcementUnwired (issue #304) is the one case a nil p must NOT be read as
// "deliberately disabled": NATS was configured, the connect failed at boot,
// and nothing re-wires enforcement for the life of the process. It is decided
// once at startup because that is exactly how long it stays true — a nil
// govStore never becomes non-nil. Checked BEFORE the p == nil guard because
// the disabled path passes a typed-nil *GovernanceStore, which is non-nil as
// an interface and whose Ping is nil-receiver safe and returns success.
func makeReadyzHandler(p pinger, enforcementUnwired bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if enforcementUnwired {
			writeHealthJSON(w, http.StatusServiceUnavailable, healthStatus{
				Status: "not_ready",
				Checks: map[string]string{"budget_enforcement": "unwired"},
			})
			return
		}
		if p == nil {
			writeHealthJSON(w, http.StatusOK, healthStatus{Status: "ready"})
			return
		}
		if err := p.Ping(r.Context()); err != nil {
			writeHealthJSON(w, http.StatusServiceUnavailable, healthStatus{
				Status: "not_ready",
				Checks: map[string]string{"nats": "unavailable"},
			})
			return
		}
		writeHealthJSON(w, http.StatusOK, healthStatus{
			Status: "ready",
			Checks: map[string]string{"nats": "ok"},
		})
	}
}
