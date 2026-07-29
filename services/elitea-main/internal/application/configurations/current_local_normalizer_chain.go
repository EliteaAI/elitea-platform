package configurations

import "context"

// CurrentLocalDataNormalizer adapts the nine Configurations-owned create
// models to the shared mutation normalizer chain. Unowned creates and every
// update are delegated so ownership remains explicit and non-overlapping.
type CurrentLocalDataNormalizer struct {
	create   CurrentLocalConfigurationCreateNormalizer
	fallback CurrentConfigurationDataNormalizer
}

func NewCurrentLocalDataNormalizer(fallback CurrentConfigurationDataNormalizer) *CurrentLocalDataNormalizer {
	return &CurrentLocalDataNormalizer{fallback: fallback}
}

func (n *CurrentLocalDataNormalizer) Normalize(
	ctx context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	if ctx == nil || n == nil {
		return CurrentConfigurationNormalizationResult{}, ErrInvalidCurrentConfigurationMutation
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationNormalizationResult{}, err
	}
	if request.Operation == CurrentConfigurationNormalizationCreate {
		result, err := n.create.NormalizeCreate(request.Type, request.Data)
		if err != nil || result.Complete {
			return result, err
		}
	}
	if n.fallback == nil {
		return CurrentConfigurationNormalizationResult{Complete: false}, nil
	}
	return n.fallback.Normalize(ctx, request)
}

var _ CurrentConfigurationDataNormalizer = (*CurrentLocalDataNormalizer)(nil)
