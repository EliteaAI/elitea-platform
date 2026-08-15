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

// tokenBindingMigrationPath is the access-token project binding (ADR-0018,
// spec-llm-project-scope §3), inside the LEDGERED corpus.
//
// It is here for the same reason 0067 is, and the failure it prevents is
// harder: internal/db/queries/auth_pat.sql's GetActivePATPrincipalByUUID now
// LEFT JOINs elitea_identity.token_project_binding, and that query runs for
// EVERY credential validation. A database built by this function alone would
// answer 42P01 to every token-authenticated request — not a missing feature, a
// dead API surface. RunMigrations applies migrations/*.sql plus this exempt
// list only; it never applies the ledgered shared corpus, so a file that the
// hot read path depends on must be named here.
//
// Every real deploy path (the Helm migrate-job, deploy/scripts/standalone-stack.sh,
// the hybrid POV compose) runs elitea-migrate and applies the whole ledgered
// history, so none of them need this. Only ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA
// does.
const tokenBindingMigrationPath = "shared/0071_token_project_binding.sql"

// dumpGuardExemptMigrations are the ledgered shared files RunMigrations applies
// itself, in order. Every one of them MUST be idempotent and MUST tolerate a
// database that already holds its objects: the pool.Exec below leaves NO ledger
// row, so elitea-migrate re-applies and records them later.
//
// Add a file here when code on a read path depends on it. Do not add one for a
// feature that only the ledgered corpus needs — the list is a compatibility
// shim for one dev flag, not a second migration runner.
var dumpGuardExemptMigrations = []string{
	gatewayMigrationPath,
	tokenBindingMigrationPath,
}

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

	// These files are idempotent and dump-guard-exempt (BF0.4): they must land
	// even on dump-loaded instances, where the p_% guard above skipped the
	// baseline set. Applying them here leaves NO ledger row — elitea-migrate
	// will re-apply and record them later, which is safe precisely because every
	// statement in them is guarded.
	for _, path := range dumpGuardExemptMigrations {
		sql, err := ledgeredMigrationSQL(path)
		if err != nil {
			return err
		}
		slog.Info("applying migration", "dir", "shared", "file", path)
		if _, err := pool.Exec(ctx, sql); err != nil {
			return fmt.Errorf("migrate: exec %s: %w", path, err)
		}
	}
	return nil
}

// ledgeredMigrationSQL reads one file out of the immutable ledgered corpus.
func ledgeredMigrationSQL(path string) (string, error) {
	data, err := platformmigrations.Files.ReadFile(path)
	if err != nil {
		return "", fmt.Errorf("migrate: read %s: %w", path, err)
	}
	return string(data), nil
}

// GatewayMigrationSQL returns the gateway schema migration as SQL.
//
// It exists for integration tests that need the gateway budget tables:
// reading the REAL migration means a schema change cannot pass a test against
// a hand-copied DDL and then fail against production. Runtime code must call
// RunMigrations instead — this returns SQL, it does not run it.
func GatewayMigrationSQL() (string, error) {
	return ledgeredMigrationSQL(gatewayMigrationPath)
}

// TokenBindingMigrationSQL returns the token project binding migration as SQL,
// for the same reason GatewayMigrationSQL exists: a test that needs
// elitea_identity.token_project_binding must read the file production applies,
// not a hand-copied CREATE TABLE that can drift from it.
func TokenBindingMigrationSQL() (string, error) {
	return ledgeredMigrationSQL(tokenBindingMigrationPath)
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
