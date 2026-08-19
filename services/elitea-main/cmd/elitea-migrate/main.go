package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

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

	runner := migrate.New(pool, platformmigrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		exitError(err)
	}

	// Enumerated AFTER the shared history, not before it.
	//
	// TenantProjects reads centry.project. On a database that pylon populated
	// that table is already there, so reading it first worked and this ordering
	// never mattered. On an EMPTY database it does not exist yet, and
	// -all-tenants failed before applying anything:
	//
	//   preflight legacy tenant projects: ERROR: relation "centry.project"
	//   does not exist (SQLSTATE 42P01)
	//
	// which made the flag the chart passes by default unusable on a first
	// install. The shared history is what creates that table, so the list has
	// to be taken once it has run. Reading it later cannot lose a project
	// either: nothing between these two statements creates one.
	var projectIDs []int64
	if allTenants {
		projectIDs, err = migrate.TenantProjects(ctx, pool)
		if err != nil {
			exitError(err)
		}
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

func exitError(err error) {
	slog.Error("migration failed", "err", err)
	os.Exit(1)
}
