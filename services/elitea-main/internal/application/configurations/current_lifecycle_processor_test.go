package configurations

import (
	"context"
	"crypto/sha256"
	"errors"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestCurrentConfigurationLifecycleProcessorReconcilesAndFencesBatch(t *testing.T) {
	store := &currentLifecycleStoreStub{events: []CurrentConfigurationLifecycleEvent{
		currentLifecycleTestEvent(t, "event-1", 1),
		currentLifecycleTestEvent(t, "event-2", 1),
	}}
	reconciler := &currentLifecycleReconcilerStub{result: CurrentConfigurationLifecycleReconcileResult{
		Disposition: CurrentConfigurationLifecycleReconciled,
	}}
	processor := currentLifecycleTestProcessor(t, store, reconciler)
	if err := processor.RunOnce(context.Background()); err != nil {
		t.Fatal(err)
	}
	if store.claimLease != "lease-1" || store.claimLimit != 2 || store.claimTTL != 30*time.Second {
		t.Fatalf("claim lease=%q limit=%d ttl=%s", store.claimLease, store.claimLimit, store.claimTTL)
	}
	sort.Strings(store.delivered)
	if !reflect.DeepEqual(store.delivered, []string{"event-1@lease-1", "event-2@lease-1"}) {
		t.Fatalf("delivered = %#v", store.delivered)
	}
	if reconciler.calls != 2 {
		t.Fatalf("reconciler calls = %d", reconciler.calls)
	}
}

func TestCurrentConfigurationLifecycleProcessorRetriesWithoutLeakingError(t *testing.T) {
	store := &currentLifecycleStoreStub{events: []CurrentConfigurationLifecycleEvent{
		currentLifecycleTestEvent(t, "event-secret", 3),
	}}
	reconciler := &currentLifecycleReconcilerStub{err: errors.New("provider returned credential=do-not-log")}
	processor := currentLifecycleTestProcessor(t, store, reconciler)
	err := processor.RunOnce(context.Background())
	if err == nil || strings.Contains(err.Error(), "credential") || strings.Contains(err.Error(), "do-not-log") {
		t.Fatalf("processor error = %v", err)
	}
	if !reflect.DeepEqual(store.retried, []string{"event-secret@lease-1@RECONCILE_FAILED@4s"}) {
		t.Fatalf("retried = %#v", store.retried)
	}
}

func TestCurrentConfigurationLifecycleProcessorDeadLettersInvalidSnapshot(t *testing.T) {
	event := currentLifecycleTestEvent(t, "event-invalid", 1)
	event.Snapshot = append(event.Snapshot, 'x')
	store := &currentLifecycleStoreStub{events: []CurrentConfigurationLifecycleEvent{event}}
	processor := currentLifecycleTestProcessor(t, store, &currentLifecycleReconcilerStub{})
	err := processor.RunOnce(context.Background())
	if err == nil || !reflect.DeepEqual(store.dead, []string{"event-invalid@lease-1@SNAPSHOT_INVALID"}) {
		t.Fatalf("error=%v dead=%#v", err, store.dead)
	}
}

func TestCurrentConfigurationLifecycleProcessorExhaustsRetries(t *testing.T) {
	event := currentLifecycleTestEvent(t, "event-exhausted", 5)
	store := &currentLifecycleStoreStub{events: []CurrentConfigurationLifecycleEvent{event}}
	reconciler := &currentLifecycleReconcilerStub{result: CurrentConfigurationLifecycleReconcileResult{
		Disposition: CurrentConfigurationLifecycleRetry,
		ErrorCode:   "LITELLM_UNAVAILABLE",
	}}
	processor := currentLifecycleTestProcessor(t, store, reconciler)
	processor.config.MaxAttempts = 5
	if err := processor.RunOnce(context.Background()); err == nil {
		t.Fatal("RunOnce() error = nil")
	}
	if !reflect.DeepEqual(store.dead, []string{"event-exhausted@lease-1@RETRY_EXHAUSTED"}) {
		t.Fatalf("dead = %#v", store.dead)
	}
}

func TestCurrentConfigurationLifecycleRetryDelayIsBounded(t *testing.T) {
	if got := currentConfigurationLifecycleRetryDelay(time.Second, 1); got != time.Second {
		t.Fatalf("attempt 1 delay = %s", got)
	}
	if got := currentConfigurationLifecycleRetryDelay(time.Second, 4); got != 8*time.Second {
		t.Fatalf("attempt 4 delay = %s", got)
	}
	if got := currentConfigurationLifecycleRetryDelay(time.Minute, 100); got != MaxCurrentConfigurationLifecycleRetryDelay {
		t.Fatalf("bounded delay = %s", got)
	}
}

func currentLifecycleTestProcessor(
	t *testing.T,
	store *currentLifecycleStoreStub,
	reconciler CurrentConfigurationLifecycleReconciler,
) *CurrentConfigurationLifecycleProcessor {
	t.Helper()
	processor, err := NewCurrentConfigurationLifecycleProcessor(
		store,
		reconciler,
		func() (string, error) { return "lease-1", nil },
		CurrentConfigurationLifecycleProcessorConfig{
			PollInterval:  100 * time.Millisecond,
			LeaseTTL:      30 * time.Second,
			RetryBase:     time.Second,
			BatchSize:     2,
			MaxConcurrent: 2,
			MaxAttempts:   5,
			ReportFailure: func(error) {},
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	return processor
}

func currentLifecycleTestEvent(t *testing.T, eventID string, attempt int) CurrentConfigurationLifecycleEvent {
	t.Helper()
	intent := CurrentConfigurationLifecycleIntent{
		ID:        eventID,
		Operation: CurrentConfigurationCreated,
		ActorID:   13,
		After: &CurrentConfigurationLifecycleSnapshot{
			ID: 9, UUID: "configuration-uuid", ProjectID: 7,
			EliteaTitle: "title", Type: "open_ai", Section: "ai_credentials",
			StatusOK: false, Source: CurrentConfigurationSourceUser,
		},
	}
	snapshot, err := EncodeCurrentConfigurationLifecycleIntent(intent)
	if err != nil {
		t.Fatal(err)
	}
	return CurrentConfigurationLifecycleEvent{
		EventID: eventID, ProjectID: 7, ConfigurationUUID: "configuration-uuid",
		Revision: 1, Operation: CurrentConfigurationCreated, ActorID: 13,
		Snapshot: snapshot, SnapshotDigest: sha256.Sum256(snapshot), AttemptCount: attempt,
		LeaseToken: "lease-1",
	}
}

type currentLifecycleStoreStub struct {
	mu         sync.Mutex
	events     []CurrentConfigurationLifecycleEvent
	claimLease string
	claimLimit int
	claimTTL   time.Duration
	delivered  []string
	retried    []string
	dead       []string
}

func (s *currentLifecycleStoreStub) ClaimCurrentConfigurationLifecycle(
	_ context.Context,
	lease string,
	limit int,
	ttl time.Duration,
) ([]CurrentConfigurationLifecycleEvent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.claimLease, s.claimLimit, s.claimTTL = lease, limit, ttl
	result := make([]CurrentConfigurationLifecycleEvent, len(s.events))
	copy(result, s.events)
	for index := range result {
		result[index].LeaseToken = lease
	}
	return result, nil
}

func (s *currentLifecycleStoreStub) MarkCurrentConfigurationLifecycleDelivered(
	_ context.Context, eventID, lease string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.delivered = append(s.delivered, eventID+"@"+lease)
	return nil
}

func (s *currentLifecycleStoreStub) MarkCurrentConfigurationLifecycleRetry(
	_ context.Context, eventID, lease, code string, delay time.Duration,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.retried = append(s.retried, eventID+"@"+lease+"@"+code+"@"+delay.String())
	return nil
}

func (s *currentLifecycleStoreStub) MarkCurrentConfigurationLifecycleDead(
	_ context.Context, eventID, lease, code string,
) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.dead = append(s.dead, eventID+"@"+lease+"@"+code)
	return nil
}

type currentLifecycleReconcilerStub struct {
	mu     sync.Mutex
	calls  int
	result CurrentConfigurationLifecycleReconcileResult
	err    error
}

func (r *currentLifecycleReconcilerStub) ReconcileCurrentConfigurationLifecycle(
	_ context.Context,
	_ CurrentConfigurationLifecycleEvent,
	_ CurrentConfigurationLifecycleIntent,
) (CurrentConfigurationLifecycleReconcileResult, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls++
	return r.result, r.err
}
