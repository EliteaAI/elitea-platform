package agentexecution

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

type currentAgentSettingsResolverStub struct {
	requests []configurationapp.CurrentToolkitSettingsRequest
	result   map[string]any
	err      error
}

func (stub *currentAgentSettingsResolverStub) Resolve(
	_ context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	stub.requests = append(stub.requests, request)
	return stub.result, stub.err
}

type currentAgentNameResolverStub struct {
	requests []CurrentAgentToolkitNameRequest
	result   string
	err      error
}

type currentAgentModelCatalogStub struct {
	queries  []configurationapp.CurrentModelCatalogQuery
	response configurationapp.CurrentModelCatalogResponse
	err      error
}

func (stub *currentAgentModelCatalogStub) Get(
	_ context.Context,
	query configurationapp.CurrentModelCatalogQuery,
) (configurationapp.CurrentModelCatalogResponse, error) {
	stub.queries = append(stub.queries, query)
	return stub.response, stub.err
}

func currentAgentModelCatalogForTest(compatible bool) *currentAgentModelCatalogStub {
	reasoning := false
	return &currentAgentModelCatalogStub{response: configurationapp.CurrentModelCatalogResponse{
		Items: []configurationapp.CurrentModelCatalogItem{{
			Name: "model", ProjectID: 7, OpenAICompatible: &compatible,
			SupportsReasoning: &reasoning,
		}},
	}}
}

func (stub *currentAgentNameResolverStub) ResolveCurrentAgentToolkitName(
	_ context.Context,
	request CurrentAgentToolkitNameRequest,
) (string, error) {
	stub.requests = append(stub.requests, request)
	return stub.result, stub.err
}

func TestCurrentApplicationToolSnapshotFreezesGenericToolkitReferences(t *testing.T) {
	settings := &currentAgentSettingsResolverStub{result: map[string]any{
		"selected_tools":  []any{"search", "read"},
		"available_tools": []any{"search", "read", "write"},
		"credential": map[string]any{
			configurationapp.CurrentFrozenConfigurationMarker: true,
			"configuration_project_id":                        json.Number("7"),
			"configuration_type":                              "sharepoint",
			"configuration_uuid":                              "configuration-1",
			"token":                                           "{{secret.SHAREPOINT_TOKEN}}",
		},
	}}
	names := &currentAgentNameResolverStub{result: "team_docs"}
	models := currentAgentModelCatalogForTest(true)
	service, err := NewCurrentApplicationToolSnapshotService(settings, names, models, 1)
	if err != nil {
		t.Fatal(err)
	}

	result, err := service.FreezeCurrentApplicationVersion(
		context.Background(),
		CurrentApplicationVersionFreezeRequest{
			ProjectID: 7, ActorUserID: 11,
			VersionDetails: json.RawMessage(`{
  "id":41,
  "agent_type":"agent",
  "llm_settings":{"model_name":"model"},
  "tools":[{
    "id":19,
    "type":"sharepoint",
    "name":"Team Docs",
    "description":"Current toolkit",
    "author_id":11,
    "settings":{"selected_tools":["search","read"],"sharepoint_configuration":{"elitea_title":"team"}},
    "meta":{"current":true},
    "is_pinned":false
  }]
}`),
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	version, err := decodeCurrentApplicationVersion(result)
	if err != nil {
		t.Fatal(err)
	}
	tool := version["tools"].([]any)[0].(map[string]any)
	llmSettings := version["llm_settings"].(map[string]any)
	toolID, validToolID := positiveCurrentAgentJSONInteger(tool["id"])
	if !validToolID || toolID != 19 || tool["type"] != "sharepoint" ||
		tool["description"] != "Current toolkit" || tool["toolkit_name"] != "team_docs" ||
		!reflect.DeepEqual(tool["settings"], settings.result) {
		t.Fatalf("frozen tool=%#v", tool)
	}
	modelProjectID, validModelProjectID := positiveCurrentAgentJSONInteger(llmSettings["model_project_id"])
	if llmSettings["openai_compatible"] != true || !validModelProjectID || modelProjectID != 7 ||
		len(models.queries) != 1 || models.queries[0].Section != configurationapp.CurrentModelSectionLLM ||
		models.queries[0].ProjectID != 7 || models.queries[0].PublicProjectID != 1 ||
		!models.queries[0].IncludeShared {
		t.Fatalf("llm_settings=%#v queries=%+v", llmSettings, models.queries)
	}
	if len(settings.requests) != 1 || settings.requests[0].Mode != configurationapp.CurrentToolkitSettingsReferenceMode ||
		settings.requests[0].ProjectID != 7 || settings.requests[0].UserID != 11 ||
		len(names.requests) != 1 || names.requests[0].ToolkitType != "sharepoint" ||
		!reflect.DeepEqual(names.requests[0].Settings, settings.result) {
		t.Fatalf("settings=%+v names=%+v", settings.requests, names.requests)
	}
}

func TestCurrentApplicationToolSnapshotRejectsNestedApplicationUntilChildParity(t *testing.T) {
	service, err := NewCurrentApplicationToolSnapshotService(
		&currentAgentSettingsResolverStub{},
		&currentAgentNameResolverStub{},
		currentAgentModelCatalogForTest(false),
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = service.FreezeCurrentApplicationVersion(
		context.Background(),
		CurrentApplicationVersionFreezeRequest{
			ProjectID: 7, ActorUserID: 11,
			VersionDetails: json.RawMessage(`{"tools":[{"id":19,"type":"application","settings":{"application_id":3,"application_version_id":4}}]}`),
		},
	)
	if !errors.Is(err, ErrUnsupportedCurrentAgentStart) {
		t.Fatalf("error=%v", err)
	}
}

func TestCurrentApplicationToolSnapshotValidatesConstruction(t *testing.T) {
	models := currentAgentModelCatalogForTest(false)
	if service, err := NewCurrentApplicationToolSnapshotService(nil, &currentAgentNameResolverStub{}, models, 1); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
	if service, err := NewCurrentApplicationToolSnapshotService(&currentAgentSettingsResolverStub{}, nil, models, 1); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
	if service, err := NewCurrentApplicationToolSnapshotService(&currentAgentSettingsResolverStub{}, &currentAgentNameResolverStub{}, nil, 1); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
	if service, err := NewCurrentApplicationToolSnapshotService(&currentAgentSettingsResolverStub{}, &currentAgentNameResolverStub{}, models, 0); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
}
