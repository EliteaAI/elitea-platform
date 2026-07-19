package tenant

import (
	"context"
	"fmt"
	"strconv"

	"github.com/jackc/pgx/v5"
)

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

// WithinTx verifies the project inside the transaction, derives the legacy
// p_<project-id> schema from the positive integer identity, installs a
// transaction-local search_path, executes fn, and always ends the transaction
// before returning. A raw pooled connection never escapes.
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

	schema := "p_" + strconv.FormatInt(project.ID, 10)
	var projectExists, schemaExists bool
	if err := tx.QueryRow(ctx, `
SELECT
    EXISTS (SELECT 1 FROM centry.project WHERE id = $1),
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $2)`,
		project.ID,
		schema,
	).Scan(&projectExists, &schemaExists); err != nil {
		return fmt.Errorf("tenant: resolve project: %w", err)
	}
	if !projectExists {
		return fmt.Errorf("tenant: project does not exist")
	}
	if !schemaExists {
		return fmt.Errorf("tenant: schema %s does not exist", schema)
	}

	// pg_catalog remains available implicitly for built-ins. Omitting it as an
	// explicit fallback ensures unqualified writes fail if the tenant schema is
	// concurrently removed.
	searchPath := pgx.Identifier{schema}.Sanitize()
	if _, err := tx.Exec(ctx, "SELECT set_config('search_path', $1, true)", searchPath); err != nil {
		return fmt.Errorf("tenant: install transaction context: %w", err)
	}
	var effectiveSchema *string
	if err := tx.QueryRow(ctx, "SELECT current_schema()").Scan(&effectiveSchema); err != nil {
		return fmt.Errorf("tenant: verify transaction context: %w", err)
	}
	if effectiveSchema == nil || *effectiveSchema != schema {
		return fmt.Errorf("tenant: schema %s is not the effective schema", schema)
	}
	if err := fn(ctx, tx); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("tenant: commit transaction: %w", err)
	}
	return nil
}
