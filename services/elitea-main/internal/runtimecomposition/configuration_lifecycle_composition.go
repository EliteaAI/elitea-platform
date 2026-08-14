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
// selects only the provider-owned credentials/models and the two internal
// reference-repair effects.
//
// The lifecycle takes no LLM runtime. It used to need one to push each
// configuration into the LiteLLM proxy's administration API; the Bifrost
// gateway instead reads those same p_{projectID}.configuration rows at request
// time, so the graph is now entirely database-side: resolve the row's
// references, then let status_ok decide whether any runtime may use it.
func NewCurrentConfigurationLifecycleReconciler(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
	allowProjectOwnLLMs bool,
) (*configurationapp.CurrentConfigurationLifecycleEffectsReconciler, error) {
	if pool == nil || configurations == nil || configurations.publicProjectID <= 0 ||
		configurations.models == nil || configurations.expander == nil || configurations.unsecreter == nil {
		return nil, errors.New("current configuration lifecycle composition is incomplete")
	}

	resolution, err := newCurrentProviderConfigurationResolution(
		configurations.expander,
		configurations.unsecreter,
	)
	if err != nil {
		return nil, fmt.Errorf("compose current provider configuration resolution: %w", err)
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
		resolution,
		status,
		renames,
		deletedLLM,
		configurationapp.CurrentProviderProjectPolicy{
			AllowProjectOwnLLMs: allowProjectOwnLLMs,
			PublicProjectID:     configurations.publicProjectID,
		},
	)
}
