package server

import (
	"context"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

func TestBootstrapAccountSatisfiesInterface(t *testing.T) {
	var _ schemas.Account = newBootstrapAccount(50)
}

func TestBootstrapAccountReportsNoProviders(t *testing.T) {
	a := newBootstrapAccount(50)

	providers, err := a.GetConfiguredProviders()
	if err != nil {
		t.Fatalf("GetConfiguredProviders: %v", err)
	}
	if len(providers) != 0 {
		t.Errorf("providers = %v, want none", providers)
	}
}

func TestBootstrapAccountReturnsNoKeys(t *testing.T) {
	a := newBootstrapAccount(50)

	keys, err := a.GetKeysForProvider(context.Background(), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 0 {
		t.Errorf("keys = %v, want none", keys)
	}
}

func TestBootstrapAccountAppliesTunedConcurrency(t *testing.T) {
	const want = 37
	a := newBootstrapAccount(want)

	cfg, err := a.GetConfigForProvider(schemas.Anthropic)
	if err != nil {
		t.Fatalf("GetConfigForProvider: %v", err)
	}
	if cfg == nil {
		t.Fatal("GetConfigForProvider returned nil config")
	}
	// §9.5: per-provider concurrency must be the tuned value, not bifrost's
	// 1000-worker default.
	if cfg.ConcurrencyAndBufferSize.Concurrency != want {
		t.Errorf("Concurrency = %d, want %d", cfg.ConcurrencyAndBufferSize.Concurrency, want)
	}
	if cfg.ConcurrencyAndBufferSize.Concurrency >= schemas.DefaultConcurrency {
		t.Errorf("Concurrency = %d, must be below default %d (§9.5)",
			cfg.ConcurrencyAndBufferSize.Concurrency, schemas.DefaultConcurrency)
	}
}
