package toolkits_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/toolkits"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/runtimecomposition"
)

// The web client reads properties.selected_tools.args_schemas[tool] and renders
// a form from it (apps/elitea-web/src/features/toolkits/ui/test-tools/
// useGetSelectedToolSchema.ts:76, ui/form/ToolBase/ToolBase.render.tsx:274).
// Until the SDK snapshot started carrying argument schemas, every entry here was
// the placeholder {"type":"object"} — an object schema with no properties, from
// which the create-index form rendered zero inputs and left its Index button
// permanently disabled. Every assertion below is on the real index_data schema
// at SDK revision b5113a1, so none of them can pass against that placeholder.
func TestToolkitTypeCatalogueServesTheSDKArgumentSchemas(t *testing.T) {
	t.Parallel()

	body := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(pinnedSnapshot(t)))

	indexData := argumentSchema(t, body, "artifact", "index_data")
	if indexData["type"] != "object" {
		t.Errorf("index_data type=%#v, want %q", indexData["type"], "object")
	}
	required, ok := indexData["required"].([]any)
	if !ok || len(required) != 1 || required[0] != "index_name" {
		t.Errorf("index_data required=%#v, want [index_name]", indexData["required"])
	}
	properties, ok := indexData["properties"].(map[string]any)
	if !ok {
		t.Fatalf("index_data carries no properties object: %#v", indexData)
	}
	for _, argument := range []string{
		"index_name", "clean_index", "folder", "include_extensions",
		"skip_extensions", "progress_step", "chunking_config",
	} {
		if _, ok := properties[argument].(map[string]any); !ok {
			t.Errorf("index_data.properties is missing %q; have %v", argument, keysOf(properties))
		}
	}
	indexName, _ := properties["index_name"].(map[string]any)
	if indexName["type"] != "string" || indexName["maxLength"] != float64(32) {
		t.Errorf("index_name=%#v, want a string with maxLength 32", indexName)
	}

	// The SETTINGS properties are a different resource and must survive the
	// swap: they are the fields the create-toolkit form renders, and the
	// snapshot's own annotation "properties" do not contain them (artifact's
	// annotations name only embedding_model and pgvector_configuration — no
	// bucket at all), so they cannot be sourced from it.
	artifact := body["artifact"].(map[string]any)["properties"].(map[string]any)
	for _, setting := range []string{"bucket", "embedding_model", "pgvector_configuration"} {
		if _, ok := artifact[setting]; !ok {
			t.Errorf("artifact settings lost %q; have %v", setting, keysOf(artifact))
		}
	}
}

// mcp/mcp_config/openapi declare no argument models in the SDK because their
// tools are discovered at runtime. openapi is the one of the three that is in
// this catalogue, and it must come back with an empty args_schemas object, not
// as a missing key and not as a 500.
func TestToolkitTypeCatalogueServesAnEmptyArgumentSchemaMapForRuntimeDiscoveredTools(t *testing.T) {
	t.Parallel()

	body := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(pinnedSnapshot(t)))

	selectedTools := selectedToolsSchema(t, body, "openapi")
	argsSchemas, ok := selectedTools["args_schemas"].(map[string]any)
	if !ok {
		t.Fatalf("openapi selected_tools has no args_schemas object: %#v", selectedTools)
	}
	if len(argsSchemas) != 0 {
		t.Errorf("openapi args_schemas=%v, want empty", keysOf(argsSchemas))
	}
}

// Four catalogue types are not SDK toolkits at all — the SDK's database toolkit
// is `sql`, and datasource/application/custom are elitea_core-native. Their
// hand-written tool-name lists are the only source there is, and dropping them
// would take the Indexes tab away from datasource toolkits, which is decided by
// exactly these keys (apps/elitea-web/src/features/toolkits/lib/helpers/
// indexesTabVisibility.ts:49).
func TestToolkitTypeCatalogueKeepsToolNamesForTypesTheSDKDoesNotDefine(t *testing.T) {
	t.Parallel()

	body := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(pinnedSnapshot(t)))

	for toolkitType, tools := range map[string][]string{
		"datasource":  {"index_data", "search_data"},
		"database":    {"query", "list_tables", "describe_table"},
		"application": {"ask_agent"},
	} {
		selectedTools := selectedToolsSchema(t, body, toolkitType)
		argsSchemas, ok := selectedTools["args_schemas"].(map[string]any)
		if !ok {
			t.Fatalf("%s selected_tools has no args_schemas object: %#v", toolkitType, selectedTools)
		}
		for _, tool := range tools {
			if _, ok := argsSchemas[tool]; !ok {
				t.Errorf("%s lost tool %q; have %v", toolkitType, tool, keysOf(argsSchemas))
			}
		}
	}
}

// A $ref is only meaningful next to the $defs it points at. This is the test
// that fails if the argument schema is ever carried in a narrowed Go type that
// knows only the keywords this codebase happens to use: the schema arrives at
// the browser structurally intact or not at all.
func TestToolkitTypeCatalogueServesNestedSchemaReferencesVerbatim(t *testing.T) {
	t.Parallel()

	const schema = `{
		"$defs":{"Chunk":{"properties":{"max_tokens":{"type":"integer","default":512}},"type":"object"}},
		"properties":{"chunk":{"$ref":"#/$defs/Chunk"},"chunks":{"items":{"$ref":"#/$defs/Chunk"},"type":"array"}},
		"required":["chunk"],
		"type":"object"
	}`
	var indexData map[string]any
	if err := json.Unmarshal([]byte(schema), &indexData); err != nil {
		t.Fatal(err)
	}
	source := stubArgumentSchemas{"artifact": {"index_data": indexData}}

	body := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(source))

	var want any
	if err := json.Unmarshal([]byte(schema), &want); err != nil {
		t.Fatal(err)
	}
	if got := any(argumentSchema(t, body, "artifact", "index_data")); !reflect.DeepEqual(got, want) {
		t.Errorf("served argument schema:\n got %#v\nwant the source schema verbatim", got)
	}
}

// A source that cannot produce its schemas is a broken binary. Answering 200
// with the settings-only catalogue would put the empty-form defect back, silently.
func TestToolkitTypeCatalogueFailsLoudlyWhenTheSchemaSourceErrors(t *testing.T) {
	t.Parallel()

	handler := toolkits.NewHandlerWithRepo(
		&mockRepo{},
		toolkits.WithArgumentSchemas(failingArgumentSchemas{}),
	)
	response := httptest.NewRecorder()
	handler.ListTypeSchemas(response, httptest.NewRequest(http.MethodGet, "/toolkits/prompt_lib/1", nil))

	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d, want 500: %s", response.Code, response.Body.String())
	}
}

// The catalogue is assembled from a package-level map on every request, so a
// response that got mutated (or one request's schemas leaking into the next)
// would corrupt every later caller in the process.
func TestToolkitTypeCatalogueDoesNotLeakBetweenRequests(t *testing.T) {
	t.Parallel()

	first := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(
		stubArgumentSchemas{"artifact": {"only_tool": {"type": "object"}}},
	))
	if _, ok := argumentSchema(t, first, "artifact", "only_tool")["type"]; !ok {
		t.Fatal("the stub source did not reach the response")
	}

	second := getToolkitTypeCatalogue(t, toolkits.WithArgumentSchemas(pinnedSnapshot(t)))
	argsSchemas := selectedToolsSchema(t, second, "artifact")["args_schemas"].(map[string]any)
	if _, leaked := argsSchemas["only_tool"]; leaked {
		t.Errorf("the previous request's schemas survived into this one: %v", keysOf(argsSchemas))
	}
}

func pinnedSnapshot(t *testing.T) *runtimecomposition.CurrentToolkitSchemaSnapshot {
	t.Helper()
	snapshot, err := runtimecomposition.LoadPinnedCurrentToolkitSchemaSnapshot()
	if err != nil {
		t.Fatalf("load pinned toolkit schema snapshot: %v", err)
	}
	return snapshot
}

func getToolkitTypeCatalogue(t *testing.T, opts ...toolkits.Option) map[string]any {
	t.Helper()
	handler := toolkits.NewHandlerWithRepo(&mockRepo{}, opts...)
	response := httptest.NewRecorder()
	handler.ListTypeSchemas(response, httptest.NewRequest(http.MethodGet, "/toolkits/prompt_lib/1", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("status=%d, want 200: %s", response.Code, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (%s)", err, response.Body.String())
	}
	return body
}

func selectedToolsSchema(t *testing.T, body map[string]any, toolkitType string) map[string]any {
	t.Helper()
	typeSchema, ok := body[toolkitType].(map[string]any)
	if !ok {
		t.Fatalf("catalogue has no %q type; have %v", toolkitType, keysOf(body))
	}
	properties, ok := typeSchema["properties"].(map[string]any)
	if !ok {
		t.Fatalf("%s has no properties object: %#v", toolkitType, typeSchema)
	}
	selectedTools, ok := properties["selected_tools"].(map[string]any)
	if !ok {
		t.Fatalf("%s has no selected_tools property: %v", toolkitType, keysOf(properties))
	}
	return selectedTools
}

func argumentSchema(t *testing.T, body map[string]any, toolkitType, tool string) map[string]any {
	t.Helper()
	selectedTools := selectedToolsSchema(t, body, toolkitType)
	argsSchemas, ok := selectedTools["args_schemas"].(map[string]any)
	if !ok {
		t.Fatalf("%s selected_tools has no args_schemas object: %#v", toolkitType, selectedTools)
	}
	schema, ok := argsSchemas[tool].(map[string]any)
	if !ok {
		t.Fatalf("%s has no %q argument schema; have %v", toolkitType, tool, keysOf(argsSchemas))
	}
	return schema
}

func keysOf[V any](values map[string]V) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

type stubArgumentSchemas map[string]map[string]map[string]any

func (s stubArgumentSchemas) ToolkitArgumentSchemas(
	toolkitType string,
) (map[string]map[string]any, bool, error) {
	schemas, found := s[toolkitType]
	return schemas, found, nil
}

type failingArgumentSchemas struct{}

func (failingArgumentSchemas) ToolkitArgumentSchemas(
	string,
) (map[string]map[string]any, bool, error) {
	return nil, false, errors.New("snapshot unavailable")
}
