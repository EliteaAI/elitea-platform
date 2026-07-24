package pricesync

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Row is the minimal single-row scan surface (pgx.Row satisfies it).
type Row interface {
	Scan(dest ...any) error
}

// Tx is the minimal transaction surface the syncer needs: an advisory-lock
// probe (QueryRow), the model UPSERT (Exec), and Commit/Rollback. Kept narrow so
// tests inject a fake without a live Postgres.
type Tx interface {
	QueryRow(ctx context.Context, sql string, args ...any) Row
	Exec(ctx context.Context, sql string, args ...any) error
	Commit(ctx context.Context) error
	Rollback(ctx context.Context) error
}

// DB opens a transaction. *pgxpool.Pool is adapted to it via PoolDB.
type DB interface {
	Begin(ctx context.Context) (Tx, error)
}

// PoolDB adapts a *pgxpool.Pool to the DB interface.
type PoolDB struct {
	Pool *pgxpool.Pool
}

var _ DB = (*PoolDB)(nil)

// NewPoolDB wraps a pgxpool.Pool for use with the syncer.
func NewPoolDB(pool *pgxpool.Pool) *PoolDB { return &PoolDB{Pool: pool} }

// Begin starts a pgx transaction and wraps it in the narrow Tx interface.
func (p *PoolDB) Begin(ctx context.Context) (Tx, error) {
	tx, err := p.Pool.Begin(ctx)
	if err != nil {
		return nil, err
	}
	return &pgxTx{tx: tx}, nil
}

// pgxTx adapts pgx.Tx (whose Exec returns pgconn.CommandTag and whose QueryRow
// returns pgx.Row) to the syncer's Tx interface.
type pgxTx struct {
	tx pgx.Tx
}

func (t *pgxTx) QueryRow(ctx context.Context, sql string, args ...any) Row {
	return t.tx.QueryRow(ctx, sql, args...)
}

func (t *pgxTx) Exec(ctx context.Context, sql string, args ...any) error {
	_, err := t.tx.Exec(ctx, sql, args...)
	return err
}

func (t *pgxTx) Commit(ctx context.Context) error   { return t.tx.Commit(ctx) }
func (t *pgxTx) Rollback(ctx context.Context) error { return t.tx.Rollback(ctx) }

// compile-time assertion that pgx.Row satisfies the syncer's Row.
var _ Row = (pgx.Row)(nil)
