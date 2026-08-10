package runtimecomposition

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
)

type currentActorVisibleSchemaSourceStub struct {
	schema    configurationapp.CurrentToolkitSchema
	found     bool
	err       error
	calls     int
	projectID int32
	userID    int32
	typeName  string
}

func (s *currentActorVisibleSchemaSourceStub) FindCurrentActorVisibleToolkitSchema(
	_ context.Context,
	projectID int32,
	userID int32,
	typeName string,
) (configurationapp.CurrentToolkitSchema, bool, error) {
	s.calls++
	s.projectID = projectID
	s.userID = userID
	s.typeName = typeName
	return s.schema, s.found, s.err
}

func TestPinnedCurrentToolkitSchemaSnapshotMatchesAdmittedSDKProjection(t *testing.T) {
	snapshot, err := LoadPinnedCurrentToolkitSchemaSnapshot()
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.SDKRevision() != "b5113a129329b85d23c2d5c2bf55f18e307414ec" || snapshot.EntryCount() != 52 {
		t.Fatalf("snapshot revision=%q entries=%d", snapshot.SDKRevision(), snapshot.EntryCount())
	}

	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(
		snapshot,
		UnavailableCurrentActorVisibleToolkitSchemas{},
	)
	if err != nil {
		t.Fatal(err)
	}
	schema, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "github")
	if err != nil || !found {
		t.Fatalf("github schema found=%t err=%v", found, err)
	}
	credential, ok := schema.Properties["github_configuration"].(map[string]any)
	if !ok {
		t.Fatalf("github credential annotation=%#v", schema.Properties["github_configuration"])
	}
	types, ok := credential["configuration_types"].([]any)
	if !ok || len(types) != 1 || types[0] != "github" {
		t.Fatalf("github configuration types=%#v", credential["configuration_types"])
	}
	// Callers cannot mutate the immutable built-in snapshot through a result.
	types[0] = "caller-corruption"
	again, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "github")
	if err != nil || !found {
		t.Fatalf("second github lookup found=%t err=%v", found, err)
	}
	againTypes := again.Properties["github_configuration"].(map[string]any)["configuration_types"].([]any)
	if againTypes[0] != "github" {
		t.Fatalf("snapshot was mutated: %#v", againTypes)
	}

	aha, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "aha")
	if err != nil || !found {
		t.Fatalf("aha schema found=%t err=%v", found, err)
	}
	ahaCredential, ok := aha.Properties["aha_configuration"].(map[string]any)
	if !ok {
		t.Fatalf("aha credential annotation=%#v", aha.Properties["aha_configuration"])
	}
	ahaTypes, ok := ahaCredential["configuration_types"].([]any)
	if !ok || len(ahaTypes) != 1 || ahaTypes[0] != "aha" {
		t.Fatalf("aha configuration types=%#v", ahaCredential["configuration_types"])
	}
}

func TestCurrentToolkitSchemaCatalogUsesBuiltInBeforeActorVisibleOverlay(t *testing.T) {
	snapshot := loadCurrentToolkitSchemaSnapshotForTest(t, `{
		"schema_version":"elitea.current-toolkit-schema-snapshot.v1",
		"sdk_revision":"sdk-revision",
		"entries":[{
			"type":"same_type",
			"properties":{"credential":{"configuration_types":["built_in"]}},
			"naming":{"field":null,"max_length":0}
		}]
	}`)
	dynamic := &currentActorVisibleSchemaSourceStub{
		found: true,
		schema: configurationapp.CurrentToolkitSchema{Properties: map[string]any{
			"credential": map[string]any{"configuration_types": []any{"dynamic"}},
		}},
	}
	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(snapshot, dynamic)
	if err != nil {
		t.Fatal(err)
	}

	schema, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "same_type")
	if err != nil || !found || dynamic.calls != 0 {
		t.Fatalf("found=%t err=%v dynamic calls=%d", found, err, dynamic.calls)
	}
	types := schema.Properties["credential"].(map[string]any)["configuration_types"].([]any)
	if len(types) != 1 || types[0] != "built_in" {
		t.Fatalf("schema precedence=%#v", schema)
	}
}

func TestCurrentToolkitSchemaCatalogDelegatesMissingTypeWithActorScope(t *testing.T) {
	snapshot := loadMinimalCurrentToolkitSchemaSnapshot(t)
	dynamicProperties := map[string]any{
		"toolkit_configuration_token": map[string]any{"secret": true},
	}
	dynamic := &currentActorVisibleSchemaSourceStub{
		found:  true,
		schema: configurationapp.CurrentToolkitSchema{Properties: dynamicProperties},
	}
	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(snapshot, dynamic)
	if err != nil {
		t.Fatal(err)
	}

	schema, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "provider_dynamic")
	if err != nil || !found {
		t.Fatalf("dynamic schema found=%t err=%v", found, err)
	}
	if dynamic.calls != 1 || dynamic.projectID != 7 || dynamic.userID != 11 || dynamic.typeName != "provider_dynamic" {
		t.Fatalf("dynamic scope calls=%d project=%d user=%d type=%q", dynamic.calls, dynamic.projectID, dynamic.userID, dynamic.typeName)
	}
	field := schema.Properties["toolkit_configuration_token"].(map[string]any)
	field["secret"] = false
	if dynamicProperties["toolkit_configuration_token"].(map[string]any)["secret"] != true {
		t.Fatal("dynamic source map was aliased to the caller")
	}
}

func TestCurrentToolkitSchemaCatalogFailsClosedWithoutDynamicOwnership(t *testing.T) {
	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(
		loadMinimalCurrentToolkitSchemaSnapshot(t),
		UnavailableCurrentActorVisibleToolkitSchemas{},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "provider_dynamic")
	if found || !errors.Is(err, ErrCurrentDynamicToolkitSchemasUnavailable) {
		t.Fatalf("found=%t err=%v", found, err)
	}
}

func TestCurrentToolkitSchemaCatalogRejectsInvalidRequestsAndDynamicSchemas(t *testing.T) {
	snapshot := loadMinimalCurrentToolkitSchemaSnapshot(t)
	dynamic := &currentActorVisibleSchemaSourceStub{
		found: true,
		schema: configurationapp.CurrentToolkitSchema{Properties: map[string]any{
			"invalid": make(chan int),
		}},
	}
	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(snapshot, dynamic)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "dynamic"); !errors.Is(err, ErrCurrentDynamicToolkitSchemaInvalid) {
		t.Fatalf("invalid dynamic schema error=%v", err)
	}

	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	before := dynamic.calls
	if _, _, err := catalog.FindEffectiveToolkitSchema(canceled, 7, 11, "dynamic"); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled lookup error=%v", err)
	}
	if dynamic.calls != before {
		t.Fatal("canceled lookup reached dynamic source")
	}
	for _, request := range []struct {
		ctx       context.Context
		projectID int32
		userID    int32
		typeName  string
	}{
		{ctx: nil, projectID: 7, userID: 11, typeName: "dynamic"},
		{ctx: context.Background(), projectID: 0, userID: 11, typeName: "dynamic"},
		{ctx: context.Background(), projectID: 7, userID: 0, typeName: "dynamic"},
		{ctx: context.Background(), projectID: 7, userID: 11, typeName: "bad\nname"},
	} {
		if _, _, err := catalog.FindEffectiveToolkitSchema(request.ctx, request.projectID, request.userID, request.typeName); !errors.Is(err, ErrCurrentToolkitSchemaLookupInvalid) {
			t.Fatalf("request=%#v error=%v", request, err)
		}
	}
}

func TestCurrentToolkitSchemaSnapshotRejectsDriftedOrUnboundedDocuments(t *testing.T) {
	tests := []struct {
		name string
		data string
	}{
		{name: "empty", data: ``},
		{name: "wrong version", data: `{"schema_version":"v2","sdk_revision":"r","entries":[]}`},
		{name: "unknown field", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{},"naming":{"field":null,"max_length":0}}],"extra":true}`},
		{name: "trailing value", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{},"naming":{"field":null,"max_length":0}}]} {}`},
		{name: "duplicate type", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{},"naming":{"field":null,"max_length":0}},{"type":"a","properties":{},"naming":{"field":null,"max_length":0}}]}`},
		{name: "unsorted", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"b","properties":{},"naming":{"field":null,"max_length":0}},{"type":"a","properties":{},"naming":{"field":null,"max_length":0}}]}`},
		{name: "missing naming", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{}}]}`},
		{name: "missing max length", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{},"naming":{"field":null}}]}`},
		{name: "name annotation mismatch", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{"url":{"toolkit_name":false}},"naming":{"field":"url","max_length":0}}]}`},
		{name: "negative max length", data: `{"schema_version":"elitea.current-toolkit-schema-snapshot.v1","sdk_revision":"r","entries":[{"type":"a","properties":{},"naming":{"field":null,"max_length":-1}}]}`},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if _, err := LoadCurrentToolkitSchemaSnapshot([]byte(test.data)); !errors.Is(err, ErrCurrentToolkitSchemaSnapshotInvalid) {
				t.Fatalf("error=%v", err)
			}
		})
	}
	if _, err := LoadCurrentToolkitSchemaSnapshot([]byte(strings.Repeat("x", maxCurrentToolkitSchemaSnapshotBytes+1))); !errors.Is(err, ErrCurrentToolkitSchemaSnapshotInvalid) {
		t.Fatalf("oversized snapshot error=%v", err)
	}
}

func TestCurrentBuiltInToolkitNameDeriverMatchesCurrentSanitizationAndFallback(t *testing.T) {
	snapshot := loadCurrentToolkitSchemaSnapshotForTest(t, `{
		"schema_version":"elitea.current-toolkit-schema-snapshot.v1",
		"sdk_revision":"sdk-revision",
		"entries":[{
			"type":"named",
			"properties":{"url":{"toolkit_name":true,"max_toolkit_length":5}},
			"naming":{"field":"url","max_length":5}
		}]
	}`)
	deriver, err := NewCurrentBuiltInToolkitNameDeriver(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	stored := "stored fallback.v2"

	name, err := deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "named", StoredName: &stored,
		Settings: map[string]any{"url": "https://my.host/x"},
	})
	if err != nil || name != "https" {
		t.Fatalf("derived name=%q err=%v", name, err)
	}
	name, err = deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "named", StoredName: &stored, Settings: map[string]any{},
	})
	if err != nil || name != "store" {
		t.Fatalf("truncated fallback name=%q err=%v", name, err)
	}
	name, err = deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "dynamic_only", StoredName: &stored, Settings: map[string]any{},
	})
	if err != nil || name != "storedfallback_v2" {
		t.Fatalf("dynamic-only fallback name=%q err=%v", name, err)
	}
	name, err = deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "named", StoredName: &stored,
		Settings: map[string]any{"url": true},
	})
	if err != nil || name != "True" {
		t.Fatalf("Python boolean rendering name=%q err=%v", name, err)
	}
	name, err = deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "named", StoredName: &stored,
		Settings: map[string]any{"url": ""},
	})
	if err != nil || name != "" {
		t.Fatalf("empty explicit name=%q err=%v", name, err)
	}
}

func TestCurrentBuiltInToolkitNameDeriverFailsClosedForInvalidRows(t *testing.T) {
	deriver, err := NewCurrentBuiltInToolkitNameDeriver(loadMinimalCurrentToolkitSchemaSnapshot(t))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := deriver.DeriveCurrentToolkitName(context.Background(), CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "built_in", Settings: map[string]any{
			"name": map[string]any{"corrupt": true},
		},
	}); !errors.Is(err, ErrCurrentToolkitNameInputInvalid) {
		t.Fatalf("compound name error=%v", err)
	}
	canceled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := deriver.DeriveCurrentToolkitName(canceled, CurrentToolkitNameInput{
		ProjectID: 7, UserID: 11, ToolkitType: "built_in", Settings: map[string]any{},
	}); !errors.Is(err, context.Canceled) {
		t.Fatalf("canceled name derivation error=%v", err)
	}
	if _, err := NewCurrentBuiltInToolkitNameDeriver(nil); err == nil {
		t.Fatal("nil snapshot was accepted")
	}
	if _, err := NewCurrentCompositeToolkitSchemaCatalog(nil, UnavailableCurrentActorVisibleToolkitSchemas{}); err == nil {
		t.Fatal("nil built-in catalog was accepted")
	}
}

func loadMinimalCurrentToolkitSchemaSnapshot(t *testing.T) *CurrentToolkitSchemaSnapshot {
	t.Helper()
	return loadCurrentToolkitSchemaSnapshotForTest(t, `{
		"schema_version":"elitea.current-toolkit-schema-snapshot.v1",
		"sdk_revision":"sdk-revision",
		"entries":[{
			"type":"built_in",
			"properties":{"name":{"toolkit_name":true}},
			"naming":{"field":"name","max_length":0}
		}]
	}`)
}

func loadCurrentToolkitSchemaSnapshotForTest(t *testing.T, data string) *CurrentToolkitSchemaSnapshot {
	t.Helper()
	snapshot, err := LoadCurrentToolkitSchemaSnapshot([]byte(data))
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func TestCurrentToolkitSchemaSnapshotRetainsExactJSONNumbers(t *testing.T) {
	snapshot := loadCurrentToolkitSchemaSnapshotForTest(t, `{
		"schema_version":"elitea.current-toolkit-schema-snapshot.v1",
		"sdk_revision":"sdk-revision",
		"entries":[{
			"type":"numeric",
			"properties":{"field":{"custom_limit":9007199254740993}},
			"naming":{"field":null,"max_length":0}
		}]
	}`)
	catalog, err := NewCurrentCompositeToolkitSchemaCatalog(snapshot, UnavailableCurrentActorVisibleToolkitSchemas{})
	if err != nil {
		t.Fatal(err)
	}
	schema, found, err := catalog.FindEffectiveToolkitSchema(context.Background(), 7, 11, "numeric")
	if err != nil || !found {
		t.Fatalf("numeric schema found=%t err=%v", found, err)
	}
	limit := schema.Properties["field"].(map[string]any)["custom_limit"]
	if limit != json.Number("9007199254740993") {
		t.Fatalf("numeric schema value=%#v", limit)
	}
}
