package runtimecomposition

import (
	"context"
	"errors"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/mcpregistry"
)

type currentPrebuiltMCPStore interface {
	Lookup(context.Context, string) (mcpregistry.PrebuiltServer, error)
}

// currentAgentPrebuiltMCP exposes enabled fixed HTTP definitions to agent execution.
type currentAgentPrebuiltMCP struct {
	store currentPrebuiltMCPStore
}

type currentAgentToolkitSettingsResolver struct {
	inner agentexecutionapp.CurrentAgentToolkitSettingsResolver
}

func newCurrentAgentPrebuiltMCP(
	store currentPrebuiltMCPStore,
) (*currentAgentPrebuiltMCP, error) {
	if store == nil {
		return nil, errors.New("current agent prebuilt MCP store is required")
	}
	return &currentAgentPrebuiltMCP{store: store}, nil
}

func (resolver currentAgentToolkitSettingsResolver) Resolve(
	ctx context.Context,
	request configurationapp.CurrentToolkitSettingsRequest,
) (map[string]any, error) {
	if resolver.inner == nil {
		return nil, errors.New("current agent toolkit settings resolver is required")
	}
	settings, err := resolver.inner.Resolve(ctx, request)
	if err != nil || settings == nil {
		return settings, err
	}
	if request.ToolkitType != "mcp_config" &&
		!mcpregistry.IsPrebuiltToolkitType(request.ToolkitType) {
		return settings, nil
	}

	safe := make(map[string]any, 5)
	for _, name := range []string{
		"server_name",
		"selected_tools",
		"excluded_tools",
		"enable_caching",
		"cache_ttl",
	} {
		if value, ok := settings[name]; ok {
			safe[name] = value
		}
	}
	return safe, nil
}

func (source *currentAgentPrebuiltMCP) FindCurrentActorVisibleToolkitSchema(
	ctx context.Context,
	projectID int32,
	userID int32,
	toolkitType string,
) (configurationapp.CurrentToolkitSchema, bool, error) {
	if ctx == nil || projectID <= 0 || userID <= 0 ||
		!validCurrentToolkitSchemaIdentifier(toolkitType) {
		return configurationapp.CurrentToolkitSchema{}, false, ErrCurrentToolkitSchemaLookupInvalid
	}
	if err := ctx.Err(); err != nil {
		return configurationapp.CurrentToolkitSchema{}, false, err
	}
	if source == nil || source.store == nil {
		return configurationapp.CurrentToolkitSchema{}, false, ErrCurrentDynamicToolkitSchemasUnavailable
	}
	if !mcpregistry.IsPrebuiltToolkitType(toolkitType) {
		return configurationapp.CurrentToolkitSchema{}, false, nil
	}
	entry, err := source.store.Lookup(ctx, toolkitType)
	if errors.Is(err, mcpregistry.ErrPrebuiltNotFound) || (err == nil && !entry.Enabled) {
		return configurationapp.CurrentToolkitSchema{}, false, nil
	}
	if err != nil {
		return configurationapp.CurrentToolkitSchema{}, false, err
	}
	return configurationapp.CurrentToolkitSchema{Properties: map[string]any{}}, true, nil
}

func (source *currentAgentPrebuiltMCP) ResolveCurrentAgentPrebuiltMCP(
	ctx context.Context,
	toolkitType string,
	settings map[string]any,
) (map[string]any, bool, error) {
	if ctx == nil || !validCurrentToolkitSchemaIdentifier(toolkitType) || settings == nil {
		return nil, false, nil
	}
	if err := ctx.Err(); err != nil {
		return nil, false, err
	}
	if source == nil || source.store == nil {
		return nil, false, ErrCurrentDynamicToolkitSchemasUnavailable
	}

	lookup := toolkitType
	if toolkitType == "mcp_config" {
		serverName, ok := settings["server_name"].(string)
		if !ok || !validCurrentToolkitSchemaIdentifier(serverName) {
			return nil, false, nil
		}
		lookup = serverName
	} else if !mcpregistry.IsPrebuiltToolkitType(toolkitType) {
		return nil, false, nil
	}

	entry, err := source.store.Lookup(ctx, lookup)
	if errors.Is(err, mcpregistry.ErrPrebuiltNotFound) || (err == nil && !entry.Enabled) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, err
	}

	resolved := map[string]any{
		"server_name": entry.Key,
		"url":         entry.ServerURL,
		"ssl_verify":  true,
	}
	if entry.TimeoutSeconds > 0 {
		resolved["timeout"] = entry.TimeoutSeconds
	}
	if len(entry.Headers) > 0 {
		headers := make(map[string]any, len(entry.Headers))
		for name, value := range entry.Headers {
			headers[name] = value
		}
		resolved["headers"] = headers
	}
	for _, name := range []string{
		"selected_tools",
		"excluded_tools",
		"enable_caching",
		"cache_ttl",
	} {
		if value, ok := settings[name]; ok {
			resolved[name] = value
		}
	}
	return resolved, true, nil
}

var _ CurrentActorVisibleToolkitSchemaSource = (*currentAgentPrebuiltMCP)(nil)
var _ agentexecutionapp.CurrentAgentToolkitSettingsResolver = currentAgentToolkitSettingsResolver{}
