package db

import (
	"context"
	"embed"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"

	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

//go:embed migrations/*.sql
var migrations embed.FS

// gatewayMigrationPath is the LLM-gateway governance/budget/price-catalog
// schema (BF0.4), inside the LEDGERED corpus.
//
// It used to be a private directory under this package, applied only by
// RunMigrations — i.e. only when ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA=true, which
// production never sets. The Helm migration hook runs elitea-migrate, which
// applies only the ledgered histories, so a Helm-deployed database never got
// these tables while three services read them (issue #306). The DDL now lives
// in migrations/shared/0067 and this file points at it, so the dev bootstrap
// and the production migration apply the exact same bytes — a second copy is
// how the two silently diverge.
const gatewayMigrationPath = "shared/0067_gateway_budget_schema.sql"

func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	// Skip the baseline migrations if the database already has tenant schemas
	// (loaded from a dump) — but ALWAYS run the idempotent gateway migrations
	// afterwards so the budget/price tables exist regardless.
	var schemaCount int
	// Tenant schemas are named p_<numeric project id>. Do not use LIKE 'p_%':
	// its underscore is a wildcard and matches PostgreSQL's pg_catalog and the
	// public schema, which would skip baseline migrations on a fresh database.
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.schemata WHERE schema_name ~ '^p_[0-9]+$'`).Scan(&schemaCount); err != nil {
		return fmt.Errorf("migrate: count tenant schemas: %w", err)
	}
	if schemaCount > 0 {
		slog.Info("skipping baseline migrations — existing tenant schemas detected", "count", schemaCount)
	} else {
		if err := applyMigrationDir(ctx, pool, migrations, "migrations"); err != nil {
			return err
		}
	}

	// The gateway schema is idempotent and dump-guard-exempt (BF0.4): it must
	// land even on dump-loaded instances, where the p_% guard above skipped the
	// baseline set. Applying it here leaves NO ledger row — elitea-migrate will
	// re-apply and record 0067 later, which is safe precisely because every
	// statement in it is guarded.
	gatewaySQL, err := GatewayMigrationSQL()
	if err != nil {
		return err
	}
	slog.Info("applying migration", "dir", "shared", "file", gatewayMigrationPath)
	if _, err := pool.Exec(ctx, gatewaySQL); err != nil {
		return fmt.Errorf("migrate: exec %s: %w", gatewayMigrationPath, err)
	}
	return nil
}

// GatewayMigrationSQL returns the gateway schema migration as SQL.
//
// It exists for integration tests that need the gateway budget tables:
// reading the REAL migration means a schema change cannot pass a test against
// a hand-copied DDL and then fail against production. Runtime code must call
// RunMigrations instead — this returns SQL, it does not run it.
func GatewayMigrationSQL() (string, error) {
	data, err := platformmigrations.Files.ReadFile(gatewayMigrationPath)
	if err != nil {
		return "", fmt.Errorf("migrate: read %s: %w", gatewayMigrationPath, err)
	}
	return string(data), nil
}

// applyMigrationDir executes every *.sql file in dir (lexical order) from fsys.
func applyMigrationDir(ctx context.Context, pool *pgxpool.Pool, fsys embed.FS, dir string) error {
	entries, err := fsys.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("migrate: read dir %s: %w", dir, err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := fsys.ReadFile(dir + "/" + entry.Name())
		if err != nil {
			return fmt.Errorf("migrate: read %s: %w", entry.Name(), err)
		}
		slog.Info("applying migration", "dir", dir, "file", entry.Name())
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("migrate: exec %s: %w", entry.Name(), err)
		}
	}
	return nil
}
