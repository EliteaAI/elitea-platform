package failmode

// user_scope_test.go — the per-member snapshot read (issue #321), the platform
// soft-alert switch carried on it (issue #322), and the usage-ledger row the
// outage path writes beside the accumulator (issue #320).

import (
	"context"
	"strings"
	"testing"
)

// recordingDB captures the SQL and the arguments of the point-read so a test
// can prove WHICH table was consulted. A per-member gate that silently read
// gateway.project_budget would return the project's limit for the member and
// pass every behavioural assertion about verdicts.
type recordingDB struct {
	row      Row
	lastSQL  string
	lastArgs []any
	tx       *storeFakeTx
}

func (d *recordingDB) QueryRow(_ context.Context, sql string, args ...any) Row {
	d.lastSQL = sql
	d.lastArgs = args
	return d.row
}

func (d *recordingDB) Begin(context.Context) (Tx, error) { return d.tx, nil }

func TestUserScopeID_RoundTrips(t *testing.T) {
	got := UserScopeID(42, 7)
	if got != "42:7" {
		t.Fatalf("UserScopeID = %q, want %q — elitea-main joins on this exact shape", got, "42:7")
	}
	userID, ok := UserIDFromScopeID(got)
	if !ok || userID != 7 {
		t.Fatalf("UserIDFromScopeID(%q) = (%d, %v), want (7, true)", got, userID, ok)
	}
}

func TestUserIDFromScopeID_RejectsMalformed(t *testing.T) {
	for _, scopeID := range []string{"", "42", "42:", "42:0", "42:-1", "42:abc", ":7"} {
		if _, ok := UserIDFromScopeID(scopeID); ok {
			t.Fatalf("UserIDFromScopeID(%q) accepted a scope_id that names no member", scopeID)
		}
	}
}

// TestReadSnapshot_UserScopeReadsUserBudget is the discriminating test: it
// proves the member read goes to gateway.user_budget, not to the project table.
func TestReadSnapshot_UserScopeReadsUserBudget(t *testing.T) {
	db := &recordingDB{row: scriptedRow{vals: []any{
		false, int64(5) * NanoUSD, int64(1) * NanoUSD, 75, nil, true, 12.0, false,
	}}}
	snap, err := NewStore(db).ReadSnapshot(context.Background(), 42, ScopeUser, "42:7", 1000)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(db.lastSQL, "gateway.user_budget") {
		t.Fatalf("member snapshot did not read gateway.user_budget; SQL was:\n%s", db.lastSQL)
	}
	// The member id must reach the query as its own parameter. Without it the
	// WHERE clause cannot name a member and the read would return an arbitrary
	// row for the project.
	if len(db.lastArgs) < 6 || db.lastArgs[5] != 7 {
		t.Fatalf("member id not bound as $6; args = %v", db.lastArgs)
	}
	if snap.HardLimitNano != 5*NanoUSD || snap.SoftAlertPct != 75 {
		t.Fatalf("bad member snapshot: %+v", snap)
	}
}

// TestReadSnapshot_ProjectScopeReadsProjectBudget is the negative control for
// the test above: the same Store, one different scope, a different table.
func TestReadSnapshot_ProjectScopeReadsProjectBudget(t *testing.T) {
	db := &recordingDB{row: scriptedRow{vals: []any{
		false, int64(9) * NanoUSD, int64(0), 80, nil, false, 0.0, false,
	}}}
	if _, err := NewStore(db).ReadSnapshot(context.Background(), 42, ScopeProject, "42", 1000); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(db.lastSQL, "gateway.project_budget pb") {
		t.Fatalf("project snapshot did not read gateway.project_budget; SQL was:\n%s", db.lastSQL)
	}
	if strings.Contains(db.lastSQL, "FROM gateway.user_budget") {
		t.Fatal("project snapshot read gateway.user_budget")
	}
}

// TestReadSnapshot_UserScopeRejectsMalformedScopeID pins the fail-closed
// choice: a scope_id that names no member is an error, not "no budget row".
// ErrNoBudgetRow is treated as unlimited by the caller, so returning it here
// would admit a capped member whenever the key was malformed.
func TestReadSnapshot_UserScopeRejectsMalformedScopeID(t *testing.T) {
	db := &recordingDB{row: scriptedRow{vals: []any{}}}
	_, err := NewStore(db).ReadSnapshot(context.Background(), 42, ScopeUser, "not-a-key", 1000)
	if err == nil {
		t.Fatal("a malformed member scope_id was accepted")
	}
	if err == ErrNoBudgetRow {
		t.Fatal("a malformed member scope_id reported ErrNoBudgetRow, which the caller reads as unlimited")
	}
}

// TestReadSnapshot_CarriesSoftAlertSwitch covers the reader half of issue #322.
func TestReadSnapshot_CarriesSoftAlertSwitch(t *testing.T) {
	for _, tc := range []struct {
		name     string
		column   bool
		wantOff  bool
		snapshot Snapshot
	}{
		{name: "alerts on", column: false, wantOff: false},
		{name: "alerts off", column: true, wantOff: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db := &recordingDB{row: scriptedRow{vals: []any{
				false, int64(100) * NanoUSD, int64(0), 80, nil, false, 0.0, tc.column,
			}}}
			snap, err := NewStore(db).ReadSnapshot(context.Background(), 7, ScopeProject, "7", 1000)
			if err != nil {
				t.Fatal(err)
			}
			if snap.SoftAlertsDisabled != tc.wantOff {
				t.Fatalf("SoftAlertsDisabled = %v, want %v", snap.SoftAlertsDisabled, tc.wantOff)
			}
			// And it must survive the FSM, because the handler reads it off the
			// Decision rather than the Snapshot.
			dec := Decide(true, 0, 0, snap, 0, Params{Mode: ModeTieredHybrid})
			if dec.SoftAlertsDisabled != tc.wantOff {
				t.Fatalf("Decision.SoftAlertsDisabled = %v, want %v", dec.SoftAlertsDisabled, tc.wantOff)
			}
		})
	}
}

// TestSnapshotZeroValueKeepsAlertsOn pins the reason the field is negative. A
// Snapshot nobody set the flag on — every unit test, every fake — must keep
// emitting alerts, because that is what a deployment that never touched the
// switch does.
func TestSnapshotZeroValueKeepsAlertsOn(t *testing.T) {
	if (Snapshot{}).SoftAlertsDisabled {
		t.Fatal("the zero Snapshot disables soft alerts; forgetting the field would silence them")
	}
	if Decide(true, 0, 0, Snapshot{}, 0, Params{}).SoftAlertsDisabled {
		t.Fatal("the zero Decision disables soft alerts")
	}
}

// TestPersistOutageDelta_WritesLedgerRow covers issue #320's degraded path: a
// request billed while NATS is down never reaches the write-back consumer, so
// the ledger row has to be written here or the Usage page is silently short.
func TestPersistOutageDelta_WritesLedgerRow(t *testing.T) {
	userID := 7
	tx := &multiExecTx{}
	store := NewStore(&execRecordingDB{tx: tx})

	err := store.PersistOutageDelta(context.Background(), OutageDelta{
		ProjectID:    42,
		Scope:        ScopeProject,
		ScopeID:      "42",
		EventID:      "11111111-1111-1111-1111-111111111111",
		PeriodStart:  1000,
		PeriodEnd:    2000,
		DeltaNanoUSD: 3_000_000_000,
		Usage: &UsageDimensions{
			UserID: &userID, Provider: "openai", Model: "gpt-4o",
			PromptTokens: 11, CompletionTokens: 22,
			OccurredAtUnix: 1500,
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(tx.statements) != 2 {
		t.Fatalf("ran %d statements, want 2 (accumulator + ledger)", len(tx.statements))
	}
	if !strings.Contains(tx.statements[1], "gateway.llm_usage_events") {
		t.Fatalf("second statement was not the ledger insert:\n%s", tx.statements[1])
	}
	if !strings.Contains(tx.statements[1], "ON CONFLICT (event_id) DO NOTHING") {
		t.Fatal("the ledger insert is not idempotent; a redelivery would duplicate the row")
	}
	// The gateway's billing instant travels with the row. A now() default here
	// would date an outage-window request to whenever the write succeeded.
	if got := tx.args[1][10]; got != int64(1500) {
		t.Fatalf("occurred_at arg = %v, want the billing instant 1500", got)
	}
	if !tx.committed {
		t.Fatal("transaction was not committed")
	}
}

// TestPersistOutageDelta_NoUsageWritesNoLedgerRow is the negative control: the
// member-scope delta of a request whose dimensions the project delta already
// recorded must not add a second row.
func TestPersistOutageDelta_NoUsageWritesNoLedgerRow(t *testing.T) {
	tx := &multiExecTx{}
	err := NewStore(&execRecordingDB{tx: tx}).PersistOutageDelta(context.Background(), OutageDelta{
		ProjectID:    42,
		Scope:        ScopeUser,
		ScopeID:      "42:7",
		EventID:      "22222222-2222-2222-2222-222222222222",
		PeriodStart:  1000,
		PeriodEnd:    2000,
		DeltaNanoUSD: 3_000_000_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(tx.statements) != 1 {
		t.Fatalf("ran %d statements, want 1 (accumulator only)", len(tx.statements))
	}
}

// TestOutageDelta_UsageWithoutEventIDIsRejected keeps the ledger's primary key
// from ever being empty, which would make the second such row a conflict rather
// than a record.
func TestOutageDelta_UsageWithoutEventIDIsRejected(t *testing.T) {
	tx := &multiExecTx{}
	err := NewStore(&execRecordingDB{tx: tx}).PersistOutageDelta(context.Background(), OutageDelta{
		ProjectID:    42,
		Scope:        ScopeProject,
		ScopeID:      "42",
		PeriodStart:  1000,
		PeriodEnd:    2000,
		DeltaNanoUSD: 1,
		Usage:        &UsageDimensions{Model: "gpt-4o"},
	})
	if err == nil {
		t.Fatal("usage dimensions were accepted without an event id")
	}
}

// multiExecTx records every statement in order, unlike storeFakeTx which keeps
// only the last one.
type multiExecTx struct {
	statements []string
	args       [][]any
	committed  bool
}

func (t *multiExecTx) QueryRow(context.Context, string, ...any) Row {
	return scriptedRow{scanErr: context.Canceled}
}
func (t *multiExecTx) Query(context.Context, string, ...any) (Rows, error) {
	return nil, context.Canceled
}
func (t *multiExecTx) ExecAffected(_ context.Context, sql string, args ...any) (int64, error) {
	t.statements = append(t.statements, sql)
	t.args = append(t.args, args)
	return 1, nil
}
func (t *multiExecTx) Commit(context.Context) error   { t.committed = true; return nil }
func (t *multiExecTx) Rollback(context.Context) error { return nil }

type execRecordingDB struct {
	tx *multiExecTx
}

func (d *execRecordingDB) QueryRow(context.Context, string, ...any) Row {
	return scriptedRow{scanErr: context.Canceled}
}
func (d *execRecordingDB) Begin(context.Context) (Tx, error) { return d.tx, nil }
