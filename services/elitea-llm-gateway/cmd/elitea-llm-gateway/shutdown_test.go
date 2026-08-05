package main

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
)

// recordingLifecycle records the shutdown calls in the order they actually
// execute, so the sequence can be asserted behaviourally rather than by
// comparing byte offsets in main.go's source.
//
// The textual guard this replaces shipped in the same commit as a live ordering
// regression it structurally could not see: it compared strings.Index positions,
// so it could not observe the os.Exit(1) that sat between two of the calls, and
// a comment merely mentioning a call name was enough for a false pass. This is
// the fourth recurrence of the wiring bug class; the guard has to execute the
// path, not read it.
type recordingLifecycle struct {
	mu    sync.Mutex
	calls []string
	// httpErr is returned by ShutdownHTTP to exercise the error path.
	httpErr error
}

func (r *recordingLifecycle) record(name string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, name)
}

func (r *recordingLifecycle) StopStreamGrace() { r.record("StopStreamGrace") }
func (r *recordingLifecycle) DrainBilling()    { r.record("DrainBilling") }
func (r *recordingLifecycle) Drain()           { r.record("govDrain") }
func (r *recordingLifecycle) Close()           { r.record("Close") }
func (r *recordingLifecycle) ShutdownHTTP(context.Context) error {
	r.record("ShutdownHTTP")
	return r.httpErr
}

func (r *recordingLifecycle) sequence() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return strings.Join(r.calls, " -> ")
}

// TestShutdownSequence pins the ONE ordering in which no spend is lost.
//
// Every constraint here was learned from a live defect:
//   - StopStreamGrace first, or the stream grace extends the pod's termination
//     window (issue #9).
//   - ShutdownHTTP before the billing drain, or billingClosing is set while SSE
//     handlers are still live and a drain holding a recovered usage trailer has
//     its increment refused (review round 1, reproduced).
//   - The billing/governance drains before Close, or every increment they were
//     moved to preserve lands on a closed NATS connection and diverts to the
//     outage-delta path (review round 2, reproduced).
func TestShutdownSequence(t *testing.T) {
	r := &recordingLifecycle{}
	if err := shutdownSequence(context.Background(), r, r, r, r); err != nil {
		t.Fatalf("shutdownSequence: %v", err)
	}
	const want = "StopStreamGrace -> ShutdownHTTP -> DrainBilling -> govDrain -> Close"
	if got := r.sequence(); got != want {
		t.Errorf("shutdown sequence =\n  %s\nwant\n  %s", got, want)
	}
}

// TestShutdownSequence_DrainsRunEvenWhenHTTPShutdownFails is the regression
// guard for the os.Exit(1) that review round 2 found sitting between the HTTP
// drain and the billing drain: a shutdown that times out is exactly when
// in-flight spend is most likely to be pending, so bailing out early drops it.
func TestShutdownSequence_DrainsRunEvenWhenHTTPShutdownFails(t *testing.T) {
	r := &recordingLifecycle{httpErr: errors.New("drain deadline exceeded")}

	err := shutdownSequence(context.Background(), r, r, r, r)
	if err == nil {
		t.Error("shutdownSequence swallowed the HTTP shutdown error; the caller must still see it")
	}
	const want = "StopStreamGrace -> ShutdownHTTP -> DrainBilling -> govDrain -> Close"
	if got := r.sequence(); got != want {
		t.Errorf("after a failed HTTP shutdown the sequence =\n  %s\nwant\n  %s\n"+
			"(the billing and governance drains MUST still run — a timed-out drain is when "+
			"pending spend is most likely, not least)", got, want)
	}
}
