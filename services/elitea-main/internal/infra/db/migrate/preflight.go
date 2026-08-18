package migrate

// The -all-tenants preflight.
//
// It lives here, and not in cmd/elitea-migrate, so that a test can prove the
// database a delete leaves behind still passes it. Issue #374 is exactly that
// dependency: a project delete that dropped the tenant schema before the
// project row left a create-successful project with no schema, this preflight
// refused to run, and the refusal stopped migration for EVERY tenant in the
// deployment rather than for the one project. The preflight is therefore part
// of the delete path's contract, and a copy of its query in a test would stop
// discriminating the day the real one changed.

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
)

// Queryer is the read side of a pool or a transaction.
type Queryer interface {
	Query(context.Context, string, ...any) (pgx.Rows, error)
}

// TenantProject is one create-successful project and whether its schema is
// there.
type TenantProject struct {
	ID           int64
	SchemaExists bool
}

// TenantProjects returns the project ids -all-tenants must migrate.
//
// It reports an error, and no ids, when any create-successful project has no
// tenant schema. Migration then stops for the whole deployment, which is why
// the delete path must never produce that state.
func TenantProjects(ctx context.Context, queryer Queryer) ([]int64, error) {
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

	projects := make([]TenantProject, 0)
	for rows.Next() {
		var project TenantProject
		if err := rows.Scan(&project.ID, &project.SchemaExists); err != nil {
			return nil, fmt.Errorf("scan legacy tenant project: %w", err)
		}
		projects = append(projects, project)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate legacy tenant projects: %w", err)
	}
	return validateTenantProjects(projects)
}

// validateTenantProjects is the decision the preflight makes, separated from
// the read so a unit test can pin it without a database.
func validateTenantProjects(projects []TenantProject) ([]int64, error) {
	projectIDs := make([]int64, 0, len(projects))
	missingSchemas := make([]int64, 0)
	for _, project := range projects {
		projectIDs = append(projectIDs, project.ID)
		if !project.SchemaExists {
			missingSchemas = append(missingSchemas, project.ID)
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
