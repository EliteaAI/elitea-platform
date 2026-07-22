package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"strings"
	"testing"
)

type resolverConfigurationKey struct {
	projectID int64
	title     string
	shared    bool
}

type resolverEmbeddingKey struct {
	projectID int64
	name      string
	shared    bool
}

type resolverLLMKey struct {
	projectID int64
	name      string
	shared    bool
}

type fixedGitHubResolverStoreStub struct {
	toolkit                  IndexToolkitRecord
	toolkitErr               error
	configurations           map[resolverConfigurationKey]IndexConfigurationRecord
	embedding                map[resolverEmbeddingKey]bool
	llmModels                map[resolverLLMKey]IndexLLMModelRecord
	sharedConfigurationCalls int
}

func (s *fixedGitHubResolverStoreStub) LoadIndexToolkit(_ context.Context, _, _ int64) (IndexToolkitRecord, error) {
	return s.toolkit, s.toolkitErr
}

func (s *fixedGitHubResolverStoreStub) LoadIndexConfiguration(_ context.Context, projectID int64, title string) (IndexConfigurationRecord, error) {
	record, ok := s.configurations[resolverConfigurationKey{projectID: projectID, title: title}]
	if !ok {
		return IndexConfigurationRecord{}, ErrIndexResolverRecordNotFound
	}
	return record, nil
}

func (s *fixedGitHubResolverStoreStub) LoadSharedIndexConfiguration(_ context.Context, projectID int64, title string) (IndexConfigurationRecord, error) {
	s.sharedConfigurationCalls++
	record, ok := s.configurations[resolverConfigurationKey{projectID: projectID, title: title, shared: true}]
	if !ok {
		return IndexConfigurationRecord{}, ErrIndexResolverRecordNotFound
	}
	return record, nil
}

func (s *fixedGitHubResolverStoreStub) IndexEmbeddingModelExists(_ context.Context, projectID int64, name string) (bool, error) {
	return s.embedding[resolverEmbeddingKey{projectID: projectID, name: name}], nil
}

func (s *fixedGitHubResolverStoreStub) SharedIndexEmbeddingModelExists(_ context.Context, projectID int64, name string) (bool, error) {
	return s.embedding[resolverEmbeddingKey{projectID: projectID, name: name, shared: true}], nil
}

func (s *fixedGitHubResolverStoreStub) LoadIndexLLMModel(_ context.Context, projectID int64, name string) (IndexLLMModelRecord, error) {
	record, ok := s.llmModels[resolverLLMKey{projectID: projectID, name: name}]
	if !ok {
		return IndexLLMModelRecord{}, ErrIndexResolverRecordNotFound
	}
	return record, nil
}

func (s *fixedGitHubResolverStoreStub) LoadSharedIndexLLMModel(_ context.Context, projectID int64, name string) (IndexLLMModelRecord, error) {
	record, ok := s.llmModels[resolverLLMKey{projectID: projectID, name: name, shared: true}]
	if !ok {
		return IndexLLMModelRecord{}, ErrIndexResolverRecordNotFound
	}
	return record, nil
}

func TestFixedGitHubResolverBuildsCanonicalReferenceOnlyInputs(t *testing.T) {
	store := validFixedGitHubStore()
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := validFixedGitHubRequest()

	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	second, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if string(inputs.ToolkitConfiguration) != string(second.ToolkitConfiguration) {
		t.Fatal("same authoritative rows produced non-deterministic toolkit JSON")
	}
	if got, want := string(inputs.ToolParameters), `{"clean_index":false,"index_name":"docs"}`; got != want {
		t.Fatalf("canonical tool parameters=%s, want %s", got, want)
	}
	if got, want := string(inputs.LLMConfiguration), `{"max_tokens":512,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"temperature":0.1}`; got != want {
		t.Fatalf("canonical LLM configuration=%s, want %s", got, want)
	}
	if inputs.LLMModel == nil || *inputs.LLMModel != "gpt-test" {
		t.Fatalf("LLM model was not preserved: %v", inputs.LLMModel)
	}

	var toolkit map[string]any
	if err := json.Unmarshal(inputs.ToolkitConfiguration, &toolkit); err != nil {
		t.Fatal(err)
	}
	if toolkit["type"] != fixedGitHubToolkitType || toolkit["toolkit_name"] != "GitHub_One" || toolkit["id"] != float64(41) {
		t.Fatalf("unexpected fixed toolkit identity: %#v", toolkit)
	}
	settings := toolkit["settings"].(map[string]any)
	if settings["active_branch"] != "main" || settings["base_branch"] != "main" {
		t.Fatalf("current GitHub schema defaults were not materialized: %#v", settings)
	}
	github := settings["github_configuration"].(map[string]any)
	pgvector := settings["pgvector_configuration"].(map[string]any)
	if github["configuration_project_id"] != float64(2) || github["configuration_type"] != "github" || github["configuration_uuid"] != "00000000-0000-0000-0000-000000000002" {
		t.Fatalf("same-project GitHub provenance was lost: %#v", github)
	}
	if pgvector["configuration_project_id"] != float64(1) || pgvector["configuration_type"] != "pgvector" || pgvector["configuration_uuid"] != "00000000-0000-0000-0000-000000000003" {
		t.Fatalf("public shared PGVector provenance was lost: %#v", pgvector)
	}
	encoded := string(inputs.ToolkitConfiguration)
	for _, required := range []string{"{{secret.GITHUB_TOKEN}}", "{{secret.PGVECTOR_DSN}}"} {
		if !strings.Contains(encoded, required) {
			t.Fatalf("resolved input lost secret reference %q: %s", required, encoded)
		}
	}
	for _, forbidden := range []string{"redeemed-github-token", "postgres://plaintext"} {
		if strings.Contains(encoded, forbidden) {
			t.Fatalf("resolved input contains redeemed material %q", forbidden)
		}
	}
	if store.sharedConfigurationCalls != 2 {
		// The resolver was run twice above; only PGVector should fall back once
		// per resolution. GitHub must remain bound to the project row.
		t.Fatalf("shared configuration calls=%d, want 2", store.sharedConfigurationCalls)
	}
}

func TestFixedGitHubResolverRejectsUnsupportedOrUnsafeStoredState(t *testing.T) {
	tests := []struct {
		name   string
		mutate func(*fixedGitHubResolverStoreStub)
		want   error
	}{
		{
			name: "toolkit missing",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				store.toolkitErr = ErrIndexResolverRecordNotFound
			},
			want: ErrToolkitNotVisible,
		},
		{
			name: "other toolkit type",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				store.toolkit.Type = "confluence"
			},
			want: ErrUnsupportedIndexToolkit,
		},
		{
			name: "index tool not selected",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				store.toolkit.Settings = replaceJSONField(t, store.toolkit.Settings, "selected_tools", []any{"search_index"})
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "private credential reference",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				settings := decodedObject(t, store.toolkit.Settings)
				settings["github_configuration"].(map[string]any)["private"] = true
				store.toolkit.Settings = mustJSON(t, settings)
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "reference has extra member",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				settings := decodedObject(t, store.toolkit.Settings)
				settings["github_configuration"].(map[string]any)["type"] = "github"
				store.toolkit.Settings = mustJSON(t, settings)
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "plaintext github token",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				key := resolverConfigurationKey{projectID: 2, title: "github-source"}
				record := store.configurations[key]
				record.Data = json.RawMessage(`{"base_url":"https://api.github.test","access_token":"redeemed-github-token"}`)
				store.configurations[key] = record
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "embedded pgvector secret reference",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				key := resolverConfigurationKey{projectID: 1, title: "pgvector-public", shared: true}
				record := store.configurations[key]
				record.Data = json.RawMessage(`{"connection_string":"postgres://user:{{secret.PASSWORD}}@db/index"}`)
				store.configurations[key] = record
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "wrong project configuration shadows public",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				key := resolverConfigurationKey{projectID: 2, title: "github-source"}
				record := store.configurations[key]
				record.Type = "gitlab"
				store.configurations[key] = record
				store.configurations[resolverConfigurationKey{projectID: 1, title: "github-source", shared: true}] = IndexConfigurationRecord{
					UUID: "00000000-0000-0000-0000-000000000009", ProjectID: 1, Type: "github", Shared: true,
					Data: json.RawMessage(`{"base_url":"https://api.github.test","access_token":"{{secret.PUBLIC_TOKEN}}"}`),
				}
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "embedding model not visible",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				store.embedding = map[resolverEmbeddingKey]bool{}
			},
			want: ErrInvalidIndexStart,
		},
		{
			name: "LLM model not visible",
			mutate: func(store *fixedGitHubResolverStoreStub) {
				store.llmModels = map[resolverLLMKey]IndexLLMModelRecord{}
			},
			want: ErrInvalidIndexStart,
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := validFixedGitHubStore()
			test.mutate(store)
			resolver, err := NewFixedGitHubResolver(store, 1)
			if err != nil {
				t.Fatal(err)
			}
			_, err = resolver.Resolve(context.Background(), validFixedGitHubRequest())
			if !errors.Is(err, test.want) {
				t.Fatalf("error=%v, want %v", err, test.want)
			}
			if test.name == "wrong project configuration shadows public" && store.sharedConfigurationCalls != 0 {
				t.Fatal("wrong-type project row incorrectly fell back to public configuration")
			}
		})
	}
}

func TestFixedGitHubResolverRejectsUntrustedLLMFieldsAndConflicts(t *testing.T) {
	tests := []struct {
		name     string
		settings json.RawMessage
		model    string
	}{
		{name: "credential-like field", settings: json.RawMessage(`{"api_key":"ui-secret"}`), model: "gpt-test"},
		{name: "unknown field", settings: json.RawMessage(`{"top_p":0.5}`), model: "gpt-test"},
		{name: "model mismatch", settings: json.RawMessage(`{"model_name":"other"}`), model: "gpt-test"},
		{name: "bad model project", settings: json.RawMessage(`{"model_project_id":99}`), model: "gpt-test"},
		{name: "excessive tokens", settings: json.RawMessage(`{"max_tokens":4097}`), model: "gpt-test"},
		{name: "unsupported reasoning", settings: json.RawMessage(`{"reasoning_effort":"high"}`), model: "gpt-test"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			store := validFixedGitHubStore()
			resolver, err := NewFixedGitHubResolver(store, 1)
			if err != nil {
				t.Fatal(err)
			}
			request := validFixedGitHubRequest()
			request.RequestedLLMModel = &test.model
			request.RequestedLLMSettings = test.settings
			if _, err := resolver.Resolve(context.Background(), request); !errors.Is(err, ErrInvalidIndexStart) {
				t.Fatalf("error=%v, want %v", err, ErrInvalidIndexStart)
			}
		})
	}
}

func TestFixedGitHubResolverUsesAuthoritativeLLMMetadata(t *testing.T) {
	store := validFixedGitHubStore()
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := validFixedGitHubRequest()
	request.RequestedLLMSettings = json.RawMessage(`{
		"model_name":"gpt-test",
		"model_project_id":2,
		"openai_compatible":false,
		"temperature":0.25,
		"max_tokens":256
	}`)
	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(inputs.LLMConfiguration), `{"max_tokens":256,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"temperature":0.25}`; got != want {
		t.Fatalf("LLM configuration=%s, want %s", got, want)
	}
}

func TestFixedGitHubResolverAcceptsCurrentUIAutomaticTokenSentinel(t *testing.T) {
	store := validFixedGitHubStore()
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := validFixedGitHubRequest()
	request.RequestedLLMSettings = json.RawMessage(`{
		"max_tokens":-1,
		"model_name":"gpt-test",
		"model_project_id":2,
		"openai_compatible":false,
		"temperature":0.6
	}`)
	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(inputs.LLMConfiguration), `{"max_tokens":-1,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"temperature":0.6}`; got != want {
		t.Fatalf("UI-shaped LLM configuration=%s, want %s", got, want)
	}
}

func TestFixedGitHubResolverEnforcesAuthoritativeReasoningFamily(t *testing.T) {
	store := validFixedGitHubStore()
	key := resolverLLMKey{projectID: 2, name: "gpt-test"}
	model := store.llmModels[key]
	model.SupportsReasoning = true
	store.llmModels[key] = model
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}

	missingEffort := validFixedGitHubRequest()
	missingEffort.RequestedLLMSettings = json.RawMessage(`{"max_tokens":-1}`)
	if _, err := resolver.Resolve(context.Background(), missingEffort); !errors.Is(err, ErrInvalidIndexStart) {
		t.Fatalf("missing reasoning effort error=%v", err)
	}

	conflict := validFixedGitHubRequest()
	conflict.RequestedLLMSettings = json.RawMessage(`{"max_tokens":-1,"reasoning_effort":"medium","temperature":0.1}`)
	if _, err := resolver.Resolve(context.Background(), conflict); !errors.Is(err, ErrInvalidIndexStart) {
		t.Fatalf("reasoning family conflict error=%v", err)
	}

	valid := validFixedGitHubRequest()
	valid.RequestedLLMSettings = json.RawMessage(`{"max_tokens":-1,"reasoning_effort":"medium"}`)
	inputs, err := resolver.Resolve(context.Background(), valid)
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(inputs.LLMConfiguration), `{"max_tokens":-1,"model_name":"gpt-test","model_project_id":2,"openai_compatible":true,"reasoning_effort":"medium"}`; got != want {
		t.Fatalf("reasoning LLM configuration=%s, want %s", got, want)
	}

	disabled := validFixedGitHubRequest()
	disabled.RequestedLLMSettings = json.RawMessage(`{"max_tokens":-1,"reasoning_effort":"none"}`)
	if _, err := resolver.Resolve(context.Background(), disabled); !errors.Is(err, ErrInvalidIndexStart) {
		t.Fatalf("inactive reasoning effort error=%v", err)
	}
}

func TestNormalizeCurrentToolkitNameMatchesCurrentSanitizer(t *testing.T) {
	if got, want := normalizeCurrentToolkitName(" Git.Hub / Привіт-01_"), "Git_Hub-01_"; got != want {
		t.Fatalf("normalized name=%q, want %q", got, want)
	}
}

func TestFixedGitHubResolverDoesNotAliasRequestModel(t *testing.T) {
	store := validFixedGitHubStore()
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}
	request := validFixedGitHubRequest()
	inputs, err := resolver.Resolve(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	*inputs.LLMModel = "changed"
	if *request.RequestedLLMModel != "gpt-test" {
		t.Fatal("resolved LLM model aliases the caller request")
	}
}

func validFixedGitHubRequest() StartRequest {
	model := "gpt-test"
	return StartRequest{
		ProjectID:            2,
		ActorUserID:          7,
		ToolkitID:            41,
		ToolParameters:       json.RawMessage(`{"index_name":"docs","clean_index":false}`),
		RequestedLLMModel:    &model,
		RequestedLLMSettings: json.RawMessage(`{"temperature":0.1,"max_tokens":512}`),
		StreamID:             "conversation-1",
		MessageID:            "message-1",
	}
}

func validFixedGitHubStore() *fixedGitHubResolverStoreStub {
	return &fixedGitHubResolverStoreStub{
		toolkit: IndexToolkitRecord{
			ID:   41,
			Name: "Git Hub.One /",
			Type: fixedGitHubToolkitType,
			Settings: json.RawMessage(`{
                "selected_tools":["search_index","index_data"],
                "repository":"elitea/example",
                "embedding_model":"embedding-small",
                "pgvector_configuration":{"elitea_title":"pgvector-public","private":false},
                "github_configuration":{"elitea_title":"github-source","private":false}
            }`),
		},
		configurations: map[resolverConfigurationKey]IndexConfigurationRecord{
			{projectID: 2, title: "github-source"}: {
				UUID:      "00000000-0000-0000-0000-000000000002",
				ProjectID: 2,
				Type:      "github",
				StatusOK:  false,
				Data: json.RawMessage(`{
                    "base_url":"https://api.github.test",
                    "access_token":"{{secret.GITHUB_TOKEN}}",
                    "password":null,
                    "app_private_key":null
                }`),
			},
			{projectID: 1, title: "pgvector-public", shared: true}: {
				UUID:      "00000000-0000-0000-0000-000000000003",
				ProjectID: 1,
				Type:      "pgvector",
				Shared:    true,
				StatusOK:  true,
				Data:      json.RawMessage(`{"connection_string":"{{secret.PGVECTOR_DSN}}"}`),
			},
		},
		embedding: map[resolverEmbeddingKey]bool{
			{projectID: 1, name: "embedding-small", shared: true}: true,
		},
		llmModels: map[resolverLLMKey]IndexLLMModelRecord{
			{projectID: 2, name: "gpt-test"}: {
				ProjectID:        2,
				Name:             "gpt-test",
				OpenAICompatible: true,
				MaxOutputTokens:  4096,
			},
		},
	}
}

func decodedObject(t *testing.T, raw json.RawMessage) map[string]any {
	t.Helper()
	var value map[string]any
	if err := json.Unmarshal(raw, &value); err != nil {
		t.Fatal(err)
	}
	return value
}

func replaceJSONField(t *testing.T, raw json.RawMessage, key string, value any) json.RawMessage {
	t.Helper()
	object := decodedObject(t, raw)
	object[key] = value
	return mustJSON(t, object)
}

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}

func TestFixedGitHubResolverOutputShapeIsStable(t *testing.T) {
	store := validFixedGitHubStore()
	resolver, err := NewFixedGitHubResolver(store, 1)
	if err != nil {
		t.Fatal(err)
	}
	inputs, err := resolver.Resolve(context.Background(), validFixedGitHubRequest())
	if err != nil {
		t.Fatal(err)
	}
	var actual map[string]any
	if err := json.Unmarshal(inputs.ToolkitConfiguration, &actual); err != nil {
		t.Fatal(err)
	}
	expectedKeys := []string{"id", "settings", "toolkit_name", "type"}
	actualKeys := make([]string, 0, len(actual))
	for key := range actual {
		actualKeys = append(actualKeys, key)
	}
	for _, key := range expectedKeys {
		if _, ok := actual[key]; !ok {
			t.Fatalf("resolved toolkit is missing %q: %#v", key, actual)
		}
	}
	if len(actualKeys) != len(expectedKeys) || !reflect.DeepEqual(actual["settings"].(map[string]any)["selected_tools"], []any{"search_index", "index_data"}) {
		t.Fatalf("resolved toolkit shape changed: %#v", actual)
	}
}
