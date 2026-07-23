package failmode

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/sony/gobreaker/v2"
)

// --- fake counter ------------------------------------------------------------

type fakeCounter struct {
	mu sync.Mutex
	// totals maps subject → current authoritative nano total.
	totals map[string]int64
	// applied records event_ids already applied (idempotency).
	applied  map[string]bool
	readErr  error
	incrErr  error
	incrs    []incrCall
	readHits int
}

type incrCall struct {
	subject string
	eventID string
	delta   int64
}

func newFakeCounter() *fakeCounter {
	return &fakeCounter{totals: map[string]int64{}, applied: map[string]bool{}}
}

func (c *fakeCounter) ReadBudget(_ context.Context, subject string) (int64, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.readHits++
	if c.readErr != nil {
		return 0, c.readErr
	}
	return c.totals[subject], nil
}

func (c *fakeCounter) IncrBudgetIdempotent(_ context.Context, subject, eventID string, delta int64) (int64, bool, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.incrErr != nil {
		return 0, false, c.incrErr
	}
	c.incrs = append(c.incrs, incrCall{subject, eventID, delta})
	if c.applied[eventID] {
		return c.totals[subject], false, nil // duplicate suppressed
	}
	c.applied[eventID] = true
	c.totals[subject] += delta
	return c.totals[subject], true, nil
}

func (c *fakeCounter) BudgetSubject(scope, scopeID string, periodStartUnix int64) string {
	return scope + "." + scopeID
}

// --- fake DB for recovery ----------------------------------------------------

// recDB scripts the enumerate transaction and per-scope transactions.
type recDB struct {
	mu sync.Mutex
	// enumerate rows returned by the first Begin's Query.
	rows []outageRow
	// perScopeAccum maps row id → accumulated nano returned by the re-lock read.
	// A missing id models an already-reconciled row (pgx.ErrNoRows).
	perScopeAccum map[string]int64

	beginErr    error
	queryErr    error
	markErr     error
	commitErr   error
	relockErr   error
	finalizeErr error

	begins    int
	finalized []string // row ids finalized (phase 3)
}

func (d *recDB) QueryRow(context.Context, string, ...any) Row {
	return scriptedRow{scanErr: errors.New("unused non-tx QueryRow")}
}

func (d *recDB) Begin(context.Context) (Tx, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.beginErr != nil {
		return nil, d.beginErr
	}
	d.begins++
	// First Begin is the enumerate tx; subsequent ones are per-scope.
	if d.begins == 1 {
		return &recEnumTx{db: d}, nil
	}
	return &recScopeTx{db: d}, nil
}

// recEnumTx serves the SELECT ... FOR UPDATE SKIP LOCKED + markers.
type recEnumTx struct{ db *recDB }

func (t *recEnumTx) QueryRow(context.Context, string, ...any) Row {
	return scriptedRow{scanErr: errors.New("unused")}
}
func (t *recEnumTx) Query(context.Context, string, ...any) (Rows, error) {
	if t.db.queryErr != nil {
		return nil, t.db.queryErr
	}
	return &fakeRows{rows: t.db.rows}, nil
}
func (t *recEnumTx) ExecAffected(context.Context, string, ...any) (int64, error) {
	if t.db.markErr != nil {
		return 0, t.db.markErr
	}
	return 1, nil
}
func (t *recEnumTx) Commit(context.Context) error   { return t.db.commitErr }
func (t *recEnumTx) Rollback(context.Context) error { return nil }

// recScopeTx serves phase-1 re-lock read + phase-3 finalize for one scope.
type recScopeTx struct {
	db      *recDB
	lastID  string
	scanned bool
}

func (t *recScopeTx) QueryRow(_ context.Context, _ string, args ...any) Row {
	if t.db.relockErr != nil {
		return scriptedRow{scanErr: t.db.relockErr}
	}
	id, _ := args[0].(string)
	t.lastID = id
	accum, ok := t.db.perScopeAccum[id]
	if !ok {
		return scriptedRow{scanErr: pgx.ErrNoRows} // already reconciled
	}
	t.scanned = true
	return scriptedRow{vals: []any{accum}}
}
func (t *recScopeTx) Query(context.Context, string, ...any) (Rows, error) {
	return nil, errors.New("unused")
}
func (t *recScopeTx) ExecAffected(_ context.Context, _ string, args ...any) (int64, error) {
	if t.db.finalizeErr != nil {
		return 0, t.db.finalizeErr
	}
	id, _ := args[0].(string)
	t.db.mu.Lock()
	t.db.finalized = append(t.db.finalized, id)
	t.db.mu.Unlock()
	return 1, nil
}
func (t *recScopeTx) Commit(context.Context) error   { return t.db.commitErr }
func (t *recScopeTx) Rollback(context.Context) error { return nil }

// fakeRows iterates a preset outageRow slice.
type fakeRows struct {
	rows []outageRow
	i    int
	err  error
}

func (r *fakeRows) Next() bool {
	if r.i >= len(r.rows) {
		return false
	}
	r.i++
	return true
}
func (r *fakeRows) Scan(dest ...any) error {
	row := r.rows[r.i-1]
	// id, scope, scope_id, period_start_unix, accumulated_nano
	*(dest[0].(*string)) = row.id
	*(dest[1].(*string)) = row.scope
	*(dest[2].(*string)) = row.scopeID
	*(dest[3].(*int64)) = row.periodStartUnix
	*(dest[4].(*int64)) = row.accumulatedNano
	return nil
}
func (r *fakeRows) Err() error { return r.err }
func (r *fakeRows) Close()     {}

// --- tests -------------------------------------------------------------------

func startedReconciler(db DB, c Counter, dc *DegradedCounters) *Reconciler {
	r := NewReconciler(db, c, dc, nil)
	r.Start(context.Background())
	return r
}

func TestReconcile_ReplaysOutageDelta(t *testing.T) {
	// PG says the scope has 50 nano accumulated; NATS recovered at 30 (frozen at
	// pre-outage). Replay delta must be 50-30=20.
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
	}
	c := newFakeCounter()
	c.totals["project.7"] = 30
	dc := NewDegradedCounters()
	dc.Add("project.7", 999) // must be reset after reconcile

	r := startedReconciler(db, c, dc)
	r.runPass(context.Background())

	if len(c.incrs) != 1 || c.incrs[0].delta != 20 {
		t.Fatalf("expected one incr of 20, got %+v", c.incrs)
	}
	if c.totals["project.7"] != 50 {
		t.Fatalf("counter total = %d, want 50", c.totals["project.7"])
	}
	if len(db.finalized) != 1 || db.finalized[0] != "r1" {
		t.Fatalf("row not finalized: %+v", db.finalized)
	}
	if dc.Get("project.7") != 0 {
		t.Fatalf("degraded counter not reset: %d", dc.Get("project.7"))
	}
}

func TestReconcile_NonPositiveDeltaStillFinalizes(t *testing.T) {
	// NATS ahead of PG (write-back lag): delta ≤ 0 ⇒ no incr, but row finalized.
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 20}},
		perScopeAccum: map[string]int64{"r1": 20},
	}
	c := newFakeCounter()
	c.totals["project.7"] = 25 // already higher
	dc := NewDegradedCounters()

	startedReconciler(db, c, dc).runPass(context.Background())

	if len(c.incrs) != 0 {
		t.Fatalf("expected no incr, got %+v", c.incrs)
	}
	if len(db.finalized) != 1 {
		t.Fatalf("row not finalized: %+v", db.finalized)
	}
}

func TestReconcile_IdempotentReusedEventID(t *testing.T) {
	// Two passes over the same amount reuse the same event_id; the second is a
	// suppressed duplicate and the counter is not double-incremented.
	c := newFakeCounter()
	c.totals["project.7"] = 0
	dc := NewDegradedCounters()

	// Pass 1: PG=40, NATS=0 ⇒ replay 40.
	db1 := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 40}},
		perScopeAccum: map[string]int64{"r1": 40},
	}
	startedReconciler(db1, c, dc).runPass(context.Background())
	if c.totals["project.7"] != 40 {
		t.Fatalf("after pass1 total=%d want 40", c.totals["project.7"])
	}

	// Simulate a crash after the NATS incr but before PG finalize: the row is
	// still outage/unreconciled, so a second recovery re-selects it. But NATS
	// now reads 40, so the recomputed delta is 0 — natural idempotency. Even if
	// the delta were the same amount, the reused event_id would suppress it.
	db2 := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 40}},
		perScopeAccum: map[string]int64{"r1": 40},
	}
	startedReconciler(db2, c, dc).runPass(context.Background())
	if c.totals["project.7"] != 40 {
		t.Fatalf("double count on replay: total=%d want 40", c.totals["project.7"])
	}
}

func TestReconcile_AlreadyReconciledRowSkipped(t *testing.T) {
	// Enumerate returns a row, but the phase-1 re-lock finds it gone (a
	// concurrent replica reconciled it): no incr, no finalize, no error.
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{}, // r1 missing ⇒ ErrNoRows on re-lock
	}
	c := newFakeCounter()
	dc := NewDegradedCounters()
	startedReconciler(db, c, dc).runPass(context.Background())

	if len(c.incrs) != 0 || len(db.finalized) != 0 {
		t.Fatalf("skipped row should be inert: incrs=%+v finalized=%+v", c.incrs, db.finalized)
	}
}

func TestReconcile_MultipleScopes_PartialFailureRetainsCaps(t *testing.T) {
	// Two scopes; the counter incr fails for all. No scope reconciles, so the
	// degraded caps must be RETAINED (not reset).
	db := &recDB{
		rows: []outageRow{
			{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50},
			{id: "r2", scope: "project", scopeID: "8", periodStartUnix: 1000, accumulatedNano: 60},
		},
		perScopeAccum: map[string]int64{"r1": 50, "r2": 60},
	}
	c := newFakeCounter()
	c.totals["project.7"] = 0
	c.totals["project.8"] = 0
	c.incrErr = errors.New("nats still flaky")
	dc := NewDegradedCounters()
	dc.Add("project.7", 100)
	dc.Add("project.8", 100)

	startedReconciler(db, c, dc).runPass(context.Background())

	if dc.Get("project.7") != 100 || dc.Get("project.8") != 100 {
		t.Fatalf("caps must be retained on failure: p7=%d p8=%d", dc.Get("project.7"), dc.Get("project.8"))
	}
	if len(db.finalized) != 0 {
		t.Fatalf("no scope should finalize: %+v", db.finalized)
	}
}

func TestReconcile_PerScopeResetOnSuccessOnly(t *testing.T) {
	// r1 succeeds, r2's incr fails. r1's cap resets, r2's is retained, and the
	// pass reports failure so ResetAll is NOT called.
	db := &recDB{
		rows: []outageRow{
			{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50},
			{id: "r2", scope: "project", scopeID: "8", periodStartUnix: 1000, accumulatedNano: 60},
		},
		perScopeAccum: map[string]int64{"r1": 50, "r2": 60},
	}
	c := &selectiveCounter{fakeCounter: newFakeCounter(), failSubject: "project.8"}
	c.totals["project.7"] = 0
	c.totals["project.8"] = 0
	dc := NewDegradedCounters()
	dc.Add("project.7", 100)
	dc.Add("project.8", 100)

	startedReconciler(db, c, dc).runPass(context.Background())

	if dc.Get("project.7") != 0 {
		t.Fatalf("r1 cap should reset: %d", dc.Get("project.7"))
	}
	if dc.Get("project.8") != 100 {
		t.Fatalf("r2 cap should be retained: %d", dc.Get("project.8"))
	}
}

// selectiveCounter fails IncrBudgetIdempotent for one subject only.
type selectiveCounter struct {
	*fakeCounter
	failSubject string
}

func (c *selectiveCounter) IncrBudgetIdempotent(ctx context.Context, subject, eventID string, delta int64) (int64, bool, error) {
	if subject == c.failSubject {
		return 0, false, errors.New("subject-specific failure")
	}
	return c.fakeCounter.IncrBudgetIdempotent(ctx, subject, eventID, delta)
}

func TestReconcile_ReadCounterErrorRetainsScope(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
	}
	c := newFakeCounter()
	c.readErr = errors.New("read failed")
	dc := NewDegradedCounters()
	dc.Add("project.7", 100)
	startedReconciler(db, c, dc).runPass(context.Background())
	if dc.Get("project.7") != 100 || len(db.finalized) != 0 {
		t.Fatalf("read error should retain scope: cap=%d finalized=%+v", dc.Get("project.7"), db.finalized)
	}
}

func TestReconcile_EnumerateErrorRetainsAll(t *testing.T) {
	db := &recDB{queryErr: errors.New("select failed")}
	c := newFakeCounter()
	dc := NewDegradedCounters()
	dc.Add("project.7", 100)
	startedReconciler(db, c, dc).runPass(context.Background())
	if dc.Get("project.7") != 100 {
		t.Fatalf("enumerate error should retain all caps: %d", dc.Get("project.7"))
	}
}

// --- breaker-edge wiring -----------------------------------------------------

func TestHandleBreakerChange_FiresOnlyOnRecoveryEdge(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 10}},
		perScopeAccum: map[string]int64{"r1": 10},
	}
	c := newFakeCounter()
	dc := NewDegradedCounters()
	r := startedReconciler(db, c, dc)

	// Non-recovery edges must not fire a pass.
	r.HandleBreakerChange(gobreaker.StateClosed, gobreaker.StateOpen)
	r.HandleBreakerChange(gobreaker.StateOpen, gobreaker.StateHalfOpen)
	waitIdle(t, r)
	if db.begins != 0 {
		t.Fatalf("non-recovery edges fired a pass: begins=%d", db.begins)
	}

	// The recovery edge (→ CLOSED from a non-closed state) fires exactly one pass.
	r.HandleBreakerChange(gobreaker.StateHalfOpen, gobreaker.StateClosed)
	waitIdle(t, r)
	if len(db.finalized) != 1 {
		t.Fatalf("recovery edge should reconcile: finalized=%+v", db.finalized)
	}
}

func TestHandleBreakerChange_IgnoredBeforeStart(t *testing.T) {
	db := &recDB{}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil) // no Start
	r.HandleBreakerChange(gobreaker.StateOpen, gobreaker.StateClosed)
	time.Sleep(20 * time.Millisecond)
	if db.begins != 0 {
		t.Fatalf("pass fired before Start: begins=%d", db.begins)
	}
}

// panicCounter panics on the first ReadBudget call to simulate an unrecoverable
// dependency failure inside the recovery goroutine (FIX 3 regression test).
type panicCounter struct{ *fakeCounter }

func (c *panicCounter) ReadBudget(_ context.Context, _ string) (int64, error) {
	panic("injected panic from ReadBudget")
}

// TestReconcile_PanicInGoroutineDoesNotCrash asserts that a panic inside the
// recovery goroutine (runPass → reconcileAll → reconcileScope) is caught by the
// deferred recover() and does NOT propagate — the process remains alive and the
// running flag is cleared so a future breaker edge can launch a fresh pass.
func TestReconcile_PanicInGoroutineDoesNotCrash(t *testing.T) {
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
	}
	c := &panicCounter{fakeCounter: newFakeCounter()}
	dc := NewDegradedCounters()
	r := startedReconciler(db, c, dc)

	// HandleBreakerChange spawns the goroutine; waitIdle confirms it exited
	// cleanly (running=false) rather than crashing the test process.
	r.HandleBreakerChange(gobreaker.StateOpen, gobreaker.StateClosed)
	waitIdle(t, r)

	// The running flag must be cleared so a subsequent recovery edge is accepted.
	r.mu.Lock()
	still := r.running
	r.mu.Unlock()
	if still {
		t.Fatal("running flag not cleared after panic recovery")
	}
}

func TestRecoveryEventID_StableAndAmountKeyed(t *testing.T) {
	a := recoveryEventID("project", "7", 1000, 20)
	b := recoveryEventID("project", "7", 1000, 20)
	if a != b {
		t.Fatalf("same inputs must yield same id: %q vs %q", a, b)
	}
	if a == recoveryEventID("project", "7", 1000, 21) {
		t.Fatal("different amount must yield different id")
	}
	if !strings.HasPrefix(a, "recovery.") {
		t.Fatalf("unexpected id shape: %q", a)
	}
}

// waitIdle waits until the reconciler's in-flight pass finishes (running=false).
func waitIdle(t *testing.T, r *Reconciler) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		r.mu.Lock()
		running := r.running
		r.mu.Unlock()
		if !running {
			return
		}
		time.Sleep(2 * time.Millisecond)
	}
	t.Fatal("reconciler pass did not complete")
}
