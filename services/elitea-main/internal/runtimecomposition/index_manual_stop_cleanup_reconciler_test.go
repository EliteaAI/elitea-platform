package runtimecomposition

import (
	"context"
	"errors"
	"testing"
	"time"
)

type currentManualStopCleanupReconciliationStub struct {
	errors []error
	calls  int
}

func (s *currentManualStopCleanupReconciliationStub) ReconcilePendingManualStopCleanups(
	_ context.Context,
	_ int,
) (int, error) {
	s.calls++
	if len(s.errors) == 0 {
		return 0, nil
	}
	err := s.errors[0]
	s.errors = s.errors[1:]
	return 1, err
}

func TestCurrentManualStopCleanupReconcilerBacksOffAndStops(t *testing.T) {
	dependencyErr := errors.New("project PgVector unavailable")
	service := &currentManualStopCleanupReconciliationStub{
		errors: []error{dependencyErr, dependencyErr, nil},
	}
	reconciler, err := newCurrentIndexManualStopCleanupReconciler(
		service,
		10*time.Millisecond,
		4,
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
		t.Fatalf("delays=%v want=%v", delays, want)
	}
	for index := range want {
		if delays[index] != want[index] {
			t.Fatalf("delays=%v want=%v", delays, want)
		}
	}
}
