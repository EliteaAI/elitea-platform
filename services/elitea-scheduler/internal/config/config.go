package config

import (
	"os"
	"time"
)

// Config holds all scheduler configuration from environment variables.
type Config struct {
	DatabaseURL string
	RedisURL    string
	RPCChannel  string
	RPCHMACKey  string
	HTTPAddr    string
	InstanceID  string

	// Price-sync worker (design §8.8). Disabled by default so environments that
	// have not yet provisioned gateway.gateway_models are unaffected.
	PriceSyncEnabled  bool
	PriceSyncInterval time.Duration
	PriceSyncLiteLLM  bool
	PriceSyncSeed     bool
	PriceSyncURL      string
}

// FromEnv reads configuration from environment variables.
func FromEnv() Config {
	return Config{
		DatabaseURL: envOr("DATABASE_URL", "postgres://elitea:elitea@localhost:5432/elitea?sslmode=disable"),
		RedisURL:    envOr("REDIS_URL", "localhost:6379"),
		RPCChannel:  envOr("RPC_CHANNEL", "elitea_rpc"),
		RPCHMACKey:  os.Getenv("RPC_HMAC_KEY"),
		HTTPAddr:    envOr("HTTP_ADDR", ":8081"),
		InstanceID:  envOr("SCHEDULER_INSTANCE_ID", hostname()),

		PriceSyncEnabled:  boolEnv("PRICE_SYNC_ENABLED", false),
		PriceSyncInterval: durationEnv("PRICE_SYNC_INTERVAL", 24*time.Hour),
		PriceSyncLiteLLM:  boolEnv("PRICE_SYNC_LITELLM", true),
		PriceSyncSeed:     boolEnv("PRICE_SYNC_SEED", true),
		PriceSyncURL:      os.Getenv("PRICE_SYNC_LITELLM_URL"),
	}
}

// boolEnv reads a boolean env var; "1"/"true"/"yes" (any case) are true.
func boolEnv(key string, fallback bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	switch v {
	case "1", "true", "TRUE", "True", "yes", "YES":
		return true
	case "0", "false", "FALSE", "False", "no", "NO":
		return false
	default:
		return fallback
	}
}

// durationEnv reads a Go duration env var (e.g. "24h"), falling back on parse error.
func durationEnv(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func hostname() string {
	h, _ := os.Hostname()
	if h == "" {
		return "scheduler-0"
	}
	return h
}
