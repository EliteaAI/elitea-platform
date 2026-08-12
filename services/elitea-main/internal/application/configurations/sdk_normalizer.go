package configurations

import (
	"context"
	"errors"
)

var ErrCurrentSDKConfigurationRejected = errors.New("current SDK configuration was rejected")

// CurrentSDKConfigurationValidationRequest is the in-process command passed
// to the language-agnostic validation execution adapter. Settings is an owned,
// expanded and unsecreted copy. Implementations must never log or return it.
type CurrentSDKConfigurationValidationRequest struct {
	ProjectID int32
	AuthorID  int32
	Type      string
	Settings  map[string]any
}

// CurrentSDKConfigurationValidator executes the registered SDK model behind
// the typed configuration.validate.v1 boundary. A business-invalid candidate
// returns ErrCurrentSDKConfigurationRejected; dependency and capacity errors
// retain their own typed identity for the HTTP adapter.
type CurrentSDKConfigurationValidator interface {
	ValidateCurrentSDKConfiguration(context.Context, CurrentSDKConfigurationValidationRequest) error
}

// CurrentSDKDataNormalizer composes generic SDK create validation in front of
// Configurations, LiteLLM, and Artifacts-owned normalization. This mirrors
// current behavior:
// validate an expanded/unsecreted copy, then persist the caller's original
// generic settings. PUT remains the separate shallow-update contract.
type CurrentSDKDataNormalizer struct {
	catalog   *CurrentAvailableCatalog
	expander  CurrentConfigurationExpander
	validator CurrentSDKConfigurationValidator
	fallback  CurrentConfigurationDataNormalizer
}

func NewCurrentSDKDataNormalizer(
	catalog *CurrentAvailableCatalog,
	expander CurrentConfigurationExpander,
	validator CurrentSDKConfigurationValidator,
	fallback CurrentConfigurationDataNormalizer,
) (*CurrentSDKDataNormalizer, error) {
	if catalog == nil || !catalog.Complete() || expander == nil || validator == nil {
		return nil, errors.New("current SDK configuration normalization dependencies are required")
	}
	return &CurrentSDKDataNormalizer{
		catalog: catalog, expander: expander, validator: validator, fallback: fallback,
	}, nil
}

func (n *CurrentSDKDataNormalizer) Normalize(
	ctx context.Context,
	request CurrentConfigurationNormalizationRequest,
) (CurrentConfigurationNormalizationResult, error) {
	if ctx == nil || n == nil || n.catalog == nil || n.expander == nil || n.validator == nil {
		return CurrentConfigurationNormalizationResult{}, ErrInvalidCurrentConfigurationMutation
	}
	if err := ctx.Err(); err != nil {
		return CurrentConfigurationNormalizationResult{}, err
	}
	entry, found := n.catalog.EntryByType(request.Type)
	if request.Operation != CurrentConfigurationNormalizationCreate || !found || !entry.UsesSDKValidation() {
		if n.fallback == nil {
			return CurrentConfigurationNormalizationResult{Complete: false}, nil
		}
		return n.fallback.Normalize(ctx, request)
	}

	original := cloneCurrentJSONObject(request.Data)
	userID := request.AuthorID
	expanded, err := n.expander.Expand(ctx, CurrentExpansionRequest{
		Payload:          cloneCurrentJSONObject(request.Data),
		CurrentProjectID: request.ProjectID,
		UserID:           &userID,
		Unsecret:         true,
	})
	if err != nil {
		return CurrentConfigurationNormalizationResult{}, err
	}
	if err := n.validator.ValidateCurrentSDKConfiguration(ctx, CurrentSDKConfigurationValidationRequest{
		ProjectID: request.ProjectID,
		AuthorID:  request.AuthorID,
		Type:      request.Type,
		Settings:  expanded,
	}); err != nil {
		if errors.Is(err, ErrCurrentSDKConfigurationRejected) {
			return CurrentConfigurationNormalizationResult{},
				currentMutationFieldError(CurrentConfigurationMutationInvalid, "type")
		}
		return CurrentConfigurationNormalizationResult{}, err
	}
	return CurrentConfigurationNormalizationResult{Data: original, Complete: true}, nil
}

var _ CurrentConfigurationDataNormalizer = (*CurrentSDKDataNormalizer)(nil)
