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
	service, err := NewCurrentApplicationToolSnapshotService(settings, names)
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
	toolID, validToolID := positiveCurrentAgentJSONInteger(tool["id"])
	if !validToolID || toolID != 19 || tool["type"] != "sharepoint" ||
		tool["description"] != "Current toolkit" || tool["toolkit_name"] != "team_docs" ||
		!reflect.DeepEqual(tool["settings"], settings.result) {
		t.Fatalf("frozen tool=%#v", tool)
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
	if service, err := NewCurrentApplicationToolSnapshotService(nil, &currentAgentNameResolverStub{}); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
	if service, err := NewCurrentApplicationToolSnapshotService(&currentAgentSettingsResolverStub{}, nil); err == nil || service != nil {
		t.Fatalf("service=%#v error=%v", service, err)
	}
}
