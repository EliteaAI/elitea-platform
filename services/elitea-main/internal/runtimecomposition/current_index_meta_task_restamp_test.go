package runtimecomposition

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
)

type taskRestamperStub struct {
	mu     sync.Mutex
	errors map[string]error
	calls  []string
}

func (s *taskRestamperStub) Restamp(
	_ context.Context,
	request indexingapp.CurrentIndexMetaTaskRestampRequest,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, request.ExecutionID)
	return s.errors[request.ExecutionID]
}

type taskRestampStoreStub struct {
	mu          sync.Mutex
	pending     []indexingapp.CurrentIndexMetaTaskRestampClaim
	superseded  map[string]bool
	resolutions map[string]indexingapp.CurrentIndexMetaTaskRestampResolution
	releases    map[string]string
	claimLimit  int
}

func (s *taskRestampStoreStub) ClaimPendingTaskRestamps(
	_ context.Context,
	token string,
	limit int,
	_ time.Duration,
) ([]indexingapp.CurrentIndexMetaTaskRestampClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimLimit = limit
	count := min(limit, len(s.pending))
	claims := append(
		[]indexingapp.CurrentIndexMetaTaskRestampClaim(nil),
		s.pending[:count]...,
	)
	for index := range claims {
		claims[index].ClaimToken = token
	}
	return claims, nil
}

func (s *taskRestampStoreStub) SupersedeTaskRestampIfNewerInitialized(
	_ context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.superseded[claim.ExecutionID], nil
}

func (s *taskRestampStoreStub) ResolveTaskRestamp(
	_ context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
	resolution indexingapp.CurrentIndexMetaTaskRestampResolution,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolutions[claim.ExecutionID] = resolution
	return nil
}

func (s *taskRestampStoreStub) ReleaseTaskRestamp(
	_ context.Context,
	claim indexingapp.CurrentIndexMetaTaskRestampClaim,
	errorCode string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.releases[claim.ExecutionID] = errorCode
	return nil
}

func TestCurrentIndexMetaTaskRestampProcessorRetriesFaultAndContinuesBatch(t *testing.T) {
	first := validTaskRestampClaim("execution-1")
	second := validTaskRestampClaim("execution-2")
	third := validTaskRestampClaim("execution-3")
	store := &taskRestampStoreStub{
		pending:     []indexingapp.CurrentIndexMetaTaskRestampClaim{first, second, third},
		superseded:  map[string]bool{"execution-3": true},
		resolutions: make(map[string]indexingapp.CurrentIndexMetaTaskRestampResolution),
		releases:    make(map[string]string),
	}
	restamper := &taskRestamperStub{
		errors: map[string]error{
			"execution-1": indexingapp.ErrCurrentIndexMetaMaterializationUnavailable,
		},
	}
	var reportedMu sync.Mutex
	var reported []error
	processor := &currentIndexMetaTaskRestampProcessor{
		restamper:   restamper,
		store:       store,
		newClaimID:  func() (string, error) { return "claim-1", nil },
		claimLease:  time.Minute,
		concurrency: 2,
		reportItemFailure: func(err error) {
			reportedMu.Lock()
			defer reportedMu.Unlock()
			reported = append(reported, err)
		},
	}
	count, err := processor.ReconcilePendingTaskRestamps(
		context.Background(),
		8,
	)
	if err != nil || count != 3 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	store.mu.Lock()
	defer store.mu.Unlock()
	if store.releases["execution-1"] != "DEPENDENCY_UNAVAILABLE" ||
		store.resolutions["execution-2"] !=
			indexingapp.CurrentIndexMetaTaskRestampApplied ||
		store.resolutions["execution-3"] != "" {
		t.Fatalf(
			"releases=%v resolutions=%v",
			store.releases,
			store.resolutions,
		)
	}
	if store.claimLimit != 4 {
		t.Fatalf("claim limit=%d, want 4", store.claimLimit)
	}
	reportedMu.Lock()
	defer reportedMu.Unlock()
	if len(reported) != 1 {
		t.Fatalf("reported faults=%d", len(reported))
	}
}

func TestCurrentIndexMetaTaskRestampConcurrencyFollowsEffectPoolCapacity(
	t *testing.T,
) {
	for _, test := range []struct {
		maxConnections int32
		want           int
		wantError      bool
	}{
		{maxConnections: 0, wantError: true},
		{maxConnections: 1, want: 1},
		{maxConnections: 2, want: 2},
		{maxConnections: 8, want: 2},
	} {
		got, err := currentIndexMetaTaskRestampConcurrency(
			test.maxConnections,
		)
		if (err != nil) != test.wantError {
			t.Fatalf(
				"max connections %d: error=%v, want error=%v",
				test.maxConnections,
				err,
				test.wantError,
			)
		}
		if got != test.want {
			t.Fatalf(
				"max connections %d: concurrency=%d, want=%d",
				test.maxConnections,
				got,
				test.want,
			)
		}
	}
}

func TestCurrentIndexMetaTaskRestampClaimBatchTracksConcurrency(t *testing.T) {
	for _, concurrency := range []int{1, 2} {
		store := &taskRestampStoreStub{
			superseded:  make(map[string]bool),
			resolutions: make(map[string]indexingapp.CurrentIndexMetaTaskRestampResolution),
			releases:    make(map[string]string),
		}
		processor := &currentIndexMetaTaskRestampProcessor{
			restamper:         &taskRestamperStub{},
			store:             store,
			newClaimID:        func() (string, error) { return "claim-1", nil },
			claimLease:        time.Minute,
			concurrency:       concurrency,
			reportItemFailure: func(error) {},
		}
		count, err := processor.ReconcilePendingTaskRestamps(
			context.Background(),
			8,
		)
		if err != nil || count != 0 {
			t.Fatalf(
				"concurrency=%d count=%d err=%v",
				concurrency,
				count,
				err,
			)
		}
		if store.claimLimit != 2*concurrency {
			t.Fatalf(
				"concurrency=%d claim limit=%d",
				concurrency,
				store.claimLimit,
			)
		}
	}
}

func TestCurrentIndexMetaTaskRestampProcessorResolvesExternalSupersession(t *testing.T) {
	claim := validTaskRestampClaim("execution-1")
	store := &taskRestampStoreStub{
		pending:     []indexingapp.CurrentIndexMetaTaskRestampClaim{claim},
		superseded:  make(map[string]bool),
		resolutions: make(map[string]indexingapp.CurrentIndexMetaTaskRestampResolution),
		releases:    make(map[string]string),
	}
	restamper := &taskRestamperStub{
		errors: map[string]error{
			"execution-1": indexingapp.ErrCurrentIndexMetaSuperseded,
		},
	}
	processor := &currentIndexMetaTaskRestampProcessor{
		restamper:         restamper,
		store:             store,
		newClaimID:        func() (string, error) { return "claim-1", nil },
		claimLease:        time.Minute,
		concurrency:       1,
		reportItemFailure: func(error) {},
	}
	count, err := processor.ReconcilePendingTaskRestamps(
		context.Background(),
		1,
	)
	if err != nil || count != 1 {
		t.Fatalf("count=%d err=%v", count, err)
	}
	if store.resolutions["execution-1"] !=
		indexingapp.CurrentIndexMetaTaskRestampSuperseded {
		t.Fatalf("resolution=%v", store.resolutions)
	}
}

type taskRestampReconciliationStub struct {
	err   error
	calls int
}

func (s *taskRestampReconciliationStub) ReconcilePendingTaskRestamps(
	_ context.Context,
	_ int,
) (int, error) {
	s.calls++
	return 0, s.err
}

func TestCurrentIndexMetaTaskRestampReconcilerIsBoundedAndCancellationAware(t *testing.T) {
	service := &taskRestampReconciliationStub{
		err: errors.New("dependency unavailable"),
	}
	reconciler, err := newCurrentIndexMetaTaskRestampReconciler(
		service,
		time.Millisecond,
		8,
		func(error) {},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := reconciler.RunOnce(context.Background()); err == nil ||
		service.calls != 1 {
		t.Fatalf("run once calls=%d err=%v", service.calls, err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if err := reconciler.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
}

func validTaskRestampClaim(
	executionID string,
) indexingapp.CurrentIndexMetaTaskRestampClaim {
	return indexingapp.CurrentIndexMetaTaskRestampClaim{
		CurrentIndexMetaTaskRestampRequest: indexingapp.CurrentIndexMetaTaskRestampRequest{
			ExecutionID:   executionID,
			Generation:    1,
			SourceEventID: "command-1:1",
			OccurredAt:    time.Date(2026, time.July, 27, 10, 0, 0, 0, time.UTC),
			CreatedOn:     1_700_000_000.25,
		},
		ClaimToken: "placeholder",
	}
}
