package tenant

import (
	"context"
	"fmt"
	"regexp"

	"github.com/jackc/pgx/v5"
)

var registeredSchemaName = regexp.MustCompile(`^p_[1-9][0-9]*$`)

// Project identifies an already authorized project. Callers cannot provide a
// database schema name.
type Project struct {
	ID int64
}

// Beginner is satisfied by pgxpool.Pool and keeps transaction ownership at
// this boundary.
type Beginner interface {
	BeginTx(context.Context, pgx.TxOptions) (pgx.Tx, error)
}

// Executor guarantees that tenant context exists only inside one transaction.
type Executor struct {
	db Beginner
}

func NewExecutor(db Beginner) *Executor {
	return &Executor{db: db}
}

// WithinTx resolves the project-to-schema mapping inside the transaction,
// installs a transaction-local search_path, executes fn, and always ends the
// transaction before returning. A raw pooled connection never escapes.
func (e *Executor) WithinTx(
	ctx context.Context,
	project Project,
	opts pgx.TxOptions,
	fn func(context.Context, pgx.Tx) error,
) (runErr error) {
	if project.ID <= 0 {
		return fmt.Errorf("tenant: project ID must be positive")
	}
	if fn == nil {
		return fmt.Errorf("tenant: transaction callback is required")
	}

	tx, err := e.db.BeginTx(ctx, opts)
	if err != nil {
		return fmt.Errorf("tenant: begin transaction: %w", err)
	}
	defer func() {
		_ = tx.Rollback(context.WithoutCancel(ctx))
	}()

	var schema string
	if err := tx.QueryRow(ctx, `
SELECT schema_name
FROM centry.project_runtime_schema
WHERE project_id = $1`, project.ID).Scan(&schema); err != nil {
		return fmt.Errorf("tenant: resolve project schema: %w", err)
	}
	if !registeredSchemaName.MatchString(schema) {
		return fmt.Errorf("tenant: registry returned invalid schema name")
	}

	searchPath := pgx.Identifier{schema}.Sanitize() + ", pg_catalog"
	if _, err := tx.Exec(ctx, "SELECT set_config('search_path', $1, true)", searchPath); err != nil {
		return fmt.Errorf("tenant: install transaction context: %w", err)
	}
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("tenant: commit transaction: %w", err)
	}
	return nil
}
