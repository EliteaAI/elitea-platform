package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"regexp"
	"strings"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

const maxCurrentToolkitIdentityBytes = 1024

var currentToolkitNameSanitizer = regexp.MustCompile(`[^a-zA-Z0-9_.-]`)

var (
	ErrCurrentModelResolutionUnavailable           = errors.New("current model resolution is unavailable")
	ErrCurrentToolkitSettingsResolutionUnavailable = errors.New("current toolkit settings resolution is unavailable")
)

// CurrentToolkitSnapshot is the provider-neutral subset of one saved
// p_<project>.elitea_tools row required by index_data admission. Settings still
// contain configuration and secret references; plaintext is forbidden here.
type CurrentToolkitSnapshot struct {
	ID       int32
	Type     string
	Name     string
	Settings map[string]any
}

// CurrentToolkitReader loads an exact saved toolkit from the already
// authorized resource project. A missing or invisible row returns found=false.
type CurrentToolkitReader interface {
	GetCurrentToolkit(context.Context, int32, int32, int32) (toolkit CurrentToolkitSnapshot, found bool, err error)
}

type CurrentModelCatalog interface {
	Get(context.Context, configurationapp.CurrentModelCatalogQuery) (configurationapp.CurrentModelCatalogResponse, error)
}

// CurrentToolkitSettingsValidator is the provider-neutral Configurations
// schema boundary. Admission uses reference mode to freeze the current
// expanded settings while secret references remain sealed. Claim time must
// consume that immutable snapshot rather than resolving configuration titles
// again.
type CurrentToolkitSettingsValidator interface {
	Resolve(context.Context, configurationapp.CurrentToolkitSettingsRequest) (map[string]any, error)
}

type CurrentEmbeddingBindingSelector interface {
	Resolve(context.Context, int32, string, *int32) (EmbeddingBinding, error)
}

// CurrentAuthoritativeInputResolver ports the current index_data preparation
// boundary: the caller selects only a saved toolkit ID and invocation values;
// Main reloads toolkit settings and model metadata from Configurations-owned
// state. AI provider credentials are deliberately absent because SDK model
// calls continue through Main's authenticated LiteLLM facade.
type CurrentAuthoritativeInputResolver struct {
	toolkits        CurrentToolkitReader
	models          CurrentModelCatalog
	settings        CurrentToolkitSettingsValidator
	embeddings      CurrentEmbeddingBindingSelector
	publicProjectID int32
}

func NewCurrentAuthoritativeInputResolver(
	toolkits CurrentToolkitReader,
	models CurrentModelCatalog,
	settings CurrentToolkitSettingsValidator,
	embeddings CurrentEmbeddingBindingSelector,
	publicProjectID int32,
) (*CurrentAuthoritativeInputResolver, error) {
	if toolkits == nil || models == nil || settings == nil || embeddings == nil || publicProjectID <= 0 {
		return nil, errors.New("current index input resolver dependencies are required")
	}
	return &CurrentAuthoritativeInputResolver{
		toolkits:        toolkits,
		models:          models,
		settings:        settings,
		embeddings:      embeddings,
		publicProjectID: publicProjectID,
	}, nil
}

func (r *CurrentAuthoritativeInputResolver) Resolve(
	ctx context.Context,
	request StartRequest,
) (AuthoritativeInputs, error) {
	if ctx == nil || request.Validate() != nil || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID > math.MaxInt32 || request.ToolkitID > math.MaxInt32 {
		return AuthoritativeInputs{}, ErrInvalidIndexStart
	}
	if err := ctx.Err(); err != nil {
		return AuthoritativeInputs{}, err
	}

	toolkit, found, err := r.toolkits.GetCurrentToolkit(
		ctx,
		int32(request.ProjectID),
		int32(request.ActorUserID),
		int32(request.ToolkitID),
	)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return AuthoritativeInputs{}, contextErr
		}
		return AuthoritativeInputs{}, err
	}
	if !found {
		return AuthoritativeInputs{}, ErrToolkitNotVisible
	}
	if err := validateCurrentToolkitSnapshot(toolkit, int32(request.ToolkitID)); err != nil {
		return AuthoritativeInputs{}, err
	}
	expandedSettings, err := r.settings.Resolve(ctx, configurationapp.CurrentToolkitSettingsRequest{
		ToolkitType: toolkit.Type,
		Settings:    cloneCurrentResolverObject(toolkit.Settings),
		ProjectID:   int32(request.ProjectID),
		UserID:      int32(request.ActorUserID),
		Mode:        configurationapp.CurrentToolkitSettingsReferenceMode,
	})
	if err != nil {
		return AuthoritativeInputs{}, currentToolkitSettingsAdmissionError(ctx, err)
	}
	if expandedSettings == nil {
		return AuthoritativeInputs{}, ErrInvalidAuthoritativeIndexInput
	}
	defaultEmbeddingProjectID, err := r.applyCurrentEmbeddingModelDefault(
		ctx,
		int32(request.ProjectID),
		expandedSettings,
	)
	if err != nil {
		return AuthoritativeInputs{}, err
	}
	embeddingBinding, err := r.resolveCurrentEmbeddingBinding(
		ctx,
		int32(request.ProjectID),
		expandedSettings,
		defaultEmbeddingProjectID,
	)
	if err != nil {
		return AuthoritativeInputs{}, err
	}

	toolkitConfiguration, err := json.Marshal(map[string]any{
		"id":           toolkit.ID,
		"type":         toolkit.Type,
		"toolkit_name": currentToolkitName(toolkit.Name, toolkit.Type),
		"settings":     cloneCurrentResolverObject(expandedSettings),
	})
	if err != nil || !validBoundedJSONObject(toolkitConfiguration) {
		return AuthoritativeInputs{}, ErrInvalidAuthoritativeIndexInput
	}

	llmSettings, err := decodeCurrentResolverObject(request.RequestedLLMSettings)
	if err != nil {
		return AuthoritativeInputs{}, ErrInvalidIndexStart
	}
	requestedModel := cloneCurrentResolverString(request.RequestedLLMModel)
	if err := r.resolveCurrentModelMetadata(ctx, int32(request.ProjectID), &requestedModel, llmSettings); err != nil {
		return AuthoritativeInputs{}, err
	}
	llmConfiguration, err := json.Marshal(llmSettings)
	if err != nil || !validBoundedJSONObject(llmConfiguration) {
		return AuthoritativeInputs{}, ErrInvalidAuthoritativeIndexInput
	}

	return AuthoritativeInputs{
		ToolkitConfiguration: toolkitConfiguration,
		ToolParameters:       bytes.Clone(request.ToolParameters),
		LLMModel:             requestedModel,
		LLMConfiguration:     llmConfiguration,
		EmbeddingBinding:     embeddingBinding,
	}, nil
}

func (r *CurrentAuthoritativeInputResolver) resolveCurrentEmbeddingBinding(
	ctx context.Context,
	projectID int32,
	settings map[string]any,
	preferredProjectID *int32,
) (*EmbeddingBinding, error) {
	value, present := settings["embedding_model"]
	if !present {
		return nil, nil
	}
	modelName, ok := value.(string)
	if !ok {
		return nil, ErrInvalidAuthoritativeIndexInput
	}
	if modelName == "" {
		return nil, ErrCurrentEmbeddingBindingUnavailable
	}
	binding, err := r.embeddings.Resolve(ctx, projectID, modelName, preferredProjectID)
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		switch {
		case errors.Is(err, ErrCurrentEmbeddingBindingAmbiguous):
			return nil, ErrCurrentEmbeddingBindingAmbiguous
		case errors.Is(err, ErrInvalidCurrentEmbeddingBinding):
			return nil, ErrInvalidCurrentEmbeddingBinding
		default:
			return nil, ErrCurrentEmbeddingBindingUnavailable
		}
	}
	if binding.ModelName != modelName {
		return nil, ErrCurrentEmbeddingBindingAmbiguous
	}
	if preferredProjectID != nil && binding.ModelProjectID != *preferredProjectID {
		return nil, ErrCurrentEmbeddingBindingAmbiguous
	}
	copyBinding := binding.Clone()
	return &copyBinding, nil
}

func (r *CurrentAuthoritativeInputResolver) applyCurrentEmbeddingModelDefault(
	ctx context.Context,
	projectID int32,
	settings map[string]any,
) (*int32, error) {
	value, present := settings["embedding_model"]
	if present {
		model, ok := value.(string)
		if !ok {
			return nil, ErrInvalidAuthoritativeIndexInput
		}
		if model != "" {
			return nil, nil
		}
	}
	catalog, err := r.models.Get(ctx, configurationapp.CurrentModelCatalogQuery{
		Section:         configurationapp.CurrentModelSectionEmbedding,
		ProjectID:       projectID,
		PublicProjectID: r.publicProjectID,
		IncludeShared:   true,
	})
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return nil, contextErr
		}
		return nil, ErrCurrentEmbeddingBindingUnavailable
	}
	if (catalog.DefaultModelName == nil) != (catalog.DefaultModelProjectID == nil) {
		return nil, ErrCurrentEmbeddingBindingUnavailable
	}
	if catalog.DefaultModelName == nil {
		return nil, nil
	}
	if *catalog.DefaultModelName == "" || catalog.DefaultModelProjectID == nil ||
		(*catalog.DefaultModelProjectID != projectID &&
			*catalog.DefaultModelProjectID != r.publicProjectID) {
		return nil, ErrCurrentEmbeddingBindingUnavailable
	}
	settings["embedding_model"] = *catalog.DefaultModelName
	project := *catalog.DefaultModelProjectID
	return &project, nil
}

func (r *CurrentAuthoritativeInputResolver) resolveCurrentModelMetadata(
	ctx context.Context,
	projectID int32,
	model **string,
	settings map[string]any,
) error {
	// This is derived Configurations metadata, never a caller-owned SDK
	// switch. Removing it first prevents an untrusted request from selecting a
	// different model client implementation.
	delete(settings, "openai_compatible")

	catalog, err := r.models.Get(ctx, configurationapp.CurrentModelCatalogQuery{
		Section:         configurationapp.CurrentModelSectionLLM,
		ProjectID:       projectID,
		PublicProjectID: r.publicProjectID,
		IncludeShared:   true,
	})
	if err != nil {
		if contextErr := ctx.Err(); contextErr != nil {
			return contextErr
		}
		return ErrCurrentModelResolutionUnavailable
	}
	if *model == nil && catalog.DefaultModelName != nil {
		*model = cloneCurrentResolverString(catalog.DefaultModelName)
	}
	if *model == nil {
		return nil
	}
	for _, item := range catalog.Items {
		if item.Name != **model {
			continue
		}
		compatible := false
		if item.OpenAICompatible != nil {
			compatible = *item.OpenAICompatible
		}
		settings["openai_compatible"] = compatible
		return nil
	}
	return nil
}

func validateCurrentToolkitSnapshot(toolkit CurrentToolkitSnapshot, requestedID int32) error {
	if toolkit.ID != requestedID || toolkit.ID <= 0 || toolkit.Type == "" ||
		len(toolkit.Type) > maxCurrentToolkitIdentityBytes || strings.ContainsAny(toolkit.Type, "\x00\r\n") ||
		len(toolkit.Name) > maxCurrentToolkitIdentityBytes || strings.ContainsAny(toolkit.Name, "\x00\r\n") ||
		toolkit.Settings == nil {
		return ErrInvalidAuthoritativeIndexInput
	}
	return nil
}

func currentToolkitName(storedName, toolkitType string) string {
	if storedName == "" {
		storedName = toolkitType
	}
	cleaned := currentToolkitNameSanitizer.ReplaceAllString(storedName, "")
	return strings.ReplaceAll(cleaned, ".", "_")
}

func decodeCurrentResolverObject(value []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(value))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, ErrInvalidIndexStart
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		return nil, ErrInvalidIndexStart
	}
	return object, nil
}

func cloneCurrentResolverObject(source map[string]any) map[string]any {
	cloned := make(map[string]any, len(source))
	for key, value := range source {
		cloned[key] = cloneCurrentResolverValue(value)
	}
	return cloned
}

func cloneCurrentResolverValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return cloneCurrentResolverObject(typed)
	case []any:
		cloned := make([]any, len(typed))
		for index, item := range typed {
			cloned[index] = cloneCurrentResolverValue(item)
		}
		return cloned
	default:
		return typed
	}
}

func cloneCurrentResolverString(value *string) *string {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func currentToolkitSettingsAdmissionError(ctx context.Context, err error) error {
	if contextErr := ctx.Err(); contextErr != nil {
		return contextErr
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return err
	}
	if errors.Is(err, configurationapp.ErrInvalidCurrentToolkitSettings) ||
		errors.Is(err, configurationapp.ErrCurrentToolkitSettingsValidation) {
		return ErrInvalidAuthoritativeIndexInput
	}
	return ErrCurrentToolkitSettingsResolutionUnavailable
}

var _ AuthoritativeInputResolver = (*CurrentAuthoritativeInputResolver)(nil)
