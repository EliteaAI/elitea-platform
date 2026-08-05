// Package config loads elitea-llm-gateway settings from the environment.
//
// The defaults encode the pre-cutover deployment guidance from
// design-bifrost-gateway §9.5: a long shutdown drain window (≥150s) so
// rolling deploys do not truncate in-flight LLM streams, a disabled write
// deadline on the /llm SSE path, a tuned-down bifrost object pool, and a
// per-provider worker concurrency well below bifrost's 1000-worker default.
package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	// DefaultShutdownTimeout is the ceiling on srv.Shutdown()'s context.
	// It MUST be ≥150s and rise together with the Deployment's
	// terminationGracePeriodSeconds so provider streams (up to ~120s) drain
	// instead of being hard-killed on every rolling deploy (§9.5).
	DefaultShutdownTimeout = 150 * time.Second

	// DefaultInitialPoolSize tunes BifrostConfig.InitialPoolSize down from
	// bifrost's memory-hungry default so the process fits the ≥1Gi memory
	// limit (§9.5, §6.1).
	DefaultInitialPoolSize = 100

	// DefaultProviderConcurrency tunes each provider's
	// ProviderConfig.ConcurrencyAndBufferSize.Concurrency down from bifrost's
	// 1000-worker-per-provider default (§9.5, §6.1).
	DefaultProviderConcurrency = 50

	// DefaultNATSReplicas is the KV/stream replica count the gateway requests
	// when it provisions its assets. 1 is the scale-1 baseline; HA operators
	// MUST override to the real replica count (≥3) — a 1-replica store has no
	// quorum (design §9.5, LLM_BUDGET_EXPECTED_REPLICAS).
	DefaultNATSReplicas = 1

	// DefaultCBFailureThreshold trips the budget-path circuit breaker after this
	// many consecutive NATS failures (design §8.5, LLM_BUDGET_CB_FAILURE_THRESHOLD).
	DefaultCBFailureThreshold = 3

	// DefaultCBOpenDuration is how long the breaker stays open before probing
	// half-open (design §8.5, LLM_BUDGET_CB_OPEN_DURATION_SEC).
	DefaultCBOpenDuration = 10 * time.Second

	// DefaultStreamGrace / MaxStreamGrace bound how long an early-exiting
	// stream keeps its provider stream alive waiting for the authoritative
	// usage trailer (issue #9, LLM_STREAM_GRACE_MS). These MUST equal
	// llmproxy.DefaultStreamGrace / llmproxy.MaxStreamGrace — the rationale for
	// the values lives there, and TestStreamGraceConstantsInSync enforces the
	// pairing so the env default and the handler default cannot drift apart.
	DefaultStreamGrace = 5 * time.Second
	MaxStreamGrace     = 15 * time.Second

	// DefaultStreamDrainLimit bounds concurrent abandoned-stream drains
	// (LLM_STREAM_DRAIN_MAX_INFLIGHT). MUST equal llmproxy.DefaultStreamDrainLimit.
	DefaultStreamDrainLimit = 256

	// DefaultNATSFailMode is the platform-baseline NATS-failure policy (§8.5,
	// LLM_BUDGET_NATS_FAIL_MODE). A per-project override on
	// gateway.project_budget.nats_fail_mode may narrow it.
	DefaultNATSFailMode = "tiered_hybrid"

	// DefaultPGFreshnessMin is how old the Postgres snapshot may be and still be
	// trusted for the tiered-hybrid fallback (§8.5, LLM_BUDGET_PG_FRESHNESS_MIN).
	// A snapshot older than this ⇒ NATS_DOWN_PG_STALE ⇒ 503.
	DefaultPGFreshnessMin = 5 * time.Minute

	// DefaultNATSDegradedMaxDuration is the continuous-outage ceiling; once NATS
	// has been down longer than this the FSM forces closed (503) regardless of
	// snapshot freshness (§8.5, LLM_BUDGET_NATS_DEGRADED_MAX_DURATION_MIN).
	DefaultNATSDegradedMaxDuration = 10 * time.Minute

	// DefaultNATSDegradedCapPct is the per-replica degraded-window overspend cap
	// expressed as a percentage of hard_limit_usd when
	// LLM_BUDGET_NATS_DEGRADED_CAP_USD is unset (§8.5, "default 10 % of
	// hard_limit_usd"). A positive LLM_BUDGET_NATS_DEGRADED_CAP_USD overrides it
	// with an absolute USD cap.
	DefaultNATSDegradedCapPct = 10
)

// Config holds the resolved gateway configuration.
type Config struct {
	// HTTPAddr is the listen address for the /llm HTTP server.
	HTTPAddr string
	// DatabaseURL is the Postgres DSN (Fernet vault + governance rows live here).
	DatabaseURL string
	// ShutdownTimeout bounds graceful shutdown; ≥150s (§9.5).
	ShutdownTimeout time.Duration
	// InitialPoolSize is passed to BifrostConfig.InitialPoolSize.
	InitialPoolSize int
	// ProviderConcurrency is applied per-provider via the Account interface.
	ProviderConcurrency int
	// LogLevel controls the slog handler level ("debug"|"info"|"warn"|"error").
	LogLevel string
	// ServiceName / ServiceVersion feed the OTel resource.
	ServiceName    string
	ServiceVersion string
	// OTLPEndpoint is the OTel collector endpoint ("" disables export).
	OTLPEndpoint string
	// IdentitySecret is the HMAC key the gateway uses to verify the edge's
	// signed identity headers (design §5.3). Empty disables verification (the
	// mTLS transport still authenticates the hop); it MUST match elitea-main's
	// IdentitySecret when set.
	IdentitySecret string

	// NATSURL is the NATS JetStream server URL (nats://host:4222) backing the
	// budget-enforcement path (design §8). Empty disables NATS wiring: the
	// gateway then serves /llm without budget enforcement (dev/test only), so
	// startup does not hard-fail when no NATS cluster is reachable.
	NATSURL string
	// NATSReplicas is the KV/stream replica count the gateway requests when
	// provisioning its assets (§9.5); ≥3 for HA quorum.
	NATSReplicas int
	// CBFailureThreshold trips the budget-path circuit breaker after this many
	// consecutive NATS failures (§8.5).
	CBFailureThreshold uint32
	// CBOpenDuration is how long the breaker stays open before probing half-open
	// (§8.5).
	CBOpenDuration time.Duration

	// NATSFailMode is the platform-baseline tiered-hybrid fail policy (§8.5):
	// "tiered_hybrid" (default) | "fail_open" | "fail_closed". A per-project
	// gateway.project_budget.nats_fail_mode overrides it (NULL inherits this).
	NATSFailMode string
	// PGFreshnessMin bounds how stale the Postgres snapshot may be before the
	// fallback degrades to 503 (§8.5, NATS_DOWN_PG_STALE).
	PGFreshnessMin time.Duration
	// NATSDegradedMaxDuration is the continuous-outage ceiling before the FSM
	// forces closed (503) regardless of snapshot freshness (§8.5).
	NATSDegradedMaxDuration time.Duration
	// NATSDegradedCapUSD is an absolute per-replica degraded-window overspend cap
	// in USD (§8.5). 0 means "use DefaultNATSDegradedCapPct % of hard_limit_usd".
	NATSDegradedCapUSD float64
	// ExpectedReplicas is the operator-configured replica count used for the
	// NATS_DOWN_PG_FRESH_NEAR per-replica cap (§8.5, LLM_BUDGET_EXPECTED_REPLICAS,
	// default 1). It reuses NATSReplicas' env var; kept distinct so the FSM reads
	// an int replica count without re-parsing.
	ExpectedReplicas int

	// TLS / mTLS (FIX #10). When TLSCertFile and TLSKeyFile are both set the
	// server switches to ListenAndServeTLS. When TLSCAFile is also set, client
	// certificates are required and verified against the CA bundle (mTLS).
	// All three are empty by default (plain HTTP, for local/dev use).
	TLSCertFile string
	TLSKeyFile  string
	TLSCAFile   string

	// StreamGrace is how long a streamed response whose SSE loop exited early
	// (client disconnect, mid-stream provider error, failed stream setup) may
	// keep its PROVIDER stream alive waiting for the authoritative usage
	// trailer, so the tokens the provider actually produced can be billed
	// (issue #9, DECISIONS.md 2026-08-05). Read from LLM_STREAM_GRACE_MS,
	// clamped to [0, llmproxy.MaxStreamGrace]. 0 disables the mechanism: the
	// provider stream is then torn down with the client request as before and
	// an early exit bills nothing (the loss is still metered).
	StreamGrace time.Duration
	// StreamDrainLimit bounds how many abandoned streams may be drained
	// concurrently; each holds a goroutine and an open provider socket for up
	// to StreamGrace. Read from LLM_STREAM_DRAIN_MAX_INFLIGHT.
	StreamDrainLimit int

	// SelfLLMOrigins are the platform's own /llm origins (comma-separated in
	// GATEWAY_SELF_LLM_ORIGINS, e.g. "https://dev.elitea.ai/llm/v1,
	// http://elitea-main:8080/llm/v1"). Any credential api_base matching one
	// of these is rejected with SELF_REFERENTIAL_CREDENTIAL (spec §2.6 guard
	// #1). Empty = the request-time guard is inert (the upsert-time guard in
	// elitea-main still applies).
	SelfLLMOrigins []string
}

// FromEnv builds a Config from environment variables, applying the §9.5
// defaults for any value that is unset or invalid.
func FromEnv() Config {
	return Config{
		HTTPAddr:            envOr("GATEWAY_HTTP_ADDR", ":8083"),
		DatabaseURL:         envOr("DATABASE_URL", "postgres://localhost:5432/elitea?sslmode=disable"),
		ShutdownTimeout:     durationOr("GATEWAY_SHUTDOWN_TIMEOUT", DefaultShutdownTimeout),
		InitialPoolSize:     intOr("GATEWAY_INITIAL_POOL_SIZE", DefaultInitialPoolSize),
		ProviderConcurrency: intOr("GATEWAY_PROVIDER_CONCURRENCY", DefaultProviderConcurrency),
		LogLevel:            envOr("GATEWAY_LOG_LEVEL", "info"),
		ServiceName:         envOr("OTEL_SERVICE_NAME", "elitea-llm-gateway"),
		ServiceVersion:      envOr("SERVICE_VERSION", "dev"),
		OTLPEndpoint:        os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT"),
		IdentitySecret:      os.Getenv("GATEWAY_IDENTITY_SECRET"),
		NATSURL:             os.Getenv("GATEWAY_NATS_URL"),
		NATSReplicas:        intOr("LLM_BUDGET_EXPECTED_REPLICAS", DefaultNATSReplicas),
		CBFailureThreshold:  uint32Or("LLM_BUDGET_CB_FAILURE_THRESHOLD", DefaultCBFailureThreshold),
		CBOpenDuration:      secondsOr("LLM_BUDGET_CB_OPEN_DURATION_SEC", DefaultCBOpenDuration),

		NATSFailMode:            failModeOr("LLM_BUDGET_NATS_FAIL_MODE", DefaultNATSFailMode),
		PGFreshnessMin:          minutesOr("LLM_BUDGET_PG_FRESHNESS_MIN", DefaultPGFreshnessMin),
		NATSDegradedMaxDuration: minutesOr("LLM_BUDGET_NATS_DEGRADED_MAX_DURATION_MIN", DefaultNATSDegradedMaxDuration),
		NATSDegradedCapUSD:      floatOr("LLM_BUDGET_NATS_DEGRADED_CAP_USD", 0),
		ExpectedReplicas:        intOr("LLM_BUDGET_EXPECTED_REPLICAS", DefaultNATSReplicas),
		TLSCertFile:             os.Getenv("GATEWAY_TLS_CERT_FILE"),
		TLSKeyFile:              os.Getenv("GATEWAY_TLS_KEY_FILE"),
		TLSCAFile:               os.Getenv("GATEWAY_TLS_CA_FILE"),
		StreamGrace:             millisOr("LLM_STREAM_GRACE_MS", DefaultStreamGrace, MaxStreamGrace),
		StreamDrainLimit:        intOr("LLM_STREAM_DRAIN_MAX_INFLIGHT", DefaultStreamDrainLimit),
		SelfLLMOrigins:          csvOr("GATEWAY_SELF_LLM_ORIGINS"),
	}
}

// millisOr reads an integer number of milliseconds from key and clamps it to
// [0, max]. Unlike the other *Or helpers it accepts an explicit 0 — for
// LLM_STREAM_GRACE_MS zero is a meaningful value (disable the stream-grace
// mechanism), not "unset". A negative or unparsable value falls back to def.
func millisOr(key string, def, max time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 0 {
		return def
	}
	// Clamp on the INTEGER, before the multiply. n * time.Millisecond overflows
	// int64 for absurd values and wraps negative, which would sail past a
	// post-multiply `d > max` check and silently DISABLE the mechanism instead
	// of capping it.
	if int64(n) > int64(max/time.Millisecond) {
		return max
	}
	return time.Duration(n) * time.Millisecond
}

// csvOr splits a comma-separated env var into trimmed, non-empty entries.
func csvOr(key string) []string {
	raw := os.Getenv(key)
	if raw == "" {
		return nil
	}
	var out []string
	for _, part := range strings.Split(raw, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

func envOr(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func intOr(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return def
}

func durationOr(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			return d
		}
	}
	return def
}

func uint32Or(key string, def uint32) uint32 {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.ParseUint(v, 10, 32); err == nil && n > 0 {
			return uint32(n)
		}
	}
	return def
}

// secondsOr reads an integer number of seconds from key and returns it as a
// time.Duration. The design surfaces the breaker open-duration knob as
// LLM_BUDGET_CB_OPEN_DURATION_SEC (a bare integer), not a Go duration string.
func secondsOr(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Second
		}
	}
	return def
}

// minutesOr reads an integer number of minutes from key. The §8.5 freshness /
// max-duration knobs are surfaced as bare integer minutes
// (LLM_BUDGET_PG_FRESHNESS_MIN, LLM_BUDGET_NATS_DEGRADED_MAX_DURATION_MIN).
func minutesOr(key string, def time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return time.Duration(n) * time.Minute
		}
	}
	return def
}

// floatOr reads a non-negative float from key (LLM_BUDGET_NATS_DEGRADED_CAP_USD,
// a USD amount). A missing / invalid / negative value returns def.
func floatOr(key string, def float64) float64 {
	if v := os.Getenv(key); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f >= 0 {
			return f
		}
	}
	return def
}

// failModeOr reads the NATS fail-mode policy, accepting only the three valid
// values (§8.5). Any other value falls back to def so a typo cannot silently
// disable enforcement.
func failModeOr(key, def string) string {
	switch os.Getenv(key) {
	case "tiered_hybrid", "fail_open", "fail_closed":
		return os.Getenv(key)
	default:
		return def
	}
}
