// Package migrate applies checksum-pinned shared, tenant and agent-state
// migration histories. It is intended for the dedicated migration command,
// never hidden in ordinary service startup.
package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Runner applies the embedded histories to one database.
type Runner struct {
	pool  *pgxpool.Pool
	files fs.FS
}

func New(pool *pgxpool.Pool, files fs.FS) *Runner {
	return &Runner{pool: pool, files: files}
}

func (r *Runner) ApplyShared(ctx context.Context) error {
	return r.apply(ctx, ScopeShared, "platform", "")
}

// ApplyAgentState applies the native agent state history to the separately
// configured agentstate database. It never targets Main's business database.
func (r *Runner) ApplyAgentState(ctx context.Context) error {
	return r.apply(ctx, ScopeAgentState, "agentstate", "")
}

// ApplyTenant verifies an existing project and applies the tenant history to
// its legacy p_<project-id> schema with a transaction-local search_path.
func (r *Runner) ApplyTenant(ctx context.Context, projectID int64) error {
	if projectID <= 0 {
		return fmt.Errorf("migrate: project ID must be positive")
	}
	schema := "p_" + strconv.FormatInt(projectID, 10)
	var projectExists, schemaExists bool
	if err := r.pool.QueryRow(ctx, `
SELECT
    EXISTS (SELECT 1 FROM centry.project WHERE id = $1),
    EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $2)`,
		projectID,
		schema,
	).Scan(&projectExists, &schemaExists); err != nil {
		return fmt.Errorf("migrate: resolve project %d: %w", projectID, err)
	}
	if !projectExists {
		return fmt.Errorf("migrate: project %d does not exist", projectID)
	}
	if !schemaExists {
		return fmt.Errorf("migrate: tenant schema %s does not exist", schema)
	}
	return r.apply(ctx, ScopeTenant, strconv.FormatInt(projectID, 10), schema)
}

func (r *Runner) apply(ctx context.Context, scope Scope, targetID, schema string) error {
	manifest, err := LoadManifest(r.files, scope)
	if err != nil {
		return err
	}
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("migrate: acquire connection: %w", err)
	}
	defer conn.Release()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("migrate: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()
	if err := acquireLock(ctx, tx, advisoryLockKey(scope, targetID)); err != nil {
		return err
	}

	if err := ensureLedger(ctx, tx); err != nil {
		return err
	}
	applied, err := readValidatedLedger(ctx, tx, scope, targetID, manifest, false)
	if err != nil {
		return err
	}
	if schema != "" {
		// Do not add a fallback creation schema. PostgreSQL searches pg_catalog
		// implicitly for built-ins; if the tenant schema disappears, DDL must fail
		// instead of escaping into a shared catalog.
		searchPath := pgx.Identifier{schema}.Sanitize()
		if _, err := tx.Exec(ctx, "SELECT set_config('search_path', $1, true)", searchPath); err != nil {
			return fmt.Errorf("migrate: set tenant search path: %w", err)
		}
		var effectiveSchema *string
		if err := tx.QueryRow(ctx, "SELECT current_schema()").Scan(&effectiveSchema); err != nil {
			return fmt.Errorf("migrate: verify tenant search path: %w", err)
		}
		if effectiveSchema == nil || *effectiveSchema != schema {
			return fmt.Errorf("migrate: tenant schema %s is not the effective schema", schema)
		}
	}

	for _, migration := range manifest {
		if _, exists := applied[migration.Version]; exists {
			continue
		}
		if _, err := tx.Exec(ctx, string(migration.SQL)); err != nil {
			return fmt.Errorf("migrate: apply %s: %w", migration.Path, err)
		}
		if err := recordMigration(ctx, tx, targetID, migration); err != nil {
			return err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("migrate: commit: %w", err)
	}
	return nil
}

// CheckHead verifies that every expected migration is recorded with the exact
// checksum. It does not mutate the database.
func (r *Runner) CheckHead(ctx context.Context, scope Scope, targetID string) error {
	manifest, err := LoadManifest(r.files, scope)
	if err != nil {
		return err
	}
	_, err = readValidatedLedger(ctx, r.pool, scope, targetID, manifest, true)
	return err
}
