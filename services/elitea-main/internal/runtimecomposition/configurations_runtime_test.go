package runtimecomposition

import (
	"bytes"
	"context"
	"os"
	"path/filepath"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentConfigurationsRuntimeIsIndependentOfWorkerRuntime(t *testing.T) {
	runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Reader() == nil || runtime.Types() == nil || runtime.Expansion() == nil || runtime.ModelCatalog() == nil || runtime.AvailableCatalog() == nil || runtime.VaultWriter() == nil {
		t.Fatalf("incomplete current Configurations runtime: %+v", runtime)
	}
	validator := currentConfigurationsSDKValidatorStub{}
	if service, err := runtime.NewMutationService(validator); err != nil || service == nil {
		t.Fatalf("compose mutation service=%+v error=%v", service, err)
	}
	if service, err := runtime.NewMutationService(nil); service != nil || err == nil {
		t.Fatalf("incomplete normalizer composed service=%+v error=%v", service, err)
	}
	runtime.Destroy()
	if runtime.Reader() != nil || runtime.Types() != nil || runtime.Expansion() != nil || runtime.ModelCatalog() != nil || runtime.AvailableCatalog() != nil || runtime.VaultWriter() != nil {
		t.Fatal("destroyed current Configurations runtime retained services")
	}
	if service, err := runtime.NewMutationService(validator); service != nil || err == nil {
		t.Fatalf("destroyed runtime composed service=%+v error=%v", service, err)
	}
}

type currentConfigurationsSDKValidatorStub struct{}

func (currentConfigurationsSDKValidatorStub) ValidateCurrentSDKConfiguration(
	context.Context,
	configurationapp.CurrentSDKConfigurationValidationRequest,
) error {
	return nil
}

func TestCurrentConfigurationsRuntimeRejectsMissingDatabase(t *testing.T) {
	if runtime, err := NewCurrentConfigurationsRuntime(nil, 1, "", nil); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 0, "", nil); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
}

// The env key must reach the vault LOADER, not just be accepted and dropped.
// A key that only the writer holds is the shape that broke: the secrets
// handler wrapped every project key with SECRETS_MASTER_KEY while this
// runtime's loader was built with no key at all, so it opened wrapped rows as
// unwrapped and answered ErrInvalidProjectKey to every model-catalogue read.
// An invalid key is the observable proof of arrival — the loader validates it
// and refuses, which a dropped key could not do.
func TestCurrentConfigurationsRuntimeGivesTheEnvironmentMasterKeyToTheVaultLoader(t *testing.T) {
	if runtime, err := NewCurrentConfigurationsRuntime(
		&pgxpool.Pool{}, 1, "", []byte("not-a-fernet-key"),
	); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	valid := bytes.Repeat([]byte("A"), 43)
	valid = append(valid, '=')
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, "", valid); runtime == nil || err != nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	} else {
		runtime.Destroy()
	}
}

// Two sources that disagree are refused rather than resolved. Whichever key
// lost would open some vaults in the database and not others, and the half it
// could not open is indistinguishable from a corrupt row.
func TestCurrentConfigurationsRuntimeRefusesDisagreeingMasterKeys(t *testing.T) {
	fileKey := bytes.Repeat([]byte("A"), 43)
	fileKey = append(fileKey, '=')
	dir, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "master.key")
	if err := os.WriteFile(path, fileKey, 0o600); err != nil {
		t.Fatal(err)
	}
	envKey := bytes.Repeat([]byte("B"), 43)
	envKey = append(envKey, '=')
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, path, envKey); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	// The same key from both sources is not a conflict.
	agreeing := append([]byte(nil), fileKey...)
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, path, agreeing); runtime == nil || err != nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	} else {
		runtime.Destroy()
	}
}
