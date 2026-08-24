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
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/infra/nats"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/policy"
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

	// The authored-governance plane (issue #218). It is a SEPARATE wiring from
	// the budget engine above and has different preconditions:
	//
	//   - It needs only a DATABASE POOL. A gateway with no NATS still enforces
	//     model allowlists, MCP allowlists, routing rules and rate policy; only
	//     the per-minute rate limits need a counter.
	//   - It survives a NATS-less deployment, which the budget engine does not.
	//
	// Wiring them together would have made every authored control depend on
	// NATS, which is how the definitions came to be enforced nowhere.
	var (
		policyStore   *policy.Store
		policyLimiter *policy.Limiter
	)
	if pool != nil {
		policyStore = policy.NewStore(policy.Config{
			DB:              policy.NewPoolQuerier(pool),
			Logger:          logger,
			RefreshInterval: cfg.GovernanceRefresh,
		})
		// Start performs the FIRST load synchronously, so the gateway is
		// enforcing what an operator authored before it serves a request.
		policyStore.Start(ctx)

		if rc, ok := nc.(policy.RateCounter); ok && nc != nil {
			policyLimiter = policy.NewLimiter(policy.LimiterConfig{
				Counter: rc,
				Subject: nats.RateLimitSubject,
				Logger:  logger,
			})
			logger.Info("GOVERNANCE ENFORCEMENT ENABLED: authored definitions are read from "+
				"gateway.governance_config, and per-minute rate limits run on the shared NATS counter",
				"refresh", cfg.GovernanceRefresh)
		} else {
			logger.Warn("GOVERNANCE RATE LIMITS DISABLED: no NATS counter is available, so an authored " +
				"tokens_per_min or requests_per_min ceiling is loaded and NOT enforced. Every other authored " +
				"control — model allowlists, MCP allowlists, routing rules, rate policy — is in force. " +
				"GET /governance/status reports this as rate_limits_enforceable=false")
		}
		var usage llmproxy.BudgetUsageReader
		if govStore != nil {
			usage = govStore
			// An authored budget row becomes the FALLBACK ceiling for a project
			// with no gateway.project_budget row. Without this the budget rows
			// on the governance page would load, appear in /governance/status,
			// and gate nothing — the same shape of gap the whole issue is about.
			govStore.SetBudgetDefaults(policyBudgetDefaults{store: policyStore})
		}
		budgetOpts = append(budgetOpts, llmproxy.WithGovernancePolicy(policyStore, policyLimiter, usage))
	} else {
		logger.Warn("GOVERNANCE ENFORCEMENT DISABLED: no database pool, so no authored governance definition " +
			"is read or enforced")
	}

	// The operator's answer to "is the rule I saved actually in force?".
	mux.HandleFunc("/governance/status", makeGovernanceStatusHandler(policyStore, policyLimiter))

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
	// The realtime WebSocket route (issue #323 follow-up). Its four options are
	// all load-bearing and TestMainWiring asserts each of them:
	//   - WithRealtimeDialer      without it the route answers 501 and the
	//                             pylon-indexer relay keeps its own LiteLLM.
	//   - WithRealtimeBudgetRecheck  a session is otherwise gated ONCE for its
	//                             whole life; bifrost's turn-start signal is one
	//                             the only known caller never sends.
	//   - WithRealtimeSessionLimit   a hijacked connection has no server-side
	//                             timeout, so nothing else bounds the pool.
	//   - WithRealtimeOrigins     a WebSocket handshake is not subject to CORS.
	handlerOpts := append(
		[]llmproxy.HandlerOption{
			llmproxy.WithModelResolver(modelResolver),
			llmproxy.WithLoopBreakerParams(breakerParams),
			llmproxy.WithStreamGrace(cfg.StreamGrace),
			llmproxy.WithStreamDrainLimit(cfg.StreamDrainLimit),
			llmproxy.WithEgressPolicy(egressPolicy),
			llmproxy.WithRealtimeDialer(llmproxy.NewBifrostRealtimeDialer(srv.Core(), logger)),
			llmproxy.WithRealtimeBudgetRecheck(cfg.RealtimeBudgetRecheck),
			llmproxy.WithRealtimeSessionLimit(cfg.RealtimeMaxSessions),
			llmproxy.WithRealtimeOrigins(cfg.RealtimeAllowedOrigins),
		},
		budgetOpts...,
	)
	logger.Info("stream disconnect billing configured",
		"grace", cfg.StreamGrace, "drain_max_inflight", cfg.StreamDrainLimit)
	logRealtimeMode(logger, cfg)
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

	if err := shutdownSequence(context.Background(), handler, srv, handler, handler, govStore); err != nil {
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
	// realtimeCloser ends live WebSocket sessions. It is its OWN seam and not
	// part of streamGraceStopper: a session is not a stream drain, and the two
	// run in different phases for different reasons (llmproxy/realtime.go,
	// CloseRealtimeSessions).
	realtimeCloser interface{ CloseRealtimeSessions(context.Context) }
	httpShutdowner interface {
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
//  3. CloseRealtimeSessions — live WebSocket sessions end. They are hijacked
//     connections, so ShutdownHTTP neither closed nor waited for them, and
//     their last turn still has to bill.
//  4. drainForShutdown — billing goroutines, then the governance store's
//     persist goroutines.
//  5. Close            — NATS last, once no further increment can be issued.
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
	rt realtimeCloser,
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
	if rt != nil {
		// AFTER ShutdownHTTP because http.Server.Shutdown neither closes nor
		// waits for a hijacked connection, so nothing else ends a session.
		// BEFORE the billing drain because a session's LAST turn spawns its
		// billing goroutine as it closes, and that goroutine needs billing open
		// and NATS live — the same reason a recovered stream trailer is billed
		// before billing closes.
		closeCtx, cancel := context.WithTimeout(ctx, llmproxy.RealtimeCloseTimeout)
		rt.CloseRealtimeSessions(closeCtx)
		cancel()
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
	// Issue #323: the audio money-path controls. An audio provider may sell by
	// the second or by the character, not by the token. The gateway prices all
	// three, but only from the catalog, so a model with no catalog audio rate is
	// still delivered and billed as zero. These counters are the only things
	// that say so out loud. The names come from the package that publishes them.
	for _, name := range llmproxy.AudioMetricNames() {
		metrics = append(metrics, gatewayMetric{
			name: name,
			kind: "counter",
			help: audioMetricHelp(name),
			v:    expvar.Get(name),
		})
	}
	// The price-catalog schema controls. A gateway pod that rolls out ahead of
	// elitea-migrate reads a gateway_models table with no audio price columns.
	// The catalog SELECT degrades to the pre-0086 statement so TOKEN pricing
	// survives the skew, and these two say the skew is happening: without them
	// the only signal is one log line per model per cache TTL. The name, the
	// kind and the help all come from the package that publishes the variable,
	// so a gauge cannot be scraped here as a counter.
	for _, m := range cost.Metrics() {
		metrics = append(metrics, gatewayMetric{
			name: m.Name,
			kind: m.Kind,
			help: m.Help,
			v:    expvar.Get(m.Name),
		})
	}
	// The realtime session controls. gateway_realtime_turns_unpriced_total is
	// the one that matters most: a transcription-intent turn reports usage that
	// bifrost's own extractor cannot read, and a turn nobody could price must be
	// a number an operator sees rather than a silent zero. The names come from
	// the package that publishes them.
	for _, name := range llmproxy.RealtimeMetricNames() {
		metrics = append(metrics, gatewayMetric{
			name: name,
			kind: "counter",
			help: realtimeMetricHelp(name),
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

// audioMetricHelp returns the help text for one audio counter.
//
// The default is a generic sentence and NOT an empty string on purpose. A new
// counter that reaches AudioMetricNames before it reaches this switch must
// still scrape: TestGatewayMetrics_EveryListedMetricIsPublished refuses an
// empty help text, so an empty default would turn a missing sentence into a
// red build for a control that works.
func audioMetricHelp(name string) string {
	switch name {
	case llmproxy.MetricAudioUnpriced:
		return "Count of audio responses the gateway could not price, because the provider reported no usable usage or the catalog carries no rate for the units it reported. Each one billed zero."
	case llmproxy.MetricAudioNonTokenBasis:
		return "Count of requests a non-token rate priced: a per-second or per-character catalog rate, not a per-token one."
	default:
		return "An audio money-path counter published by the llmproxy package."
	}
}

// realtimeMetricHelp returns the help text for one realtime counter. Its
// default is a generic sentence, never an empty string, for the reason
// audioMetricHelp gives: a counter that reaches the name list before it reaches
// this switch must still scrape.
func realtimeMetricHelp(name string) string {
	switch name {
	case llmproxy.MetricRealtimeSessionsOpened:
		return "Count of realtime WebSocket sessions that passed admission and completed the upgrade."
	case llmproxy.MetricRealtimeRefusedUnpricedModel:
		return "Count of realtime upgrades refused because the price catalogue holds no rate for the model. An unpriced session has no natural bound, so it is refused rather than billed as zero."
	case llmproxy.MetricRealtimeRefusedCapacity:
		return "Count of realtime upgrades refused because the global or per-project session pool was full."
	case llmproxy.MetricRealtimeTurnsBilled:
		return "Count of realtime turns whose usage reached the authoritative budget counter."
	case llmproxy.MetricRealtimeTurnsUnpriced:
		return "Count of realtime turns that ended with no usable usage, so nothing was billed for them."
	case llmproxy.MetricRealtimeTurnsRefused:
		return "Count of realtime turn starts the gateway did not forward to the provider because the budget gate did not admit them. Read gateway_realtime_frames_dropped_total beside it: the only known caller sends no turn-start event."
	case llmproxy.MetricRealtimeSessionsClosedBudget:
		return "Count of realtime sessions the budget gate closed: an exhausted budget, or too many consecutive gate outages."
	case llmproxy.MetricRealtimeFramesDropped:
		return "Count of client frames a realtime session did not forward to the provider because the budget gate was refusing. This is the number of frames a refusal really stopped; the turns counter cannot report it for a caller that sends no turn-start event."
	case llmproxy.MetricRealtimeTurnBasisMismatch:
		return "Count of realtime turns whose usage arrived on a price basis the catalogue does not carry for that model. Such a turn bills nothing, so this is the only signal that an admitted session bills zero."
	case llmproxy.MetricRealtimeTurnsUnbilled:
		return "Count of realtime turns whose provider-reported spend was dropped because billing was already draining."
	case llmproxy.MetricRealtimeSessionsClosedModel:
		return "Count of realtime sessions closed because a client frame asked the provider for a model that admission refused."
	default:
		return "A realtime session counter published by the llmproxy package."
	}
}

// logRealtimeMode states the realtime route's operator settings once at
// startup. The Origin policy is the half that must never be silent: an empty
// allowlist is the SECURE default (same-origin only), and an operator who
// widened it has to be able to see that from the log alone.
func logRealtimeMode(logger *slog.Logger, cfg config.Config) {
	if len(cfg.RealtimeAllowedOrigins) == 0 {
		logger.Info("REALTIME ROUTE ARMED: browser origins are restricted to the gateway's own host "+
			"(a WebSocket handshake is not subject to CORS, so this is the secure default). "+
			"Set LLM_REALTIME_ALLOWED_ORIGINS to admit a browser origin.",
			"budget_recheck", cfg.RealtimeBudgetRecheck, "max_sessions", cfg.RealtimeMaxSessions)
		return
	}
	logger.Warn("REALTIME ROUTE ARMED WITH A WIDENED ORIGIN POLICY: the listed browser origins may open "+
		"/llm/v1/realtime cross-site with the user's ambient credentials.",
		"origins", strings.Join(cfg.RealtimeAllowedOrigins, ","),
		"budget_recheck", cfg.RealtimeBudgetRecheck, "max_sessions", cfg.RealtimeMaxSessions)
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
