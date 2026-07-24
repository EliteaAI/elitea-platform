package server

import (
	"context"

	"github.com/maximhq/bifrost/core/schemas"
)

// bootstrapAccount is a minimal, fully-working schemas.Account used to
// initialise bifrost/core at gateway startup before any provider credentials
// are wired.
//
// bifrost.Init requires a non-nil Account (it errors otherwise), so the
// gateway always constructs one. This bootstrap variant reports zero
// configured providers — a valid state for a gateway that resolves provider
// credentials per-request from the Fernet vault rather than at Init time.
//
// The vault-backed Account (internal/account/account.go, task BF0.2-account)
// supersedes this: it enumerates real providers and reads keys from the vault.
// Until then, this keeps the per-provider concurrency tuning (§9.5) in one
// place so the settings contract is exercised and unit-tested.
type bootstrapAccount struct {
	// providerConcurrency caps the worker goroutines bifrost spawns per
	// provider, tuning ConcurrencyAndBufferSize.Concurrency down from the
	// 1000-worker default (design §6.1, §9.5).
	providerConcurrency int
}

var _ schemas.Account = (*bootstrapAccount)(nil)

// newBootstrapAccount builds a bootstrapAccount with the given per-provider
// concurrency cap.
func newBootstrapAccount(providerConcurrency int) *bootstrapAccount {
	return &bootstrapAccount{providerConcurrency: providerConcurrency}
}

// GetConfiguredProviders reports no providers: credentials are resolved
// per-request, not enumerated at Init.
func (a *bootstrapAccount) GetConfiguredProviders() ([]schemas.ModelProvider, error) {
	return []schemas.ModelProvider{}, nil
}

// GetKeysForProvider returns no keys for the bootstrap account. The
// vault-backed Account resolves keys from the Fernet vault per request.
func (a *bootstrapAccount) GetKeysForProvider(context.Context, schemas.ModelProvider) ([]schemas.Key, error) {
	return []schemas.Key{}, nil
}

// GetConfigForProvider returns a provider config with the tuned-down
// concurrency (§9.5). bifrost/core fills the remaining defaults via
// ProviderConfig.CheckAndSetDefaults.
func (a *bootstrapAccount) GetConfigForProvider(schemas.ModelProvider) (*schemas.ProviderConfig, error) {
	return &schemas.ProviderConfig{
		ConcurrencyAndBufferSize: schemas.ConcurrencyAndBufferSize{
			Concurrency: a.providerConcurrency,
		},
	}, nil
}
