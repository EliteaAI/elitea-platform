package indexsearch

import (
	"bytes"
	"errors"
	"testing"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"google.golang.org/protobuf/proto"
)

func TestRequestPreservesSDKOwnedSearchParameters(t *testing.T) {
	model := "embedding-and-stepback-model"
	request := Request{
		Scope: AuthorizedScope{
			TenantID:            "tenant-7",
			ResourceProjectID:   "project-7",
			ProjectionProjectID: "project-7",
			PrincipalRef:        "user-42",
		},
		Operation: SearchIndex,
		Inputs: AuthoritativeInputs{
			ToolkitConfiguration: []byte(`{"type":"github","settings":{"vectorstore_type":"PGVector","embedding_model":"text-embedding-3-large","dimension":3072}}`),
			ToolParameters:       []byte(`{"query":"release notes","filter":{"state":{"$eq":"published"}},"cut_off":0.77,"search_top":3,"full_text_search":{"enabled":true,"fields":["page_content"]},"reranking_config":{"source":{"weight":2,"rules":{"priority":"docs"}}},"extended_search":["summary"],"output_fields":["metadata.source","score"]}`),
			LLMModel:             &model,
			LLMConfiguration:     []byte(`{"temperature":0.1}`),
			MCPTokens:            []byte(`{"server":"opaque-reference-only"}`),
			EmbeddingBinding:     []byte(`{"schema_version":"elitea.index.embedding-binding.v1","model_name":"text-embedding-3-large"}`),
		},
	}
	if err := request.Validate(); err != nil {
		t.Fatalf("request should leave SDK-owned search fields intact: %v", err)
	}
	copy := request.Inputs.Clone()
	copy.ToolParameters[2] = 'X'
	if bytes.Equal(copy.ToolParameters, request.Inputs.ToolParameters) {
		t.Fatal("input clone aliases mutable request content")
	}
}

func TestRequestRejectsMissingAuthorizationOrUnknownOperation(t *testing.T) {
	request := validRequest()
	request.Scope.PrincipalRef = ""
	if !errors.Is(request.Validate(), ErrInvalidContract) {
		t.Fatal("request without authenticated principal was accepted")
	}
	request = validRequest()
	request.Operation = "remove_index"
	if !errors.Is(request.Validate(), ErrInvalidContract) {
		t.Fatal("unreviewed SDK operation was accepted")
	}
}

func TestCommandContainsOnlyReferenceIdentifiers(t *testing.T) {
	command, err := Command(StepbackSearchIndex, bindings())
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(command)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range [][]byte{
		[]byte("release notes"), []byte("text-embedding-3-large"), []byte("opaque-reference-only"),
	} {
		if bytes.Contains(encoded, forbidden) {
			t.Fatalf("control command leaked input content %q", forbidden)
		}
	}
	if command.GetOperation() != runtimev1.IndexSearchOperationV1_INDEX_SEARCH_OPERATION_V1_STEPBACK_SEARCH_INDEX || command.GetToolkitConfigurationEntryId() != "toolkit" || command.GetToolParametersEntryId() != "params" || command.GetLlmModelEntryId() != "llm-model" || command.GetLlmConfigurationEntryId() != "llm-config" || command.GetMcpTokensEntryId() != "mcp-tokens" || command.GetEmbeddingBinding().GetEntryId() != "embedding-binding" {
		t.Fatalf("unexpected reference command: %+v", command)
	}
}

func TestResultBindsAllModelAndVectorConfigurationReferences(t *testing.T) {
	result, err := Result(
		SearchIndex,
		"bundle-1",
		digest("bundle"),
		bindings(),
		ArtifactReference{
			ID:             "artifact-1",
			Version:        "sha256:artifact",
			MediaType:      "application/vnd.elitea.index-search-result.v1+json",
			ByteLength:     4096,
			Digest:         digest("artifact"),
			Classification: "tenant-confidential",
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	if result.GetToolkitConfiguration().GetEntryId() != "toolkit" || result.GetLlmModel().GetEntryId() != "llm-model" || result.GetLlmConfiguration().GetEntryId() != "llm-config" || result.GetMcpTokens().GetEntryId() != "mcp-tokens" || result.GetEmbeddingBinding().GetEntryId() != "embedding-binding" || result.GetResultArtifact().GetArtifactId() != "artifact-1" {
		t.Fatalf("result lost an immutable input/result binding: %+v", result)
	}
	if got := len(result.GetResultArtifact().GetDigest().GetValue()); got != 32 {
		t.Fatalf("result artifact digest length = %d, want 32", got)
	}
}

func validRequest() Request {
	return Request{
		Scope:     AuthorizedScope{TenantID: "tenant", ResourceProjectID: "project", ProjectionProjectID: "project", PrincipalRef: "user"},
		Operation: ListIndexes,
		Inputs: AuthoritativeInputs{
			ToolkitConfiguration: []byte(`{"type":"github","settings":{}}`),
			ToolParameters:       []byte(`{}`),
			EmbeddingBinding:     []byte(`{"schema_version":"elitea.index.embedding-binding.v1"}`),
		},
	}
}

func bindings() Bindings {
	model := InputBinding{EntryID: "llm-model", Version: "sha256:model", Digest: digest("model")}
	config := InputBinding{EntryID: "llm-config", Version: "sha256:config", Digest: digest("config")}
	mcp := InputBinding{EntryID: "mcp-tokens", Version: "sha256:mcp", Digest: digest("mcp")}
	return Bindings{
		ToolkitConfiguration: InputBinding{EntryID: "toolkit", Version: "sha256:toolkit", Digest: digest("toolkit")},
		ToolParameters:       InputBinding{EntryID: "params", Version: "sha256:params", Digest: digest("params")},
		LLMModel:             &model,
		LLMConfiguration:     &config,
		MCPTokens:            &mcp,
		EmbeddingBinding:     InputBinding{EntryID: "embedding-binding", Version: "sha256:embedding", Digest: digest("embedding")},
	}
}

func TestRequireRecordedEmbeddingBindingRejectsLegacyStaleScopeModelAndConfigurationDrift(t *testing.T) {
	binding := indexingapp.EmbeddingBinding{
		SchemaVersion:          indexingapp.CurrentEmbeddingBindingSchema,
		ModelName:              "embed",
		ResolvedModelGroup:     "7_embed",
		Route:                  "project",
		ModelProjectID:         7,
		ConfigurationProjectID: 7,
		ConfigurationUUID:      "00000000-0000-0000-0000-000000000701",
		ConfigurationDigest:    digest("configuration"),
	}
	recorded := &RecordedEmbeddingBinding{
		ResourceProjectID: "7",
		ToolkitID:         19,
		IndexName:         "docs",
		IndexGeneration:   4,
		Input:             InputBinding{EntryID: "embedding-binding", Version: "sha256:binding", Digest: digest("binding")},
		Binding:           binding,
	}
	expectation := EmbeddingExpectation{
		ResourceProjectID:   "7",
		ToolkitID:           19,
		IndexName:           "docs",
		IndexGeneration:     4,
		ModelName:           "embed",
		ModelProjectID:      7,
		ConfigurationUUID:   binding.ConfigurationUUID,
		ConfigurationDigest: binding.ConfigurationDigest,
	}
	if err := RequireRecordedEmbeddingBinding(recorded, expectation); err != nil {
		t.Fatal(err)
	}

	assertCompatibilityCode(t, nil, expectation, EmbeddingCompatibilityLegacyBindingMissing)
	stale := expectation
	stale.IndexGeneration++
	assertCompatibilityCode(t, recorded, stale, EmbeddingCompatibilityStaleGeneration)
	wrongScope := expectation
	wrongScope.ResourceProjectID = "8"
	assertCompatibilityCode(t, recorded, wrongScope, EmbeddingCompatibilityScopeMismatch)
	wrongModel := expectation
	wrongModel.ModelName = "embed-v2"
	assertCompatibilityCode(t, recorded, wrongModel, EmbeddingCompatibilityModelMismatch)
	wrongConfiguration := expectation
	wrongConfiguration.ConfigurationDigest = digest("changed-configuration")
	assertCompatibilityCode(t, recorded, wrongConfiguration, EmbeddingCompatibilityConfigurationMismatch)
	wrongProject := expectation
	wrongProject.ModelProjectID = 1
	assertCompatibilityCode(t, recorded, wrongProject, EmbeddingCompatibilityConfigurationMismatch)
}

func assertCompatibilityCode(
	t *testing.T,
	recorded *RecordedEmbeddingBinding,
	expectation EmbeddingExpectation,
	code EmbeddingCompatibilityCode,
) {
	t.Helper()
	err := RequireRecordedEmbeddingBinding(recorded, expectation)
	var compatibility *EmbeddingCompatibilityError
	if !errors.As(err, &compatibility) || compatibility.Code != code {
		t.Fatalf("error=%v code=%q, want %q", err, compatibility.Code, code)
	}
}

func digest(value string) runtimedomain.Digest {
	return runtimedomain.SHA256([]byte(value))
}
