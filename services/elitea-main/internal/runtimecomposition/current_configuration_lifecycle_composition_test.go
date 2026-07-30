package runtimecomposition

import (
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestCurrentConfigurationLifecycleCompositionRejectsPartialGraph(t *testing.T) {
	pool := &pgxpool.Pool{}
	configurations := &CurrentConfigurationsRuntime{
		publicProjectID: 1,
		models:          &configurationapp.CurrentModelCatalogService{},
	}
	llm := &CurrentLLMRuntime{}

	tests := []struct {
		name           string
		pool           *pgxpool.Pool
		configurations *CurrentConfigurationsRuntime
		llm            *CurrentLLMRuntime
	}{
		{name: "database", configurations: configurations, llm: llm},
		{name: "configurations", pool: pool, llm: llm},
		{name: "public project", pool: pool, configurations: &CurrentConfigurationsRuntime{models: configurations.models}, llm: llm},
		{name: "model catalog", pool: pool, configurations: &CurrentConfigurationsRuntime{publicProjectID: 1}, llm: llm},
		{name: "LiteLLM", pool: pool, configurations: configurations},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, err := NewCurrentConfigurationLifecycleReconciler(
				test.pool,
				test.configurations,
				test.llm,
				true,
			)
			if err == nil || got != nil {
				t.Fatalf("reconciler=%#v error=%v", got, err)
			}
		})
	}
}
