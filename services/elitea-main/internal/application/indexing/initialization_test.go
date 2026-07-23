package indexing

import (
	"context"
	"errors"
	"testing"
	"time"
)

type indexMetaMaterializerStub struct {
	request AdmissionOutcome
	inputs  AuthoritativeInputs
	err     error
	calls   int
}

func (s *indexMetaMaterializerStub) MaterializeInitialIndexMeta(
	_ context.Context,
	request SubmitRequest,
	outcome AdmissionOutcome,
) error {
	s.calls++
	s.request = cloneAdmissionOutcome(outcome)
	s.inputs = request.Inputs.Clone()
	return s.err
}

type indexMetaTransitionStub struct {
	initialization IndexMetaInitialization
	initializedAt  time.Time
	err            error
	calls          int
}

func (s *indexMetaTransitionStub) MarkIndexMetaInitialized(
	_ context.Context,
	initialization IndexMetaInitialization,
) (time.Time, error) {
	s.calls++
	s.initialization = initialization
	return s.initializedAt, s.err
}

func TestInitializingAdmissionSubmitterMaterializesBeforeOpeningGate(t *testing.T) {
	outcome := validStartAdmissionOutcome()
	outcome.IndexMetaInitializedAt = nil
	admissions := &startAdmissionStub{outcome: outcome}
	materializer := &indexMetaMaterializerStub{}
	initializedAt := time.Date(2026, time.July, 23, 9, 30, 0, 0, time.UTC)
	transitions := &indexMetaTransitionStub{initializedAt: initializedAt}
	submitter, err := NewInitializingAdmissionSubmitter(admissions, materializer, transitions)
	if err != nil {
		t.Fatal(err)
	}
	request := SubmitRequest{
		CorrelationID: "message-1",
		Inputs:        validStartServiceInputs(),
	}

	got, err := submitter.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if materializer.calls != 1 || transitions.calls != 1 ||
		materializer.request.IndexMetaID != outcome.IndexMetaID ||
		transitions.initialization != (IndexMetaInitialization{
			ExecutionID:   outcome.ExecutionID,
			Generation:    outcome.Generation,
			MetaID:        outcome.IndexMetaID,
			CorrelationID: outcome.IndexMetaCorrelationID,
		}) ||
		got.IndexMetaInitializedAt == nil || !got.IndexMetaInitializedAt.Equal(initializedAt) {
		t.Fatalf(
			"materialization/gate outcome=%+v materializer_calls=%d transition=%+v transition_calls=%d",
			got,
			materializer.calls,
			transitions.initialization,
			transitions.calls,
		)
	}
}

func TestInitializingAdmissionSubmitterNeverMarksAfterMaterializationFailure(t *testing.T) {
	outcome := validStartAdmissionOutcome()
	outcome.IndexMetaInitializedAt = nil
	materializationFailure := errors.New("PgVector unavailable")
	materializer := &indexMetaMaterializerStub{err: materializationFailure}
	transitions := &indexMetaTransitionStub{
		initializedAt: time.Date(2026, time.July, 23, 9, 30, 0, 0, time.UTC),
	}
	submitter, err := NewInitializingAdmissionSubmitter(
		&startAdmissionStub{outcome: outcome},
		materializer,
		transitions,
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := submitter.Submit(context.Background(), SubmitRequest{}); !errors.Is(err, materializationFailure) {
		t.Fatalf("materialization error=%v", err)
	}
	if materializer.calls != 1 || transitions.calls != 0 {
		t.Fatalf("materializer calls=%d transition calls=%d", materializer.calls, transitions.calls)
	}
}

func TestInitializingAdmissionSubmitterReusesCompletedTransition(t *testing.T) {
	outcome := validStartAdmissionOutcome()
	materializer := &indexMetaMaterializerStub{}
	transitions := &indexMetaTransitionStub{}
	submitter, err := NewInitializingAdmissionSubmitter(
		&startAdmissionStub{outcome: outcome},
		materializer,
		transitions,
	)
	if err != nil {
		t.Fatal(err)
	}
	got, err := submitter.Submit(context.Background(), SubmitRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got.IndexMetaInitializedAt == nil || materializer.calls != 0 || transitions.calls != 0 {
		t.Fatalf("completed transition was replayed: outcome=%+v materializer=%d transition=%d", got, materializer.calls, transitions.calls)
	}
}
