package account

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolQuerier adapts a *pgxpool.Pool to the account's rowQuerier interface. pgx
// returns concrete pgx.Rows / pgx.Row types, so a thin adapter is needed to
// bridge them to the account's minimal, test-friendly interfaces.
type PoolQuerier struct {
	Pool *pgxpool.Pool
}

var _ rowQuerier = (*PoolQuerier)(nil)

// NewPoolQuerier wraps a pgxpool.Pool for use with account.New.
func NewPoolQuerier(pool *pgxpool.Pool) *PoolQuerier {
	return &PoolQuerier{Pool: pool}
}

// Query runs a query and adapts pgx.Rows to the account's pgxRows interface.
func (p *PoolQuerier) Query(ctx context.Context, sql string, args ...any) (pgxRows, error) {
	rows, err := p.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// QueryRow runs a single-row query. pgx.Row already satisfies pgxRow (Scan-only).
func (p *PoolQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgxRow {
	return p.Pool.QueryRow(ctx, sql, args...)
}

// compile-time assertions that pgx's concrete types satisfy the account
// interfaces the adapter returns.
var (
	_ pgxRows = (pgx.Rows)(nil)
	_ pgxRow  = (pgx.Row)(nil)
)
