package indexing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"google.golang.org/protobuf/proto"
)

type indexAdmissionStoreStub struct {
	admission Admission
}

func (s *indexAdmissionStoreStub) AdmitIndexIngest(_ context.Context, admission Admission) (executionapp.AdmissionOutcome, error) {
	s.admission = admission
	admittedAt := time.Date(2026, time.July, 22, 9, 0, 0, 0, time.UTC)
	return executionapp.AdmissionOutcome{
		ExecutionID: admission.Record.Job.ID,
		CommandID:   admission.Record.Job.CommandID,
		Created:     true,
		AdmittedAt:  admittedAt,
		Deadline:    admittedAt.Add(time.Hour),
	}, nil
}

func TestInputBundleFactoryBuildsTypedReferenceManifestWithoutAliasing(t *testing.T) {
	ids := sequenceIDs("bundle", "toolkit-content", "parameters-content", "model-content", "llm-content", "mcp-content")
	factory, err := NewInputBundleFactory(InputProfile{
		Classification:        "project-confidential",
		RequiredGrantAudience: "elitea.runtime.input.read.v1",
	}, ids)
	if err != nil {
		t.Fatal(err)
	}
	model := "gpt-test"
	inputs := AuthoritativeInputs{
		ToolkitConfiguration: json.RawMessage(`{"id":19,"type":"confluence","settings":{"token":"secret-ref://42"}}`),
		ToolParameters:       json.RawMessage(`{"index_name":"docs"}`),
		LLMModel:             &model,
		LLMConfiguration:     json.RawMessage(`{"temperature":0.1}`),
		MCPReferences:        json.RawMessage(`{"server":"credential-ref://7"}`),
	}
	bundle, binding, err := factory.Build(context.Background(), inputs)
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Entries) != 5 || binding.ToolkitConfigurationEntryID == "" || binding.ToolParametersEntryID == "" || binding.LLMModelEntryID == "" || binding.LLMConfigurationEntryID == "" || binding.MCPTokensEntryID == "" {
		t.Fatalf("unexpected typed index bundle: entries=%d binding=%+v", len(bundle.Entries), binding)
	}
	var manifest runtimev1.ExecutionInputBundleV1
	if err := proto.Unmarshal(bundle.Manifest, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.GetEntries()) != 5 {
		t.Fatalf("manifest entry count=%d, want 5", len(manifest.GetEntries()))
	}
	for index, entry := range manifest.GetEntries() {
		if entry.GetContent() == nil || len(entry.GetContent().GetDigest().GetValue()) != 32 || entry.GetContent().GetByteLength() != uint64(bundle.Entries[index].ContentLength) {
			t.Fatalf("manifest entry %d lost reference binding: %v", index, entry)
		}
	}
	inputs.ToolkitConfiguration[2] = 'X'
	if bytes.Equal(bundle.Entries[0].Content, inputs.ToolkitConfiguration) {
		t.Fatal("durable toolkit configuration aliases resolver memory")
	}
}

func TestAdmissionServiceBuildsIndexJobAndPreservesCurrentIdentity(t *testing.T) {
	factory, err := NewInputBundleFactory(InputProfile{
		Classification:        "project-confidential",
		RequiredGrantAudience: "elitea.runtime.input.read.v1",
	}, sequenceIDs("bundle-1", "toolkit-content", "parameters-content"))
	if err != nil {
		t.Fatal(err)
	}
	store := &indexAdmissionStoreStub{}
	service, err := NewAdmissionService(store, factory, func() time.Time {
		return time.Date(2026, time.July, 22, 8, 0, 0, 0, time.UTC)
	}, sequenceIDs("execution-1", "command-1", "outbox-1"))
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := service.Submit(context.Background(), SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "tenant-1",
			ResourceProjectID:   "1",
			ProjectionProjectID: "1",
			ActorID:             "7",
		},
		IdempotencyKey: "index-request-1",
		ToolkitID:      19,
		Initiator:      executiondomain.IndexIngestInitiatorUser,
		Inputs: AuthoritativeInputs{
			ToolkitConfiguration: json.RawMessage(`{"id":19,"type":"confluence"}`),
			ToolParameters:       json.RawMessage(`{"index_name":"docs"}`),
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Created || outcome.ExecutionID != "execution-1" || outcome.CommandID != "command-1" {
		t.Fatalf("unexpected admission outcome: %+v", outcome)
	}
	if store.admission.Record.Job.CapabilityID != executiondomain.IndexIngestCapability || store.admission.Binding.ToolkitID != 19 || store.admission.Binding.IndexName != "docs" || store.admission.Binding.Initiator != executiondomain.IndexIngestInitiatorUser {
		t.Fatalf("index identity was not preserved: %+v", store.admission)
	}
	if err := store.admission.Binding.Validate(store.admission.Record.InputBundle); err != nil {
		t.Fatalf("stored binding is invalid: %v", err)
	}
}

func TestIndexAdmissionRejectsContentBeyondDurableEntryLimit(t *testing.T) {
	value := bytes.Repeat([]byte{'x'}, executiondomain.MaxInputEntryContentBytes+1)
	inputs := AuthoritativeInputs{
		ToolkitConfiguration: json.RawMessage(`{"id":1}`),
		ToolParameters:       append(json.RawMessage(`{"index_name":"`), append(value, []byte(`"}`)...)...),
	}
	if err := inputs.validate(); !errors.Is(err, ErrInvalidAuthoritativeIndexInput) {
		t.Fatalf("oversized entry error=%v, want %v", err, ErrInvalidAuthoritativeIndexInput)
	}
}

func sequenceIDs(values ...string) executionapp.IDGenerator {
	return func() (string, error) {
		if len(values) == 0 {
			return "", fmt.Errorf("unexpected ID allocation")
		}
		value := values[0]
		values = values[1:]
		return value, nil
	}
}
