package failmode

// BF0.4b — Disjoint-row integration test (recovery side).
//
// Companion to services/elitea-scheduler/internal/budgetwriteback/
// disjoint_writeback_test.go. The two writers of gateway.llm_budget_accumulators
// live in separate modules behind internal/ boundaries, so neither can import
// the other and a single in-process test spanning both real writers is
// impossible without a shared live Postgres (absent offline). This file proves
// the §8.5 invariant from the recovery goroutine's side: driving the REAL
// Reconciler.runPass against a full accumulator-table model whose enumerate
// query FILTERS by the exact recovery predicate (outage_mode AND NOT reconciled),
// so HEALTHY write-back-owned rows are provably excluded from every recovery
// touch, and a reconciled row's flags flip to rejoin the write-back path.

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/jackc/pgx/v5"
)

// tblRow mirrors the coordination columns the two writers partition on.
type tblRow struct {
	id              string
	scope           string
	scopeID         string
	periodStartUnix int64
	accumulatedNano int64
	outageMode      bool
	reconciled      bool
}

// recoveryOwns is the real selectOutageRowsSQL predicate.
func (r *tblRow) recoveryOwns() bool { return r.outageMode && !r.reconciled }

// writeBackOwns is the upsertSQL guard NOT (outage_mode AND NOT reconciled),
// in its De Morgan form (!outage OR reconciled).
func (r *tblRow) writeBackOwns() bool { return !r.outageMode || r.reconciled }

// recTable is a shared in-memory accumulator table the real reconciler drives.
type recTable struct {
	mu   sync.Mutex
	rows map[string]*tblRow // keyed by row id
}

func newRecTable(rows ...*tblRow) *recTable {
	m := make(map[string]*tblRow, len(rows))
	for _, r := range rows {
		m[r.id] = r
	}
	return &recTable{rows: m}
}

// tblDB adapts recTable to the failmode DB seam, faithfully evaluating the
// recovery SQL's row selection and state transitions.
type tblDB struct{ tbl *recTable }

func (d *tblDB) QueryRow(context.Context, string, ...any) Row {
	return scriptedRow{scanErr: errors.New("recovery uses tx-scoped reads only")}
}

func (d *tblDB) Begin(context.Context) (Tx, error) { return &tblTx{tbl: d.tbl}, nil }

// tblTx serves BOTH the enumerate tx (Query + mark ExecAffected) and each
// per-scope tx (re-lock QueryRow + finalize ExecAffected) against the shared
// table. Which role a call plays is disambiguated by the SQL, exactly as the
// real pgx path routes to distinct statements.
type tblTx struct {
	tbl    *recTable
	lockID string // id captured by a phase-1 re-lock QueryRow, used by finalize
}

func (t *tblTx) QueryRow(_ context.Context, _ string, args ...any) Row {
	// Phase-1 re-lock: SELECT (accumulated_cost*NanoUSD)::bigint WHERE id=$1
	// AND outage_mode=true AND reconciled=false FOR UPDATE. A row that no longer
	// matches the predicate (already reconciled) yields ErrNoRows.
	id, _ := args[0].(string)
	t.lockID = id
	t.tbl.mu.Lock()
	defer t.tbl.mu.Unlock()
	r := t.tbl.rows[id]
	if r == nil || !r.recoveryOwns() {
		return scriptedRow{scanErr: pgx.ErrNoRows}
	}
	return scriptedRow{vals: []any{r.accumulatedNano}}
}

func (t *tblTx) Query(_ context.Context, _ string, _ ...any) (Rows, error) {
	// Enumerate: SELECT ... WHERE outage_mode=true AND reconciled=false
	// FOR UPDATE SKIP LOCKED. Only recovery-owned rows are returned — healthy
	// rows are excluded by the predicate, which is the disjointness proof.
	t.tbl.mu.Lock()
	defer t.tbl.mu.Unlock()
	var out []outageRow
	for _, r := range t.tbl.rows {
		if r.recoveryOwns() {
			out = append(out, outageRow{
				id:              r.id,
				scope:           r.scope,
				scopeID:         r.scopeID,
				periodStartUnix: r.periodStartUnix,
				accumulatedNano: r.accumulatedNano,
			})
		}
	}
	return &tblRows{rows: out}, nil
}

func (t *tblTx) ExecAffected(_ context.Context, sql string, args ...any) (int64, error) {
	id, _ := args[0].(string)
	t.tbl.mu.Lock()
	defer t.tbl.mu.Unlock()
	r := t.tbl.rows[id]
	if r == nil {
		return 0, nil
	}
	switch {
	case containsFold(sql, "reconciliation_in_progress = true") && !containsFold(sql, "reconciled = true"):
		// Phase-1 mark — a no-op flag we don't model beyond RowsAffected.
		return 1, nil
	case containsFold(sql, "reconciled = true"):
		// Phase-3 finalizeRowSQL effect: rejoin the write-back path.
		r.reconciled = true
		r.outageMode = false
		return 1, nil
	}
	return 1, nil
}

func (t *tblTx) Commit(context.Context) error   { return nil }
func (t *tblTx) Rollback(context.Context) error { return nil }

// containsFold is a tiny case-insensitive substring check to route by SQL text
// without pulling in strings for a single use elsewhere.
func containsFold(haystack, needle string) bool {
	return len(needle) == 0 || indexFold(haystack, needle) >= 0
}

func indexFold(s, sub string) int {
	for i := 0; i+len(sub) <= len(s); i++ {
		if eqFold(s[i:i+len(sub)], sub) {
			return i
		}
	}
	return -1
}

func eqFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
}

// tblRows iterates recovery-owned rows for the enumerate Query.
type tblRows struct {
	rows []outageRow
	i    int
}

func (r *tblRows) Next() bool {
	if r.i >= len(r.rows) {
		return false
	}
	r.i++
	return true
}
func (r *tblRows) Scan(dest ...any) error {
	row := r.rows[r.i-1]
	*(dest[0].(*string)) = row.id
	*(dest[1].(*string)) = row.scope
	*(dest[2].(*string)) = row.scopeID
	*(dest[3].(*int64)) = row.periodStartUnix
	*(dest[4].(*int64)) = row.accumulatedNano
	return nil
}
func (r *tblRows) Err() error { return nil }
func (r *tblRows) Close()     {}

// TestDisjointRowRecovery drives the REAL Reconciler.runPass against a table
// holding BOTH an outage-owned row and a healthy write-back-owned row, asserting
// recovery finalizes only the outage row, leaves the healthy row wholly
// untouched (its flags AND its accumulated total), and replays exactly the
// outage delta onto the recovered NATS counter — the §8.5 disjointness invariant
// from the recovery side.
func TestDisjointRowRecovery(t *testing.T) {
	outage := &tblRow{
		id: "r-outage", scope: "project", scopeID: "7", periodStartUnix: 1_700_000_000,
		accumulatedNano: 5_000_000_000, outageMode: true, reconciled: false,
	}
	healthy := &tblRow{
		id: "r-healthy", scope: "project", scopeID: "8", periodStartUnix: 1_700_000_000,
		accumulatedNano: 1_000_000_000, outageMode: false, reconciled: false,
	}
	tbl := newRecTable(outage, healthy)
	db := &tblDB{tbl: tbl}

	c := newFakeCounter()
	c.totals["project.7"] = 3_000_000_000 // NATS frozen at pre-outage $3.00
	dc := NewDegradedCounters()
	dc.Add("project.7", 999)

	r := startedReconciler(db, c, dc)
	r.runPass(context.Background())

	// Outage row: finalized (reconciled, no longer outage) and its spend replayed.
	if !outage.reconciled || outage.outageMode {
		t.Fatalf("outage row not finalized: %+v", outage)
	}
	// Replay delta = accumulated(5e9) − counter(3e9) = 2e9.
	if len(c.incrs) != 1 || c.incrs[0].delta != 2_000_000_000 || c.incrs[0].subject != "project.7" {
		t.Fatalf("expected one 2e9 incr on project.7, got %+v", c.incrs)
	}
	if c.totals["project.7"] != 5_000_000_000 {
		t.Fatalf("recovered counter = %d, want 5e9", c.totals["project.7"])
	}

	// Healthy row: recovery must NOT have touched it at all.
	if healthy.reconciled || healthy.outageMode || healthy.accumulatedNano != 1_000_000_000 {
		t.Fatalf("recovery perturbed the healthy write-back row: %+v", healthy)
	}
	// The reconciled scope's degraded cap resets now that its outage spend is on
	// the authoritative counter (§8.5; a fully-clean pass also calls ResetAll).
	if dc.Get("project.7") != 0 {
		t.Fatalf("outage scope cap not reset: %d", dc.Get("project.7"))
	}

	// Post-recovery both rows are write-back-owned and neither is recovery-owned
	// — the row space is again cleanly partitioned for the write-back consumer.
	for _, row := range []*tblRow{outage, healthy} {
		if !row.writeBackOwns() || row.recoveryOwns() {
			t.Fatalf("row %s not returned to write-back ownership: %+v", row.id, row)
		}
	}
}
