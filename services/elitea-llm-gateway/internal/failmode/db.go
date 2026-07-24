package failmode

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is the minimal single-row scan surface (pgx.Row satisfies it).
type Row interface {
	Scan(dest ...any) error
}

// Rows is the minimal multi-row surface for the recovery SELECT ... FOR UPDATE.
type Rows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}

// Tx is the narrow transaction surface the FSM store needs, kept small so tests
// inject a fake without a live Postgres (mirrors budgetwriteback):
//   - QueryRow: the snapshot point-read and the dedup / marker probes.
//   - Query: the recovery SELECT ... FOR UPDATE of outage rows.
//   - ExecAffected: the outage-window UPSERT and the reconcile UPDATE; the
//     rows-affected count is the applied/deferred signal.
//   - Commit/Rollback.
type Tx interface {
	QueryRow(ctx context.Context, sql string, args ...any) Row
	Query(ctx context.Context, sql string, args ...any) (Rows, error)
	ExecAffected(ctx context.Context, sql string, args ...any) (int64, error)
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

// DB opens a transaction and supports a non-transactional point-read for the
// hot-path snapshot (which must not hold a transaction on the /llm path).
type DB interface {
	Begin(ctx context.Context) (Tx, error)
	QueryRow(ctx context.Context, sql string, args ...any) Row
}

// PoolDB adapts a *pgxpool.Pool to the DB interface.
type PoolDB struct {
	Pool *pgxpool.Pool
}

var _ DB = (*PoolDB)(nil)

// NewPoolDB wraps a pgxpool.Pool for use with the FSM store.
func NewPoolDB(pool *pgxpool.Pool) *PoolDB { return &PoolDB{Pool: pool} }

// QueryRow runs a single-row query directly on the pool (no transaction).
func (p *PoolDB) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return p.Pool.QueryRow(ctx, sql, args...)
}

// Begin starts a pgx transaction and wraps it in the narrow Tx interface.
func (p *PoolDB) Begin(ctx context.Context) (Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &pgxTx{tx: tx}, nil
}

// pgxTx adapts pgx.Tx to the FSM store's Tx interface.
type pgxTx struct {
	tx pgx.Tx
}

func (t *pgxTx) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t *pgxTx) Query(ctx context.Context, sql string, args ...any) (Rows, error) {
	rows, err := t.tx.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

func (t *pgxTx) ExecAffected(ctx context.Context, sql string, args ...any) (int64, error) {
	tag, err := t.tx.Exec(ctx, sql, args...)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func (t *pgxTx) Commit(ctx context.Context) error   { return t.tx.Commit(ctx) }
func (t *pgxTx) Rollback(ctx context.Context) error { return t.tx.Rollback(ctx) }

// compile-time assertions that pgx's concrete types satisfy the store surfaces.
var (
	_ Row  = (pgx.Row)(nil)
	_ Rows = (pgx.Rows)(nil)
)
