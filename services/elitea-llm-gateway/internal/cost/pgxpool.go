package cost

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// PoolQuerier adapts a *pgxpool.Pool to the calculator's rowQuerier interface
// (mirrors account.PoolQuerier). pgx.Row already satisfies pgxRow (Scan-only).
type PoolQuerier struct {
	Pool *pgxpool.Pool
}

var _ rowQuerier = (*PoolQuerier)(nil)

// NewPoolQuerier wraps a pgxpool.Pool for use with cost.New.
func NewPoolQuerier(pool *pgxpool.Pool) *PoolQuerier {
	return &PoolQuerier{Pool: pool}
}

// QueryRow runs a single-row query on the pool.
func (p *PoolQuerier) QueryRow(ctx context.Context, sql string, args ...any) pgxRow {
	return p.Pool.QueryRow(ctx, sql, args...)
}

// compile-time assertion that pgx's concrete Row type satisfies pgxRow.
var _ pgxRow = (pgx.Row)(nil)
