package tenant

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type contextKey string

const tenantKey contextKey = "tenant_id"

// WithTenant returns a context with the tenant ID stored for later use by
// ConnForTenant.
func WithTenant(ctx context.Context, tenantID string) context.Context {
	return context.WithValue(ctx, tenantKey, tenantID)
}

// TenantFromContext retrieves the tenant ID from the context.
func TenantFromContext(ctx context.Context) (string, bool) {
	id, ok := ctx.Value(tenantKey).(string)
	return id, ok
}

// Router routes database connections to the correct tenant schema.
type Router struct {
	pool *pgxpool.Pool
}

// New creates a new tenant Router backed by pool.
func New(pool *pgxpool.Pool) *Router {
	return &Router{pool: pool}
}

// ConnForTenant acquires a connection from the pool, sets the search_path
// to the tenant's schema, and returns the pool connection. The caller MUST
// call Release() on the returned *pgxpool.Conn when done.
func (r *Router) ConnForTenant(ctx context.Context) (*pgxpool.Conn, error) {
	tenantID, ok := TenantFromContext(ctx)
	if !ok {
		return nil, fmt.Errorf("tenant: no tenant in context")
	}

	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("tenant: acquire conn: %w", err)
	}

	// The tenant id becomes an IDENTIFIER in the statement, so it is quoted
	// with SQL rules. %q quotes with Go rules and writes an embedded double
	// quote as \" , which PostgreSQL reads as an ordinary backslash followed
	// by the quote that ENDS the identifier (issue #543).
	schema := pgx.Identifier{tenantID}.Sanitize()
	if _, err := conn.Exec(ctx, fmt.Sprintf("SET search_path TO %s, public", schema)); err != nil {
		conn.Release()
		return nil, fmt.Errorf("tenant: set search_path: %w", err)
	}

	return conn, nil
}
