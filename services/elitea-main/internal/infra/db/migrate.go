package db

import (
	"context"
	"embed"
	"fmt"
	"log/slog"

	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed migrations/*.sql
var migrations embed.FS

func RunMigrations(ctx context.Context, pool *pgxpool.Pool) error {
	// Skip migrations if the database already has tenant schemas (loaded from a dump).
	var schemaCount int
	_ = pool.QueryRow(ctx, `SELECT count(*) FROM information_schema.schemata WHERE schema_name LIKE 'p_%'`).Scan(&schemaCount)
	if schemaCount > 0 {
		slog.Info("skipping migrations — existing tenant schemas detected", "count", schemaCount)
		return nil
	}

	entries, err := migrations.ReadDir("migrations")
	if err != nil {
		return fmt.Errorf("migrate: read dir: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		data, err := migrations.ReadFile("migrations/" + entry.Name())
		if err != nil {
			return fmt.Errorf("migrate: read %s: %w", entry.Name(), err)
		}
		slog.Info("applying migration", "file", entry.Name())
		if _, err := pool.Exec(ctx, string(data)); err != nil {
			return fmt.Errorf("migrate: exec %s: %w", entry.Name(), err)
		}
	}
	return nil
}
