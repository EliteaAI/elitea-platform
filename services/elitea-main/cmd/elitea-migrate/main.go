package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

func main() {
	var projectID int64
	var allTenants bool
	flag.Int64Var(&projectID, "tenant-project", 0, "apply tenant history for this project after the shared history")
	flag.BoolVar(&allTenants, "all-tenants", false, "apply tenant history for every existing legacy project after the shared history")
	flag.Parse()
	if projectID > 0 && allTenants {
		exitError(fmt.Errorf("-tenant-project and -all-tenants are mutually exclusive"))
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	slog.SetDefault(logger)
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		exitError(fmt.Errorf("DATABASE_URL is required"))
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		exitError(fmt.Errorf("open database: %w", err))
	}
	defer pool.Close()

	var projectIDs []int64
	if allTenants {
		projectIDs, err = migrationTenantProjects(ctx, pool)
		if err != nil {
			exitError(err)
		}
	}

	runner := migrate.New(pool, platformmigrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		exitError(err)
	}
	if projectID > 0 {
		if err := runner.ApplyTenant(ctx, projectID); err != nil {
			exitError(err)
		}
	}
	tenantCount := 0
	if allTenants {
		for _, id := range projectIDs {
			if err := runner.ApplyTenant(ctx, id); err != nil {
				exitError(err)
			}
		}
		tenantCount = len(projectIDs)
	}
	slog.Info("migrations applied", "tenant_project", projectID, "all_tenants", allTenants, "tenant_count", tenantCount)
}

type tenantProjectQueryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

func migrationTenantProjects(ctx context.Context, queryer tenantProjectQueryer) ([]int64, error) {
	rows, err := queryer.Query(ctx, `
SELECT
    project.id,
    EXISTS (
        SELECT 1
        FROM pg_catalog.pg_namespace
        WHERE nspname = 'p_' || project.id::text
    ) AS schema_exists
FROM centry.project AS project
WHERE project.create_success = TRUE
ORDER BY project.id`)
	if err != nil {
		return nil, fmt.Errorf("preflight legacy tenant projects: %w", err)
	}
	defer rows.Close()

	projects := make([]tenantProjectPreflight, 0)
	for rows.Next() {
		var project tenantProjectPreflight
		if err := rows.Scan(&project.id, &project.schemaExists); err != nil {
			return nil, fmt.Errorf("scan legacy tenant project: %w", err)
		}
		projects = append(projects, project)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy tenant projects: %w", err)
	}
	return validateTenantProjectPreflight(projects)
}

type tenantProjectPreflight struct {
	id           int64
	schemaExists bool
}

func validateTenantProjectPreflight(projects []tenantProjectPreflight) ([]int64, error) {
	projectIDs := make([]int64, 0, len(projects))
	missingSchemas := make([]int64, 0)
	for _, project := range projects {
		projectIDs = append(projectIDs, project.id)
		if !project.schemaExists {
			missingSchemas = append(missingSchemas, project.id)
		}
	}
	if len(missingSchemas) != 0 {
		shown := missingSchemas
		if len(shown) > 20 {
			shown = shown[:20]
		}
		return nil, fmt.Errorf(
			"preflight found %d create-successful projects without tenant schemas (first IDs: %v)",
			len(missingSchemas),
			shown,
		)
	}
	return projectIDs, nil
}

func exitError(err error) {
	slog.Error("migration failed", "err", err)
	os.Exit(1)
}
