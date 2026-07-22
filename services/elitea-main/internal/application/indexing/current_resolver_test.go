package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

type currentToolkitReaderStub struct {
	toolkit CurrentToolkitSnapshot
	found   bool
	err     error
	calls   int
}

func (s *currentToolkitReaderStub) GetCurrentToolkit(
	_ context.Context,
	projectID int32,
	userID int32,
	toolkitID int32,
) (CurrentToolkitSnapshot, bool, error) {
	s.calls++
	if projectID != 7 || userID != 42 || toolkitID != 19 {
		return CurrentToolkitSnapshot{}, false, errors.New("unexpected toolkit scope")
	}
	return s.toolkit, s.found, s.err
}

type currentModelCatalogStub struct {
	response configurationapp.CurrentModelCatalogResponse
	err      error
	calls    int
	query    configurationapp.CurrentModelCatalogQuery
}

type currentToolkitSettingsValidatorStub struct {
	result map[string]any
	err    error
	calls  []configurationapp.CurrentToolkitSettingsRequest
}

func (s *currentToolkitSettingsValidatorStub) Resolve(
	_ context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	s.calls = append(s.calls, configurationapp.CurrentToolkitSettingsRequest{
		ToolkitType: request.ToolkitType,
		Settings:    cloneCurrentResolverObject(request.Settings),
		ProjectID:   request.ProjectID,
		UserID:      request.UserID,
		Mode:        request.Mode,
	})
	if s.err != nil {
		return nil, s.err
	}
	if s.result != nil {
		return cloneCurrentResolverObject(s.result), nil
	}
	return cloneCurrentResolverObject(request.Settings), nil
}

func (s *currentModelCatalogStub) Get(
	_ context.Context,
	query configurationapp.CurrentModelCatalogQuery,
) (configurationapp.CurrentModelCatalogResponse, error) {
	s.calls++
	s.query = query
	return s.response, s.err
}

func TestCurrentAuthoritativeInputResolverLoadsSavedToolkitAndConfigurationModelMetadata(t *testing.T) {
	openAICompatible := true
	toolkits := &currentToolkitReaderStub{found: true, toolkit: CurrentToolkitSnapshot{
		ID:   19,
		Type: "confluence",
		Name: "Wiki.Main !",
		Settings: map[string]any{
			"confluence_configuration": map[string]any{"elitea_title": "wiki-prod"},
			"pgvector_configuration":   map[string]any{"elitea_title": "project-vectorstore"},
			"large_integer":            json.Number("9007199254740993"),
		},
	}}
	models := &currentModelCatalogStub{response: configurationapp.CurrentModelCatalogResponse{
		Items: []configurationapp.CurrentModelCatalogItem{
			{Name: "claude-through-openai", ProjectID: 1, Shared: true, OpenAICompatible: &openAICompatible},
		},
	}}
	settingsValidator := &currentToolkitSettingsValidatorStub{result: map[string]any{
		"confluence_configuration": map[string]any{
			configurationapp.CurrentFrozenConfigurationMarker: true,
			"elitea_title":             "wiki-prod",
			"private":                  false,
			"url":                      "https://wiki.example",
			"token":                    "{{secret.CONFLUENCE_TOKEN}}",
			"configuration_uuid":       "configuration-confluence",
			"configuration_project_id": int32(1),
			"configuration_type":       "confluence",
		},
		"pgvector_configuration": map[string]any{
			configurationapp.CurrentFrozenConfigurationMarker: true,
			"elitea_title":             "project-vectorstore",
			"private":                  true,
			"connection_string":        "{{secret.PGVECTOR_CONNECTION}}",
			"configuration_uuid":       "configuration-pgvector",
			"configuration_project_id": int32(700),
			"configuration_type":       "pgvector",
		},
		"large_integer": json.Number("9007199254740993"),
	}}
	resolver, err := NewCurrentAuthoritativeInputResolver(toolkits, models, settingsValidator, 1)
	if err != nil {
		t.Fatal(err)
	}
	model := "claude-through-openai"
	request := StartRequest{
		ProjectID:            7,
		ActorUserID:          42,
		ToolkitID:            19,
		ToolParameters:       json.RawMessage(`{"index_name":"docs","source":"all"}`),
		RequestedLLMModel:    &model,
		RequestedLLMSettings: json.RawMessage(`{"temperature":0.1,"seed":9007199254740993}`),
	}

	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if toolkits.calls != 1 || models.calls != 1 || models.query != (configurationapp.CurrentModelCatalogQuery{
		Section: configurationapp.CurrentModelSectionLLM, ProjectID: 7, PublicProjectID: 1, IncludeShared: true,
	}) {
		t.Fatalf("toolkit calls=%d model calls=%d query=%+v", toolkits.calls, models.calls, models.query)
	}
	if len(settingsValidator.calls) != 1 || settingsValidator.calls[0].ToolkitType != "confluence" ||
		settingsValidator.calls[0].ProjectID != 7 || settingsValidator.calls[0].UserID != 42 ||
		settingsValidator.calls[0].Mode != configurationapp.CurrentToolkitSettingsReferenceMode {
		t.Fatalf("settings validation calls=%+v", settingsValidator.calls)
	}

	toolkit, err := decodeCurrentResolverObject(inputs.ToolkitConfiguration)
	if err != nil {
		t.Fatal(err)
	}
	if toolkit["id"] != json.Number("19") || toolkit["type"] != "confluence" || toolkit["toolkit_name"] != "Wiki_Main" {
		t.Fatalf("toolkit identity=%#v", toolkit)
	}
	settings := toolkit["settings"].(map[string]any)
	confluence := settings["confluence_configuration"].(map[string]any)
	pgvector := settings["pgvector_configuration"].(map[string]any)
	if settings["large_integer"] != json.Number("9007199254740993") ||
		confluence["configuration_uuid"] != "configuration-confluence" ||
		confluence["configuration_project_id"] != json.Number("1") ||
		confluence["token"] != "{{secret.CONFLUENCE_TOKEN}}" ||
		pgvector["configuration_uuid"] != "configuration-pgvector" ||
		pgvector["configuration_project_id"] != json.Number("700") ||
		pgvector["connection_string"] != "{{secret.PGVECTOR_CONNECTION}}" {
		t.Fatalf("sealed expansion was not frozen at admission: %#v", settings)
	}
	if strings.Contains(string(inputs.ToolkitConfiguration), "confluence-secret") ||
		strings.Contains(string(inputs.ToolkitConfiguration), "postgresql://") {
		t.Fatal("resolver materialized credential plaintext during admission")
	}

	llm, err := decodeCurrentResolverObject(inputs.LLMConfiguration)
	if err != nil {
		t.Fatal(err)
	}
	if llm["openai_compatible"] != true || llm["seed"] != json.Number("9007199254740993") || inputs.LLMModel == nil || *inputs.LLMModel != model {
		t.Fatalf("LLM resolution model=%v settings=%#v", inputs.LLMModel, llm)
	}
	if inputs.MCPReferences != nil {
		t.Fatalf("unexpected invented MCP credential input: %s", inputs.MCPReferences)
	}
}

func TestCurrentAuthoritativeInputResolverUsesConfigurationsDefaultWithoutCopyingCredentials(t *testing.T) {
	compatible := false
	defaultName := "configured-default"
	defaultProjectID := int32(7)
	toolkits := validCurrentToolkitReader()
	models := &currentModelCatalogStub{response: configurationapp.CurrentModelCatalogResponse{
		DefaultModelName:      &defaultName,
		DefaultModelProjectID: &defaultProjectID,
		Items: []configurationapp.CurrentModelCatalogItem{{
			Name: defaultName, ProjectID: 7, OpenAICompatible: &compatible,
		}},
	}}
	resolver := newCurrentAuthoritativeResolverForTest(t, toolkits, models)

	inputs, err := resolver.Resolve(context.Background(), validCurrentStartRequest(nil, `{}`))
	if err != nil {
		t.Fatal(err)
	}
	if inputs.LLMModel == nil || *inputs.LLMModel != defaultName {
		t.Fatalf("model=%v, want Configurations default", inputs.LLMModel)
	}
	settings, _ := decodeCurrentResolverObject(inputs.LLMConfiguration)
	if settings["openai_compatible"] != false || len(settings) != 1 {
		t.Fatalf("settings=%#v", settings)
	}
}

func TestCurrentAuthoritativeInputResolverOverwritesCallerCompatibilityFromConfigurations(t *testing.T) {
	compatible := false
	models := &currentModelCatalogStub{response: configurationapp.CurrentModelCatalogResponse{Items: []configurationapp.CurrentModelCatalogItem{{
		Name: "explicit-model", ProjectID: 7, OpenAICompatible: &compatible,
	}}}}
	resolver := newCurrentAuthoritativeResolverForTest(t, validCurrentToolkitReader(), models)
	model := "explicit-model"

	inputs, err := resolver.Resolve(context.Background(), validCurrentStartRequest(&model, `{"openai_compatible":true}`))
	if err != nil {
		t.Fatal(err)
	}
	if models.calls != 1 {
		t.Fatalf("authoritative compatibility queried catalog %d times", models.calls)
	}
	settings, _ := decodeCurrentResolverObject(inputs.LLMConfiguration)
	if settings["openai_compatible"] != false {
		t.Fatalf("settings=%#v", settings)
	}
}

func TestCurrentAuthoritativeInputResolverFailsClosedWhenConfigurationsModelCatalogIsUnavailable(t *testing.T) {
	models := &currentModelCatalogStub{err: errors.New("catalog details must not escape")}
	resolver := newCurrentAuthoritativeResolverForTest(t, validCurrentToolkitReader(), models)
	model := "explicit-model"
	_, err := resolver.Resolve(context.Background(), validCurrentStartRequest(&model, `{"openai_compatible":true}`))
	if !errors.Is(err, ErrCurrentModelResolutionUnavailable) || err.Error() != ErrCurrentModelResolutionUnavailable.Error() {
		t.Fatalf("error=%v, want redacted model-resolution failure", err)
	}
}

func TestCurrentAuthoritativeInputResolverFreezesSealedExpansionWithoutAliasing(t *testing.T) {
	expansion := map[string]any{
		"credential": map[string]any{
			configurationapp.CurrentFrozenConfigurationMarker: true,
			"elitea_title":             "frozen-title",
			"private":                  false,
			"token":                    "{{secret.FROZEN}}",
			"configuration_uuid":       "frozen-uuid",
			"configuration_project_id": int32(7),
			"configuration_type":       "github",
		},
	}
	validator := &currentToolkitSettingsValidatorStub{result: expansion}
	toolkits := validCurrentToolkitReader()
	resolver := newCurrentAuthoritativeResolverWithSettingsForTest(
		t,
		toolkits,
		&currentModelCatalogStub{},
		validator,
	)

	inputs, err := resolver.Resolve(context.Background(), validCurrentStartRequest(nil, `{}`))
	if err != nil {
		t.Fatal(err)
	}
	if len(validator.calls) != 1 || validator.calls[0].Mode != configurationapp.CurrentToolkitSettingsReferenceMode {
		t.Fatalf("settings validation calls=%+v", validator.calls)
	}
	expansion["credential"].(map[string]any)["token"] = "mutated-after-resolve"
	validator.result["credential"].(map[string]any)["elitea_title"] = "changed-title"
	validator.calls[0].Settings["credential"] = "changed-original-reference"
	toolkit, decodeErr := decodeCurrentResolverObject(inputs.ToolkitConfiguration)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	credential := toolkit["settings"].(map[string]any)["credential"].(map[string]any)
	if credential["elitea_title"] != "frozen-title" || credential["token"] != "{{secret.FROZEN}}" ||
		credential["configuration_project_id"] != json.Number("7") {
		t.Fatalf("frozen expansion changed through an alias: %#v", credential)
	}
}

func TestCurrentAuthoritativeInputResolverClassifiesSettingsFailuresWithoutDetails(t *testing.T) {
	validation := &configurationapp.CurrentToolkitSettingsValidationError{Violations: []configurationapp.CurrentToolkitSettingsViolation{{
		Field: "credential", Code: configurationapp.CurrentToolkitConfigurationNotFoundCode,
	}}}
	for name, test := range map[string]struct {
		err  error
		want error
	}{
		"invalid saved references": {err: validation, want: ErrInvalidAuthoritativeIndexInput},
		"catalog dependency":       {err: errors.New("schema registry secret detail"), want: ErrCurrentToolkitSettingsResolutionUnavailable},
	} {
		t.Run(name, func(t *testing.T) {
			resolver := newCurrentAuthoritativeResolverWithSettingsForTest(
				t,
				validCurrentToolkitReader(),
				&currentModelCatalogStub{},
				&currentToolkitSettingsValidatorStub{err: test.err},
			)
			_, err := resolver.Resolve(context.Background(), validCurrentStartRequest(nil, `{}`))
			if !errors.Is(err, test.want) || err.Error() != test.want.Error() {
				t.Fatalf("error=%v, want safe %v", err, test.want)
			}
		})
	}
}

func TestCurrentAuthoritativeInputResolverDoesNotAliasCallerOrRepositoryValues(t *testing.T) {
	model := "model"
	request := validCurrentStartRequest(&model, `{"nested":{"value":"request"}}`)
	toolkits := validCurrentToolkitReader()
	resolver := newCurrentAuthoritativeResolverForTest(t, toolkits, &currentModelCatalogStub{})

	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	request.ToolParameters[2] = 'X'
	request.RequestedLLMSettings[2] = 'X'
	*request.RequestedLLMModel = "changed"
	toolkits.toolkit.Settings["credential"] = "changed"

	toolkit, _ := decodeCurrentResolverObject(inputs.ToolkitConfiguration)
	settings := toolkit["settings"].(map[string]any)
	if settings["credential"] != "{{secret.CREDENTIAL}}" || string(inputs.ToolParameters) != `{"index_name":"docs"}` || *inputs.LLMModel != "model" {
		t.Fatalf("resolver retained an alias: toolkit=%#v params=%s model=%v", toolkit, inputs.ToolParameters, inputs.LLMModel)
	}
	llm, _ := decodeCurrentResolverObject(inputs.LLMConfiguration)
	if !reflect.DeepEqual(llm["nested"], map[string]any{"value": "request"}) {
		t.Fatalf("LLM settings changed through request alias: %#v", llm)
	}
}

func TestCurrentAuthoritativeInputResolverRejectsMissingOrInvalidSavedToolkit(t *testing.T) {
	for name, reader := range map[string]*currentToolkitReaderStub{
		"not found": {found: false},
		"wrong id": {
			found:   true,
			toolkit: CurrentToolkitSnapshot{ID: 20, Type: "github", Name: "repo", Settings: map[string]any{}},
		},
		"missing settings": {
			found:   true,
			toolkit: CurrentToolkitSnapshot{ID: 19, Type: "github", Name: "repo"},
		},
	} {
		t.Run(name, func(t *testing.T) {
			resolver := newCurrentAuthoritativeResolverForTest(t, reader, &currentModelCatalogStub{})
			_, err := resolver.Resolve(context.Background(), validCurrentStartRequest(nil, `{}`))
			if name == "not found" {
				if !errors.Is(err, ErrToolkitNotVisible) {
					t.Fatalf("error=%v, want not visible", err)
				}
				return
			}
			if !errors.Is(err, ErrInvalidAuthoritativeIndexInput) {
				t.Fatalf("error=%v, want invalid input", err)
			}
		})
	}
}

func TestNewCurrentAuthoritativeInputResolverRejectsIncompleteComposition(t *testing.T) {
	models := &currentModelCatalogStub{}
	toolkits := validCurrentToolkitReader()
	settings := &currentToolkitSettingsValidatorStub{}
	if _, err := NewCurrentAuthoritativeInputResolver(nil, models, settings, 1); err == nil {
		t.Fatal("expected missing toolkit reader to fail")
	}
	if _, err := NewCurrentAuthoritativeInputResolver(toolkits, nil, settings, 1); err == nil {
		t.Fatal("expected missing model catalog to fail")
	}
	if _, err := NewCurrentAuthoritativeInputResolver(toolkits, models, nil, 1); err == nil {
		t.Fatal("expected missing settings validator to fail")
	}
	if _, err := NewCurrentAuthoritativeInputResolver(toolkits, models, settings, 0); err == nil {
		t.Fatal("expected invalid public project to fail")
	}
}

func validCurrentToolkitReader() *currentToolkitReaderStub {
	return &currentToolkitReaderStub{found: true, toolkit: CurrentToolkitSnapshot{
		ID:       19,
		Type:     "github",
		Name:     "repo",
		Settings: map[string]any{"credential": "{{secret.CREDENTIAL}}"},
	}}
}

func validCurrentStartRequest(model *string, settings string) StartRequest {
	return StartRequest{
		ProjectID:            7,
		ActorUserID:          42,
		ToolkitID:            19,
		ToolParameters:       json.RawMessage(`{"index_name":"docs"}`),
		RequestedLLMModel:    model,
		RequestedLLMSettings: json.RawMessage(settings),
	}
}

func newCurrentAuthoritativeResolverForTest(
	t *testing.T,
	toolkits CurrentToolkitReader,
	models CurrentModelCatalog,
) *CurrentAuthoritativeInputResolver {
	t.Helper()
	return newCurrentAuthoritativeResolverWithSettingsForTest(
		t,
		toolkits,
		models,
		&currentToolkitSettingsValidatorStub{},
	)
}

func newCurrentAuthoritativeResolverWithSettingsForTest(
	t *testing.T,
	toolkits CurrentToolkitReader,
	models CurrentModelCatalog,
	settings CurrentToolkitSettingsValidator,
) *CurrentAuthoritativeInputResolver {
	t.Helper()
	resolver, err := NewCurrentAuthoritativeInputResolver(toolkits, models, settings, 1)
	if err != nil {
		t.Fatal(err)
	}
	return resolver
}
