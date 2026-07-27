package runtimecomposition

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

type executionReplayPrunerStub struct {
	mu      sync.Mutex
	errors  []error
	calls   int
	started chan struct{}
	release chan struct{}
}

func (s *executionReplayPrunerStub) PruneExpiredReplayProgress(ctx context.Context) (int64, error) {
	s.mu.Lock()
	s.calls++
	var err error
	if len(s.errors) > 0 {
		err = s.errors[0]
		s.errors = s.errors[1:]
	}
	started := s.started
	release := s.release
	s.mu.Unlock()
	if started != nil {
		select {
		case started <- struct{}{}:
		default:
		}
	}
	if release != nil {
		select {
		case <-release:
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	}
	return 1, err
}

func (s *executionReplayPrunerStub) callCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.calls
}

func TestExecutionReplayRetentionJanitorReportsFailureAndContinues(t *testing.T) {
	dependencyErr := errors.New("PostgreSQL replay maintenance unavailable")
	pruner := &executionReplayPrunerStub{errors: []error{dependencyErr, nil}}
	var reported []error
	janitor, err := newExecutionReplayRetentionJanitor(
		pruner,
		time.Minute,
		func(err error) { reported = append(reported, err) },
	)
	if err != nil {
		t.Fatal(err)
	}
	var waits int
	janitor.wait = func(_ context.Context, delay time.Duration) error {
		if delay != time.Minute {
			t.Fatalf("poll delay=%s", delay)
		}
		waits++
		if waits == 2 {
			return context.Canceled
		}
		return nil
	}
	if err := janitor.Run(context.Background()); !errors.Is(err, context.Canceled) {
		t.Fatalf("Run error=%v", err)
	}
	if pruner.callCount() != 2 || len(reported) != 1 || !errors.Is(reported[0], dependencyErr) {
		t.Fatalf("calls=%d reported=%v", pruner.callCount(), reported)
	}
}

func TestExecutionReplayRetentionJanitorDoesNotOverlapAndCancelsActivePass(t *testing.T) {
	pruner := &executionReplayPrunerStub{
		started: make(chan struct{}, 2),
		release: make(chan struct{}),
	}
	janitor, err := newExecutionReplayRetentionJanitor(
		pruner,
		time.Millisecond,
		func(error) {},
	)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- janitor.Run(ctx) }()
	select {
	case <-pruner.started:
	case <-time.After(time.Second):
		t.Fatal("janitor did not start its first pass")
	}
	select {
	case <-pruner.started:
		t.Fatal("janitor overlapped a second pass")
	case <-time.After(20 * time.Millisecond):
	}
	cancel()
	select {
	case err := <-done:
		if !errors.Is(err, context.Canceled) {
			t.Fatalf("Run error=%v", err)
		}
	case <-time.After(time.Second):
		t.Fatal("janitor did not stop after cancellation")
	}
	if pruner.callCount() != 1 {
		t.Fatalf("calls=%d", pruner.callCount())
	}
}

func TestExecutionReplayRetentionJanitorRejectsIncompleteComposition(t *testing.T) {
	pruner := &executionReplayPrunerStub{}
	tests := []struct {
		pruner   executionReplayProgressPruner
		interval time.Duration
		reporter func(error)
	}{
		{interval: time.Minute, reporter: func(error) {}},
		{pruner: pruner, reporter: func(error) {}},
		{pruner: pruner, interval: time.Minute},
	}
	for _, test := range tests {
		if janitor, err := newExecutionReplayRetentionJanitor(
			test.pruner,
			test.interval,
			test.reporter,
		); err == nil || janitor != nil {
			t.Fatalf("janitor=%#v error=%v", janitor, err)
		}
	}
}
