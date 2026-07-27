package litellm

import (
	"context"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

// GetCurrentEmbeddingRuntimeGroup performs the same existence check used by the
// current project -> public -> raw proxy mapping. It deliberately does not list
// deployments: endpoint, credential and deployment selection remains current
// LiteLLM behavior at SDK execution time.
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

	return indexingapp.CurrentEmbeddingRuntimeGroup{
		Name: groups[0].ModelGroup,
	}, true, nil
}

var _ indexingapp.CurrentEmbeddingRuntimeReader = (*Client)(nil)
