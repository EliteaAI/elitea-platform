package runtimecomposition

import (
	"context"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentConfigurationsRuntimeIsIndependentOfWorkerRuntime(t *testing.T) {
	runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, "")
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
	if runtime, err := NewCurrentConfigurationsRuntime(nil, 1, ""); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 0, ""); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
}
