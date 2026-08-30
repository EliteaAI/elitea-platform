package overhead

// overhead_test.go — unit tests for the context-carried overhead Meter
// (issue #17). The context round-trip runs against the REAL
// *schemas.BifrostContext, because that is the type bifrost/core hands to
// account.GetKeysForProvider; a test against a hand-rolled context would pass
// while the production seam stayed broken.

import (
	"context"
	"sync"
	"testing"
	"time"

	"github.com/maximhq/bifrost/core/schemas"
)

// TestAttach_RoundTripsThroughBifrostContext asserts a Meter attached to a
// BifrostContext comes back from a plain context.Context read — the shape
// GetKeysForProvider uses.
func TestAttach_RoundTripsThroughBifrostContext(t *testing.T) {
	bc := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	m := Attach(bc, time.Now())
	if m == nil {
		t.Fatal("Attach returned nil")
	}

	var ctx context.Context = bc
	if got := FromContext(ctx); got != m {
		t.Fatalf("FromContext returned %p, want the attached Meter %p", got, m)
	}
}

// TestFromContext_AbsentMeterIsNil asserts a context with no Meter yields nil,
// and that a nil Meter answers every method safely.
func TestFromContext_AbsentMeterIsNil(t *testing.T) {
	if got := FromContext(context.Background()); got != nil {
		t.Fatalf("FromContext on a bare context = %p, want nil", got)
	}
	//nolint:staticcheck // the nil-context branch is a guard this test pins.
	if got := FromContext(nil); got != nil {
		t.Fatalf("FromContext(nil) = %p, want nil", got)
	}

	var m *Meter
	m.MarkCredentialsResolved() // must not panic
	if got := m.Overhead(7 * time.Millisecond); got != 7*time.Millisecond {
		t.Fatalf("nil Meter Overhead = %v, want the pre-dispatch value", got)
	}
}

// TestMeter_NoMarkReportsPreDispatch asserts an unmarked Meter reports the
// handler's pre-dispatch snapshot. That is the fallback for a request that
// resolves no credential (direct key, plugin short-circuit).
func TestMeter_NoMarkReportsPreDispatch(t *testing.T) {
	m := New(time.Now())
	if got := m.Overhead(3 * time.Millisecond); got != 3*time.Millisecond {
		t.Fatalf("Overhead = %v, want 3ms (no mark)", got)
	}
}

// TestMeter_MarkCountsTimeSinceStart asserts the mark measures from the start
// the handler gave, and not from the moment of the mark.
func TestMeter_MarkCountsTimeSinceStart(t *testing.T) {
	m := New(time.Now())
	time.Sleep(20 * time.Millisecond)
	m.MarkCredentialsResolved()

	got := m.Overhead(0)
	if got < 15*time.Millisecond {
		t.Fatalf("Overhead = %v, want at least the 20ms that elapsed before the mark", got)
	}
}

// TestMeter_KeepsEarliestMark asserts a later mark loses. bifrost calls
// GetKeysForProvider again for a retry or a fallback, AFTER a provider
// round-trip; that second mark must not put provider time in the metric.
func TestMeter_KeepsEarliestMark(t *testing.T) {
	m := New(time.Now())
	m.MarkCredentialsResolved()
	first := m.Overhead(0)

	time.Sleep(30 * time.Millisecond)
	m.MarkCredentialsResolved() // the "retry after a provider call" mark

	if got := m.Overhead(0); got != first {
		t.Fatalf("Overhead = %v after a later mark, want the first mark %v", got, first)
	}
}

// TestMeter_OverheadNeverBelowPreDispatch asserts the reported value never
// falls under what the handler already measured itself.
func TestMeter_OverheadNeverBelowPreDispatch(t *testing.T) {
	m := New(time.Now())
	m.MarkCredentialsResolved()
	if got := m.Overhead(time.Second); got != time.Second {
		t.Fatalf("Overhead = %v, want the larger pre-dispatch value 1s", got)
	}
}

// TestMeter_ConcurrentMarksAreRaceFree drives the accumulator the way bifrost
// can: many goroutines resolve credentials for one request (fallback providers,
// retries). Run under -race; the assertions bound the result as well.
func TestMeter_ConcurrentMarksAreRaceFree(t *testing.T) {
	start := time.Now()
	m := New(start)

	const goroutines = 64
	var wg sync.WaitGroup
	begin := make(chan struct{})
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-begin
			m.MarkCredentialsResolved()
			_ = m.Overhead(0) // concurrent readers too
		}()
	}
	close(begin)
	wg.Wait()

	total := time.Since(start)
	got := m.Overhead(0)
	if got <= 0 {
		t.Fatal("Overhead = 0 after 64 concurrent marks, want a recorded mark")
	}
	if got > total {
		t.Fatalf("Overhead = %v, greater than the %v the whole test took", got, total)
	}
}
