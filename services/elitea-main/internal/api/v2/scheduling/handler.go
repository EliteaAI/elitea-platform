// Package scheduling serves the platform cron table, `centry.schedule`.
//
// The handlers live in schedules.go, which also documents what these rows are,
// who executes them, and why the write path cannot change what they invoke.
package scheduling

import (
	"github.com/jackc/pgx/v5/pgxpool"
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}
