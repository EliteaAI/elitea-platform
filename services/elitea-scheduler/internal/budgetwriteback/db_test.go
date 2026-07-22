package budgetwriteback

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

// stubPgxTx embeds pgx.Tx (so it satisfies the full interface) and overrides
// only the four methods pgxTx forwards, letting us exercise the adapter's
// translation logic — notably ExecAffected → CommandTag.RowsAffected() — with no
// live Postgres.
type stubPgxTx struct {
	pgx.Tx
	tag        pgconn.CommandTag
	execErr    error
	committed  bool
	rolledBack bool
}

func (s *stubPgxTx) Exec(context.Context, string, ...any) (pgconn.CommandTag, error) {
	if s.execErr != nil {
		return pgconn.CommandTag{}, s.execErr
	}
	return s.tag, nil
}
func (s *stubPgxTx) Commit(context.Context) error   { s.committed = true; return nil }
func (s *stubPgxTx) Rollback(context.Context) error { s.rolledBack = true; return nil }

// errRow is a pgx.Row that always errors, used to prove QueryRow forwards the
// underlying tx's row through unchanged.
type errRow struct{}

func (errRow) Scan(...any) error { return errors.New("sentinel row") }

func (s *stubPgxTx) QueryRow(context.Context, string, ...any) pgx.Row { return errRow{} }

func TestPgxTx_ExecAffectedReturnsRowsAffected(t *testing.T) {
	stub := &stubPgxTx{tag: pgconn.NewCommandTag("UPDATE 3")}
	adapter := &pgxTx{tx: stub}
	n, err := adapter.ExecAffected(context.Background(), "UPDATE x")
	if err != nil {
		t.Fatalf("ExecAffected: %v", err)
	}
	if n != 3 {
		t.Errorf("RowsAffected = %d, want 3", n)
	}
}

func TestPgxTx_ExecAffectedZeroRows(t *testing.T) {
	// The outage-guard signal: DO UPDATE matched no row.
	stub := &stubPgxTx{tag: pgconn.NewCommandTag("UPDATE 0")}
	n, err := (&pgxTx{tx: stub}).ExecAffected(context.Background(), "UPDATE x")
	if err != nil || n != 0 {
		t.Fatalf("want (0,nil), got (%d,%v)", n, err)
	}
}

func TestPgxTx_ExecAffectedError(t *testing.T) {
	stub := &stubPgxTx{execErr: errors.New("deadlock")}
	if _, err := (&pgxTx{tx: stub}).ExecAffected(context.Background(), "UPDATE x"); err == nil {
		t.Fatal("expected exec error to propagate")
	}
}

func TestPgxTx_QueryRowForwards(t *testing.T) {
	row := (&pgxTx{tx: &stubPgxTx{}}).QueryRow(context.Background(), "SELECT 1")
	if err := row.Scan(); err == nil {
		t.Fatal("expected the underlying tx's row to be forwarded unchanged")
	}
}

func TestNewPoolDB_Wraps(t *testing.T) {
	// NewPoolDB is a pure wrapper: no connection is opened until Begin.
	db := NewPoolDB(nil)
	if db == nil || db.Pool != nil {
		t.Fatalf("NewPoolDB(nil) = %+v, want &PoolDB{Pool:nil}", db)
	}
	var _ DB = db // satisfies the seam
}

func TestPgxTx_CommitRollbackForward(t *testing.T) {
	stub := &stubPgxTx{}
	adapter := &pgxTx{tx: stub}
	if err := adapter.Commit(context.Background()); err != nil {
		t.Fatalf("commit: %v", err)
	}
	if err := adapter.Rollback(context.Background()); err != nil {
		t.Fatalf("rollback: %v", err)
	}
	if !stub.committed || !stub.rolledBack {
		t.Errorf("commit/rollback not forwarded: committed=%v rolledBack=%v", stub.committed, stub.rolledBack)
	}
}
