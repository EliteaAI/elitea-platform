package litellm

import (
	"context"
	"strings"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// GetCurrentEmbeddingRuntimeGroup projects only the non-secret fields that
// exist in the current Configurations -> LiteLLM mapping. It deliberately does
// not treat model_info.id as a semantic model version and does not infer an
// embedding dimension from either the upstream model string or model name.
func (c *Client) GetCurrentEmbeddingRuntimeGroup(
	ctx context.Context,
	modelGroup string,
) (indexingapp.CurrentEmbeddingRuntimeGroup, bool, error) {
	if c == nil || ctx == nil || !validAdminIdentifier(modelGroup) {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, ErrInvalidRequest
	}
	if err := ctx.Err(); err != nil {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, err
	}

	groups, err := c.LookupModelGroup(ctx, modelGroup)
	if err != nil {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, err
	}
	if len(groups) == 0 {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, nil
	}
	if len(groups) != 1 || groups[0].ModelGroup != modelGroup {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, ErrInvalidResponse
	}

	models, err := c.ListModels(ctx)
	if err != nil {
		return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, err
	}
	deployments := make([]indexingapp.CurrentEmbeddingRuntimeDeployment, 0, len(models))
	for _, model := range models {
		if model.ModelName != modelGroup {
			continue
		}
		configurationUUID, ok := exactNonEmptyString(
			model.ModelInfo,
			"centry_configuration_uuid",
		)
		if !ok {
			return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, ErrInvalidResponse
		}
		provider, ok := exactNonEmptyString(model.LiteLLMParams, "custom_llm_provider")
		if !ok {
			return indexingapp.CurrentEmbeddingRuntimeGroup{}, false, ErrInvalidResponse
		}
		deployments = append(deployments, indexingapp.CurrentEmbeddingRuntimeDeployment{
			ConfigurationUUID: configurationUUID,
			Provider:          provider,
		})
	}

	return indexingapp.CurrentEmbeddingRuntimeGroup{
		Name:        groups[0].ModelGroup,
		Providers:   append([]string(nil), groups[0].Providers...),
		Deployments: deployments,
	}, true, nil
}

func exactNonEmptyString(values map[string]any, key string) (string, bool) {
	if values == nil {
		return "", false
	}
	value, ok := values[key].(string)
	if !ok || value == "" || value != strings.TrimSpace(value) ||
		strings.ContainsAny(value, "\x00\r\n") {
		return "", false
	}
	return value, true
}

var _ indexingapp.CurrentEmbeddingRuntimeReader = (*Client)(nil)
