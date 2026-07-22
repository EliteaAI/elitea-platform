package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
)

const fixedGitHubToolkitType = "github"

var (
	// ErrIndexResolverRecordNotFound is returned by a persistence adapter when
	// an authoritative current-platform row is absent. It is deliberately not
	// exposed directly at the HTTP boundary.
	ErrIndexResolverRecordNotFound = errors.New("index resolver record not found")
	ErrUnsupportedIndexToolkit     = errors.New("index toolkit is not supported by this runtime slice")
)

var canonicalSecretReference = regexp.MustCompile(`^\{\{secret\.[A-Za-z0-9_]+\}\}$`)

// IndexToolkitRecord is the minimum authoritative current elitea_tools row
// needed by the fixed GitHub index resolver. Settings remain unresolved JSON.
type IndexToolkitRecord struct {
	ID       int64
	Name     string
	Type     string
	Settings json.RawMessage
}

// IndexConfigurationRecord is the current configuration row selected from a
// transaction-local p_<project> schema. Data can contain Vault references but
// must never contain redeemed values when returned by the repository.
type IndexConfigurationRecord struct {
	UUID      string
	ProjectID int64
	Type      string
	Data      json.RawMessage
	Shared    bool
	StatusOK  bool
}

// IndexLLMModelRecord contains only non-secret model catalogue metadata. The
// backing configuration query must filter to status_ok rows in section llm.
type IndexLLMModelRecord struct {
	ProjectID         int64
	Name              string
	Shared            bool
	SupportsReasoning bool
	OpenAICompatible  bool
	MaxOutputTokens   int64
}

// FixedGitHubResolverStore is intentionally smaller than the general toolkit
// catalog. The first PoV supports only saved GitHub toolkits in the requested
// project and the two configuration/model visibility rules listed here.
type FixedGitHubResolverStore interface {
	LoadIndexToolkit(context.Context, int64, int64) (IndexToolkitRecord, error)
	LoadIndexConfiguration(context.Context, int64, string) (IndexConfigurationRecord, error)
	LoadSharedIndexConfiguration(context.Context, int64, string) (IndexConfigurationRecord, error)
	IndexEmbeddingModelExists(context.Context, int64, string) (bool, error)
	SharedIndexEmbeddingModelExists(context.Context, int64, string) (bool, error)
	LoadIndexLLMModel(context.Context, int64, string) (IndexLLMModelRecord, error)
	LoadSharedIndexLLMModel(context.Context, int64, string) (IndexLLMModelRecord, error)
}

// FixedGitHubResolver reconstructs the exact reference-bearing SDK input for a
// same-project GitHub toolkit. It does not redeem credentials, discover SDK
// schemas, support private/personal references, or interpret other toolkits.
type FixedGitHubResolver struct {
	store           FixedGitHubResolverStore
	publicProjectID int64
}

func NewFixedGitHubResolver(store FixedGitHubResolverStore, publicProjectID int64) (*FixedGitHubResolver, error) {
	if store == nil || publicProjectID <= 0 {
		return nil, errors.New("fixed GitHub resolver dependencies are required")
	}
	return &FixedGitHubResolver{store: store, publicProjectID: publicProjectID}, nil
}

// Resolve reloads all execution-authoritative values from current-platform
// state. Caller-provided toolkit settings are absent from StartRequest and
// therefore cannot override the saved toolkit or credential references.
func (r *FixedGitHubResolver) Resolve(ctx context.Context, request StartRequest) (AuthoritativeInputs, error) {
	if err := request.Validate(); err != nil {
		return AuthoritativeInputs{}, err
	}

	toolkit, err := r.store.LoadIndexToolkit(ctx, request.ProjectID, request.ToolkitID)
	if errors.Is(err, ErrIndexResolverRecordNotFound) {
		return AuthoritativeInputs{}, ErrToolkitNotVisible
	}
	if err != nil {
		return AuthoritativeInputs{}, fmt.Errorf("load authoritative index toolkit: %w", err)
	}
	if toolkit.ID != request.ToolkitID {
		return AuthoritativeInputs{}, ErrToolkitNotVisible
	}
	if toolkit.Type != fixedGitHubToolkitType {
		return AuthoritativeInputs{}, ErrUnsupportedIndexToolkit
	}

	settings, err := decodeJSONObject(toolkit.Settings)
	if err != nil {
		return AuthoritativeInputs{}, invalidGitHubInput("stored toolkit settings are malformed")
	}
	if !nonEmptyString(settings["repository"]) || !stringListContains(settings["selected_tools"], IndexDataToolName) {
		return AuthoritativeInputs{}, invalidGitHubInput("stored toolkit is not configured for index_data")
	}
	// The current SDK schema defaults both fields to main, but its toolkit
	// constructor indexes the original map directly. Stamp the schema defaults
	// so an older saved row cannot pass validation and then fail in the worker.
	for _, branchField := range []string{"active_branch", "base_branch"} {
		if _, present := settings[branchField]; !present {
			settings[branchField] = "main"
		}
	}
	embeddingModel, ok := settings["embedding_model"].(string)
	if !ok || embeddingModel == "" {
		return AuthoritativeInputs{}, invalidGitHubInput("stored toolkit has no embedding model")
	}

	githubReference, err := configurationReference(settings["github_configuration"])
	if err != nil {
		return AuthoritativeInputs{}, err
	}
	pgvectorReference, err := configurationReference(settings["pgvector_configuration"])
	if err != nil {
		return AuthoritativeInputs{}, err
	}

	githubConfiguration, err := r.resolveConfiguration(
		ctx,
		request.ProjectID,
		githubReference,
		"github",
		[]string{"access_token", "password", "app_private_key"},
		nil,
	)
	if err != nil {
		return AuthoritativeInputs{}, err
	}
	pgvectorConfiguration, err := r.resolveConfiguration(
		ctx,
		request.ProjectID,
		pgvectorReference,
		"pgvector",
		[]string{"connection_string"},
		map[string]struct{}{"connection_string": {}},
	)
	if err != nil {
		return AuthoritativeInputs{}, err
	}

	visible, err := r.embeddingModelVisible(ctx, request.ProjectID, embeddingModel)
	if err != nil {
		return AuthoritativeInputs{}, err
	}
	if !visible {
		return AuthoritativeInputs{}, invalidGitHubInput("stored embedding model is not visible")
	}

	settings["github_configuration"] = githubConfiguration
	settings["pgvector_configuration"] = pgvectorConfiguration
	toolkitConfiguration, err := canonicalJSON(map[string]any{
		"id":           toolkit.ID,
		"settings":     settings,
		"toolkit_name": normalizeCurrentToolkitName(toolkit.Name),
		"type":         fixedGitHubToolkitType,
	})
	if err != nil {
		return AuthoritativeInputs{}, invalidGitHubInput("resolved toolkit cannot be encoded")
	}
	toolParameters, err := canonicalizeJSONObject(request.ToolParameters)
	if err != nil {
		return AuthoritativeInputs{}, invalidGitHubInput("tool parameters cannot be encoded")
	}
	llmModel, llmConfiguration, err := r.resolveLLMPreferences(ctx, request)
	if err != nil {
		return AuthoritativeInputs{}, err
	}
	return AuthoritativeInputs{
		ToolkitConfiguration: toolkitConfiguration,
		ToolParameters:       toolParameters,
		LLMModel:             llmModel,
		LLMConfiguration:     llmConfiguration,
	}, nil
}

func (r *FixedGitHubResolver) resolveLLMPreferences(ctx context.Context, request StartRequest) (*string, json.RawMessage, error) {
	settings, err := decodeJSONObject(request.RequestedLLMSettings)
	if err != nil {
		return nil, nil, invalidGitHubInput("LLM settings cannot be encoded")
	}
	for key := range settings {
		switch key {
		case "temperature", "reasoning_effort", "max_tokens", "model_name", "model_project_id", "openai_compatible":
		default:
			return nil, nil, invalidGitHubInput("LLM settings contain an unsupported field")
		}
	}

	modelName, err := optionalNonEmptyString(settings, "model_name")
	if err != nil {
		return nil, nil, err
	}
	if request.RequestedLLMModel != nil {
		requested := *request.RequestedLLMModel
		if strings.TrimSpace(requested) == "" {
			return nil, nil, invalidGitHubInput("LLM model is empty")
		}
		if modelName != "" && modelName != requested {
			return nil, nil, invalidGitHubInput("LLM model fields disagree")
		}
		modelName = requested
	}
	modelProjectID, hasModelProjectID, err := optionalPositiveJSONInteger(settings, "model_project_id")
	if err != nil {
		return nil, nil, err
	}
	if value, present := settings["openai_compatible"]; present {
		if _, ok := value.(bool); !ok {
			return nil, nil, invalidGitHubInput("openai_compatible is not a boolean")
		}
	}
	if err := validateGenerationPreferences(settings); err != nil {
		return nil, nil, err
	}

	if modelName == "" {
		if hasModelProjectID || settings["openai_compatible"] != nil {
			return nil, nil, invalidGitHubInput("LLM model metadata has no model name")
		}
		encoded, err := canonicalJSON(settings)
		if err != nil {
			return nil, nil, invalidGitHubInput("LLM settings cannot be encoded")
		}
		return nil, encoded, nil
	}

	model, err := r.resolveLLMModel(ctx, request.ProjectID, modelProjectID, hasModelProjectID, modelName)
	if err != nil {
		return nil, nil, err
	}
	if maxTokens, present := jsonInteger(settings["max_tokens"]); present && maxTokens != -1 && model.MaxOutputTokens > 0 && maxTokens > model.MaxOutputTokens {
		return nil, nil, invalidGitHubInput("max_tokens exceeds the selected model limit")
	}
	effort, _ := settings["reasoning_effort"].(string)
	activeReasoning := effort != "" && effort != "none"
	if model.SupportsReasoning {
		if !activeReasoning {
			return nil, nil, invalidGitHubInput("reasoning_effort is required by the selected model")
		}
		if settings["temperature"] != nil {
			return nil, nil, invalidGitHubInput("temperature conflicts with reasoning_effort")
		}
	} else if activeReasoning {
		return nil, nil, invalidGitHubInput("reasoning_effort is not supported by the selected model")
	}

	// These values are selected from a visible status_ok catalogue row. Never
	// trust the UI copies, which can be stale or forged.
	settings["model_name"] = model.Name
	settings["model_project_id"] = model.ProjectID
	settings["openai_compatible"] = model.OpenAICompatible
	encoded, err := canonicalJSON(settings)
	if err != nil {
		return nil, nil, invalidGitHubInput("LLM settings cannot be encoded")
	}
	resolvedName := model.Name
	return &resolvedName, encoded, nil
}

func (r *FixedGitHubResolver) resolveLLMModel(
	ctx context.Context,
	projectID int64,
	requestedProjectID int64,
	hasRequestedProjectID bool,
	modelName string,
) (IndexLLMModelRecord, error) {
	if hasRequestedProjectID && requestedProjectID != projectID && requestedProjectID != r.publicProjectID {
		return IndexLLMModelRecord{}, invalidGitHubInput("LLM model project is not visible")
	}

	selectedProjectID := projectID
	sharedFallback := false
	var model IndexLLMModelRecord
	var err error
	if hasRequestedProjectID && requestedProjectID == r.publicProjectID && projectID != r.publicProjectID {
		selectedProjectID = r.publicProjectID
		sharedFallback = true
		model, err = r.store.LoadSharedIndexLLMModel(ctx, selectedProjectID, modelName)
	} else {
		model, err = r.store.LoadIndexLLMModel(ctx, selectedProjectID, modelName)
		if errors.Is(err, ErrIndexResolverRecordNotFound) && !hasRequestedProjectID && projectID != r.publicProjectID {
			selectedProjectID = r.publicProjectID
			sharedFallback = true
			model, err = r.store.LoadSharedIndexLLMModel(ctx, selectedProjectID, modelName)
		}
	}
	if errors.Is(err, ErrIndexResolverRecordNotFound) {
		return IndexLLMModelRecord{}, invalidGitHubInput("LLM model is not visible")
	}
	if err != nil {
		return IndexLLMModelRecord{}, fmt.Errorf("load visible LLM model: %w", err)
	}
	if model.ProjectID != selectedProjectID || model.Name != modelName || (sharedFallback && !model.Shared) {
		return IndexLLMModelRecord{}, invalidGitHubInput("LLM model metadata is invalid")
	}
	return model, nil
}

func optionalNonEmptyString(settings map[string]any, key string) (string, error) {
	value, present := settings[key]
	if !present || value == nil {
		return "", nil
	}
	text, ok := value.(string)
	if !ok || strings.TrimSpace(text) == "" {
		return "", invalidGitHubInput(key + " is not a non-empty string")
	}
	return text, nil
}

func optionalPositiveJSONInteger(settings map[string]any, key string) (int64, bool, error) {
	value, present := settings[key]
	if !present || value == nil {
		return 0, false, nil
	}
	integer, ok := positiveJSONInteger(value)
	if !ok {
		return 0, false, invalidGitHubInput(key + " is not a positive integer")
	}
	return integer, true, nil
}

func positiveJSONInteger(value any) (int64, bool) {
	integer, ok := jsonInteger(value)
	return integer, ok && integer > 0
}

func jsonInteger(value any) (int64, bool) {
	if integer, ok := value.(int64); ok {
		return integer, true
	}
	number, ok := value.(json.Number)
	if !ok {
		return 0, false
	}
	integer, err := number.Int64()
	return integer, err == nil
}

func validateGenerationPreferences(settings map[string]any) error {
	if value, present := settings["temperature"]; present && value != nil {
		number, ok := value.(json.Number)
		if !ok {
			return invalidGitHubInput("temperature is not a number")
		}
		temperature, err := number.Float64()
		if err != nil || temperature < 0 || temperature > 1 {
			return invalidGitHubInput("temperature is outside the supported range")
		}
		settings["temperature"] = temperature
	}
	if value, present := settings["max_tokens"]; present && value != nil {
		integer, ok := jsonInteger(value)
		if !ok || (integer < 1 && integer != -1) {
			return invalidGitHubInput("max_tokens is neither a positive integer nor the current -1 automatic sentinel")
		}
		settings["max_tokens"] = integer
	}
	if value, present := settings["reasoning_effort"]; present && value != nil {
		effort, ok := value.(string)
		if !ok || (effort != "none" && effort != "low" && effort != "medium" && effort != "high") {
			return invalidGitHubInput("reasoning_effort is invalid")
		}
	}
	return nil
}

type fixedConfigurationReference struct {
	title string
}

func configurationReference(value any) (fixedConfigurationReference, error) {
	object, ok := value.(map[string]any)
	if !ok || len(object) != 2 {
		return fixedConfigurationReference{}, invalidGitHubInput("configuration reference is malformed")
	}
	title, titleOK := object["elitea_title"].(string)
	private, privateOK := object["private"].(bool)
	if !titleOK || title == "" || !privateOK || private {
		// Personal-project references are intentionally outside the fixed first
		// PoV. Accepting one as a team reference would cross a tenant boundary.
		return fixedConfigurationReference{}, invalidGitHubInput("configuration reference is not supported")
	}
	return fixedConfigurationReference{title: title}, nil
}

func (r *FixedGitHubResolver) resolveConfiguration(
	ctx context.Context,
	projectID int64,
	reference fixedConfigurationReference,
	expectedType string,
	secretFields []string,
	requiredSecretFields map[string]struct{},
) (map[string]any, error) {
	configurationProjectID := projectID
	sharedFallback := false
	record, err := r.store.LoadIndexConfiguration(ctx, projectID, reference.title)
	if errors.Is(err, ErrIndexResolverRecordNotFound) && projectID != r.publicProjectID {
		configurationProjectID = r.publicProjectID
		sharedFallback = true
		record, err = r.store.LoadSharedIndexConfiguration(ctx, r.publicProjectID, reference.title)
	}
	if errors.Is(err, ErrIndexResolverRecordNotFound) {
		return nil, invalidGitHubInput("referenced configuration is not visible")
	}
	if err != nil {
		return nil, fmt.Errorf("load authoritative index configuration: %w", err)
	}
	if record.UUID == "" || record.ProjectID != configurationProjectID || record.Type != expectedType {
		return nil, invalidGitHubInput("referenced configuration type is invalid")
	}
	if sharedFallback && !record.Shared {
		return nil, invalidGitHubInput("referenced configuration project is invalid")
	}

	data, err := decodeJSONObject(record.Data)
	if err != nil {
		return nil, invalidGitHubInput("referenced configuration data is malformed")
	}
	if err := requireCanonicalSecretReferences(data, secretFields, requiredSecretFields); err != nil {
		return nil, err
	}

	// Match configurations.expand: begin with the reference, overlay stored
	// data, then stamp authoritative configuration metadata.
	resolved := map[string]any{
		"elitea_title": reference.title,
		"private":      false,
	}
	for key, value := range data {
		resolved[key] = value
	}
	resolved["configuration_uuid"] = record.UUID
	resolved["configuration_project_id"] = record.ProjectID
	resolved["configuration_type"] = record.Type
	return resolved, nil
}

func (r *FixedGitHubResolver) embeddingModelVisible(ctx context.Context, projectID int64, model string) (bool, error) {
	visible, err := r.store.IndexEmbeddingModelExists(ctx, projectID, model)
	if err != nil {
		return false, fmt.Errorf("load project embedding model: %w", err)
	}
	if visible || projectID == r.publicProjectID {
		return visible, nil
	}
	visible, err = r.store.SharedIndexEmbeddingModelExists(ctx, r.publicProjectID, model)
	if err != nil {
		return false, fmt.Errorf("load shared embedding model: %w", err)
	}
	return visible, nil
}

func requireCanonicalSecretReferences(data map[string]any, fields []string, required map[string]struct{}) error {
	for _, field := range fields {
		value, present := data[field]
		_, isRequired := required[field]
		if !present || value == nil {
			if isRequired {
				return invalidGitHubInput("required credential reference is missing")
			}
			continue
		}
		text, ok := value.(string)
		if !ok || !canonicalSecretReference.MatchString(text) {
			return invalidGitHubInput("credential field is not a canonical secret reference")
		}
	}
	return nil
}

func normalizeCurrentToolkitName(value string) string {
	var normalized strings.Builder
	normalized.Grow(len(value))
	for _, character := range value {
		switch {
		case character >= 'a' && character <= 'z',
			character >= 'A' && character <= 'Z',
			character >= '0' && character <= '9',
			character == '_', character == '-':
			normalized.WriteRune(character)
		case character == '.':
			normalized.WriteByte('_')
		}
	}
	return normalized.String()
}

func nonEmptyString(value any) bool {
	text, ok := value.(string)
	return ok && text != ""
}

func stringListContains(value any, expected string) bool {
	items, ok := value.([]any)
	if !ok {
		return false
	}
	for _, item := range items {
		if text, ok := item.(string); ok && text == expected {
			return true
		}
	}
	return false
}

func decodeJSONObject(raw []byte) (map[string]any, error) {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var object map[string]any
	if err := decoder.Decode(&object); err != nil || object == nil {
		return nil, errors.New("invalid JSON object")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err == nil {
		return nil, errors.New("multiple JSON values")
	} else if !errors.Is(err, io.EOF) {
		return nil, errors.New("invalid trailing JSON")
	}
	return object, nil
}

func canonicalizeJSONObject(raw []byte) (json.RawMessage, error) {
	object, err := decodeJSONObject(raw)
	if err != nil {
		return nil, err
	}
	return canonicalJSON(object)
}

func canonicalJSON(value any) (json.RawMessage, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(encoded), nil
}

func invalidGitHubInput(reason string) error {
	return fmt.Errorf("%w: %s", ErrInvalidIndexStart, reason)
}
