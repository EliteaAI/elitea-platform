package runtimecomposition

import (
	"context"
	"errors"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/litellm"
)

var errCurrentLiteLLMConfigurationMaterialization = errors.New(
	"current LiteLLM configuration materialization failed",
)

type currentConfigurationLifecycleExpander interface {
	Expand(context.Context, configurationapp.CurrentExpansionRequest) (map[string]any, error)
}

type currentConfigurationLifecycleUnsecreter interface {
	Unsecret(context.Context, int32, map[string]any) (map[string]any, error)
}

// currentLiteLLMConfigurationMaterializer is the final trusted boundary that
// turns one sanitized lifecycle snapshot into the provider projection consumed
// by LiteLLM. Generic schemas and validation remain owned by Configurations and
// elitea-sdk; this adapter only resolves the already-declared references and
// hidden values needed by the LiteLLM administration call.
type currentLiteLLMConfigurationMaterializer struct {
	expander   currentConfigurationLifecycleExpander
	unsecreter currentConfigurationLifecycleUnsecreter
}

func newCurrentLiteLLMConfigurationMaterializer(
	expander currentConfigurationLifecycleExpander,
	unsecreter currentConfigurationLifecycleUnsecreter,
) (*currentLiteLLMConfigurationMaterializer, error) {
	if expander == nil || unsecreter == nil {
		return nil, errCurrentLiteLLMConfigurationMaterialization
	}
	return &currentLiteLLMConfigurationMaterializer{
		expander: expander, unsecreter: unsecreter,
	}, nil
}

func (materializer *currentLiteLLMConfigurationMaterializer) MaterializeCurrentLiteLLMConfiguration(
	ctx context.Context,
	snapshot configurationapp.CurrentConfigurationLifecycleSnapshot,
) (litellm.Configuration, error) {
	if ctx == nil || materializer == nil || materializer.expander == nil || materializer.unsecreter == nil ||
		snapshot.ProjectID <= 0 || snapshot.UUID == "" || snapshot.Type == "" || snapshot.Data == nil {
		return litellm.Configuration{}, errCurrentLiteLLMConfigurationMaterialization
	}
	if err := ctx.Err(); err != nil {
		return litellm.Configuration{}, err
	}

	// Resolve the snapshot owner's own secret references first. Expansion then
	// resolves each nested configuration through that nested configuration's
	// owning project, avoiding cross-project vault fallback.
	owned, err := materializer.unsecreter.Unsecret(ctx, snapshot.ProjectID, snapshot.Data)
	if err != nil {
		return litellm.Configuration{}, currentLiteLLMMaterializationError(ctx, err)
	}
	expanded, err := materializer.expander.Expand(ctx, configurationapp.CurrentExpansionRequest{
		Payload:          owned,
		CurrentProjectID: snapshot.ProjectID,
		UserID:           snapshot.AuthorID,
		Unsecret:         true,
	})
	if err != nil {
		return litellm.Configuration{}, currentLiteLLMMaterializationError(ctx, err)
	}
	if expanded == nil {
		return litellm.Configuration{}, errCurrentLiteLLMConfigurationMaterialization
	}
	return litellm.Configuration{
		UUID:      snapshot.UUID,
		ProjectID: int64(snapshot.ProjectID),
		Type:      snapshot.Type,
		Data:      expanded,
	}, nil
}

func currentLiteLLMMaterializationError(ctx context.Context, err error) error {
	if ctx != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	return errCurrentLiteLLMConfigurationMaterialization
}

var _ litellm.CurrentConfigurationMaterializer = (*currentLiteLLMConfigurationMaterializer)(nil)
