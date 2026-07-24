package llmproxy

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// ModelPoolQuerier adapts a *pgxpool.Pool to the ModelResolver's modelRowQuerier
// interface. pgx returns concrete pgx.Rows, so a thin adapter bridges it to the
// resolver's minimal, test-friendly interface (mirrors account.PoolQuerier).
type ModelPoolQuerier struct {
	Pool *pgxpool.Pool
}

var _ modelRowQuerier = (*ModelPoolQuerier)(nil)

// NewModelPoolQuerier wraps a pgxpool.Pool for use with NewModelResolver.
func NewModelPoolQuerier(pool *pgxpool.Pool) *ModelPoolQuerier {
	return &ModelPoolQuerier{Pool: pool}
}

// Query runs a query and adapts pgx.Rows to the resolver's modelRows interface.
func (p *ModelPoolQuerier) Query(ctx context.Context, sql string, args ...any) (modelRows, error) {
	rows, err := p.Pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	return rows, nil
}

// compile-time assertion that pgx.Rows satisfies the resolver's row interface.
var _ modelRows = (pgx.Rows)(nil)
