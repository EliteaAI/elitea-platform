package config

import (
	"testing"
	"time"
)

func TestFromEnvDefaults(t *testing.T) {
	// Ensure a clean environment for the keys we read.
	for _, k := range []string{
		"GATEWAY_HTTP_ADDR", "DATABASE_URL", "GATEWAY_SHUTDOWN_TIMEOUT",
		"GATEWAY_INITIAL_POOL_SIZE", "GATEWAY_PROVIDER_CONCURRENCY",
		"GATEWAY_LOG_LEVEL", "OTEL_SERVICE_NAME", "SERVICE_VERSION",
		"OTEL_EXPORTER_OTLP_ENDPOINT",
	} {
		t.Setenv(k, "")
	}

	cfg := FromEnv()

	if cfg.HTTPAddr != ":8083" {
		t.Errorf("HTTPAddr = %q, want :8083", cfg.HTTPAddr)
	}
	if cfg.ShutdownTimeout != DefaultShutdownTimeout {
		t.Errorf("ShutdownTimeout = %v, want %v", cfg.ShutdownTimeout, DefaultShutdownTimeout)
	}
	// §9.5: the shutdown drain window MUST be at least 150s.
	if cfg.ShutdownTimeout < 150*time.Second {
		t.Errorf("ShutdownTimeout = %v, must be >= 150s (§9.5)", cfg.ShutdownTimeout)
	}
	if cfg.InitialPoolSize != DefaultInitialPoolSize {
		t.Errorf("InitialPoolSize = %d, want %d", cfg.InitialPoolSize, DefaultInitialPoolSize)
	}
	if cfg.ProviderConcurrency != DefaultProviderConcurrency {
		t.Errorf("ProviderConcurrency = %d, want %d", cfg.ProviderConcurrency, DefaultProviderConcurrency)
	}
	// §9.5: concurrency MUST be well below bifrost's 1000-worker default.
	if cfg.ProviderConcurrency >= 1000 {
		t.Errorf("ProviderConcurrency = %d, must be tuned below 1000 (§9.5)", cfg.ProviderConcurrency)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LogLevel = %q, want info", cfg.LogLevel)
	}
	if cfg.ServiceName != "elitea-llm-gateway" {
		t.Errorf("ServiceName = %q, want elitea-llm-gateway", cfg.ServiceName)
	}
	if cfg.OTLPEndpoint != "" {
		t.Errorf("OTLPEndpoint = %q, want empty", cfg.OTLPEndpoint)
	}
}

func TestFromEnvOverrides(t *testing.T) {
	t.Setenv("GATEWAY_HTTP_ADDR", ":9999")
	t.Setenv("DATABASE_URL", "postgres://db/x")
	t.Setenv("GATEWAY_SHUTDOWN_TIMEOUT", "200s")
	t.Setenv("GATEWAY_INITIAL_POOL_SIZE", "42")
	t.Setenv("GATEWAY_PROVIDER_CONCURRENCY", "7")
	t.Setenv("GATEWAY_LOG_LEVEL", "debug")
	t.Setenv("OTEL_SERVICE_NAME", "gw-test")
	t.Setenv("SERVICE_VERSION", "1.2.3")
	t.Setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4317")

	cfg := FromEnv()

	if cfg.HTTPAddr != ":9999" {
		t.Errorf("HTTPAddr = %q", cfg.HTTPAddr)
	}
	if cfg.DatabaseURL != "postgres://db/x" {
		t.Errorf("DatabaseURL = %q", cfg.DatabaseURL)
	}
	if cfg.ShutdownTimeout != 200*time.Second {
		t.Errorf("ShutdownTimeout = %v", cfg.ShutdownTimeout)
	}
	if cfg.InitialPoolSize != 42 {
		t.Errorf("InitialPoolSize = %d", cfg.InitialPoolSize)
	}
	if cfg.ProviderConcurrency != 7 {
		t.Errorf("ProviderConcurrency = %d", cfg.ProviderConcurrency)
	}
	if cfg.LogLevel != "debug" {
		t.Errorf("LogLevel = %q", cfg.LogLevel)
	}
	if cfg.ServiceName != "gw-test" {
		t.Errorf("ServiceName = %q", cfg.ServiceName)
	}
	if cfg.ServiceVersion != "1.2.3" {
		t.Errorf("ServiceVersion = %q", cfg.ServiceVersion)
	}
	if cfg.OTLPEndpoint != "http://collector:4317" {
		t.Errorf("OTLPEndpoint = %q", cfg.OTLPEndpoint)
	}
}

func TestFromEnvInvalidValuesFallBackToDefaults(t *testing.T) {
	t.Setenv("GATEWAY_SHUTDOWN_TIMEOUT", "not-a-duration")
	t.Setenv("GATEWAY_INITIAL_POOL_SIZE", "-5")
	t.Setenv("GATEWAY_PROVIDER_CONCURRENCY", "abc")

	cfg := FromEnv()

	if cfg.ShutdownTimeout != DefaultShutdownTimeout {
		t.Errorf("ShutdownTimeout = %v, want default on invalid input", cfg.ShutdownTimeout)
	}
	if cfg.InitialPoolSize != DefaultInitialPoolSize {
		t.Errorf("InitialPoolSize = %d, want default on non-positive input", cfg.InitialPoolSize)
	}
	if cfg.ProviderConcurrency != DefaultProviderConcurrency {
		t.Errorf("ProviderConcurrency = %d, want default on invalid input", cfg.ProviderConcurrency)
	}
}
