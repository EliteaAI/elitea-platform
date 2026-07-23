package governance

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/sony/gobreaker/v2"

	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/failmode"
	"github.com/EliteaAI/elitea-platform/services/elitea-llm-gateway/internal/infra/nats"
)

// ─── fake NATS client ────────────────────────────────────────────────────────

type fakeNATS struct {
	mu sync.Mutex

	// totals maps subject → current running counter.
	totals  map[string]int64
	applied map[string]bool

	readErr  error
	incrErr  error
	pubErr   error
	alertErr error

	// deltas published via PublishDelta.
	deltas  [][]byte
	readHit int

	// state change callback registered via OnBreakerStateChange.
	stateChangeFn func(from, to gobreaker.State)

	// breakerState controls what BreakerState() returns.
	breakerState gobreaker.State
}

func newFakeNATS() *fakeNATS {
	return &fakeNATS{
		totals:  map[string]int64{},
		applied: map[string]bool{},
	}
}

func (f *fakeNATS) ReadBudget(_ context.Context, subject string) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.readHit++
	if f.readErr != nil {
		return 0, f.readErr
	}
	return f.totals[subject], nil
}

func (f *fakeNATS) IncrBudget(_ context.Context, subject string, delta int64) (int64, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.incrErr != nil {
		return 0, f.incrErr
	}
	f.totals[subject] += delta
	return f.totals[subject], nil
}

func (f *fakeNATS) IncrBudgetIdempotent(_ context.Context, subject, eventID string, delta int64) (int64, bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.incrErr != nil {
		return 0, false, f.incrErr
	}
	if f.applied[eventID] {
		return f.totals[subject], false, nil
	}
	f.applied[eventID] = true
	f.totals[subject] += delta
	return f.totals[subject], true, nil
}

func (f *fakeNATS) PublishDelta(_ context.Context, _ string, payload []byte) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.pubErr != nil {
		return f.pubErr
	}
	cp := make([]byte, len(payload))
	copy(cp, payload)
	f.deltas = append(f.deltas, cp)
	return nil
}

func (f *fakeNATS) TryAlertCooldown(_ context.Context, _ string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.alertErr != nil {
		return false, f.alertErr
	}
	return true, nil
}

func (f *fakeNATS) OnBreakerStateChange(fn func(from, to gobreaker.State)) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.stateChangeFn = fn
}

func (f *fakeNATS) BreakerState() gobreaker.State {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.breakerState
}

// fireStateChange simulates a breaker transition.
func (f *fakeNATS) fireStateChange(from, to gobreaker.State) {
	f.mu.Lock()
	fn := f.stateChangeFn
	f.mu.Unlock()
	if fn != nil {
		fn(from, to)
	}
}

// ─── fake failmode.DB for in-memory snapshot reads ───────────────────────────

type fakeDB struct {
	row      failmode.Snapshot
	rowErr   error
	beginErr error
}

func (d *fakeDB) QueryRow(_ context.Context, _ string, _ ...any) failmode.Row {
	if d.rowErr != nil {
		return scriptedRow{scanErr: d.rowErr}
	}
	// Encode the snapshot as the seven columns ReadSnapshot scans:
	// is_unlimited, hard_limit_nano, accumulated_nano, soft_alert_pct,
	// nats_fail_mode (*string), acc_found, age_seconds
	//
	// nats_fail_mode must be a nil interface (not a nil *string wrapped in
	// interface{}) so that assignVal's nil check fires correctly for a NULL column.
	var natsFM any // nil interface ⇒ SQL NULL
	ageSeconds := d.row.Age.Seconds()
	return scriptedRow{vals: []any{
		d.row.IsUnlimited,
		d.row.HardLimitNano,
		d.row.AccumulatedNano,
		d.row.SoftAlertPct,
		natsFM,
		d.row.Found,
		ageSeconds,
	}}
}

func (d *fakeDB) Begin(_ context.Context) (failmode.Tx, error) {
	if d.beginErr != nil {
		return nil, d.beginErr
	}
	return &nopTx{}, nil
}

// scriptedRow is shared with the failmode package pattern; we redefine a local
// copy here so the governance test is self-contained (the failmode.scriptedRow
// is unexported).
type scriptedRow struct {
	vals    []any
	scanErr error
}

func (r scriptedRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(dest) != len(r.vals) {
		return errors.New("scriptedRow: arity mismatch")
	}
	for i, v := range r.vals {
		if err := assignVal(dest[i], v); err != nil {
			return err
		}
	}
	return nil
}

func assignVal(dest, v any) error {
	switch p := dest.(type) {
	case *bool:
		*p = v.(bool)
	case *int64:
		*p = v.(int64)
	case *int:
		*p = v.(int)
	case *float64:
		*p = v.(float64)
	case **string:
		// v may be an untyped nil (SQL NULL) or a string value. A typed-nil
		// *string wrapped in interface{} also compares == nil here because we
		// set natsFM as `any` (untyped nil) in the test helper.
		if v == nil {
			*p = nil
		} else {
			s := v.(string)
			*p = &s
		}
	case *string:
		*p = v.(string)
	default:
		return errors.New("scriptedRow: unsupported dest type")
	}
	return nil
}

// nopTx is a no-op transaction for UpdateUsage's outage-delta path in tests
// where PG commits are not under test.
type nopTx struct{}

func (t *nopTx) QueryRow(_ context.Context, _ string, _ ...any) failmode.Row {
	return scriptedRow{scanErr: errors.New("nop")}
}
func (t *nopTx) Query(_ context.Context, _ string, _ ...any) (failmode.Rows, error) {
	return nil, errors.New("nop")
}
func (t *nopTx) ExecAffected(_ context.Context, _ string, _ ...any) (int64, error) { return 1, nil }
func (t *nopTx) Commit(_ context.Context) error                                     { return nil }
func (t *nopTx) Rollback(_ context.Context) error                                   { return nil }

// ─── test helpers ─────────────────────────────────────────────────────────────

const (
	testProject = 7
	testScope   = "project"
	testScopeID = "42"
	testPeriod  = int64(1_000_000)
	testPeriodEnd = int64(1_086_400) // +1 day
)

// limitNano is 100 USD in nano-USD.
const limitNano = int64(100) * failmode.NanoUSD

func makeSubject() string {
	return nats.BudgetSubject(testScope, testScopeID, testPeriod)
}

// newStore builds a fully-wired GovernanceStore for testing over fakes.
func newStore(nc *fakeNATS, db *fakeDB) *GovernanceStore {
	fmStore := failmode.NewStore(db)
	degraded := failmode.NewDegradedCounters()
	rec := failmode.NewReconciler(db, nc2counter(nc), degraded, nil)
	params := failmode.Params{
		Mode:             failmode.ModeTieredHybrid,
		PGFreshness:      5 * time.Minute,
		ExpectedReplicas: 1,
	}
	gs := NewGovernanceStore(nc, fmStore, degraded, rec, params, nil)
	gs.Start(context.Background())
	return gs
}

// nc2counter adapts *fakeNATS to the failmode.Counter interface for the Reconciler.
type nc2counterAdapter struct{ nc *fakeNATS }

func nc2counter(nc *fakeNATS) failmode.Counter { return &nc2counterAdapter{nc: nc} }

func (a *nc2counterAdapter) ReadBudget(ctx context.Context, subject string) (int64, error) {
	return a.nc.ReadBudget(ctx, subject)
}
func (a *nc2counterAdapter) IncrBudgetIdempotent(ctx context.Context, subject, eventID string, delta int64) (int64, bool, error) {
	return a.nc.IncrBudgetIdempotent(ctx, subject, eventID, delta)
}
func (a *nc2counterAdapter) BudgetSubject(scope, scopeID string, periodStartUnix int64) string {
	return nats.BudgetSubject(scope, scopeID, periodStartUnix)
}

// ─── tests ────────────────────────────────────────────────────────────────────

// TestCheckBudget_UnderBudgetAllow: NATS up, counter well below limit → Allow.
func TestCheckBudget_UnderBudgetAllow(t *testing.T) {
	nc := newFakeNATS()
	nc.totals[makeSubject()] = 10 * failmode.NanoUSD // 10 of 100 USD spent

	db := &fakeDB{row: failmode.Snapshot{
		HardLimitNano:   limitNano,
		AccumulatedNano: 10 * failmode.NanoUSD,
		SoftAlertPct:    80,
		Found:           true,
		Age:             0,
	}}
	gs := newStore(nc, db)

	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, failmode.NanoUSD)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Allow {
		t.Fatalf("want Allow, got %v (state=%v)", dec.Verdict, dec.State)
	}
	if dec.State != failmode.StateNATSHealthy {
		t.Fatalf("want NATS_HEALTHY, got %v", dec.State)
	}
	if dec.Degraded {
		t.Fatal("should not be degraded when NATS is up")
	}
}

// TestCheckBudget_OverBudgetBlock402: NATS up, counter ≥ limit → Block402.
func TestCheckBudget_OverBudgetBlock402(t *testing.T) {
	nc := newFakeNATS()
	nc.totals[makeSubject()] = limitNano // exactly at limit

	db := &fakeDB{row: failmode.Snapshot{
		HardLimitNano:   limitNano,
		AccumulatedNano: limitNano,
		Found:           true,
	}}
	gs := newStore(nc, db)

	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Block402 {
		t.Fatalf("want Block402, got %v (state=%v)", dec.Verdict, dec.State)
	}
	if dec.State != failmode.StateNATSHealthy {
		t.Fatalf("want NATS_HEALTHY, got %v", dec.State)
	}
}

// TestCheckBudget_NATSDownStale_Block503: NATS down + stale snapshot → Block503.
func TestCheckBudget_NATSDownStale_Block503(t *testing.T) {
	nc := newFakeNATS()
	nc.readErr = nats.ErrUnavailable // breaker open

	// Snapshot is stale (age > freshness).
	db := &fakeDB{row: failmode.Snapshot{
		HardLimitNano:   limitNano,
		AccumulatedNano: 5 * failmode.NanoUSD,
		Found:           true,
		Age:             10 * time.Minute, // > 5m freshness
	}}
	gs := newStore(nc, db)

	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Block503 {
		t.Fatalf("want Block503, got %v (state=%v)", dec.Verdict, dec.State)
	}
	if !dec.Degraded {
		t.Fatal("want Degraded=true on NATS-down path")
	}
}

// TestCheckBudget_NATSDownFresh_Allow: NATS down + fresh snapshot + under limit → Allow.
func TestCheckBudget_NATSDownFresh_Allow(t *testing.T) {
	nc := newFakeNATS()
	nc.readErr = nats.ErrUnavailable

	db := &fakeDB{row: failmode.Snapshot{
		HardLimitNano:   limitNano,
		AccumulatedNano: 10 * failmode.NanoUSD, // 10% spent, soft=80%
		SoftAlertPct:    80,
		Found:           true,
		Age:             1 * time.Minute, // fresh
	}}
	gs := newStore(nc, db)

	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, failmode.NanoUSD)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Allow {
		t.Fatalf("want Allow, got %v (state=%v)", dec.Verdict, dec.State)
	}
	if !dec.Degraded {
		t.Fatal("want Degraded=true on NATS-down path")
	}
}

// TestCheckBudget_NoBudgetRow_Unlimited: no project_budget row → unlimited → Allow.
func TestCheckBudget_NoBudgetRow_Unlimited(t *testing.T) {
	nc := newFakeNATS()
	nc.totals[makeSubject()] = 999 * failmode.NanoUSD // any counter

	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	// NATS up with non-zero counter; unlimited means no block.
	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Allow {
		t.Fatalf("unlimited project must be Allow, got %v", dec.Verdict)
	}
}

// TestCheckBudget_NATSAndPGBothDown_Block503: NATS unavailable + PG error → Block503.
func TestCheckBudget_NATSAndPGBothDown_Block503(t *testing.T) {
	nc := newFakeNATS()
	nc.readErr = nats.ErrUnavailable

	db := &fakeDB{rowErr: errors.New("postgres down")}
	gs := newStore(nc, db)

	dec, err := gs.CheckBudget(context.Background(), testProject, testScope, testScopeID, testPeriod, 0)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dec.Verdict != failmode.Block503 {
		t.Fatalf("want Block503, got %v", dec.Verdict)
	}
}

// TestUpdateUsage_IncrementsAndPublishes: UpdateUsage calls IncrBudgetIdempotent
// and PublishDelta with the correct data.
func TestUpdateUsage_IncrementsAndPublishes(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	const costNano = int64(2) * failmode.NanoUSD
	const eventID = "evt-001"
	err := gs.UpdateUsage(context.Background(), testProject, testScope, testScopeID, eventID, costNano, testPeriod, testPeriodEnd)
	if err != nil {
		t.Fatalf("UpdateUsage: %v", err)
	}

	subject := makeSubject()
	nc.mu.Lock()
	total := nc.totals[subject]
	deltaCount := len(nc.deltas)
	nc.mu.Unlock()

	if total != costNano {
		t.Fatalf("counter total = %d, want %d", total, costNano)
	}
	if deltaCount != 1 {
		t.Fatalf("expected 1 delta published, got %d", deltaCount)
	}
}

// TestUpdateUsage_IdempotentOnRetry: a second call with the same eventID does
// not double-increment the counter.
func TestUpdateUsage_IdempotentOnRetry(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	const costNano = int64(5) * failmode.NanoUSD
	const eventID = "evt-idem"

	// First call.
	if err := gs.UpdateUsage(context.Background(), testProject, testScope, testScopeID, eventID, costNano, testPeriod, testPeriodEnd); err != nil {
		t.Fatalf("first UpdateUsage: %v", err)
	}
	// Second call with same eventID (retry simulation).
	if err := gs.UpdateUsage(context.Background(), testProject, testScope, testScopeID, eventID, costNano, testPeriod, testPeriodEnd); err != nil {
		t.Fatalf("second UpdateUsage: %v", err)
	}

	subject := makeSubject()
	nc.mu.Lock()
	total := nc.totals[subject]
	nc.mu.Unlock()

	if total != costNano {
		t.Fatalf("idempotent: counter = %d, want %d (must not double-count)", total, costNano)
	}
}

// TestUpdateUsage_NATSDown_DegradedCounterUpdated: when NATS is unavailable,
// UpdateUsage must update the degraded counter so CheckBudget's FSM can gate it.
func TestUpdateUsage_NATSDown_DegradedCounterUpdated(t *testing.T) {
	nc := newFakeNATS()
	nc.incrErr = nats.ErrUnavailable
	// Also fail delta publish (NATS down) — should not error the caller.
	nc.pubErr = nats.ErrUnavailable

	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	const costNano = int64(3) * failmode.NanoUSD
	if err := gs.UpdateUsage(context.Background(), testProject, testScope, testScopeID, "evt-down", costNano, testPeriod, testPeriodEnd); err != nil {
		t.Fatalf("UpdateUsage must not error on NATS-down: %v", err)
	}

	subject := makeSubject()
	got := gs.DumpTotal(testScope, testScopeID, testPeriod)
	if got != costNano {
		t.Fatalf("degraded counter = %d, want %d", got, costNano)
	}
	_ = subject
}

// TestDumpTotal_ZeroWhenNeverUpdated: DumpTotal returns 0 for an unknown scope.
func TestDumpTotal_ZeroWhenNeverUpdated(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)
	if got := gs.DumpTotal("project", "9999", 0); got != 0 {
		t.Fatalf("expected 0, got %d", got)
	}
}

// TestResetExpired_NoOp: ResetExpired must return nil (no-op by design).
func TestResetExpired_NoOp(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)
	if err := gs.ResetExpired(context.Background()); err != nil {
		t.Fatalf("ResetExpired returned error: %v", err)
	}
}

// TestNATSUnavailable_ReflectsState: NATSUnavailable returns false when
// BreakerState is Closed and true otherwise.
func TestNATSUnavailable_ReflectsState(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	// Default state: closed.
	if gs.NATSUnavailable() {
		t.Fatal("expected NATS available (closed breaker)")
	}

	nc.mu.Lock()
	nc.breakerState = gobreaker.StateOpen
	nc.mu.Unlock()

	if !gs.NATSUnavailable() {
		t.Fatal("expected NATS unavailable (open breaker)")
	}
}

// TestTryAlertCooldown_Forwarded: TryAlertCooldown must call through to NATS.
func TestTryAlertCooldown_Forwarded(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	ok, err := gs.TryAlertCooldown(context.Background(), testScope, testScopeID, testPeriod)
	if err != nil {
		t.Fatalf("TryAlertCooldown: %v", err)
	}
	if !ok {
		t.Fatal("expected alert to fire (first call)")
	}
}

// TestStart_BindsReconcilerContext: after Start, a breaker→closed transition
// fires the recovery reconciler. This test just verifies no panic and that the
// wiring produced by NewGovernanceStore fires the correct HandleBreakerChange path.
func TestStart_BindsReconcilerContext(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db) // Start is called inside newStore

	// Simulate a breaker recovery edge (open → closed). The reconciler has no
	// outage rows so runPass completes trivially.
	nc.fireStateChange(gobreaker.StateOpen, gobreaker.StateClosed)

	// Give the goroutine a moment to complete; no assertion needed here beyond
	// confirming the state-change path does not panic.
	time.Sleep(50 * time.Millisecond)
	_ = gs
}

// TestDefaultParams_Sane: DefaultParams must return a non-zero Params.
func TestDefaultParams_Sane(t *testing.T) {
	p := DefaultParams()
	if p.Mode != failmode.ModeTieredHybrid {
		t.Fatalf("mode = %v", p.Mode)
	}
	if p.PGFreshness <= 0 {
		t.Fatalf("freshness = %v", p.PGFreshness)
	}
	if p.ExpectedReplicas < 1 {
		t.Fatalf("replicas = %d", p.ExpectedReplicas)
	}
}

// TestUpdateUsage_DeltaPayloadContainsRequiredFields: verifies the JSON delta
// payload carries all the fields the scheduler consumer expects.
func TestUpdateUsage_DeltaPayloadContainsRequiredFields(t *testing.T) {
	nc := newFakeNATS()
	db := &fakeDB{rowErr: failmode.ErrNoBudgetRow}
	gs := newStore(nc, db)

	const costNano = int64(7) * failmode.NanoUSD
	const eventID = "evt-payload-check"
	if err := gs.UpdateUsage(context.Background(), testProject, testScope, testScopeID, eventID, costNano, testPeriod, testPeriodEnd); err != nil {
		t.Fatalf("UpdateUsage: %v", err)
	}

	nc.mu.Lock()
	if len(nc.deltas) == 0 {
		nc.mu.Unlock()
		t.Fatal("no delta published")
	}
	payload := nc.deltas[0]
	nc.mu.Unlock()

	for _, needle := range []string{
		`"project_id"`,
		`"scope"`,
		`"scope_id"`,
		`"event_id"`,
		`"cost_nano"`,
		`"period_start_unix"`,
		`"period_end_unix"`,
	} {
		if !contains(string(payload), needle) {
			t.Errorf("delta payload missing %s: %s", needle, payload)
		}
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && (s == sub || len(s) > 0 && containsStr(s, sub))
}

func containsStr(s, sub string) bool {
	for i := 0; i+len(sub) <= len(s); i++ {
		if s[i:i+len(sub)] == sub {
			return true
		}
	}
	return false
}
