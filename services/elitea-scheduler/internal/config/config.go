package config

import "os"

// Config holds all scheduler configuration from environment variables.
type Config struct {
	DatabaseURL string
	RedisURL    string

	PipelineSchedulingEnabled bool
	HTTPAddr                  string
	InstanceID                string
}

// FromEnv reads configuration from environment variables.
func FromEnv() Config {
	return Config{
		DatabaseURL:               envOr("DATABASE_URL", "postgres://elitea:elitea@localhost:5432/elitea?sslmode=disable"),
		RedisURL:                  envOr("REDIS_URL", "localhost:6379"),
		PipelineSchedulingEnabled: envOr("PIPELINE_SCHEDULING_ENABLED", "true") == "true",
		HTTPAddr:                  envOr("HTTP_ADDR", ":8081"),
		InstanceID:                envOr("SCHEDULER_INSTANCE_ID", hostname()),
	}
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
