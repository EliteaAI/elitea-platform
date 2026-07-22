package config

import (
	"os"
	"strconv"
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

	// Budget write-back consumer (design §8.6): the durable pull consumer that
	// drains GATEWAY_BUDGET_DELTAS into gateway.llm_budget_accumulators. Disabled
	// by default (empty NATS URL) so environments without NATS are unaffected;
	// enabling requires GATEWAY_NATS_URL, matching the gateway's NATS env name.
	BudgetWriteBackEnabled    bool
	BudgetWriteBackNATSURL    string
	BudgetWriteBackBatchSize  int
	BudgetWriteBackAckWait    time.Duration
	BudgetWriteBackMaxDeliver int
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

		BudgetWriteBackEnabled:    boolEnv("BUDGET_WRITEBACK_ENABLED", false),
		BudgetWriteBackNATSURL:    os.Getenv("GATEWAY_NATS_URL"),
		BudgetWriteBackBatchSize:  intEnv("BUDGET_WRITEBACK_BATCH_SIZE", 500),
		BudgetWriteBackAckWait:    durationEnv("BUDGET_WRITEBACK_ACK_WAIT", 30*time.Second),
		BudgetWriteBackMaxDeliver: intEnv("BUDGET_WRITEBACK_MAX_DELIVER", 10),
	}
}

// intEnv reads an integer env var, falling back on empty/parse error.
func intEnv(key string, fallback int) int {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return fallback
	}
	return n
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
