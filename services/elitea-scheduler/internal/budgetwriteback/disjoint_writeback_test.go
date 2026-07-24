package budgetwriteback

// BF0.4b — Disjoint-row integration test (write-back side).
//
// This test proves the §8.5/§8.6 disjointness invariant from the write-back
// consumer's side, driving the REAL Store.Apply (the production dedup + guarded
// UPSERT logic) against an in-memory accumulator-table model whose fake Tx
// faithfully evaluates the load-bearing SQL semantics:
//
//   - dedupSQL   : INSERT ... ON CONFLICT DO NOTHING RETURNING event_id, with
//                  transactional staging (a rolled-back group persists NO dedup
//                  rows, so it is redeliverable).
//   - upsertSQL  : the delta-UPSERT whose DO UPDATE is guarded by
//                  WHERE NOT (outage_mode AND NOT reconciled). A guard miss ⇒
//                  RowsAffected()==0 ⇒ Store.Apply reports outcomeDeferred.
//
// The recovery-reconciliation goroutine (§8.5) lives in the gateway module
// (services/elitea-llm-gateway/internal/failmode) behind an internal/ boundary,
// so it CANNOT be imported here — a single in-process test spanning both real
// writers is structurally impossible without a shared live Postgres (absent in
// this offline dev env, like the sibling BF-Build infra checks). The real
// reconciler is exercised in that package's recovery_test.go, and this file's
// companion is failmode/disjoint_recovery_test.go which drives the REAL
// Reconciler.runPass against a table-modeling enumerate. Here, recovery's
// row-state transition is modeled using the EXACT predicates from the real
// selectOutageRowsSQL (outage_mode AND NOT reconciled) and finalizeRowSQL
// (reconciled=true, outage_mode=false) so the shared row model is faithful.

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// --- faithful in-memory accumulator-table model ------------------------------

// acctRow mirrors the coordination columns of gateway.llm_budget_accumulators
// that the two writers partition on (accumulated_cost is kept in nano-USD here
// to match the int64 money path; the real column is USD NUMERIC and the SQL
// converts, which is asserted separately by TestUpsertSQL_UsesNanoDivisorAndGuard).
type acctRow struct {
	accumulatedNano int64
	outageMode      bool
	reconciled      bool
}

// writeBackOwns reports whether the write-back consumer's guarded UPSERT may
// touch this row — the upsertSQL guard NOT (outage_mode AND NOT reconciled),
// written here in its De Morgan form (!outage OR reconciled).
func (r *acctRow) writeBackOwns() bool { return !r.outageMode || r.reconciled }

// recoveryOwns reports whether the gateway recovery goroutine may touch this row
// — the exact selectOutageRowsSQL predicate: outage_mode AND NOT reconciled.
func (r *acctRow) recoveryOwns() bool { return r.outageMode && !r.reconciled }

// acctTable is the shared row model both writers operate on, keyed by the
// accumulator's unique (scope, scope_id, period_start).
type acctTable struct {
	rows    map[deltaKey]*acctRow
	applied map[string]bool // committed gateway.processed_event_ids
}

func newAcctTable() *acctTable {
	return &acctTable{rows: map[deltaKey]*acctRow{}, applied: map[string]bool{}}
}

// modelRecovery applies the gateway reconciler's row-state EFFECT to the table:
// it selects rows matching recoveryOwns() (the real selectOutageRowsSQL
// predicate) and finalizes them (reconciled=true, outage_mode=false — the real
// finalizeRowSQL effect), returning the keys it touched. The outage spend is
// already in accumulated_cost; recovery only flips the flags so the row rejoins
// the healthy write-back path. It never adds to accumulated_cost, so it cannot
// double-count against a subsequent write-back delta.
func (tbl *acctTable) modelRecovery() []deltaKey {
	var touched []deltaKey
	for k, r := range tbl.rows {
		if r.recoveryOwns() {
			r.reconciled = true
			r.outageMode = false
			touched = append(touched, k)
		}
	}
	return touched
}

// --- fake Tx that evaluates the real SQL semantics with staging --------------

// tableTx models one Postgres transaction over acctTable. Dedup inserts and the
// single upsert are STAGED and only applied on Commit; a Rollback (which
// Store.Apply always defers, and calls explicitly on a deferred group) discards
// them — reproducing the "deferred group persists nothing" guarantee (§8.6).
type tableTx struct {
	tbl *acctTable

	stagedIDs []string       // event_ids probed-new this tx (not yet committed)
	pending   *pendingUpsert // the at-most-one upsert staged this tx
	committed bool
}

// pendingUpsert is the resolved effect of the guarded UPSERT, computed at exec
// time against the current table state and applied on Commit.
type pendingUpsert struct {
	key     deltaKey
	newRow  *acctRow // non-nil ⇒ INSERT (fresh period)
	addNano int64    // for an existing, write-back-owned row: accumulated += this
	touched bool     // whether a row was/will be mutated (RowsAffected>=1)
}

func (t *tableTx) QueryRow(_ context.Context, sql string, args ...any) Row {
	if !strings.Contains(sql, "processed_event_ids") {
		return tableRow{scanErr: errors.New("unexpected QueryRow sql")}
	}
	id, _ := args[0].(string)
	// ON CONFLICT DO NOTHING RETURNING: a row comes back only if the id is not
	// already committed AND not already staged in this tx.
	if t.tbl.applied[id] || t.hasStaged(id) {
		return tableRow{scanErr: pgx.ErrNoRows}
	}
	t.stagedIDs = append(t.stagedIDs, id)
	return tableRow{returnID: id}
}

func (t *tableTx) hasStaged(id string) bool {
	for _, s := range t.stagedIDs {
		if s == id {
			return true
		}
	}
	return false
}

func (t *tableTx) ExecAffected(_ context.Context, sql string, args ...any) (int64, error) {
	if !strings.Contains(sql, "llm_budget_accumulators") {
		return 0, errors.New("unexpected Exec sql")
	}
	// upsertSQL arg order: project_id, org_id, scope, scope_id, period_start,
	// period_end, sumNano.
	key := deltaKey{
		scope:       args[2].(string),
		scopeID:     args[3].(string),
		periodStart: args[4].(int64),
	}
	sumNano := args[6].(int64)

	existing := t.tbl.rows[key]
	if existing == nil {
		// Fresh INSERT for a new period: always affects 1 row, outage_mode=false.
		t.pending = &pendingUpsert{
			key:     key,
			newRow:  &acctRow{accumulatedNano: sumNano, outageMode: false, reconciled: false},
			touched: true,
		}
		return 1, nil
	}
	if !existing.writeBackOwns() {
		// Guard blocked the DO UPDATE (outage-owned row): RowsAffected()==0.
		t.pending = &pendingUpsert{key: key, touched: false}
		return 0, nil
	}
	t.pending = &pendingUpsert{key: key, addNano: sumNano, touched: true}
	return 1, nil
}

func (t *tableTx) Commit(context.Context) error {
	t.committed = true
	for _, id := range t.stagedIDs {
		t.tbl.applied[id] = true
	}
	if p := t.pending; p != nil {
		switch {
		case p.newRow != nil:
			t.tbl.rows[p.key] = p.newRow
		case p.touched:
			t.tbl.rows[p.key].accumulatedNano += p.addNano
		}
	}
	return nil
}

func (t *tableTx) Rollback(context.Context) error {
	// A pre-commit rollback discards staged dedup ids and the pending upsert.
	if !t.committed {
		t.stagedIDs = nil
		t.pending = nil
	}
	return nil
}

// tableRow is the dedup-probe scan result.
type tableRow struct {
	returnID string
	scanErr  error
}

func (r tableRow) Scan(dest ...any) error {
	if r.scanErr != nil {
		return r.scanErr
	}
	if len(dest) == 1 {
		if p, ok := dest[0].(*string); ok {
			*p = r.returnID
		}
	}
	return nil
}

// tableDB hands out a fresh tableTx per Begin, all sharing the one acctTable.
type tableDB struct{ tbl *acctTable }

func (d *tableDB) Begin(context.Context) (Tx, error) { return &tableTx{tbl: d.tbl}, nil }

// deltaFor builds a write-back delta targeting a specific key.
func deltaFor(eventID, scope, scopeID string, periodStart int64, nano int64) BudgetDelta {
	return BudgetDelta{
		EventID:      eventID,
		Scope:        scope,
		ScopeID:      scopeID,
		ProjectID:    99,
		PeriodStart:  periodStart,
		PeriodEnd:    periodStart + 2_600_000,
		DeltaNanoUSD: nano,
	}
}

// --- the test ----------------------------------------------------------------

// TestDisjointRowWriteBack drives the real Store.Apply through the full
// outage → recovery → resume lifecycle against a shared row model, asserting:
//
//  1. The write-back consumer touches only rows it owns (NOT outage-unreconciled).
//  2. A delta for an outage-owned row is DEFERRED — not applied, and its dedup
//     rows are NOT persisted (so JetStream redelivery re-runs it cleanly).
//  3. The write-back and recovery touched-row sets are DISJOINT throughout.
//  4. After recovery finalizes the outage row, the SAME redelivered delta now
//     applies exactly once on top of the reconciled accumulated total — the
//     outage spend is preserved and NOT double-counted (post-recovery resume).
func TestDisjointRowWriteBack(t *testing.T) {
	const period = int64(1_700_000_000)
	outageKey := deltaKey{scope: "project", scopeID: "7", periodStart: period}
	healthyKey := deltaKey{scope: "project", scopeID: "8", periodStart: period}

	tbl := newAcctTable()
	// Row A: an OUTAGE-owned row — the gateway billed $5.00 while NATS was down
	// (outage_mode=true, reconciled=false). Recovery owns it until it finalizes.
	tbl.rows[outageKey] = &acctRow{accumulatedNano: 5_000_000_000, outageMode: true, reconciled: false}
	// Row B: a HEALTHY row from an earlier write-back ($1.00, outage_mode=false).
	tbl.rows[healthyKey] = &acctRow{accumulatedNano: 1_000_000_000, outageMode: false, reconciled: false}

	// Sanity: the two ownership predicates partition the initial rows.
	assertDisjointOwnership(t, tbl)

	store := NewStore(&tableDB{tbl: tbl})

	// --- Step 1: write-back delta for the OUTAGE key must DEFER --------------
	outageDelta := deltaFor("aaaaaaaa-0000-0000-0000-000000000001", "project", "7", period, 2_000_000_000) // $2.00
	outcome, err := store.Apply(context.Background(), []BudgetDelta{outageDelta})
	if err != nil {
		t.Fatalf("apply(outage key): %v", err)
	}
	if outcome != outcomeDeferred {
		t.Fatalf("outage-owned row: outcome = %v, want deferred", outcome)
	}
	if got := tbl.rows[outageKey].accumulatedNano; got != 5_000_000_000 {
		t.Fatalf("outage row must be untouched by write-back, got %d nano", got)
	}
	if tbl.applied[outageDelta.EventID] {
		t.Fatal("deferred group MUST NOT persist dedup rows (must be redeliverable)")
	}

	// --- Step 2: write-back delta for the HEALTHY key applies ---------------
	healthyDelta := deltaFor("bbbbbbbb-0000-0000-0000-000000000002", "project", "8", period, 500_000_000) // $0.50
	outcome, err = store.Apply(context.Background(), []BudgetDelta{healthyDelta})
	if err != nil {
		t.Fatalf("apply(healthy key): %v", err)
	}
	if outcome != outcomeApplied {
		t.Fatalf("healthy row: outcome = %v, want applied", outcome)
	}
	if got := tbl.rows[healthyKey].accumulatedNano; got != 1_500_000_000 {
		t.Fatalf("healthy row = %d nano, want 1500000000 ($1.00 + $0.50)", got)
	}
	// The outage row is STILL untouched — the two writers never collided.
	if got := tbl.rows[outageKey].accumulatedNano; got != 5_000_000_000 {
		t.Fatalf("outage row perturbed by an unrelated write-back, got %d nano", got)
	}

	// --- Step 3: recovery finalizes ONLY the outage-owned row ---------------
	recovered := tbl.modelRecovery()
	if len(recovered) != 1 || recovered[0] != outageKey {
		t.Fatalf("recovery must touch exactly the outage row, touched %+v", recovered)
	}
	// Recovery preserved the accumulated outage spend and flipped the flags.
	if r := tbl.rows[outageKey]; r.accumulatedNano != 5_000_000_000 || r.outageMode || !r.reconciled {
		t.Fatalf("post-recovery outage row = %+v, want {5e9, outage=false, reconciled=true}", r)
	}
	// Post-recovery the ownership predicates still partition every row.
	assertDisjointOwnership(t, tbl)

	// --- Step 4: post-recovery resume — the redelivered delta now applies ---
	// JetStream redelivers the Step-1 delta (its dedup rows never persisted).
	// The row now passes the guard (reconciled=true), so the $2.00 applies on
	// top of the preserved $5.00 outage spend: $7.00 total, counted once.
	outcome, err = store.Apply(context.Background(), []BudgetDelta{outageDelta})
	if err != nil {
		t.Fatalf("apply(redelivered outage delta): %v", err)
	}
	if outcome != outcomeApplied {
		t.Fatalf("post-recovery redelivery: outcome = %v, want applied", outcome)
	}
	if got := tbl.rows[outageKey].accumulatedNano; got != 7_000_000_000 {
		t.Fatalf("post-recovery total = %d nano, want 7000000000 ($5.00 outage + $2.00, no double-count)", got)
	}
	if !tbl.applied[outageDelta.EventID] {
		t.Fatal("applied delta must now be recorded in the dedup ledger")
	}

	// --- Step 5: a further redelivery of the same event is a no-op ----------
	// The dedup ledger now suppresses it — no third-count of the $2.00.
	outcome, err = store.Apply(context.Background(), []BudgetDelta{outageDelta})
	if err != nil {
		t.Fatalf("apply(second redelivery): %v", err)
	}
	if outcome != outcomeApplied {
		t.Fatalf("idempotent redelivery: outcome = %v, want applied (no-op commit)", outcome)
	}
	if got := tbl.rows[outageKey].accumulatedNano; got != 7_000_000_000 {
		t.Fatalf("dedup failed: total = %d nano, want 7000000000 (unchanged)", got)
	}
}

// assertDisjointOwnership fails if any row is owned by both writers or by
// neither — the two predicates must partition the row space exactly.
func assertDisjointOwnership(t *testing.T, tbl *acctTable) {
	t.Helper()
	for k, r := range tbl.rows {
		wb, rec := r.writeBackOwns(), r.recoveryOwns()
		if wb == rec {
			t.Fatalf("row %+v owned by both/neither writer: writeBack=%v recovery=%v (%+v)", k, wb, rec, r)
		}
	}
}

// TestDisjointRowWriteBack_CoalescedGroupDeferredAtomically proves a coalesced
// multi-delta group targeting an outage-owned row defers ATOMICALLY: none of the
// group's dedup rows persist, so the whole group is cleanly redelivered (a
// partial apply would double-count on redelivery).
func TestDisjointRowWriteBack_CoalescedGroupDeferredAtomically(t *testing.T) {
	const period = int64(1_700_000_000)
	key := deltaKey{scope: "project", scopeID: "7", periodStart: period}
	tbl := newAcctTable()
	tbl.rows[key] = &acctRow{accumulatedNano: 3_000_000_000, outageMode: true, reconciled: false}
	store := NewStore(&tableDB{tbl: tbl})

	d1 := deltaFor("cccccccc-0000-0000-0000-000000000001", "project", "7", period, 1_000_000_000)
	d2 := deltaFor("cccccccc-0000-0000-0000-000000000002", "project", "7", period, 1_000_000_000)

	outcome, err := store.Apply(context.Background(), []BudgetDelta{d1, d2})
	if err != nil {
		t.Fatalf("apply: %v", err)
	}
	if outcome != outcomeDeferred {
		t.Fatalf("coalesced outage group: outcome = %v, want deferred", outcome)
	}
	if tbl.applied[d1.EventID] || tbl.applied[d2.EventID] {
		t.Fatal("deferred coalesced group leaked dedup rows — redelivery would double-count")
	}
	if got := tbl.rows[key].accumulatedNano; got != 3_000_000_000 {
		t.Fatalf("outage row mutated by a deferred group: %d nano", got)
	}
}
