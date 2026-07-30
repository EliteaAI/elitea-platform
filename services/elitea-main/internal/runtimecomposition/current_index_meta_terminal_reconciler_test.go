package runtimecomposition

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type currentIndexMetaTerminalReconciliationStub struct {
	mu        sync.Mutex
	errors    []error
	calls     int
	callReady chan struct{}
}

func (s *currentIndexMetaTerminalReconciliationStub) ReconcilePendingIndexMetaTerminals(
	_ context.Context,
	_ int,
) (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls++
	if s.callReady != nil {
		select {
		case s.callReady <- struct{}{}:
		default:
		}
	}
	if len(s.errors) == 0 {
		return 0, nil
	}
	err := s.errors[0]
	s.errors = s.errors[1:]
	return 1, err
}

func TestCurrentIndexMetaTerminalReconcilerBacksOffIndependently(t *testing.T) {
	dependencyErr := errors.New("tenant pgvector unavailable")
	service := &currentIndexMetaTerminalReconciliationStub{
		errors: []error{dependencyErr, dependencyErr, nil},
	}
	reconciler, err := newCurrentIndexMetaTerminalReconciler(
		service,
		10*time.Millisecond,
		8,
		func(error) {},
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	var delays []time.Duration
	reconciler.wait = func(_ context.Context, delay time.Duration) error {
		delays = append(delays, delay)
		if len(delays) == 3 {
			cancel()
			return context.Canceled
		}
		return nil
	}
	if err := reconciler.Run(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v", err)
	}
	want := []time.Duration{
		10 * time.Millisecond,
		20 * time.Millisecond,
		10 * time.Millisecond,
	}
	if len(delays) != len(want) {
		t.Fatalf("delays=%v", delays)
	}
	for index := range want {
		if delays[index] != want[index] {
			t.Fatalf("delays=%v want=%v", delays, want)
		}
	}
}

type liveDispatchRunner struct {
	cycles chan struct{}
}

func (r *liveDispatchRunner) Run(ctx context.Context) error {
	for {
		select {
		case r.cycles <- struct{}{}:
		case <-ctx.Done():
			return ctx.Err()
		}
		select {
		case <-time.After(time.Millisecond):
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

func TestCurrentIndexMetaPoisonTenantCannotBlockLiveDispatchRunner(t *testing.T) {
	service := &currentIndexMetaTerminalReconciliationStub{
		errors:    []error{errors.New("poison tenant")},
		callReady: make(chan struct{}, 1),
	}
	reconciler, err := newCurrentIndexMetaTerminalReconciler(
		service,
		time.Second,
		8,
		func(error) {},
	)
	if err != nil {
		t.Fatal(err)
	}
	reconciler.wait = func(ctx context.Context, _ time.Duration) error {
		<-ctx.Done()
		return ctx.Err()
	}
	dispatch := &liveDispatchRunner{cycles: make(chan struct{}, 4)}
	runners, err := newPublisherSet(dispatch, reconciler)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- runners.Run(ctx) }()

	select {
	case <-service.callReady:
	case <-time.After(time.Second):
		t.Fatal("terminal reconciler did not encounter poison tenant")
	}
	for range 2 {
		select {
		case <-dispatch.cycles:
		case <-time.After(time.Second):
			t.Fatal("live dispatch stopped behind terminal reconciliation")
		}
	}
	cancel()
	if err := <-done; !errors.Is(err, context.Canceled) {
		t.Fatalf("error=%v", err)
	}
}
