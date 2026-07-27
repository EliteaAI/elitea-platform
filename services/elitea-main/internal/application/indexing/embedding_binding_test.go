package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type embeddingConfigurationReaderStub struct {
	configurations map[int32]CurrentEmbeddingConfiguration
	calls          []embeddingConfigurationCall
	err            error
}

type embeddingConfigurationCall struct {
	projectID  int32
	modelName  string
	sharedOnly bool
}

func (s *embeddingConfigurationReaderStub) FindCurrentEmbeddingConfiguration(
	_ context.Context,
	projectID int32,
	modelName string,
	sharedOnly bool,
) (CurrentEmbeddingConfiguration, bool, error) {
	s.calls = append(s.calls, embeddingConfigurationCall{
		projectID: projectID, modelName: modelName, sharedOnly: sharedOnly,
	})
	if s.err != nil {
		return CurrentEmbeddingConfiguration{}, false, s.err
	}
	configuration, found := s.configurations[projectID]
	return configuration, found, nil
}

type embeddingRuntimeReaderStub struct {
	groups map[string]CurrentEmbeddingRuntimeGroup
	calls  []string
	err    error
}

func (s *embeddingRuntimeReaderStub) GetCurrentEmbeddingRuntimeGroup(
	_ context.Context,
	name string,
) (CurrentEmbeddingRuntimeGroup, bool, error) {
	s.calls = append(s.calls, name)
	if s.err != nil {
		return CurrentEmbeddingRuntimeGroup{}, false, s.err
	}
	group, found := s.groups[name]
	return group, found, nil
}

func TestCurrentEmbeddingBindingResolverUsesProjectThenPublicAndIsRestartStable(t *testing.T) {
	public := currentEmbeddingConfiguration(
		1,
		"00000000-0000-0000-0000-000000000101",
		"text-embedding-3-small",
		true,
	)
	configurations := &embeddingConfigurationReaderStub{
		configurations: map[int32]CurrentEmbeddingConfiguration{1: public},
	}
	dimension := uint32(1536)
	runtime := &embeddingRuntimeReaderStub{groups: map[string]CurrentEmbeddingRuntimeGroup{
		"1_text-embedding-3-small": {
			Name:      "1_text-embedding-3-small",
			Providers: []string{"openai", "openai"},
			Deployments: []CurrentEmbeddingRuntimeDeployment{
				{
					ConfigurationUUID: public.UUID,
					Provider:          "openai",
					ModelVersion:      "2024-01",
					Dimension:         &dimension,
				},
				{
					ConfigurationUUID: public.UUID,
					Provider:          "openai",
					ModelVersion:      "2024-01",
					Dimension:         &dimension,
				},
			},
		},
	}}
	resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
	if err != nil {
		t.Fatal(err)
	}

	first, err := resolver.Resolve(context.Background(), 7, "text-embedding-3-small")
	if err != nil {
		t.Fatal(err)
	}
	second, err := resolver.Resolve(context.Background(), 7, "text-embedding-3-small")
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("restart changed binding: first=%+v second=%+v", first, second)
	}
	if first.ConfigurationProjectID != 1 || first.ConfigurationUUID != public.UUID ||
		first.ResolvedModelGroup != "1_text-embedding-3-small" || first.Provider != "openai" ||
		first.ModelVersion != "2024-01" || first.Dimension == nil || *first.Dimension != 1536 {
		t.Fatalf("binding=%+v", first)
	}
	if !reflect.DeepEqual(configurations.calls, []embeddingConfigurationCall{
		{projectID: 7, modelName: "text-embedding-3-small", sharedOnly: false},
		{projectID: 1, modelName: "text-embedding-3-small", sharedOnly: true},
		{projectID: 7, modelName: "text-embedding-3-small", sharedOnly: false},
		{projectID: 1, modelName: "text-embedding-3-small", sharedOnly: true},
	}) {
		t.Fatalf("configuration lookup order=%+v", configurations.calls)
	}
	if !reflect.DeepEqual(runtime.calls, []string{
		"1_text-embedding-3-small",
		"1_text-embedding-3-small",
	}) {
		t.Fatalf("runtime groups=%v", runtime.calls)
	}

	encoded, err := first.MarshalCanonical()
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"api_key", "token", "credential_title", "deployment_id"} {
		if strings.Contains(string(encoded), forbidden) {
			t.Fatalf("binding leaked %q: %s", forbidden, encoded)
		}
	}
}

func TestCurrentEmbeddingBindingResolverProjectConfigurationWins(t *testing.T) {
	project := currentEmbeddingConfiguration(
		7,
		"00000000-0000-0000-0000-000000000701",
		"embed",
		false,
	)
	configurations := &embeddingConfigurationReaderStub{
		configurations: map[int32]CurrentEmbeddingConfiguration{
			7: project,
			1: currentEmbeddingConfiguration(
				1,
				"00000000-0000-0000-0000-000000000101",
				"embed",
				true,
			),
		},
	}
	runtime := &embeddingRuntimeReaderStub{groups: map[string]CurrentEmbeddingRuntimeGroup{
		"7_embed": currentEmbeddingRuntimeGroup("7_embed", project.UUID, "azure"),
	}}
	resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
	if err != nil {
		t.Fatal(err)
	}
	binding, err := resolver.Resolve(context.Background(), 7, "embed")
	if err != nil {
		t.Fatal(err)
	}
	if binding.ConfigurationProjectID != 7 || binding.Provider != "azure" ||
		len(configurations.calls) != 1 || configurations.calls[0].sharedOnly {
		t.Fatalf("binding=%+v calls=%+v", binding, configurations.calls)
	}
}

func TestCurrentEmbeddingBindingResolverRejectsExternalFallbackAndCrossTenantDrift(t *testing.T) {
	configurations := &embeddingConfigurationReaderStub{
		configurations: map[int32]CurrentEmbeddingConfiguration{
			8: currentEmbeddingConfiguration(
				8,
				"00000000-0000-0000-0000-000000000801",
				"external-only",
				false,
			),
		},
	}
	runtime := &embeddingRuntimeReaderStub{groups: map[string]CurrentEmbeddingRuntimeGroup{
		"external-only": currentEmbeddingRuntimeGroup(
			"external-only",
			"00000000-0000-0000-0000-000000000801",
			"openai",
		),
	}}
	resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolver.Resolve(context.Background(), 7, "external-only")
	if !errors.Is(err, ErrCurrentEmbeddingBindingUnavailable) {
		t.Fatalf("error=%v", err)
	}
	if !reflect.DeepEqual(configurations.calls, []embeddingConfigurationCall{
		{projectID: 7, modelName: "external-only", sharedOnly: false},
		{projectID: 1, modelName: "external-only", sharedOnly: true},
	}) || len(runtime.calls) != 0 {
		t.Fatalf("cross-tenant row influenced resolution: configurations=%+v runtime=%v", configurations.calls, runtime.calls)
	}
}

func TestCurrentEmbeddingBindingResolverModelChangeChangesConfigurationDigest(t *testing.T) {
	first := currentEmbeddingConfiguration(
		7,
		"00000000-0000-0000-0000-000000000701",
		"embed",
		false,
	)
	second := first
	second.Data = json.RawMessage(`{"name":"embed","ai_credentials":{"elitea_title":"credential-v2","private":true}}`)

	firstDigest, err := currentEmbeddingConfigurationDigest(first, "embed")
	if err != nil {
		t.Fatal(err)
	}
	secondDigest, err := currentEmbeddingConfigurationDigest(second, "embed")
	if err != nil {
		t.Fatal(err)
	}
	if firstDigest == secondDigest {
		t.Fatal("configuration reference change retained the old immutable digest")
	}
}

func TestCurrentEmbeddingBindingResolverRejectsDimensionAndProviderAmbiguity(t *testing.T) {
	configuration := currentEmbeddingConfiguration(
		7,
		"00000000-0000-0000-0000-000000000701",
		"embed",
		false,
	)
	dimension1536 := uint32(1536)
	dimension3072 := uint32(3072)
	tests := []CurrentEmbeddingRuntimeGroup{
		{
			Name: "7_embed", Providers: []string{"openai"},
			Deployments: []CurrentEmbeddingRuntimeDeployment{
				{ConfigurationUUID: configuration.UUID, Provider: "openai", Dimension: &dimension1536},
				{ConfigurationUUID: configuration.UUID, Provider: "openai", Dimension: &dimension3072},
			},
		},
		{
			Name: "7_embed", Providers: []string{"openai", "azure"},
			Deployments: []CurrentEmbeddingRuntimeDeployment{
				{ConfigurationUUID: configuration.UUID, Provider: "openai"},
			},
		},
	}
	for index, group := range tests {
		configurations := &embeddingConfigurationReaderStub{
			configurations: map[int32]CurrentEmbeddingConfiguration{7: configuration},
		}
		runtime := &embeddingRuntimeReaderStub{
			groups: map[string]CurrentEmbeddingRuntimeGroup{"7_embed": group},
		}
		resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
		if err != nil {
			t.Fatal(err)
		}
		_, err = resolver.Resolve(context.Background(), 7, "embed")
		if !errors.Is(err, ErrCurrentEmbeddingBindingAmbiguous) {
			t.Fatalf("case %d error=%v", index, err)
		}
	}
}

func TestCurrentEmbeddingBindingResolverDoesNotInventVersionOrDimension(t *testing.T) {
	configuration := currentEmbeddingConfiguration(
		7,
		"00000000-0000-0000-0000-000000000701",
		"embed",
		false,
	)
	runtime := &embeddingRuntimeReaderStub{groups: map[string]CurrentEmbeddingRuntimeGroup{
		"7_embed": currentEmbeddingRuntimeGroup("7_embed", configuration.UUID, "openai"),
	}}
	resolver, err := NewCurrentEmbeddingBindingResolver(
		&embeddingConfigurationReaderStub{
			configurations: map[int32]CurrentEmbeddingConfiguration{7: configuration},
		},
		runtime,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	binding, err := resolver.Resolve(context.Background(), 7, "embed")
	if err != nil {
		t.Fatal(err)
	}
	if binding.ModelVersion != "" || binding.Dimension != nil {
		t.Fatalf("invented model metadata: %+v", binding)
	}
}

func TestCurrentEmbeddingBindingResolverRedactsDependencyFailuresAndPreservesCancellation(t *testing.T) {
	resolver, err := NewCurrentEmbeddingBindingResolver(
		&embeddingConfigurationReaderStub{err: errors.New("credential-details")},
		&embeddingRuntimeReaderStub{},
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolver.Resolve(context.Background(), 7, "embed")
	if !errors.Is(err, ErrCurrentEmbeddingBindingUnavailable) ||
		strings.Contains(err.Error(), "credential-details") {
		t.Fatalf("error=%v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = resolver.Resolve(ctx, 7, "embed")
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error=%v", err)
	}
}

func currentEmbeddingConfiguration(
	projectID int32,
	uuid string,
	modelName string,
	shared bool,
) CurrentEmbeddingConfiguration {
	private := !shared
	data, _ := json.Marshal(map[string]any{
		"name": modelName,
		"ai_credentials": map[string]any{
			"elitea_title": "credential-current",
			"private":      private,
		},
	})
	return CurrentEmbeddingConfiguration{
		UUID:      uuid,
		ProjectID: projectID,
		Type:      "embedding_model",
		Section:   "embedding",
		Data:      data,
		Shared:    shared,
	}
}

func currentEmbeddingRuntimeGroup(
	name string,
	configurationUUID string,
	provider string,
) CurrentEmbeddingRuntimeGroup {
	return CurrentEmbeddingRuntimeGroup{
		Name:      name,
		Providers: []string{provider},
		Deployments: []CurrentEmbeddingRuntimeDeployment{{
			ConfigurationUUID: configurationUUID,
			Provider:          provider,
		}},
	}
}
