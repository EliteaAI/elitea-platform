package indexing

import (
	"context"
	"errors"
	"fmt"
)

// IndexMetaMaterializer owns the idempotent external PgVector write for the
// exact admission identity. It must reproduce the approved current initial
// metadata contract and return only after that row is durably visible. It does
// not open the command dispatch gate.
type IndexMetaMaterializer interface {
	MaterializeInitialIndexMeta(context.Context, SubmitRequest, AdmissionOutcome) error
}

// InitializingAdmissionSubmitter is the required composition hook between a
// bare durable admission and the HTTP StartService. An external write may have
// succeeded when either call returns an error, so every retry reuses the
// durable meta identity and requires an idempotent materializer.
type InitializingAdmissionSubmitter struct {
	admissions   IndexAdmissionSubmitter
	materializer IndexMetaMaterializer
	transitions  IndexMetaInitializationStore
}

func NewInitializingAdmissionSubmitter(
	admissions IndexAdmissionSubmitter,
	materializer IndexMetaMaterializer,
	transitions IndexMetaInitializationStore,
) (*InitializingAdmissionSubmitter, error) {
	if admissions == nil || materializer == nil || transitions == nil {
		return nil, errors.New("index metadata initialization dependencies are required")
	}
	return &InitializingAdmissionSubmitter{
		admissions:   admissions,
		materializer: materializer,
		transitions:  transitions,
	}, nil
}

func (s *InitializingAdmissionSubmitter) Submit(ctx context.Context, request SubmitRequest) (AdmissionOutcome, error) {
	outcome, err := s.admissions.Submit(ctx, request)
	if err != nil {
		return AdmissionOutcome{}, err
	}
	if outcome.IndexMetaInitializedAt != nil {
		if outcome.IndexMetaInitializedAt.IsZero() {
			return AdmissionOutcome{}, errors.New("index metadata initialization timestamp is invalid")
		}
		return outcome, nil
	}

	materializationRequest := request
	materializationRequest.Inputs = request.Inputs.Clone()
	if err := s.materializer.MaterializeInitialIndexMeta(ctx, materializationRequest, cloneAdmissionOutcome(outcome)); err != nil {
		return AdmissionOutcome{}, fmt.Errorf("materialize initial index metadata: %w", err)
	}
	initializedAt, err := s.transitions.MarkIndexMetaInitialized(ctx, IndexMetaInitialization{
		ExecutionID:   outcome.ExecutionID,
		Generation:    outcome.Generation,
		MetaID:        outcome.IndexMetaID,
		CorrelationID: outcome.IndexMetaCorrelationID,
	})
	if err != nil {
		return AdmissionOutcome{}, fmt.Errorf("open index metadata dispatch gate: %w", err)
	}
	if initializedAt.IsZero() {
		return AdmissionOutcome{}, errors.New("index metadata initialization transition returned an invalid timestamp")
	}
	outcome.IndexMetaInitializedAt = &initializedAt
	return outcome, nil
}

func cloneAdmissionOutcome(outcome AdmissionOutcome) AdmissionOutcome {
	if outcome.IndexMetaInitializedAt != nil {
		value := *outcome.IndexMetaInitializedAt
		outcome.IndexMetaInitializedAt = &value
	}
	return outcome
}

var _ IndexAdmissionSubmitter = (*InitializingAdmissionSubmitter)(nil)
