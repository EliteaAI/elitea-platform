package failmode

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/sony/gobreaker/v2"
)

// sweep_test.go covers issue #515: the recovery pass that no breaker edge asks
// for, and the gauge that reports the rows it has not cleared.
//
// The defect it guards is exact. The outage branch is taken on ONE failed
// counter operation, because internal/infra/nats mapErr turns
// context.DeadlineExceeded into ErrUnavailable. One failure does not reach the
// breaker's consecutive-failure threshold, so the breaker stays CLOSED, so no
// open→closed edge follows, so HandleBreakerChange never runs and the row this
// gateway marked outage-owned is never handed back to the write-back consumer.
// Every later delta for that (scope, scope_id, period) is deferred, and the
// durable spend for that scope stops advancing for the rest of the period.

// TestHandleBreakerChange_NoEdgeForSingleFailure states the premise of the fix
// in the reconciler's own terms: no state change means no pass, whatever the
// current state is. It is the reason a timer is needed at all.
func TestHandleBreakerChange_NoEdgeForSingleFailure(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
	}
	c := newFakeCounter()
	r := NewReconciler(db, c, NewDegradedCounters(), nil)
	r.sweepInterval = 0 // no timer here; this test is about the edge alone
	r.Start(context.Background())

	// A failed operation that leaves the breaker CLOSED produces no transition,
	// so the only signal the reconciler had before #515 is never delivered.
	// closed→closed is what "nothing happened" looks like to the callback.
	r.HandleBreakerChange(gobreaker.StateClosed, gobreaker.StateClosed)
	time.Sleep(30 * time.Millisecond)

	if len(db.finalized) != 0 {
		t.Fatalf("a pass ran without a recovery edge: finalized=%v", db.finalized)
	}
}

// TestSweep_ClearsRowWithNoBreakerEdge is the fix: the same wedged row, no
// breaker edge at all, and the sweep hands it back.
func TestSweep_ClearsRowWithNoBreakerEdge(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
		outageCount:   1,
	}
	c := newFakeCounter()
	c.totals["project.7"] = 30
	dc := NewDegradedCounters()
	dc.Add("project.7", 999)

	r := NewReconciler(db, c, dc, nil)
	r.sweepInterval = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	waitFor(t, time.Second, func() bool {
		db.mu.Lock()
		defer db.mu.Unlock()
		return len(db.finalized) == 1
	}, "sweep did not finalize the outage row")

	if db.finalized[0] != "r1" {
		t.Fatalf("finalized %v, want r1", db.finalized)
	}
	// The outage spend reached the recovered counter: PG 50 − NATS 30 = 20.
	if len(c.incrs) != 1 || c.incrs[0].delta != 20 {
		t.Fatalf("replay incr = %+v, want one of 20", c.incrs)
	}
	// A reconciled scope stands its per-replica cap down, exactly as the edge
	// pass does for the scopes it reconciles.
	if dc.Get("project.7") != 0 {
		t.Fatalf("degraded counter = %d, want 0", dc.Get("project.7"))
	}
}

// TestSweep_DoesNotResetCapsForScopesItDidNotReconcile is why the sweep calls
// reconcileAll rather than runPass. runPass ends with DegradedCounters.ResetAll,
// which is the breaker edge's "NATS is back, stand the cap down" step. On a
// timer that would run on every quiet tick and could zero a cap that a request
// added between this pass enumerating zero rows and that request's outage row
// landing.
func TestSweep_DoesNotResetCapsForScopesItDidNotReconcile(t *testing.T) {
	db := &recDB{} // no outage rows to enumerate
	dc := NewDegradedCounters()
	dc.Add("project.9", 777)

	r := NewReconciler(db, newFakeCounter(), dc, nil)
	r.sweepInterval = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	waitFor(t, time.Second, func() bool {
		db.mu.Lock()
		defer db.mu.Unlock()
		return db.countHits > 0
	}, "sweep never ran")

	if got := dc.Get("project.9"); got != 777 {
		t.Fatalf("degraded counter = %d, want 777 (an untouched scope must keep its cap)", got)
	}
}

// TestSweep_SkipsRecoveryWhileNATSIsDown is the negative control the fix must
// pass. A project genuinely in outage stays in outage: while the health check
// reports NATS unreachable the sweep attempts nothing, so the row keeps
// outage_mode and the write-back consumer stays barred from it. A fix that
// cleared the flag unconditionally would be worse than the wedge, because the
// outage spend would never reach the authoritative counter.
func TestSweep_SkipsRecoveryWhileNATSIsDown(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
		outageCount:   1,
	}
	var up healthFlag
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)
	r.sweepInterval = 5 * time.Millisecond
	r.SetHealthCheck(up.get)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	// Several ticks with NATS down.
	waitFor(t, time.Second, func() bool {
		db.mu.Lock()
		defer db.mu.Unlock()
		return db.countHits >= 3
	}, "sweep never ticked")

	db.mu.Lock()
	finalized := len(db.finalized)
	begins := db.begins
	db.mu.Unlock()
	if finalized != 0 {
		t.Fatalf("row released while NATS was down: finalized=%d", finalized)
	}
	if begins != 0 {
		t.Fatalf("sweep opened %d transactions while NATS was down; it must not even write the crash marker", begins)
	}
	// The gauge is still refreshed, so the held row is visible for the whole
	// outage rather than only after it ends.
	if got := outageRowsGauge.Value(); got != 1 {
		t.Fatalf("outage-rows gauge = %d, want 1 while the row is held", got)
	}

	// NATS returns. The very next tick releases the row — no breaker edge.
	up.set(true)
	waitFor(t, time.Second, func() bool {
		db.mu.Lock()
		defer db.mu.Unlock()
		return len(db.finalized) == 1
	}, "sweep did not release the row after NATS returned")
}

// TestSweep_FailedReconcileRetainsRowAndCountsFailure covers the "what if the
// recovery itself fails" case: the counter read errors, so the row must keep
// outage_mode and the failure must be visible.
func TestSweep_FailedReconcileRetainsRowAndCountsFailure(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
		outageCount:   1,
	}
	c := newFakeCounter()
	c.readErr = errors.New("counter unreachable")

	before := recoveryFailuresMetric.Value()
	r := NewReconciler(db, c, NewDegradedCounters(), nil)
	r.sweepInterval = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	r.Start(ctx)

	waitFor(t, time.Second, func() bool { return recoveryFailuresMetric.Value() > before },
		"the failure counter never rose")

	db.mu.Lock()
	defer db.mu.Unlock()
	if len(db.finalized) != 0 {
		t.Fatalf("row finalized despite a failed replay: %v", db.finalized)
	}
}

// TestSweep_GaugeKeepsLastValueWhenTheCountFails states why the gauge is not
// zeroed on a read error: a gauge that falls to zero because Postgres is
// unreachable reads exactly like one that falls to zero because the rows
// recovered.
func TestSweep_GaugeKeepsLastValueWhenTheCountFails(t *testing.T) {
	outageRowsGauge.Set(4)
	db := &recDB{countErr: errors.New("pg down")}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)

	r.refreshOutageGauge(context.Background())

	if got := outageRowsGauge.Value(); got != 4 {
		t.Fatalf("gauge = %d, want the last known 4", got)
	}
}

// TestSweep_CoalescesWithAnInFlightPass proves the timer and the breaker edge
// share one lease, so two passes never reconcile the same rows at once.
// It also proves SweepOnce needs no Start: Start owns the ticker, and a pass
// that silently did nothing until Start had run would be a no-op wherever a
// caller drives one deterministic pass.
func TestSweep_CoalescesWithAnInFlightPass(t *testing.T) {
	db := &recDB{outageCount: 2}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)

	if !r.acquire() {
		t.Fatal("first acquire must succeed")
	}
	r.SweepOnce(context.Background())
	db.mu.Lock()
	begins := db.begins
	db.mu.Unlock()
	if begins != 0 {
		t.Fatalf("sweep reconciled while a pass held the lease: begins=%d", begins)
	}
	// The gauge still refreshes, because the operator's view must not depend on
	// which pass holds the lease.
	if got := outageRowsGauge.Value(); got != 2 {
		t.Fatalf("gauge = %d, want 2", got)
	}
	r.release()
	// With the lease free, the same call reconciles — with no Start anywhere.
	r.SweepOnce(context.Background())
	db.mu.Lock()
	begins = db.begins
	db.mu.Unlock()
	if begins == 0 {
		t.Fatal("SweepOnce did nothing without Start; the pass must not depend on the ticker being launched")
	}
}

// TestSweep_StartIsIdempotent keeps a second Start from launching a second
// ticker, which would double every replica's sweep rate.
func TestSweep_StartIsIdempotent(t *testing.T) {
	db := &recDB{}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)
	r.sweepInterval = 5 * time.Millisecond
	ctx, cancel := context.WithCancel(context.Background())
	r.Start(ctx)
	r.Start(ctx)

	waitFor(t, time.Second, func() bool {
		db.mu.Lock()
		defer db.mu.Unlock()
		return db.countHits >= 4
	}, "sweep never ticked")

	// Cancelling the one context stops all sweeping.
	cancel()
	time.Sleep(30 * time.Millisecond)
	db.mu.Lock()
	settled := db.countHits
	db.mu.Unlock()
	time.Sleep(50 * time.Millisecond)
	db.mu.Lock()
	after := db.countHits
	db.mu.Unlock()
	if after > settled+1 {
		t.Fatalf("sweeps continued after cancel: %d → %d (a second ticker is still running)", settled, after)
	}
}

// TestSweep_PanicDoesNotStopTheTicker keeps one bad pass from disabling
// recovery for the life of the process.
func TestSweep_PanicDoesNotStopTheTicker(t *testing.T) {
	db := &recDB{}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)
	r.Start(context.Background())

	orig := runtimeStack
	runtimeStack = func(buf []byte, _ bool) int { panic("stack blew up") }
	defer func() { runtimeStack = orig }()

	// A panic inside the pass is caught by sweepOnce; the panic handler's own
	// failure must not escape either, so this recovers twice over.
	func() {
		defer func() { _ = recover() }()
		r.SweepOnce(context.Background())
	}()

	// The reconciler is still usable afterwards.
	if !r.acquire() {
		t.Fatal("the lease was not returned after the pass")
	}
	r.release()
}

// TestSweep_PanicInThePassReturnsTheLease is the trap a plain "release after
// the call" would leave: a pass that panics never returns the lease, and every
// later pass — sweep and breaker edge alike — coalesces onto a pass that is
// already dead. Recovery would then be off for the life of the process.
func TestSweep_PanicInThePassReturnsTheLease(t *testing.T) {
	db := &recDB{beginPanics: true}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil)

	r.SweepOnce(context.Background()) // the panic is caught inside

	if !r.acquire() {
		t.Fatal("the lease was not returned after a panicking pass; recovery is now off for good")
	}
	r.release()

	// And the next pass runs.
	db.mu.Lock()
	db.beginPanics = false
	db.outageCount = 3
	db.mu.Unlock()
	r.SweepOnce(context.Background())
	if got := outageRowsGauge.Value(); got != 3 {
		t.Fatalf("gauge = %d, want 3; the reconciler did not recover from the panic", got)
	}
}

// TestRecoveryMetricNames_MatchThePublishedVars keeps the /metrics allowlist
// honest: a name listed for the composition root that nothing publishes writes
// an "# UNPUBLISHED" line to a scrape instead of a value.
func TestRecoveryMetricNames_MatchThePublishedVars(t *testing.T) {
	names := RecoveryMetricNames()
	if len(names) != 2 {
		t.Fatalf("RecoveryMetricNames = %v, want two names", names)
	}
	for _, name := range names {
		if !strings.HasPrefix(name, "gateway_") {
			t.Errorf("%q does not carry the gateway metric prefix", name)
		}
	}
	if names[0] != MetricBudgetOutageRows || names[1] != MetricBudgetRecoveryFailuresTotal {
		t.Fatalf("RecoveryMetricNames = %v, want the two budget-outage controls", names)
	}
}

// TestRecoverySweepInterval_IsBounded pins the cadence as a compiled constant:
// no setting can turn recovery off, and the window a wedged row can hold back
// durable spend stays short.
func TestRecoverySweepInterval_IsBounded(t *testing.T) {
	if RecoverySweepInterval <= 0 {
		t.Fatal("a non-positive sweep interval disables recovery entirely")
	}
	if RecoverySweepInterval > time.Minute {
		t.Fatalf("sweep interval %v is longer than a minute; a wedged row holds durable spend for that long", RecoverySweepInterval)
	}
	if NewReconciler(&recDB{}, newFakeCounter(), NewDegradedCounters(), nil).sweepInterval != RecoverySweepInterval {
		t.Fatal("NewReconciler does not take the compiled sweep interval; a caller could ship with the sweep off")
	}
}

// ─── helpers ─────────────────────────────────────────────────────────────────

// healthFlag is a tiny mutex-guarded bool used as the sweep's health predicate.
type healthFlag struct {
	mu sync.Mutex
	v  bool
}

func (a *healthFlag) get() bool  { a.mu.Lock(); defer a.mu.Unlock(); return a.v }
func (a *healthFlag) set(v bool) { a.mu.Lock(); a.v = v; a.mu.Unlock() }

// waitFor polls cond until it holds or the deadline passes.
func waitFor(t *testing.T, limit time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(limit)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal(msg)
}
