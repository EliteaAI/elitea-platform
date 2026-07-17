// Package migrate applies checksum-pinned shared and tenant migration
// histories. It is intended for the dedicated migration command, never hidden
// in ordinary service startup.
package migrate

import (
	"context"
	"fmt"
	"io/fs"
	"regexp"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var tenantSchemaName = regexp.MustCompile(`^p_[1-9][0-9]*$`)

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

// ApplyTenant resolves a tenant schema from the authoritative project mapping
// and applies the tenant history with a transaction-local search_path.
func (r *Runner) ApplyTenant(ctx context.Context, projectID int64) error {
	if projectID <= 0 {
		return fmt.Errorf("migrate: project ID must be positive")
	}
	var schema string
	if err := r.pool.QueryRow(ctx, `
SELECT schema_name
FROM centry.project_runtime_schema
WHERE project_id = $1`, projectID).Scan(&schema); err != nil {
		return fmt.Errorf("migrate: resolve project %d schema: %w", projectID, err)
	}
	if !tenantSchemaName.MatchString(schema) {
		return fmt.Errorf("migrate: registry returned invalid schema name")
	}
	return r.apply(ctx, ScopeTenant, strconv.FormatInt(projectID, 10), schema)
}

func (r *Runner) apply(ctx context.Context, scope Scope, targetID, schema string) (runErr error) {
	manifest, err := LoadManifest(r.files, scope)
	if err != nil {
		return err
	}
	conn, err := r.pool.Acquire(ctx)
	if err != nil {
		return fmt.Errorf("migrate: acquire connection: %w", err)
	}
	defer conn.Release()

	lockKey := advisoryLockKey(scope, targetID)
	if err := acquireLock(ctx, conn, lockKey); err != nil {
		return err
	}
	defer func() {
		unlockCtx := context.WithoutCancel(ctx)
		if err := releaseLock(unlockCtx, conn, lockKey); runErr == nil && err != nil {
			runErr = err
		}
	}()

	tx, err := conn.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("migrate: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(context.WithoutCancel(ctx)) }()

	if err := ensureLedger(ctx, tx); err != nil {
		return err
	}
	if schema != "" {
		searchPath := pgx.Identifier{schema}.Sanitize() + ", pg_catalog"
		if _, err := tx.Exec(ctx, "SELECT set_config('search_path', $1, true)", searchPath); err != nil {
			return fmt.Errorf("migrate: set tenant search path: %w", err)
		}
	}

	for _, migration := range manifest {
		recorded, exists, err := recordedChecksum(ctx, tx, scope, targetID, migration.Version)
		if err != nil {
			return err
		}
		if exists {
			if err := verifyChecksum(migration, recorded); err != nil {
				return err
			}
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
	for _, migration := range manifest {
		var recorded []byte
		if err := r.pool.QueryRow(ctx, `
SELECT checksum
FROM elitea_runtime.schema_migrations
WHERE target_kind = $1 AND target_id = $2 AND version = $3`,
			string(scope), targetID, migration.Version,
		).Scan(&recorded); err != nil {
			return fmt.Errorf("migrate: expected %s is not applied: %w", migration.Path, err)
		}
		if err := verifyChecksum(migration, recorded); err != nil {
			return err
		}
	}
	return nil
}
