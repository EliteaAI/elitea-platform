package indexing

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
)

type indexMetaMaterializerStub struct {
	mu      sync.Mutex
	request AdmissionOutcome
	inputs  AuthoritativeInputs
	err     error
	calls   atomic.Int32
	active  atomic.Int32
	maximum atomic.Int32
	block   <-chan struct{}
}

func (s *indexMetaMaterializerStub) MaterializeInitialIndexMeta(
	ctx context.Context,
	request SubmitRequest,
	outcome AdmissionOutcome,
) error {
	s.calls.Add(1)
	active := s.active.Add(1)
	defer s.active.Add(-1)
	for {
		maximum := s.maximum.Load()
		if active <= maximum || s.maximum.CompareAndSwap(maximum, active) {
			break
		}
	}
	s.mu.Lock()
	s.request = cloneAdmissionOutcome(outcome)
	s.inputs = request.Inputs.Clone()
	s.mu.Unlock()
	if s.block != nil {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-s.block:
		}
	}
	return s.err
}

type indexMetaInitializationStoreStub struct {
	mu             sync.Mutex
	work           IndexMetaInitializationWork
	pending        []IndexMetaInitializationClaim
	exactErr       error
	loadErr        error
	resolveErr     error
	initializedAt  time.Time
	resolved       int
	released       int
	quarantined    int
	lastErrorCode  string
	claimedExactID IndexMetaInitialization
}

func (s *indexMetaInitializationStoreStub) ClaimExactIndexMetaInitialization(
	_ context.Context,
	identity IndexMetaInitialization,
	token string,
	_ time.Duration,
) (IndexMetaInitializationClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimedExactID = identity
	if s.exactErr != nil {
		return IndexMetaInitializationClaim{}, s.exactErr
	}
	claim := s.work.Claim
	claim.ClaimToken = token
	s.work.Claim = claim
	return claim, nil
}

func (s *indexMetaInitializationStoreStub) ClaimPendingIndexMetaInitializations(
	_ context.Context,
	token string,
	limit int,
	_ time.Duration,
) ([]IndexMetaInitializationClaim, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if limit > len(s.pending) {
		limit = len(s.pending)
	}
	claims := append([]IndexMetaInitializationClaim(nil), s.pending[:limit]...)
	for index := range claims {
		claims[index].ClaimToken = token
	}
	return claims, nil
}

func (s *indexMetaInitializationStoreStub) LoadIndexMetaInitializationWork(
	_ context.Context,
	claim IndexMetaInitializationClaim,
) (IndexMetaInitializationWork, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loadErr != nil {
		return IndexMetaInitializationWork{}, s.loadErr
	}
	work := s.work
	work.Claim = claim
	work.Outcome.ExecutionID = claim.ExecutionID
	work.Outcome.Generation = claim.Generation
	return work, nil
}

func (s *indexMetaInitializationStoreStub) ResolveIndexMetaInitialization(
	_ context.Context,
	_ IndexMetaInitializationClaim,
) (time.Time, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resolved++
	return s.initializedAt, s.resolveErr
}

func (s *indexMetaInitializationStoreStub) ReleaseIndexMetaInitialization(
	_ context.Context,
	_ IndexMetaInitializationClaim,
	code string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.released++
	s.lastErrorCode = code
	return nil
}

func (s *indexMetaInitializationStoreStub) QuarantineIndexMetaInitialization(
	_ context.Context,
	_ IndexMetaInitializationClaim,
	code string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.quarantined++
	s.lastErrorCode = code
	return nil
}

func newTestDurableIndexMetaInitializer(
	t *testing.T,
	store *indexMetaInitializationStoreStub,
	materializer IndexMetaMaterializer,
	maxConcurrent int,
) *DurableIndexMetaInitializer {
	t.Helper()
	initializer, err := NewDurableIndexMetaInitializer(
		store,
		materializer,
		func() (string, error) { return "claim-token", nil },
		IndexMetaInitializationReconcilerConfig{
			PollInterval:  time.Millisecond,
			ClaimLease:    time.Minute,
			BatchSize:     8,
			MaxConcurrent: maxConcurrent,
			ReportFailure: func(error) {},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	initializer.now = func() time.Time {
		return time.Date(2025, time.July, 23, 9, 0, 0, 0, time.UTC)
	}
	return initializer
}

func validInitializationWork() IndexMetaInitializationWork {
	outcome := validStartAdmissionOutcome()
	outcome.IndexMetaInitializedAt = nil
	return IndexMetaInitializationWork{
		Claim: IndexMetaInitializationClaim{
			ExecutionID: outcome.ExecutionID,
			Generation:  outcome.Generation,
			ClaimToken:  "claim-token",
			Attempt:     1,
		},
		Request: SubmitRequest{
			Identity:      executionIdentityForTest(),
			CorrelationID: outcome.IndexMetaCorrelationID,
			ToolkitID:     9,
			Initiator:     "user",
			Inputs:        validStartServiceInputs(),
		},
		Outcome: outcome,
	}
}

func executionIdentityForTest() executionapp.AdmissionIdentity {
	return executionapp.AdmissionIdentity{
		TenantID: "7", ResourceProjectID: "7",
		ProjectionProjectID: "7", ActorID: "11",
	}
}

func TestInitializingAdmissionSubmitterReloadsFrozenIntentBeforeOpeningGate(
	t *testing.T,
) {
	work := validInitializationWork()
	initializedAt := time.Date(2026, time.July, 23, 9, 30, 0, 0, time.UTC)
	store := &indexMetaInitializationStoreStub{
		work:          work,
		initializedAt: initializedAt,
	}
	materializer := &indexMetaMaterializerStub{}
	initializer := newTestDurableIndexMetaInitializer(
		t,
		store,
		materializer,
		1,
	)
	submitter, err := NewInitializingAdmissionSubmitter(
		&startAdmissionStub{outcome: work.Outcome},
		initializer,
	)
	if err != nil {
		t.Fatal(err)
	}
	request := work.Request
	request.Inputs.ToolParameters = []byte(`{"index_name":"caller-drift"}`)

	got, err := submitter.Submit(context.Background(), request)
	if err != nil {
		t.Fatal(err)
	}
	if materializer.calls.Load() != 1 || store.resolved != 1 ||
		string(materializer.inputs.ToolParameters) !=
			string(work.Request.Inputs.ToolParameters) ||
		got.IndexMetaInitializedAt == nil ||
		!got.IndexMetaInitializedAt.Equal(initializedAt) {
		t.Fatalf(
			"outcome=%+v calls=%d resolved=%d inputs=%s",
			got,
			materializer.calls.Load(),
			store.resolved,
			materializer.inputs.ToolParameters,
		)
	}
}

func TestDurableIndexMetaInitializerReleasesRetryableAndQuarantinesPermanent(
	t *testing.T,
) {
	for _, test := range []struct {
		name            string
		failure         error
		wantReleased    int
		wantQuarantined int
		wantCode        string
	}{
		{
			name:         "dependency",
			failure:      ErrCurrentIndexMetaMaterializationUnavailable,
			wantReleased: 1,
			wantCode:     "INITIALIZATION_DEPENDENCY_UNAVAILABLE",
		},
		{
			name:            "frozen target invalid",
			failure:         ErrCurrentIndexMetaTargetUnavailable,
			wantQuarantined: 1,
			wantCode:        "INITIALIZATION_TARGET_INVALID",
		},
		{
			name:            "external generation superseded",
			failure:         ErrCurrentIndexMetaSuperseded,
			wantQuarantined: 1,
			wantCode:        "INITIALIZATION_EXTERNAL_SUPERSEDED",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			store := &indexMetaInitializationStoreStub{
				work:          validInitializationWork(),
				initializedAt: time.Now(),
			}
			initializer := newTestDurableIndexMetaInitializer(
				t,
				store,
				&indexMetaMaterializerStub{err: test.failure},
				1,
			)
			_, err := initializer.Initialize(
				context.Background(),
				store.work.Outcome,
			)
			if !errors.Is(err, test.failure) ||
				store.released != test.wantReleased ||
				store.quarantined != test.wantQuarantined ||
				store.lastErrorCode != test.wantCode ||
				store.resolved != 0 {
				t.Fatalf(
					"error=%v released=%d quarantined=%d code=%q resolved=%d",
					err,
					store.released,
					store.quarantined,
					store.lastErrorCode,
					store.resolved,
				)
			}
		})
	}
}

func TestDurableIndexMetaInitializerRetriesUnknownPostCommitMarkerOutcome(
	t *testing.T,
) {
	unknown := errors.New("database result unknown")
	store := &indexMetaInitializationStoreStub{
		work:          validInitializationWork(),
		initializedAt: time.Now().UTC(),
		resolveErr:    unknown,
	}
	materializer := &indexMetaMaterializerStub{}
	initializer := newTestDurableIndexMetaInitializer(
		t,
		store,
		materializer,
		1,
	)
	if _, err := initializer.Initialize(
		context.Background(),
		store.work.Outcome,
	); !errors.Is(err, unknown) {
		t.Fatalf("first error=%v", err)
	}
	store.resolveErr = nil
	if _, err := initializer.Initialize(
		context.Background(),
		store.work.Outcome,
	); err != nil {
		t.Fatal(err)
	}
	if materializer.calls.Load() != 2 || store.resolved != 2 {
		t.Fatalf(
			"idempotent external calls=%d marker attempts=%d",
			materializer.calls.Load(),
			store.resolved,
		)
	}
}

func TestDurableIndexMetaInitializerReleasesCancelledInFlightMaterialization(
	t *testing.T,
) {
	store := &indexMetaInitializationStoreStub{
		work:          validInitializationWork(),
		initializedAt: time.Now().UTC(),
	}
	materializer := &indexMetaMaterializerStub{
		block: make(chan struct{}),
	}
	initializer := newTestDurableIndexMetaInitializer(
		t,
		store,
		materializer,
		1,
	)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := initializer.Initialize(ctx, store.work.Outcome)
		done <- err
	}()
	deadline := time.After(time.Second)
	for materializer.calls.Load() == 0 {
		select {
		case <-deadline:
			t.Fatal("materializer did not enter the in-flight call")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	cancel()
	err := <-done
	if !errors.Is(err, context.Canceled) ||
		store.released != 1 ||
		store.quarantined != 0 ||
		store.lastErrorCode != "INITIALIZATION_CANCELLED" ||
		store.resolved != 0 {
		t.Fatalf(
			"error=%v released=%d quarantined=%d code=%q resolved=%d",
			err,
			store.released,
			store.quarantined,
			store.lastErrorCode,
			store.resolved,
		)
	}
}

func TestDurableIndexMetaInitializerQuarantinesExpiredAbsoluteDeadline(
	t *testing.T,
) {
	work := validInitializationWork()
	work.Outcome.AdmittedAt = time.Date(
		2025,
		time.July,
		23,
		8,
		0,
		0,
		0,
		time.UTC,
	)
	work.Outcome.Deadline = time.Date(
		2025,
		time.July,
		23,
		8,
		59,
		59,
		0,
		time.UTC,
	)
	store := &indexMetaInitializationStoreStub{
		work:          work,
		initializedAt: time.Now().UTC(),
	}
	materializer := &indexMetaMaterializerStub{}
	initializer := newTestDurableIndexMetaInitializer(
		t,
		store,
		materializer,
		1,
	)
	_, err := initializer.Initialize(context.Background(), work.Outcome)
	if !errors.Is(err, context.DeadlineExceeded) ||
		materializer.calls.Load() != 0 ||
		store.released != 0 ||
		store.quarantined != 1 ||
		store.lastErrorCode != "INITIALIZATION_DEADLINE_EXCEEDED" ||
		store.resolved != 0 {
		t.Fatalf(
			"error=%v calls=%d released=%d quarantined=%d code=%q resolved=%d",
			err,
			materializer.calls.Load(),
			store.released,
			store.quarantined,
			store.lastErrorCode,
			store.resolved,
		)
	}
}

func TestDurableIndexMetaInitializerBoundsRecoveryConcurrency(t *testing.T) {
	work := validInitializationWork()
	claims := make([]IndexMetaInitializationClaim, 6)
	for index := range claims {
		claims[index] = work.Claim
		claims[index].ExecutionID += string(rune('a' + index))
	}
	release := make(chan struct{})
	store := &indexMetaInitializationStoreStub{
		work:          work,
		pending:       claims,
		initializedAt: time.Now().UTC(),
	}
	materializer := &indexMetaMaterializerStub{block: release}
	initializer := newTestDurableIndexMetaInitializer(
		t,
		store,
		materializer,
		2,
	)
	done := make(chan error, 1)
	go func() {
		_, err := initializer.Reconcile(context.Background())
		done <- err
	}()
	deadline := time.After(time.Second)
	for materializer.calls.Load() < 2 {
		select {
		case <-deadline:
			t.Fatal("bounded workers did not start")
		default:
			time.Sleep(time.Millisecond)
		}
	}
	if got := materializer.maximum.Load(); got != 2 {
		t.Fatalf("maximum concurrency=%d want=2", got)
	}
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if got := materializer.maximum.Load(); got > 2 {
		t.Fatalf("maximum concurrency=%d exceeded bound", got)
	}
}
