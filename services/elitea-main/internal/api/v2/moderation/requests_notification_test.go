package moderation

// The defect: insertDecisionNotification wrote centry.notifications with only
// (project_id, user_id, meta, event_type). The two remaining NOT NULL columns,
// `uuid` and `is_seen`, were left to a server default.
//
// The evidence that no such default exists: internal/db/schema/notifications_baseline.sql
// declares `uuid uuid NOT NULL UNIQUE` and `is_seen boolean NOT NULL` with no
// DEFAULT, and that projection was verified against the running platform
// schema. The legacy model supplies both values in Python, not in the database.
// Only this repository's 001_initial.sql adds server defaults, and it uses
// CREATE TABLE IF NOT EXISTS, so a database the legacy platform created never
// receives them.
//
// The failure: an operator approves or rejects an App Request. The INSERT fails
// with SQLSTATE 23502 (null value in a NOT NULL column). It runs in the same
// transaction as the moderation_state status UPDATE, so the decision rolls
// back, the endpoint answers 500, and the row keeps status `pending`.
//
// The integration suite cannot see this. It loads 001_initial.sql, which is the
// one schema that DOES carry the defaults. This test reads the statement
// instead, so it needs no database.

import (
	"context"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// recordingTx captures the one statement insertDecisionNotification executes.
// It embeds pgx.Tx to satisfy the interface; no other method is called.
type recordingTx struct {
	pgx.Tx
	sql  string
	args []any
}

func (t *recordingTx) Exec(_ context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	t.sql = sql
	t.args = args
	return pgconn.CommandTag{}, nil
}

func TestDecisionNotificationBindsUUIDAndIsSeen(t *testing.T) {
	tx := &recordingTx{}
	row := requestRow{
		UserID:    9,
		ProjectID: 7,
		IssueType: "toolkit",
		EntityID:  "jira",
		Status:    "approved",
	}

	if err := insertDecisionNotification(context.Background(), tx, row); err != nil {
		t.Fatalf("insertDecisionNotification: %v", err)
	}

	columns := tx.sql[strings.Index(tx.sql, "(") : strings.Index(tx.sql, ")")+1]
	for _, column := range []string{"uuid", "is_seen"} {
		if !strings.Contains(columns, column) {
			t.Fatalf("column list %q does not bind %q; the platform schema has no default for it", columns, column)
		}
	}

	if len(tx.args) == 0 {
		t.Fatal("statement binds no arguments")
	}
	minted, ok := tx.args[0].(string)
	if !ok {
		t.Fatalf("first argument is %T, want the minted uuid string", tx.args[0])
	}
	if _, err := uuid.Parse(minted); err != nil {
		t.Fatalf("first argument %q is not a uuid: %v", minted, err)
	}
}
