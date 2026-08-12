package db

import (
	"context"
	"embed"
	"fmt"
	"log/slog"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

// gatewayMigrations hold the LLM-gateway governance/budget/price-catalog schema
// (BF0.4). Unlike the baseline migrations they are applied UNCONDITIONALLY —
// they must land even on dump-loaded instances (where the p_% dump-guard skips
// the baseline set), so every statement in them is idempotent
// (CREATE ... IF NOT EXISTS / ADD COLUMN IF NOT EXISTS).
//
//go:embed gateway_migrations/*.sql
var gatewayMigrations embed.FS

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

	// Gateway migrations are idempotent and dump-guard-exempt (BF0.4).
	return applyMigrationDir(ctx, pool, gatewayMigrations, "gateway_migrations")
}

// GatewayMigrationSQL returns every gateway migration concatenated in apply
// order.
//
// It exists for integration tests that need the gateway budget tables:
// applying the REAL migration means a schema change cannot pass a test against
// a hand-copied DDL and then fail against production. Runtime code must call
// RunMigrations instead — this returns SQL, it does not run it.
func GatewayMigrationSQL() (string, error) {
	entries, err := gatewayMigrations.ReadDir("gateway_migrations")
	if err != nil {
		return "", fmt.Errorf("migrate: read gateway_migrations: %w", err)
	}
	var builder strings.Builder
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := gatewayMigrations.ReadFile("gateway_migrations/" + entry.Name())
		if err != nil {
			return "", fmt.Errorf("migrate: read %s: %w", entry.Name(), err)
		}
		builder.Write(data)
		builder.WriteString("\n")
	}
	return builder.String(), nil
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
