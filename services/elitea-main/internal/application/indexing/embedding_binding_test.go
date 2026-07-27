package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"reflect"
	"strings"
	"testing"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
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

func TestCurrentEmbeddingBindingResolverPreservesProjectPublicRawRoute(t *testing.T) {
	tests := []struct {
		name       string
		groups     map[string]CurrentEmbeddingRuntimeGroup
		wantGroup  string
		wantRoute  string
		wantCalls  []string
		configs    map[int32]CurrentEmbeddingConfiguration
		configCall []embeddingConfigurationCall
	}{
		{
			name:      "project",
			groups:    embeddingGroups("7_embed"),
			wantGroup: "7_embed",
			wantRoute: "project",
			wantCalls: []string{"7_embed"},
			configs: map[int32]CurrentEmbeddingConfiguration{
				7: currentEmbeddingConfiguration(7, "00000000-0000-0000-0000-000000000701", "embed", false),
			},
			configCall: []embeddingConfigurationCall{{projectID: 7, modelName: "embed"}},
		},
		{
			name:      "public",
			groups:    embeddingGroups("1_embed"),
			wantGroup: "1_embed",
			wantRoute: "public",
			wantCalls: []string{"7_embed", "1_embed"},
			configs: map[int32]CurrentEmbeddingConfiguration{
				1: currentEmbeddingConfiguration(1, "00000000-0000-0000-0000-000000000101", "embed", true),
			},
			configCall: []embeddingConfigurationCall{
				{projectID: 7, modelName: "embed"},
				{projectID: 1, modelName: "embed", sharedOnly: true},
			},
		},
		{
			name:       "raw external",
			groups:     map[string]CurrentEmbeddingRuntimeGroup{},
			wantGroup:  "embed",
			wantRoute:  "raw",
			wantCalls:  []string{"7_embed", "1_embed"},
			configs:    map[int32]CurrentEmbeddingConfiguration{},
			configCall: []embeddingConfigurationCall{{projectID: 7, modelName: "embed"}, {projectID: 1, modelName: "embed", sharedOnly: true}},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			configurations := &embeddingConfigurationReaderStub{configurations: test.configs}
			runtime := &embeddingRuntimeReaderStub{groups: test.groups}
			resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
			if err != nil {
				t.Fatal(err)
			}
			binding, err := resolver.Resolve(context.Background(), 7, "embed", nil)
			if err != nil {
				t.Fatal(err)
			}
			if binding.ModelName != "embed" ||
				binding.ResolvedModelGroup != test.wantGroup ||
				binding.Route != test.wantRoute ||
				binding.ModelProjectID != 0 {
				t.Fatalf("binding=%+v", binding)
			}
			if !reflect.DeepEqual(runtime.calls, test.wantCalls) {
				t.Fatalf("runtime calls=%v want=%v", runtime.calls, test.wantCalls)
			}
			if !reflect.DeepEqual(configurations.calls, test.configCall) {
				t.Fatalf("configuration calls=%+v want=%+v", configurations.calls, test.configCall)
			}
			encoded, err := binding.MarshalCanonical()
			if err != nil {
				t.Fatal(err)
			}
			for _, forbidden := range []string{"api_key", "token", "credential_title", "deployment_id", "endpoint"} {
				if strings.Contains(string(encoded), forbidden) {
					t.Fatalf("binding leaked %q: %s", forbidden, encoded)
				}
			}
		})
	}
}

func TestCurrentEmbeddingBindingResolverRetainsAuthoritativeDefaultTupleWithDuplicateName(t *testing.T) {
	public := currentEmbeddingConfiguration(
		1,
		"00000000-0000-0000-0000-000000000101",
		"embed",
		true,
	)
	configurations := &embeddingConfigurationReaderStub{
		configurations: map[int32]CurrentEmbeddingConfiguration{
			7: currentEmbeddingConfiguration(
				7,
				"00000000-0000-0000-0000-000000000701",
				"embed",
				false,
			),
			1: public,
		},
	}
	runtime := &embeddingRuntimeReaderStub{groups: embeddingGroups("7_embed", "1_embed")}
	resolver, err := NewCurrentEmbeddingBindingResolver(configurations, runtime, 1)
	if err != nil {
		t.Fatal(err)
	}
	preferredProjectID := int32(1)
	first, err := resolver.Resolve(context.Background(), 7, "embed", &preferredProjectID)
	if err != nil {
		t.Fatal(err)
	}
	second, err := resolver.Resolve(context.Background(), 7, "embed", &preferredProjectID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(first, second) {
		t.Fatalf("restart changed binding: first=%+v second=%+v", first, second)
	}
	if first.ModelProjectID != 1 ||
		first.ConfigurationProjectID != 1 ||
		first.ConfigurationUUID != public.UUID ||
		first.ConfigurationDigest.IsZero() {
		t.Fatalf("default tuple bound the wrong duplicate: %+v", first)
	}
	// The current proxy route remains project-first and is recorded separately;
	// the worker does not rewrite the model to either group.
	if first.Route != "project" || first.ResolvedModelGroup != "7_embed" {
		t.Fatalf("current route drifted: %+v", first)
	}
	if !reflect.DeepEqual(configurations.calls, []embeddingConfigurationCall{
		{projectID: 1, modelName: "embed", sharedOnly: true},
		{projectID: 1, modelName: "embed", sharedOnly: true},
	}) {
		t.Fatalf("default configuration lookup=%+v", configurations.calls)
	}
}

func TestCurrentEmbeddingBindingResolverRejectsDefaultFromUnrelatedProject(t *testing.T) {
	resolver, err := NewCurrentEmbeddingBindingResolver(
		&embeddingConfigurationReaderStub{},
		&embeddingRuntimeReaderStub{},
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	unrelatedProjectID := int32(8)
	if _, err := resolver.Resolve(
		context.Background(),
		7,
		"embed",
		&unrelatedProjectID,
	); !errors.Is(err, ErrInvalidCurrentEmbeddingBinding) {
		t.Fatalf("error=%v", err)
	}
}

func TestCurrentEmbeddingBindingConfigurationChangeChangesDigest(t *testing.T) {
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
		t.Fatal("configuration reference change retained the old digest")
	}
}

func TestCurrentEmbeddingBindingAcceptsCurrentOptionalCredentialReference(t *testing.T) {
	configuration := CurrentEmbeddingConfiguration{
		UUID:      "00000000-0000-0000-0000-000000000701",
		ProjectID: 7,
		Type:      "embedding_model",
		Section:   "embedding",
		Data:      json.RawMessage(`{"name":"external-embedding","ai_credentials":null}`),
	}
	first, err := currentEmbeddingConfigurationDigest(configuration, "external-embedding")
	if err != nil || first.IsZero() {
		t.Fatalf("optional credential reference: digest=%s err=%v", first, err)
	}
	configuration.Data = json.RawMessage(`{"name":"external-embedding"}`)
	second, err := currentEmbeddingConfigurationDigest(configuration, "external-embedding")
	if err != nil || second != first {
		t.Fatalf("missing and null optional references diverged: first=%s second=%s err=%v", first, second, err)
	}
}

func TestCurrentEmbeddingBindingResolverRedactsDependencyFailuresAndPreservesCancellation(t *testing.T) {
	resolver, err := NewCurrentEmbeddingBindingResolver(
		&embeddingConfigurationReaderStub{},
		&embeddingRuntimeReaderStub{err: errors.New("credential-details")},
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = resolver.Resolve(context.Background(), 7, "embed", nil)
	if !errors.Is(err, ErrCurrentEmbeddingBindingUnavailable) ||
		strings.Contains(err.Error(), "credential-details") {
		t.Fatalf("error=%v", err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err = resolver.Resolve(ctx, 7, "embed", nil)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation error=%v", err)
	}
}

func TestEmbeddingBindingValidationContract(t *testing.T) {
	valid := EmbeddingBinding{
		SchemaVersion:          CurrentEmbeddingBindingSchema,
		ModelName:              "embed",
		ResolvedModelGroup:     "1_embed",
		Route:                  "public",
		ModelProjectID:         1,
		ConfigurationProjectID: 1,
		ConfigurationUUID:      "00000000-0000-0000-0000-000000000101",
		ConfigurationDigest:    currentEmbeddingDigest("valid"),
	}
	if err := valid.Validate(); err != nil {
		t.Fatal(err)
	}
	tests := []EmbeddingBinding{
		func() EmbeddingBinding { value := valid; value.Route = "raw"; return value }(),
		func() EmbeddingBinding { value := valid; value.ResolvedModelGroup = "embed"; return value }(),
		func() EmbeddingBinding { value := valid; value.ModelProjectID = -1; return value }(),
		func() EmbeddingBinding { value := valid; value.ConfigurationUUID = ""; return value }(),
		func() EmbeddingBinding { value := valid; value.ConfigurationProjectID = 7; return value }(),
		func() EmbeddingBinding {
			value := valid
			value.ModelName = strings.Repeat("x", maxEmbeddingBindingIdentity+1)
			return value
		}(),
	}
	for index, invalid := range tests {
		if !errors.Is(invalid.Validate(), ErrInvalidCurrentEmbeddingBinding) {
			t.Fatalf("case %d accepted: %+v", index, invalid)
		}
	}
}

func TestEmbeddingBindingValidationSharedGoPythonFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/embedding_binding_validation_v2.json")
	if err != nil {
		t.Fatal(err)
	}
	var cases []struct {
		Name     string `json:"name"`
		Valid    bool   `json:"valid"`
		Document struct {
			SchemaVersion          string `json:"schema_version"`
			ModelName              string `json:"model_name"`
			ResolvedModelGroup     string `json:"resolved_model_group"`
			Route                  string `json:"route"`
			ModelProjectID         int32  `json:"model_project_id"`
			ConfigurationProjectID int32  `json:"configuration_project_id"`
			ConfigurationUUID      string `json:"configuration_uuid"`
			ConfigurationDigest    string `json:"configuration_digest"`
		} `json:"document"`
	}
	if err := json.Unmarshal(raw, &cases); err != nil {
		t.Fatal(err)
	}
	for _, test := range cases {
		t.Run(test.Name, func(t *testing.T) {
			var digest runtimedomain.Digest
			if test.Document.ConfigurationDigest != "" {
				var parseErr error
				digest, parseErr = runtimedomain.ParseDigest(test.Document.ConfigurationDigest)
				if parseErr != nil {
					t.Fatal(parseErr)
				}
			}
			binding := EmbeddingBinding{
				SchemaVersion:          test.Document.SchemaVersion,
				ModelName:              test.Document.ModelName,
				ResolvedModelGroup:     test.Document.ResolvedModelGroup,
				Route:                  test.Document.Route,
				ModelProjectID:         test.Document.ModelProjectID,
				ConfigurationProjectID: test.Document.ConfigurationProjectID,
				ConfigurationUUID:      test.Document.ConfigurationUUID,
				ConfigurationDigest:    digest,
			}
			if got := binding.Validate() == nil; got != test.Valid {
				t.Fatalf("valid=%t want=%t binding=%+v", got, test.Valid, binding)
			}
		})
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

func embeddingGroups(names ...string) map[string]CurrentEmbeddingRuntimeGroup {
	groups := make(map[string]CurrentEmbeddingRuntimeGroup, len(names))
	for _, name := range names {
		groups[name] = CurrentEmbeddingRuntimeGroup{Name: name}
	}
	return groups
}

func currentEmbeddingDigest(value string) runtimedomain.Digest {
	return runtimedomain.SHA256([]byte(value))
}
