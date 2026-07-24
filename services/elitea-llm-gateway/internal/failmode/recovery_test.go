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
	// Pass 1 must have applied the increment (applied=true path).
	if len(c.incrs) != 1 {
		t.Fatalf("pass1 incr count=%d want 1", len(c.incrs))
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

	// Now exercise the explicit dedup-window SUPPRESSION path: force NATS counter
	// back to the pre-recovery baseline (0) while keeping the applied map intact.
	// Pass 3 will see the same (PG=40, NATS=0, delta=40) and therefore generate
	// the identical event_id as pass 1 — IncrBudgetIdempotent must return
	// applied=false (Nats-Msg-Id already seen) and NOT advance the counter.
	c.mu.Lock()
	c.totals["project.7"] = 0 // reset counter baseline; applied map still has pass1's id
	incrsBefore := len(c.incrs)
	c.mu.Unlock()

	db3 := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 40}},
		perScopeAccum: map[string]int64{"r1": 40},
	}
	startedReconciler(db3, c, dc).runPass(context.Background())

	c.mu.Lock()
	incrsAfter := len(c.incrs)
	totalAfter := c.totals["project.7"]
	c.mu.Unlock()

	// IncrBudgetIdempotent was called (a new incr record was appended) but
	// applied=false — the counter must stay at 0 (the suppressed duplicate must
	// not advance the in-memory total).
	if incrsAfter == incrsBefore {
		t.Fatal("expected IncrBudgetIdempotent to be called on pass3 (same delta); got no call")
	}
	if totalAfter != 0 {
		t.Fatalf("dedup suppression: counter advanced to %d after duplicate replay, want 0", totalAfter)
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
	// HandleBreakerChange guards baseCtx == nil under mutex: when Start has never
	// been called it returns immediately without launching a goroutine. The
	// assertion is therefore deterministic — there is no goroutine race to wait
	// for. Replace the bare sleep with: (a) observe that running is false
	// (confirming no goroutine was spawned) then (b) assert db.begins == 0.
	db := &recDB{}
	r := NewReconciler(db, newFakeCounter(), NewDegradedCounters(), nil) // no Start
	r.HandleBreakerChange(gobreaker.StateOpen, gobreaker.StateClosed)

	// No goroutine was launched (baseCtx == nil guard), so running must be false
	// immediately — no sleep needed.
	r.mu.Lock()
	running := r.running
	r.mu.Unlock()
	if running {
		t.Fatal("running=true without Start — goroutine unexpectedly launched")
	}
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
	// Fix #3: counterNano is now part of the event ID.
	a := recoveryEventID("project", "7", 1000, 30, 20)
	b := recoveryEventID("project", "7", 1000, 30, 20)
	if a != b {
		t.Fatalf("same inputs must yield same id: %q vs %q", a, b)
	}
	if a == recoveryEventID("project", "7", 1000, 30, 21) {
		t.Fatal("different delta must yield different id")
	}
	if a == recoveryEventID("project", "7", 1000, 31, 20) {
		t.Fatal("different counterNano baseline must yield different id")
	}
	if !strings.HasPrefix(a, "recovery.") {
		t.Fatalf("unexpected id shape: %q", a)
	}
}

// TestRecoveryEventID_DistinctOutagesSameDelta asserts Fix #3: two outages with
// the same replay delta but different NATS counter baselines within one
// RecoveryDedupeWindow produce distinct event IDs so neither suppresses the other.
func TestRecoveryEventID_DistinctOutagesSameDelta(t *testing.T) {
	// Outage 1: NATS was at 0 before the outage; delta = 500.
	// Outage 2: NATS was at 1000 after first outage + normal ops; delta = 500.
	id1 := recoveryEventID("project", "7", 1000, 0, 500)
	id2 := recoveryEventID("project", "7", 1000, 1000, 500)
	if id1 == id2 {
		t.Fatalf("distinct outages with same delta must produce different event IDs: %q == %q", id1, id2)
	}
}

// TestReconcile_TwoSameDeltaOutagesApplyBoth asserts Fix #3: two distinct
// outages with the same replay delta both have their recovery increments applied,
// i.e. neither is dedup-suppressed by the other.
func TestReconcile_TwoSameDeltaOutagesApplyBoth(t *testing.T) {
	c := newFakeCounter()
	dc := NewDegradedCounters()

	// Outage 1: NATS at 0, PG accumulated 500 → replay delta = 500.
	c.totals["project.7"] = 0
	db1 := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 500}},
		perScopeAccum: map[string]int64{"r1": 500},
	}
	startedReconciler(db1, c, dc).runPass(context.Background())
	if c.totals["project.7"] != 500 {
		t.Fatalf("after outage 1 recovery: counter=%d, want 500", c.totals["project.7"])
	}

	// Normal operations advance NATS from 500 → 1000.
	c.mu.Lock()
	c.totals["project.7"] = 1000
	c.mu.Unlock()

	// Outage 2 (within RecoveryDedupeWindow): NATS at 1000, PG accumulated 1500
	// → replay delta = 500 (same as outage 1).
	db2 := &recDB{
		rows:          []outageRow{{id: "r2", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 1500}},
		perScopeAccum: map[string]int64{"r2": 1500},
	}
	startedReconciler(db2, c, dc).runPass(context.Background())
	if c.totals["project.7"] != 1500 {
		t.Fatalf("after outage 2 recovery: counter=%d, want 1500 (second delta not applied, possibly dedup-collided)", c.totals["project.7"])
	}
}

// TestReconcile_NATSSucceedsPGCommitFails exercises the degraded-counter
// non-reset path: the NATS increment for a scope succeeds (spending is on the
// authoritative counter) but the per-scope PG commit (phase 3) fails. In this
// situation reconcileScope returns an error so the per-scope degraded counter
// MUST NOT be reset — the cap keeps enforcing until a future recovery edge
// retries and commits.
func TestReconcile_NATSSucceedsPGCommitFails(t *testing.T) {
	// commitFailScopeTx wraps recScopeTx and fails Commit so we can test the
	// reconcileScope-error path without failing the enumerate-tx commit.
	// recDB.begins==1 means the enum tx; begins>=2 are scope txs.
	commitErrAfterFirst := errors.New("pg commit failed on scope tx")
	db := &recDB{
		rows:          []outageRow{{id: "r1", scope: "project", scopeID: "7", periodStartUnix: 1000, accumulatedNano: 50}},
		perScopeAccum: map[string]int64{"r1": 50},
		// Inject a commit error ONLY for the scope transaction (begins >= 2).
		// We use a custom wrapper via the commitErrForScopeTx field.
	}
	// We need to fail only scope tx commits, not the enumerate tx commit.
	// Wrap Begin so the scope tx's Commit always fails.
	wdb := &scopeCommitFailDB{recDB: db, scopeCommitErr: commitErrAfterFirst}

	c := newFakeCounter()
	c.totals["project.7"] = 0
	dc := NewDegradedCounters()
	dc.Add("project.7", 100) // set a degraded cap; must NOT be cleared

	startedReconciler(wdb, c, dc).runPass(context.Background())

	// NATS increment was called (the scope tx attempted the replay).
	c.mu.Lock()
	nIncrs := len(c.incrs)
	counterTotal := c.totals["project.7"]
	c.mu.Unlock()
	if nIncrs == 0 {
		t.Fatal("expected NATS IncrBudgetIdempotent to be called before commit failed")
	}
	// The NATS counter reflects the replay (delta=50-0=50).
	if counterTotal != 50 {
		t.Fatalf("NATS counter = %d after replay, want 50", counterTotal)
	}

	// The degraded counter must NOT be reset because the PG commit failed. Even
	// though NATS was updated, the row was not finalized — so the cap must keep
	// enforcing until a future recovery edge succeeds. This is the key invariant:
	// a commit failure on the PG side propagates as a scope error so
	// reconcileAll does NOT call dc.Reset for this scope.
	if dc.Get("project.7") != 100 {
		t.Fatalf("degraded counter = %d after scope commit failure, want 100 (must NOT be reset)", dc.Get("project.7"))
	}
	// Note: we do NOT assert db.finalized here because the in-memory fake records
	// ExecAffected calls eagerly (before commit); in production PG the UPDATE
	// would be rolled back. The key invariant is the degraded counter above.
}

// scopeCommitFailDB wraps recDB and returns a Tx whose Commit fails for all
// scope transactions (begins >= 2 — the first Begin is the enumerate tx).
type scopeCommitFailDB struct {
	recDB          *recDB
	scopeCommitErr error
}

func (d *scopeCommitFailDB) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return d.recDB.QueryRow(ctx, sql, args...)
}

func (d *scopeCommitFailDB) Begin(ctx context.Context) (Tx, error) {
	tx, err := d.recDB.Begin(ctx)
	if err != nil {
		return nil, err
	}
	d.recDB.mu.Lock()
	n := d.recDB.begins
	d.recDB.mu.Unlock()
	if n >= 2 {
		// Scope transaction: wrap to fail Commit.
		return &commitFailTx{Tx: tx, commitErr: d.scopeCommitErr}, nil
	}
	return tx, nil
}

// commitFailTx delegates everything to the underlying Tx but fails Commit.
type commitFailTx struct {
	Tx
	commitErr error
}

func (t *commitFailTx) Commit(_ context.Context) error { return t.commitErr }

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
