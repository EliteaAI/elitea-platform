package storage

import (
	"context"
	"errors"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/centrysecrets"
)

const currentProjectLLMKeyName = "project_llm_key"

var ErrCurrentProjectLLMKeyUnavailable = errors.New("current project LLM key is unavailable")

// CurrentProjectLLMKeyResolver reads the same project regular-secret used by
// the current runtime_interface_litellm proxy. Hidden and admin fallback values
// are intentionally excluded: a caller must always spend through its selected
// project's own LiteLLM key.
type CurrentProjectLLMKeyResolver struct {
	vaults SecretVaultLoader
}

func NewCurrentProjectLLMKeyResolver(vaults SecretVaultLoader) (*CurrentProjectLLMKeyResolver, error) {
	if vaults == nil {
		return nil, errors.New("current project LLM key vault loader is required")
	}
	return &CurrentProjectLLMKeyResolver{vaults: vaults}, nil
}

func (resolver *CurrentProjectLLMKeyResolver) CurrentProjectLLMKey(ctx context.Context, projectID int64) (string, error) {
	if ctx == nil || projectID <= 0 {
		return "", ErrCurrentProjectLLMKeyUnavailable
	}
	if err := ctx.Err(); err != nil {
		return "", err
	}
	vault, err := resolver.vaults.LoadProjectVault(ctx, projectID)
	if err != nil || vault == nil {
		return "", currentProjectLLMKeyFailure(ctx, err)
	}
	secret, err := vault.LookupRegular(currentProjectLLMKeyName)
	if err != nil || secret.Value == "" || secret.Hidden {
		return "", currentProjectLLMKeyFailure(ctx, err)
	}
	return secret.Value, nil
}

func currentProjectLLMKeyFailure(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, centrysecrets.ErrSecretNotFound) {
		return ErrCurrentProjectLLMKeyUnavailable
	}
	return ErrCurrentProjectLLMKeyUnavailable
}
