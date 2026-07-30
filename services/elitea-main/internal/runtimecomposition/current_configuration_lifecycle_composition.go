package runtimecomposition

import (
	"errors"
	"fmt"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/jackc/pgx/v5/pgxpool"
)

// NewCurrentConfigurationLifecycleReconciler composes the exact current
// Configurations side effects around one shared persistence adapter. Generic
// SDK-owned configuration types remain passive; the application reconciler
// selects only the LiteLLM-owned credentials/models and the two internal
// reference-repair effects.
func NewCurrentConfigurationLifecycleReconciler(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	llm *CurrentLLMRuntime,
	allowProjectOwnLLMs bool,
) (*configurationapp.CurrentConfigurationLifecycleEffectsReconciler, error) {
	if pool == nil || configurations == nil || configurations.publicProjectID <= 0 ||
		configurations.models == nil || llm == nil {
		return nil, errors.New("current configuration lifecycle composition is incomplete")
	}

	liteLLMEffects, err := llm.NewConfigurationEffects(configurations)
	if err != nil {
		return nil, fmt.Errorf("compose current LiteLLM configuration effects: %w", err)
	}
	persistence, err := repos.NewCurrentConfigurationLifecycleEffectsRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("compose current configuration lifecycle persistence: %w", err)
	}
	status, err := configurationapp.NewCurrentConfigurationLifecycleStatusEffect(persistence)
	if err != nil {
		return nil, err
	}
	renames, err := configurationapp.NewCurrentConfigurationRenameReferenceEffect(persistence)
	if err != nil {
		return nil, err
	}
	deletedLLM, err := configurationapp.NewCurrentDeletedLLMReferenceEffect(
		persistence,
		configurations.models,
		persistence,
		configurations.publicProjectID,
	)
	if err != nil {
		return nil, err
	}
	return configurationapp.NewCurrentConfigurationLifecycleEffectsReconciler(
		liteLLMEffects,
		status,
		renames,
		deletedLLM,
		configurationapp.CurrentLiteLLMProjectPolicy{
			AllowProjectOwnLLMs: allowProjectOwnLLMs,
			PublicProjectID:     configurations.publicProjectID,
		},
	)
}
