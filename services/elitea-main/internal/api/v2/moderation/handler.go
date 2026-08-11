// Package moderation serves the app-request table, `centry.moderation_state`.
//
// The handlers live in requests.go, which also documents what these rows are,
// who creates them, what a decision on one actually causes, and why neither the
// requester nor the moderator may write the fields they are not writing.
package moderation

import "github.com/jackc/pgx/v5/pgxpool"

type Handler struct{ pool *pgxpool.Pool }

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }
