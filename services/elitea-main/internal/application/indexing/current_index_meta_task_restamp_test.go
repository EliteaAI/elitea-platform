package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
	"time"
)

type currentTaskRestampBindingStub struct {
	binding CurrentIndexMetaTaskRestampBinding
	err     error
	calls   int
}

func (s *currentTaskRestampBindingStub) LoadCurrentIndexMetaTaskRestampBinding(
	_ context.Context,
	executionID string,
	generation uint64,
) (CurrentIndexMetaTaskRestampBinding, error) {
	s.calls++
	if s.err != nil {
		return CurrentIndexMetaTaskRestampBinding{}, s.err
	}
	if executionID != s.binding.ExecutionID ||
		generation != s.binding.Generation {
		return CurrentIndexMetaTaskRestampBinding{}, ErrCurrentIndexMetaConflict
	}
	binding := s.binding
	binding.ToolkitConfiguration = append(
		json.RawMessage(nil),
		binding.ToolkitConfiguration...,
	)
	return binding, nil
}

type currentTaskRestampWriterStub struct {
	target CurrentIndexMetaTarget
	record CurrentTaskRestampIndexMeta
	err    error
	calls  int
}

func (s *currentTaskRestampWriterStub) MaterializeTaskID(
	_ context.Context,
	target CurrentIndexMetaTarget,
	record CurrentTaskRestampIndexMeta,
) error {
	s.calls++
	s.target = target
	s.record = record
	return s.err
}

func TestCurrentIndexMetaTaskRestamperUsesOnlyFrozenAdmissionIdentity(t *testing.T) {
	binding := validCurrentTaskRestampBinding()
	bindings := &currentTaskRestampBindingStub{binding: binding}
	claimer := &frozenToolkitClaimerStub{value: json.RawMessage(`{
		"id":19,
		"type":"github",
		"settings":{"pgvector_configuration":{
			"configuration_type":"pgvector",
			"configuration_project_id":7,
			"connection_string":"postgresql://project-only"
		}}
	}`)}
	writer := &currentTaskRestampWriterStub{}
	restamper, err := NewCurrentIndexMetaTaskRestamper(
		bindings,
		claimer,
		writer,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := CurrentIndexMetaTaskRestampRequest{
		ExecutionID:   "execution-1",
		Generation:    3,
		SourceEventID: "command-1:6",
		OccurredAt:    time.Date(2026, time.July, 27, 10, 0, 0, 0, time.UTC),
		CreatedOn:     1_700_000_000.25,
	}
	if err := restamper.Restamp(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if bindings.calls != 1 || claimer.calls != 1 || writer.calls != 1 {
		t.Fatalf(
			"binding=%d claim=%d write=%d",
			bindings.calls,
			claimer.calls,
			writer.calls,
		)
	}
	if claimer.claim.ResourceProjectID != binding.ResourceProjectID ||
		claimer.claim.ActorUserID != binding.ActorUserID ||
		string(claimer.claim.ToolkitConfiguration) !=
			string(binding.ToolkitConfiguration) {
		t.Fatalf("claim=%+v", claimer.claim)
	}
	if writer.target.SchemaID != binding.ToolkitID ||
		writer.target.ConnectionString != "postgresql://project-only" ||
		writer.record.MetaID != binding.MetaID ||
		writer.record.ExecutionID != binding.ExecutionID ||
		writer.record.Generation != binding.Generation ||
		writer.record.IndexGeneration != binding.IndexGeneration ||
		writer.record.IndexName != binding.IndexName ||
		writer.record.ToolkitID != binding.ToolkitID ||
		writer.record.CreatedOn != request.CreatedOn {
		t.Fatalf("target=%+v record=%+v", writer.target, writer.record)
	}
}

func TestCurrentIndexMetaTaskRestamperFailsClosedBeforeSecretClaim(t *testing.T) {
	binding := validCurrentTaskRestampBinding()
	bindings := &currentTaskRestampBindingStub{
		binding: binding,
		err:     ErrCurrentIndexMetaConflict,
	}
	claimer := &frozenToolkitClaimerStub{}
	writer := &currentTaskRestampWriterStub{}
	restamper, err := NewCurrentIndexMetaTaskRestamper(
		bindings,
		claimer,
		writer,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := CurrentIndexMetaTaskRestampRequest{
		ExecutionID:   "execution-1",
		Generation:    2,
		SourceEventID: "command-1:6",
		OccurredAt:    time.Now().UTC(),
		CreatedOn:     1_700_000_000.25,
	}
	if err := restamper.Restamp(
		context.Background(),
		request,
	); !errors.Is(err, ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
	if claimer.calls != 0 || writer.calls != 0 {
		t.Fatalf("claim=%d write=%d", claimer.calls, writer.calls)
	}
}

func validCurrentTaskRestampBinding() CurrentIndexMetaTaskRestampBinding {
	return CurrentIndexMetaTaskRestampBinding{
		ResourceProjectID: 7,
		ActorUserID:       13,
		ToolkitID:         19,
		IndexName:         "Docs",
		MetaID:            "meta-1",
		ExecutionID:       "execution-1",
		Generation:        3,
		IndexGeneration:   7,
		ToolkitConfiguration: json.RawMessage(
			`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`,
		),
	}
}
