package runtimecomposition

import (
	"context"
	"errors"
	"fmt"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
	"github.com/jackc/pgx/v5/pgxpool"
)

// newCurrentAgentVersionFreezer reuses the same schema-driven, provider-neutral
// Configurations graph as index admission. It freezes references but never
// places plaintext credentials in the durable agent input.
func newCurrentAgentVersionFreezer(
	pool *pgxpool.Pool,
	configurations *CurrentConfigurationsRuntime,
) (*agentexecutionapp.CurrentApplicationToolSnapshotService, error) {
	if pool == nil || configurations == nil || configurations.expander == nil ||
		configurations.models == nil || configurations.unsecreter == nil ||
		configurations.publicProjectID <= 0 {
		return nil, errors.New("current agent configuration dependencies are required")
	}
	builtInSchemas, err := LoadPinnedCurrentToolkitSchemaSnapshot()
	if err != nil {
		return nil, fmt.Errorf("load current agent toolkit schema snapshot: %w", err)
	}
	schemas, err := NewCurrentCompositeToolkitSchemaCatalog(
		builtInSchemas,
		absentCurrentAgentDynamicToolkitSchemas{},
	)
	if err != nil {
		return nil, err
	}
	names, err := NewCurrentBuiltInToolkitNameDeriver(builtInSchemas)
	if err != nil {
		return nil, err
	}
	toolkitRows, err := repos.NewCurrentToolkitsRepository(pool)
	if err != nil {
		return nil, fmt.Errorf("construct current agent toolkit repository: %w", err)
	}
	nestedToolkits, err := NewCurrentNestedToolkitReaderAdapter(toolkitRows, names)
	if err != nil {
		return nil, err
	}
	modelVisibility, err := NewCurrentModelVisibilityAdapter(
		configurations.models,
		configurations.publicProjectID,
	)
	if err != nil {
		return nil, err
	}
	settings, err := configurationapp.NewCurrentToolkitSettingsResolver(
		schemas,
		nestedToolkits,
		configurations.expander,
		modelVisibility,
		configurations.unsecreter,
	)
	if err != nil {
		return nil, err
	}
	guardrailPolicies, err := platformconfig.NewGuardrailPolicyAdapter(pool)
	if err != nil {
		return nil, fmt.Errorf("construct current agent guardrail policy source: %w", err)
	}
	return agentexecutionapp.NewCurrentApplicationToolSnapshotService(
		settings,
		currentAgentToolkitNameAdapter{names: names},
		configurations.models,
		guardrailPolicies,
		configurations.publicProjectID,
	)
}

// absentCurrentAgentDynamicToolkitSchemas keeps an unsupported Provider Hub or
// custom toolkit attached to the conversation without making every other
// participant unusable. The agent freezer treats found=false as a runtime
// capability gap and omits only that toolkit from the immutable execution
// snapshot. Index admission keeps the fail-closed unavailable adapter because
// an index cannot run correctly after silently losing its source toolkit.
type absentCurrentAgentDynamicToolkitSchemas struct{}

func (absentCurrentAgentDynamicToolkitSchemas) FindCurrentActorVisibleToolkitSchema(
	ctx context.Context,
	_ int32,
	_ int32,
	_ string,
) (configurationapp.CurrentToolkitSchema, bool, error) {
	if ctx == nil {
		return configurationapp.CurrentToolkitSchema{}, false, ErrCurrentToolkitSchemaLookupInvalid
	}
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentToolkitSchema{}, false, err
	}
	return configurationapp.CurrentToolkitSchema{}, false, nil
}

type currentAgentToolkitNameAdapter struct {
	names CurrentToolkitNameDeriver
}

func (adapter currentAgentToolkitNameAdapter) ResolveCurrentAgentToolkitName(
	ctx context.Context,
	request agentexecutionapp.CurrentAgentToolkitNameRequest,
) (string, error) {
	if adapter.names == nil {
		return "", errors.New("current agent toolkit name resolver is unavailable")
	}
	return adapter.names.DeriveCurrentToolkitName(
		ctx,
		CurrentToolkitNameInput{
			ProjectID: request.ProjectID, UserID: request.UserID,
			ToolkitType: request.ToolkitType, StoredName: request.StoredName,
			Settings: request.Settings,
		},
	)
}

var _ agentexecutionapp.CurrentAgentToolkitNameResolver = currentAgentToolkitNameAdapter{}
