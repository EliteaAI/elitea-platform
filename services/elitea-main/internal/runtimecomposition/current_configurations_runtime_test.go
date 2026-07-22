package runtimecomposition

import (
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentConfigurationsRuntimeIsIndependentOfWorkerRuntime(t *testing.T) {
	runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if runtime.Reader() == nil || runtime.ModelCatalog() == nil || runtime.AvailableCatalog() == nil || runtime.VaultWriter() == nil {
		t.Fatalf("incomplete current Configurations runtime: %+v", runtime)
	}
	runtime.Destroy()
	if runtime.Reader() != nil || runtime.ModelCatalog() != nil || runtime.AvailableCatalog() != nil || runtime.VaultWriter() != nil {
		t.Fatal("destroyed current Configurations runtime retained services")
	}
}

func TestCurrentConfigurationsRuntimeRejectsMissingDatabase(t *testing.T) {
	if runtime, err := NewCurrentConfigurationsRuntime(nil, 1, ""); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
	if runtime, err := NewCurrentConfigurationsRuntime(&pgxpool.Pool{}, 0, ""); runtime != nil || err == nil {
		t.Fatalf("runtime=%+v error=%v", runtime, err)
	}
}
