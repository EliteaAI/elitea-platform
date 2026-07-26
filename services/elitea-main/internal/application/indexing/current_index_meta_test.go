package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
)

type frozenToolkitClaimerStub struct {
	claim FrozenToolkitConfigurationClaim
	value json.RawMessage
	err   error
	calls int
}

func (s *frozenToolkitClaimerStub) ClaimFrozenToolkitConfiguration(
	_ context.Context,
	claim FrozenToolkitConfigurationClaim,
) (json.RawMessage, error) {
	s.calls++
	s.claim = claim
	return append(json.RawMessage(nil), s.value...), s.err
}

type currentIndexMetaWriterStub struct {
	target CurrentIndexMetaTarget
	record CurrentInitialIndexMeta
	err    error
	calls  int
}

func (s *currentIndexMetaWriterStub) MaterializeInitial(
	_ context.Context,
	target CurrentIndexMetaTarget,
	record CurrentInitialIndexMeta,
) error {
	s.calls++
	s.target = target
	s.record = record
	s.record.InitialMetadata = append(json.RawMessage(nil), record.InitialMetadata...)
	return s.err
}

type currentIndexMetaTerminalBindingStub struct {
	binding CurrentIndexMetaTerminalBinding
	err     error
	calls   int
}

func (s *currentIndexMetaTerminalBindingStub) LoadCurrentIndexMetaTerminalBinding(
	_ context.Context,
	executionID string,
	generation uint64,
) (CurrentIndexMetaTerminalBinding, error) {
	s.calls++
	if s.err != nil {
		return CurrentIndexMetaTerminalBinding{}, s.err
	}
	if executionID != s.binding.ExecutionID || generation != s.binding.Generation {
		return CurrentIndexMetaTerminalBinding{}, ErrCurrentIndexMetaConflict
	}
	binding := s.binding
	binding.ToolkitConfiguration = append(json.RawMessage(nil), binding.ToolkitConfiguration...)
	return binding, nil
}

type currentIndexMetaTerminalWriterStub struct {
	target CurrentIndexMetaTarget
	record CurrentTerminalIndexMeta
	err    error
	calls  int
}

func (s *currentIndexMetaTerminalWriterStub) MaterializeTerminal(
	_ context.Context,
	target CurrentIndexMetaTarget,
	record CurrentTerminalIndexMeta,
) error {
	s.calls++
	s.target = target
	s.record = record
	return s.err
}

func TestCurrentIndexMetaInitializerUsesOnlyClaimedProjectPgvector(t *testing.T) {
	claimed := json.RawMessage(`{
		"id":19,
		"type":"confluence",
		"settings":{
			"pgvector_configuration":{
				"configuration_type":"pgvector",
				"configuration_project_id":7,
				"configuration_uuid":"pgvector-7",
				"connection_string":"postgresql+psycopg://project-only"
			}
		}
	}`)
	claimer := &frozenToolkitClaimerStub{value: claimed}
	writer := &currentIndexMetaWriterStub{}
	initializer, err := NewCurrentIndexMetaInitializer(claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	admittedAt := time.Date(2026, time.July, 23, 11, 12, 13, 456_000_000, time.UTC)
	request := SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "7",
			ResourceProjectID:   "7",
			ProjectionProjectID: "7",
			ActorID:             "13",
		},
		CorrelationID: "message-1",
		ToolkitID:     19,
		Inputs: AuthoritativeInputs{
			ToolkitConfiguration: json.RawMessage(`{"id":19,"type":"confluence","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`),
			ToolParameters:       json.RawMessage(`{"index_name":"Docs","recursive":true,"limit":3}`),
		},
	}
	outcome := AdmissionOutcome{
		AdmissionOutcome: executionapp.AdmissionOutcome{
			ExecutionID: "execution-1",
			CommandID:   "command-1",
			AdmittedAt:  admittedAt,
			Deadline:    admittedAt.Add(time.Hour),
		},
		Generation:             1,
		IndexMetaID:            "meta-1",
		IndexMetaCorrelationID: "message-1",
	}

	if err := initializer.MaterializeInitialIndexMeta(context.Background(), request, outcome); err != nil {
		t.Fatal(err)
	}
	if claimer.calls != 1 || claimer.claim.ResourceProjectID != 7 || claimer.claim.ActorUserID != 13 ||
		string(claimer.claim.ToolkitConfiguration) != string(request.Inputs.ToolkitConfiguration) {
		t.Fatalf("claim=%+v calls=%d", claimer.claim, claimer.calls)
	}
	if writer.calls != 1 ||
		writer.target != (CurrentIndexMetaTarget{
			ConnectionString: "postgresql+psycopg://project-only",
			SchemaID:         19,
		}) ||
		writer.record.MetaID != "meta-1" ||
		writer.record.ExecutionID != "execution-1" ||
		writer.record.CorrelationID != "message-1" ||
		writer.record.Generation != 1 ||
		writer.record.IndexName != "Docs" ||
		writer.record.ToolkitID != 19 ||
		writer.record.Document != "index_meta_Docs" {
		t.Fatalf("target=%+v record=%+v calls=%d", writer.target, writer.record, writer.calls)
	}
	metadata, err := decodeCurrentIndexMetaObject(writer.record.InitialMetadata)
	if err != nil {
		t.Fatal(err)
	}
	indexConfiguration, ok := metadata["index_configuration"].(map[string]any)
	if !ok || indexConfiguration["index_name"] != "Docs" || indexConfiguration["recursive"] != true ||
		indexConfiguration["limit"] != json.Number("3") {
		t.Fatalf("index_configuration=%#v", metadata["index_configuration"])
	}
	wantLinkage := map[string]any{
		"collection":           "Docs",
		"type":                 "index_meta",
		"state":                "in_progress",
		"task_id":              "execution-1",
		"conversation_id":      nil,
		"toolkit_id":           json.Number("19"),
		"execution_id":         "execution-1",
		"execution_generation": json.Number("1"),
		"index_meta_id":        "meta-1",
		"correlation_id":       "message-1",
	}
	for key, want := range wantLinkage {
		if !reflect.DeepEqual(metadata[key], want) {
			t.Fatalf("metadata[%q]=%#v want %#v", key, metadata[key], want)
		}
	}
	if metadata["created_on"] != json.Number("1784805133.456") ||
		metadata["updated_on"] != metadata["created_on"] ||
		metadata["indexed"] != json.Number("0") || metadata["updated"] != json.Number("0") {
		t.Fatalf("initial counters/timing=%#v", metadata)
	}
	if _, present := metadata["history"]; present {
		t.Fatal("application initializer, rather than the atomic writer, populated history")
	}
}

func TestCurrentIndexMetaInitializerRejectsNonProjectPgvectorTargets(t *testing.T) {
	for _, test := range []struct {
		name    string
		claimed string
	}{
		{
			name: "mutable marker remains",
			claimed: `{"id":19,"type":"github","settings":{"pgvector_configuration":{
				"__elitea_frozen_configuration_v1":true,
				"configuration_type":"pgvector","configuration_project_id":7,
				"connection_string":"postgresql://project"
			}}}`,
		},
		{
			name: "wrong configuration type",
			claimed: `{"id":19,"type":"github","settings":{"pgvector_configuration":{
				"configuration_type":"github","configuration_project_id":7,
				"connection_string":"postgresql://project"
			}}}`,
		},
		{
			name: "different project",
			claimed: `{"id":19,"type":"github","settings":{"pgvector_configuration":{
				"configuration_type":"pgvector","configuration_project_id":1,
				"connection_string":"postgresql://public"
			}}}`,
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			claimer := &frozenToolkitClaimerStub{value: json.RawMessage(test.claimed)}
			writer := &currentIndexMetaWriterStub{}
			initializer, err := NewCurrentIndexMetaInitializer(claimer, writer)
			if err != nil {
				t.Fatal(err)
			}
			err = initializer.MaterializeInitialIndexMeta(
				context.Background(),
				validCurrentIndexMetaSubmitRequest(),
				validCurrentIndexMetaOutcome(),
			)
			if !errors.Is(err, ErrCurrentIndexMetaTargetUnavailable) {
				t.Fatalf("error=%v", err)
			}
			if writer.calls != 0 {
				t.Fatal("invalid target reached the external writer")
			}
		})
	}
}

func TestCurrentIndexMetaInitializerCancellationNeverClaimsOrWrites(t *testing.T) {
	claimer := &frozenToolkitClaimerStub{}
	writer := &currentIndexMetaWriterStub{}
	initializer, err := NewCurrentIndexMetaInitializer(claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := initializer.MaterializeInitialIndexMeta(
		ctx,
		validCurrentIndexMetaSubmitRequest(),
		validCurrentIndexMetaOutcome(),
	); !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v", err)
	}
	if claimer.calls != 0 || writer.calls != 0 {
		t.Fatalf("claimer=%d writer=%d", claimer.calls, writer.calls)
	}
}

func TestCurrentIndexMetaTerminalizerFencesExactDurableGeneration(t *testing.T) {
	frozen := json.RawMessage(`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`)
	claimed := json.RawMessage(`{"id":19,"type":"github","settings":{"pgvector_configuration":{"configuration_type":"pgvector","configuration_project_id":7,"connection_string":"postgresql://project"}}}`)
	bindings := &currentIndexMetaTerminalBindingStub{binding: CurrentIndexMetaTerminalBinding{
		ResourceProjectID:    7,
		ActorUserID:          13,
		ToolkitID:            19,
		IndexName:            "Docs",
		MetaID:               "meta-1",
		ExecutionID:          "execution-1",
		Generation:           3,
		ToolkitConfiguration: frozen,
	}}
	claimer := &frozenToolkitClaimerStub{value: claimed}
	writer := &currentIndexMetaTerminalWriterStub{}
	terminalizer, err := NewCurrentIndexMetaTerminalizer(bindings, claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	occurredAt := time.Date(2026, time.July, 26, 12, 13, 14, 567_000_000, time.UTC)
	request := CurrentIndexMetaTerminalRequest{
		ExecutionID: "execution-1",
		Generation:  3,
		State:       CurrentIndexMetaFailed,
		OccurredAt:  occurredAt,
		SafeError:   "A dependency is unavailable.",
	}
	if err := terminalizer.Terminalize(context.Background(), request); err != nil {
		t.Fatal(err)
	}
	if bindings.calls != 1 || claimer.calls != 1 || writer.calls != 1 {
		t.Fatalf("bindings=%d claimer=%d writer=%d", bindings.calls, claimer.calls, writer.calls)
	}
	if claimer.claim.ResourceProjectID != 7 || claimer.claim.ActorUserID != 13 ||
		string(claimer.claim.ToolkitConfiguration) != string(frozen) {
		t.Fatalf("claim=%+v", claimer.claim)
	}
	if writer.target != (CurrentIndexMetaTarget{ConnectionString: "postgresql://project", SchemaID: 19}) ||
		writer.record != (CurrentTerminalIndexMeta{
			MetaID:      "meta-1",
			ExecutionID: "execution-1",
			Generation:  3,
			IndexName:   "Docs",
			ToolkitID:   19,
			State:       CurrentIndexMetaFailed,
			OccurredAt:  occurredAt,
			SafeError:   "A dependency is unavailable.",
		}) {
		t.Fatalf("target=%+v record=%+v", writer.target, writer.record)
	}
}

func TestCurrentIndexMetaTerminalizerRejectsDifferentGenerationBeforeSecretClaim(t *testing.T) {
	bindings := &currentIndexMetaTerminalBindingStub{binding: CurrentIndexMetaTerminalBinding{
		ResourceProjectID:    7,
		ActorUserID:          13,
		ToolkitID:            19,
		IndexName:            "Docs",
		MetaID:               "meta-1",
		ExecutionID:          "execution-1",
		Generation:           3,
		ToolkitConfiguration: json.RawMessage(`{"id":19}`),
	}}
	claimer := &frozenToolkitClaimerStub{}
	writer := &currentIndexMetaTerminalWriterStub{}
	terminalizer, err := NewCurrentIndexMetaTerminalizer(bindings, claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	err = terminalizer.Terminalize(context.Background(), CurrentIndexMetaTerminalRequest{
		ExecutionID: "execution-1",
		Generation:  2,
		State:       CurrentIndexMetaCancelled,
		OccurredAt:  time.Now(),
	})
	if !errors.Is(err, ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
	if claimer.calls != 0 || writer.calls != 0 {
		t.Fatalf("claimer=%d writer=%d", claimer.calls, writer.calls)
	}
}

func validCurrentIndexMetaSubmitRequest() SubmitRequest {
	return SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "7",
			ResourceProjectID:   "7",
			ProjectionProjectID: "7",
			ActorID:             "13",
		},
		CorrelationID: "message-1",
		ToolkitID:     19,
		Inputs: AuthoritativeInputs{
			ToolkitConfiguration: json.RawMessage(`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`),
			ToolParameters:       json.RawMessage(`{"index_name":"Docs"}`),
		},
	}
}

func validCurrentIndexMetaOutcome() AdmissionOutcome {
	admittedAt := time.Date(2026, time.July, 23, 11, 0, 0, 0, time.UTC)
	return AdmissionOutcome{
		AdmissionOutcome: executionapp.AdmissionOutcome{
			ExecutionID: "execution-1",
			CommandID:   "command-1",
			AdmittedAt:  admittedAt,
			Deadline:    admittedAt.Add(time.Hour),
		},
		Generation:             1,
		IndexMetaID:            "meta-1",
		IndexMetaCorrelationID: "message-1",
	}
}
