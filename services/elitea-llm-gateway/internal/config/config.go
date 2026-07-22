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
	}
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
