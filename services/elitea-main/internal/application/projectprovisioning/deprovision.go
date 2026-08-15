package projectprovisioning

// Project deletion — the symmetric half issue #333 asks for.
//
// The reference is legacy/plugins/projects/api/v2/project.py's `delete_project`,
// which walks the same step list in REVERSE calling each step's `delete`. This
// reuses the very same `remove` functions the create path compensates with, so
// the two directions cannot drift apart: a step added to createSteps() is
// deleted here automatically, and a compensation bug shows up in both.

import (
	"context"
	"errors"
	"fmt"
)

// ErrProjectNotFound reports a delete for a project id that has no row.
var ErrProjectNotFound = errors.New("projectprovisioning: project does not exist")

// ErrProjectNotRemoved reports a delete that ran every step and still left the
// project row behind.
var ErrProjectNotRemoved = errors.New("projectprovisioning: project was not removed")

// ErrTenantSchemaNotRemoved reports a delete that removed the project row and
// left the tenant schema behind.
//
// The schema is dropped last (#374), so this is the only residue a failed
// delete can leave. It is a storage leak and not a stopper: cmd/elitea-migrate
// reads projects and not schemas, so a schema with no project row does not
// block migration. The delete still reports it, because a route that answers
// 200 for a job it did not finish is the failure mode this package exists to
// avoid. Another delete of the same id clears it.
var ErrTenantSchemaNotRemoved = errors.New("projectprovisioning: tenant schema was not removed")

// Deprovision removes a project and everything provisioning created for it.
//
// TWO DELIBERATE DEVIATIONS from the reference:
//
// First, the reference answers 200 whatever happens. Every one of its undo
// steps is individually try/except'd and the failures are only logged, so a
// delete that removed nothing at all is reported as a success — the
// "answers 200, did nothing" shape this codebase keeps re-shipping. Here the
// per-step results are still best-effort, because stopping at the first failure
// would strand the remaining resources; but the project row is RE-READ at the
// end, and a project that survived is an error rather than a 200.
//
// Second, the reference leaves auth_core__project_role and
// auth_core__project_user_role rows behind for every deleted project, because
// its ProjectPermissions and ProjectAdmin steps have no-op deletes. Those rows
// describe a project that no longer exists, and they resurface if the id is
// reused. removeProjectPermissions clears them.
//
// THE ORDER (#374). The steps run in reverse, with one exception: the tenant
// schema is dropped LAST, and only after the project row is proved gone. The
// order is the whole fix, because the schema holds the tenant data and the
// project row does not. Two outcomes are possible, and both are safe:
//
//   - the row goes, then the schema goes. The project is deleted.
//   - the row stays, so the schema stays. The project is unchanged, this
//     returns ErrProjectNotRemoved, and the route answers 500.
//
// The third outcome — a project row whose schema is gone — is the one this
// order makes unreachable. cmd/elitea-migrate refuses to run against it, and
// that refusal stops migration for every tenant in the deployment.
//
// Every row that references centry.project(id) goes in the same transaction as
// the project row. See removeProjectModel and referencingDeletes.
func (p *Provisioner) Deprovision(ctx context.Context, projectID int64) (Result, error) {
	if projectID <= 0 {
		return Result{}, ErrProjectNotFound
	}
	if p.pool == nil {
		return Result{}, errors.New("projectprovisioning: provisioner is not configured")
	}

	// A project is present when its row is there OR when its schema is there.
	// The row alone would make the delete of a leftover schema impossible: a
	// delete that removed the row and could not drop the schema would answer
	// "not found" on every retry, and the schema would stay for ever. Neither
	// half present is a real not-found.
	state := &provisionState{projectID: projectID}
	var exists bool
	if err := p.pool.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM centry.project WHERE id = $1)
    OR EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $2)`,
		projectID, state.tenantSchema(),
	).Scan(&exists); err != nil {
		return Result{}, fmt.Errorf("projectprovisioning: resolve project %d: %w", projectID, err)
	}
	if !exists {
		return Result{}, ErrProjectNotFound
	}

	// removeSystemUser deletes by id, so the identity has to be resolved first.
	// An absent row is not an error: a project provisioned before this step
	// existed, or one whose system user was already removed, still deletes.
	var systemUserID *int64
	if err := p.pool.QueryRow(ctx,
		`SELECT id FROM public.auth_core__user WHERE email = $1`,
		systemUserEmail(projectID),
	).Scan(&systemUserID); err != nil {
		p.logger.InfoContext(ctx, "no system user to remove for project",
			"project_id", projectID, "err", err)
	} else if systemUserID != nil {
		state.systemUserID = *systemUserID
	}

	// Every step is "attempted" for deletion: unlike compensation, there is no
	// progress list to consult, and each remove tolerates a resource that was
	// never created.
	attempted := make([]StepStatus, 0, len(createSteps()))
	for _, step := range createSteps() {
		attempted = append(attempted, StepStatus{Step: step.name, Initialized: true})
	}
	result := Result{
		ProjectID:     projectID,
		RollbackSteps: p.compensate(ctx, state, attempted),
	}

	// The discriminating check: did both halves actually go?
	var rowSurvived, schemaSurvived bool
	if err := p.pool.QueryRow(ctx, `
SELECT EXISTS (SELECT 1 FROM centry.project WHERE id = $1),
       EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $2)`,
		projectID, state.tenantSchema(),
	).Scan(&rowSurvived, &schemaSurvived); err != nil {
		return result, fmt.Errorf("projectprovisioning: verify project %d removal: %w", projectID, err)
	}
	if rowSurvived {
		// The schema is still there too, because the drop is held back while
		// the row is there. The project is unchanged and it stays usable.
		return result, ErrProjectNotRemoved
	}
	if schemaSurvived {
		return result, ErrTenantSchemaNotRemoved
	}
	return result, nil
}
