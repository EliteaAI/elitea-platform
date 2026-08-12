package indexing

import (
	"context"
	"encoding/json"
	"errors"
	"testing"
)

type currentManualStopCleanupWriterStub struct {
	target CurrentIndexMetaTarget
	record CurrentManualStopCleanup
	err    error
	calls  int
}

func (s *currentManualStopCleanupWriterStub) CleanupManualStop(
	_ context.Context,
	target CurrentIndexMetaTarget,
	record CurrentManualStopCleanup,
) error {
	s.calls++
	s.target = target
	s.record = record
	return s.err
}

func TestCurrentManualStopCleanerUsesOnlyFrozenAdmissionBinding(t *testing.T) {
	bindings := &currentIndexMetaTerminalBindingStub{
		binding: validCurrentManualStopBinding(),
	}
	claimed := json.RawMessage(`{
		"id":19,
		"type":"github",
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
	writer := &currentManualStopCleanupWriterStub{}
	cleaner, err := NewCurrentManualStopCleaner(bindings, claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	if err := cleaner.Cleanup(
		context.Background(),
		CurrentManualStopCleanupRequest{
			ExecutionID: "execution-1",
			Generation:  3,
		},
	); err != nil {
		t.Fatal(err)
	}
	if bindings.calls != 1 || claimer.calls != 1 || writer.calls != 1 {
		t.Fatalf(
			"bindings=%d claimer=%d writer=%d",
			bindings.calls,
			claimer.calls,
			writer.calls,
		)
	}
	if claimer.claim.ResourceProjectID != 7 ||
		claimer.claim.ActorUserID != 13 ||
		string(claimer.claim.ToolkitConfiguration) !=
			`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}` {
		t.Fatalf("claim=%+v", claimer.claim)
	}
	if writer.target.SchemaID != 19 ||
		writer.target.ConnectionString !=
			"postgresql+psycopg://project-only" ||
		writer.record != (CurrentManualStopCleanup{
			MetaID:          "meta-1",
			ExecutionID:     "execution-1",
			Generation:      3,
			IndexGeneration: 8,
			IndexName:       "Docs",
			ToolkitID:       19,
		}) {
		t.Fatalf("target=%+v record=%+v", writer.target, writer.record)
	}
}

func TestCurrentManualStopCleanerRejectsBindingDriftBeforeSecretClaim(
	t *testing.T,
) {
	binding := validCurrentManualStopBinding()
	binding.Generation = 4
	bindings := &currentIndexMetaTerminalBindingStub{binding: binding}
	claimer := &frozenToolkitClaimerStub{}
	writer := &currentManualStopCleanupWriterStub{}
	cleaner, err := NewCurrentManualStopCleaner(bindings, claimer, writer)
	if err != nil {
		t.Fatal(err)
	}
	err = cleaner.Cleanup(
		context.Background(),
		CurrentManualStopCleanupRequest{
			ExecutionID: "execution-1",
			Generation:  3,
		},
	)
	if !errors.Is(err, ErrCurrentIndexMetaConflict) {
		t.Fatalf("error=%v", err)
	}
	if claimer.calls != 0 || writer.calls != 0 {
		t.Fatalf("claimer=%d writer=%d", claimer.calls, writer.calls)
	}
}

func TestCurrentManualStopCleanupContractsRejectInvalidIdentity(t *testing.T) {
	for name, value := range map[string]CurrentManualStopCleanup{
		"missing execution": {
			MetaID:          "meta-1",
			Generation:      1,
			IndexGeneration: 1,
			IndexName:       "Docs",
			ToolkitID:       19,
		},
		"missing logical generation": {
			MetaID:      "meta-1",
			ExecutionID: "execution-1",
			Generation:  1,
			IndexName:   "Docs",
			ToolkitID:   19,
		},
		"missing toolkit": {
			MetaID:          "meta-1",
			ExecutionID:     "execution-1",
			Generation:      1,
			IndexGeneration: 1,
			IndexName:       "Docs",
		},
	} {
		t.Run(name, func(t *testing.T) {
			if !errors.Is(
				value.Validate(),
				ErrCurrentIndexMetaInitializationInvalid,
			) {
				t.Fatalf("value=%+v", value)
			}
		})
	}
}

func validCurrentManualStopBinding() CurrentIndexMetaTerminalBinding {
	return CurrentIndexMetaTerminalBinding{
		ResourceProjectID: 7,
		ActorUserID:       13,
		ToolkitID:         19,
		IndexName:         "Docs",
		MetaID:            "meta-1",
		ExecutionID:       "execution-1",
		Generation:        3,
		IndexGeneration:   8,
		ToolkitConfiguration: json.RawMessage(
			`{"id":19,"type":"github","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true}}}`,
		),
	}
}
