package runtimecomposition

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
	"github.com/jackc/pgx/v5/pgxpool"
)

type currentLLMRuntimeVaultLoader struct{}

func (currentLLMRuntimeVaultLoader) LoadProjectVault(context.Context, int64) (storage.SecretVault, error) {
	return nil, storage.ErrContentUnavailable
}

func (currentLLMRuntimeVaultLoader) LoadAdminVault(context.Context) (storage.SecretVault, error) {
	return nil, storage.ErrContentUnavailable
}

func TestCurrentLLMRuntimeComposesProviderNeutralFacade(t *testing.T) {
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	masterKeyPath := filepath.Join(root, "litellm-master-key")
	if err := os.WriteFile(masterKeyPath, []byte("sk-current"), 0o600); err != nil {
		t.Fatal(err)
	}
	runtime, err := NewCurrentLLMRuntime(
		&pgxpool.Pool{},
		&CurrentConfigurationsRuntime{
			publicProjectID: 41,
			scope:           &repos.CurrentExpansionScopeRepository{},
			vaultLoader:     currentLLMRuntimeVaultLoader{},
		},
		CurrentLLMConfig{
			BaseURL:       "https://litellm.internal",
			MasterKeyFile: masterKeyPath,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Handler() == nil || runtime.transport == nil || runtime.masterKey == nil {
		t.Fatalf("incomplete current LLM runtime: %+v", runtime)
	}
	runtime.Close()
	if _, err := runtime.masterKey.MasterKey(context.Background()); err == nil {
		t.Fatal("runtime close retained the LiteLLM master key")
	}
}

func TestCurrentLLMRuntimeRejectsIncompleteGraph(t *testing.T) {
	if runtime, err := NewCurrentLLMRuntime(nil, &CurrentConfigurationsRuntime{vaultLoader: currentLLMRuntimeVaultLoader{}}, CurrentLLMConfig{}); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v err=%v", runtime, err)
	}
}
