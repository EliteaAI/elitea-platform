package runtimecomposition

import (
	"context"
	"errors"
	"reflect"
	"testing"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/mcpregistry"
)

type currentAgentToolkitSettingsResolverStub struct {
	result  map[string]any
	err     error
	request configurationapp.CurrentToolkitSettingsRequest
}

func (stub *currentAgentToolkitSettingsResolverStub) Resolve(
	_ context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	stub.request = request
	return stub.result, stub.err
}

type currentPrebuiltMCPStoreStub struct {
	entry  mcpregistry.PrebuiltServer
	err    error
	lookup string
	calls  int
}

func (stub *currentPrebuiltMCPStoreStub) Lookup(
	_ context.Context,
	name string,
) (mcpregistry.PrebuiltServer, error) {
	stub.calls++
	stub.lookup = name
	return stub.entry, stub.err
}

func enabledPrebuiltMCPEntry() mcpregistry.PrebuiltServer {
	return mcpregistry.PrebuiltServer{
		Key:            "release_intelligence",
		DisplayName:    "Release Intelligence",
		ServerURL:      "https://mcp.example.test/v1/mcp",
		TimeoutSeconds: 45,
		Headers:        map[string]string{"X-Platform": "fixed-value"},
		Enabled:        true,
	}
}

func TestCurrentAgentPrebuiltMCPExposesOnlyEnabledDynamicDefinitions(t *testing.T) {
	store := &currentPrebuiltMCPStoreStub{entry: enabledPrebuiltMCPEntry()}
	source, err := newCurrentAgentPrebuiltMCP(store)
	if err != nil {
		t.Fatal(err)
	}
	schema, found, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(),
		7,
		11,
		"mcp_release_intelligence",
	)
	if err != nil || !found || schema.Properties == nil || len(schema.Properties) != 0 {
		t.Fatalf("schema=%#v found=%v error=%v", schema, found, err)
	}
	if store.lookup != "mcp_release_intelligence" || store.calls != 1 {
		t.Fatalf("lookup=%q calls=%d", store.lookup, store.calls)
	}

	store.entry.Enabled = false
	if _, found, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(), 7, 11, "mcp_release_intelligence",
	); err != nil || found {
		t.Fatalf("disabled found=%v error=%v", found, err)
	}
	store.err = mcpregistry.ErrPrebuiltNotFound
	if _, found, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(), 7, 11, "mcp_missing",
	); err != nil || found {
		t.Fatalf("missing found=%v error=%v", found, err)
	}

	before := store.calls
	if _, found, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(), 7, 11, "provider_dynamic",
	); err != nil || found || store.calls != before {
		t.Fatalf("unrelated found=%v error=%v calls=%d", found, err, store.calls)
	}
}

func TestCurrentAgentPrebuiltMCPSchemaLookupValidatesDependencies(t *testing.T) {
	dependency := errors.New("catalogue unavailable")
	store := &currentPrebuiltMCPStoreStub{err: dependency}
	source, err := newCurrentAgentPrebuiltMCP(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := source.FindCurrentActorVisibleToolkitSchema(
		context.Background(), 7, 11, "mcp_release_intelligence",
	); !errors.Is(err, dependency) {
		t.Fatalf("dependency error=%v", err)
	}

	var nilContext context.Context
	if _, _, err := source.FindCurrentActorVisibleToolkitSchema(
		nilContext, 7, 11, "mcp_release_intelligence",
	); !errors.Is(err, ErrCurrentToolkitSchemaLookupInvalid) {
		t.Fatalf("nil context error=%v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, _, err := source.FindCurrentActorVisibleToolkitSchema(
		ctx, 7, 11, "mcp_release_intelligence",
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancelled context error=%v", err)
	}
	if resolver, err := newCurrentAgentPrebuiltMCP(nil); err == nil || resolver != nil {
		t.Fatal("missing store must fail construction")
	}
}

func TestCurrentAgentPrebuiltMCPResolvesFixedHTTPAuthority(t *testing.T) {
	store := &currentPrebuiltMCPStoreStub{entry: enabledPrebuiltMCPEntry()}
	resolver, err := newCurrentAgentPrebuiltMCP(store)
	if err != nil {
		t.Fatal(err)
	}
	settings := map[string]any{
		"server_name":    "Release Intelligence",
		"url":            "https://caller.example.test/mcp",
		"headers":        map[string]any{"Authorization": "caller-secret"},
		"client_secret":  "caller-secret",
		"selected_tools": []any{"lookup_release"},
		"excluded_tools": []any{"publish_release"},
		"unknown":        "must-not-cross",
	}
	resolved, found, err := resolver.ResolveCurrentAgentPrebuiltMCP(
		context.Background(),
		"mcp_config",
		settings,
	)
	if err != nil || !found {
		t.Fatalf("found=%v error=%v", found, err)
	}
	if store.lookup != "Release Intelligence" {
		t.Fatalf("lookup=%q", store.lookup)
	}
	want := map[string]any{
		"server_name":    "release_intelligence",
		"url":            "https://mcp.example.test/v1/mcp",
		"ssl_verify":     true,
		"timeout":        45,
		"headers":        map[string]any{"X-Platform": "fixed-value"},
		"selected_tools": []any{"lookup_release"},
		"excluded_tools": []any{"publish_release"},
	}
	if !reflect.DeepEqual(resolved, want) {
		t.Fatalf("resolved=%#v want=%#v", resolved, want)
	}
	if settings["url"] != "https://caller.example.test/mcp" {
		t.Fatal("resolver mutated caller settings")
	}
}

func TestCurrentAgentPrebuiltMCPRejectsUnknownOrDisabledResolution(t *testing.T) {
	store := &currentPrebuiltMCPStoreStub{err: mcpregistry.ErrPrebuiltNotFound}
	resolver, err := newCurrentAgentPrebuiltMCP(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, found, err := resolver.ResolveCurrentAgentPrebuiltMCP(
		context.Background(), "mcp_missing", map[string]any{},
	); err != nil || found {
		t.Fatalf("missing found=%v error=%v", found, err)
	}
	store.err = nil
	store.entry = enabledPrebuiltMCPEntry()
	store.entry.Enabled = false
	if _, found, err := resolver.ResolveCurrentAgentPrebuiltMCP(
		context.Background(), "mcp_release_intelligence", map[string]any{},
	); err != nil || found {
		t.Fatalf("disabled found=%v error=%v", found, err)
	}
	if _, found, err := resolver.ResolveCurrentAgentPrebuiltMCP(
		context.Background(), "mcp_config", map[string]any{},
	); err != nil || found {
		t.Fatalf("missing selector found=%v error=%v", found, err)
	}
}

func TestCurrentAgentPrebuiltMCPAdmissionKeepsOnlySelectorAndFilters(t *testing.T) {
	inner := &currentAgentToolkitSettingsResolverStub{result: map[string]any{
		"server_name":    "mcp_release_intelligence",
		"selected_tools": []any{"lookup_release"},
		"excluded_tools": []any{"publish_release"},
		"enable_caching": true,
		"cache_ttl":      90,
		"url":            "https://caller.example.test/mcp",
		"headers":        map[string]any{"Authorization": "caller-secret"},
		"client_secret":  "caller-secret",
		"unknown":        "must-not-cross",
	}}
	resolver := currentAgentToolkitSettingsResolver{inner: inner}
	request := configurationapp.CurrentToolkitSettingsRequest{
		ToolkitType: "mcp_config",
		Settings:    map[string]any{"server_name": "mcp_release_intelligence"},
		ProjectID:   7,
		UserID:      11,
		Mode:        configurationapp.CurrentToolkitSettingsReferenceMode,
	}

	resolved, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]any{
		"server_name":    "mcp_release_intelligence",
		"selected_tools": []any{"lookup_release"},
		"excluded_tools": []any{"publish_release"},
		"enable_caching": true,
		"cache_ttl":      90,
	}
	if !reflect.DeepEqual(resolved, want) {
		t.Fatalf("resolved=%#v want=%#v", resolved, want)
	}
	if !reflect.DeepEqual(inner.request, request) {
		t.Fatalf("request=%#v want=%#v", inner.request, request)
	}
	if len(inner.result) != 9 {
		t.Fatal("resolver mutated the inner result")
	}

	request.ToolkitType = "mcp_release_intelligence"
	resolved, err = resolver.Resolve(context.Background(), request)
	if err != nil || !reflect.DeepEqual(resolved, want) {
		t.Fatalf("dynamic resolved=%#v error=%v", resolved, err)
	}
}

func TestCurrentAgentPrebuiltMCPAdmissionLeavesOtherToolkitsUnchanged(t *testing.T) {
	for _, toolkitType := range []string{"mcp", "github"} {
		t.Run(toolkitType, func(t *testing.T) {
			result := map[string]any{
				"url":     "https://caller.example.test/mcp",
				"headers": map[string]any{"X-Test": "value"},
			}
			inner := &currentAgentToolkitSettingsResolverStub{result: result}
			resolver := currentAgentToolkitSettingsResolver{inner: inner}
			resolved, err := resolver.Resolve(
				context.Background(),
				configurationapp.CurrentToolkitSettingsRequest{ToolkitType: toolkitType},
			)
			if err != nil || !reflect.DeepEqual(resolved, result) {
				t.Fatalf("resolved=%#v error=%v", resolved, err)
			}
		})
	}
}

func TestCurrentAgentPrebuiltMCPAdmissionValidatesDependency(t *testing.T) {
	resolver := currentAgentToolkitSettingsResolver{}
	if _, err := resolver.Resolve(
		context.Background(),
		configurationapp.CurrentToolkitSettingsRequest{ToolkitType: "mcp_config"},
	); err == nil {
		t.Fatal("missing inner resolver must fail")
	}

	dependency := errors.New("settings unavailable")
	resolver.inner = &currentAgentToolkitSettingsResolverStub{err: dependency}
	if _, err := resolver.Resolve(
		context.Background(),
		configurationapp.CurrentToolkitSettingsRequest{ToolkitType: "mcp_config"},
	); !errors.Is(err, dependency) {
		t.Fatalf("dependency error=%v", err)
	}
}
