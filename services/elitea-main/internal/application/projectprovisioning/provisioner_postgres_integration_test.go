package projectprovisioning_test

// What these tests exist to catch.
//
// A project-create route that answers 201 while provisioning nothing is the
// exact defect this repository keeps re-shipping — issue #128's folders backend
// answered 200 from routes whose behaviour was absent, and its acceptance test
// passed because it asserted the status code. So nothing here asserts a return
// value alone. Every case reads the database back and compares it against the
// only tenant this repository knows to be correct: p_1, which the bootstrap and
// the migration corpus build between them.
//
// The three properties that matter, and the test that pins each:
//
//   TestProvisionBuildsATenantEqualToTheReference
//       the new tenant has exactly p_1's tables, plus the shared rows and RBAC
//       rows a project needs to be usable. Drop any step and this fails.
//   TestProvisionIsIdempotent
//       provisioning twice converges. This is what makes a retry after a
//       partial failure safe.
//   TestProvisionLeavesNothingBehindWhenAStepFails
//       a failure mid-pipeline removes the schema, the ledger rows, the RBAC
//       rows and the project row. A survivor with create_success = TRUE would
//       break elitea-migrate for the WHOLE deployment, not just this project.

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/projectprovisioning"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/migrate"
	platformmigrations "github.com/EliteaAI/elitea-platform/services/elitea-main/migrations"
)

const (
	databaseURLEnv  = "ELITEA_TEST_DATABASE_URL"
	bootstrapSchema = "../../infra/db/migrations/001_initial.sql"
)

func TestProvisionBuildsATenantEqualToTheReference(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	// A real account for the project_admin_email step to find.
	var adminUserID int64
	if err := pool.QueryRow(ctx, `
INSERT INTO public.auth_core__user (email, name) VALUES ('owner@example.test', 'Owner')
RETURNING id`).Scan(&adminUserID); err != nil {
		t.Fatalf("seed administrator account: %v", err)
	}

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)
	result, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name:        "Acceptance Project",
		OwnerID:     1,
		Plugins:     []string{"configuration", "models"},
		AdminEmails: []string{"OWNER@example.test"}, // case-insensitive on purpose
		AdminRoles:  []string{"admin"},
		Limits:      projectprovisioning.DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("provision: %v (steps=%+v)", err, result.Steps)
	}
	if result.ProjectID <= 1 {
		t.Fatalf("project id = %d, want a newly allocated id greater than the seeded project 1", result.ProjectID)
	}
	projectID := result.ProjectID
	schema := fmt.Sprintf("p_%d", projectID)

	// ── the tenant itself ────────────────────────────────────────────────
	//
	// Compared against p_1 rather than against a hand-written list. A literal
	// list would have to be edited every time the corpus grows, and an
	// out-of-date list silently stops discriminating. p_1 is built by
	// 001_initial.sql's own create_tenant_schema call plus ApplyTenant, which is
	// the composition production runs.
	reference := schemaTables(ctx, t, pool, "p_1")
	provisioned := schemaTables(ctx, t, pool, schema)
	if len(reference) == 0 {
		t.Fatal("reference schema p_1 has no tables; the fixture is broken, not the code")
	}
	if !equalStrings(reference, provisioned) {
		t.Fatalf("tenant schema %s does not match the reference p_1\n missing: %v\n extra:   %v",
			schema, difference(reference, provisioned), difference(provisioned, reference))
	}

	// The tenant migration ledger must be at head for the new project, not just
	// for p_1. Without this, `elitea-migrate` would re-apply the corpus.
	if err := migrate.New(pool, platformmigrations.Files).
		CheckHead(ctx, migrate.ScopeTenant, fmt.Sprintf("%d", projectID)); err != nil {
		t.Fatalf("tenant migration head is not applied for project %d: %v", projectID, err)
	}

	// ── the shared rows ──────────────────────────────────────────────────
	var (
		createSuccess bool
		name          string
		ownerID       int64
		plugins       []string
	)
	if err := pool.QueryRow(ctx,
		`SELECT name, owner_id, plugins, create_success FROM centry.project WHERE id = $1`,
		projectID,
	).Scan(&name, &ownerID, &plugins, &createSuccess); err != nil {
		t.Fatalf("read project row: %v", err)
	}
	if !createSuccess {
		t.Error("create_success = false after a successful provision; every reader that filters on it would ignore this project")
	}
	if name != "Acceptance Project" || ownerID != 1 {
		t.Errorf("project row = (%q, owner %d), want (%q, owner 1)", name, ownerID, "Acceptance Project")
	}
	if !equalStrings([]string{"configuration", "models"}, plugins) {
		t.Errorf("plugins = %v, want [configuration models]", plugins)
	}

	// Quota and statistics: /projects/quota and /projects/statistics answer 404
	// without these rows, so a project provisioned without them reports "no such
	// project" on its own settings page.
	var vcuHard, storageHard int32
	if err := pool.QueryRow(ctx,
		`SELECT vcu_hard_limit, storage_hard_limit FROM centry.project_quota WHERE project_id = $1`,
		projectID,
	).Scan(&vcuHard, &storageHard); err != nil {
		t.Fatalf("read quota row: %v", err)
	}
	// The ProjectCreatePD defaults, asserted by value. A zero here would mean
	// the Go zero value reached the column instead of the reference's default —
	// a project that can spend nothing.
	if vcuHard != 5000 || storageHard != 10 {
		t.Errorf("quota = (vcu %d, storage %d), want (5000, 10)", vcuHard, storageHard)
	}

	var statisticRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM centry.statistic WHERE project_id = $1`, projectID,
	).Scan(&statisticRows); err != nil {
		t.Fatalf("read statistic row: %v", err)
	}
	if statisticRows != 1 {
		t.Errorf("statistic rows = %d, want 1", statisticRows)
	}

	// ── RBAC ─────────────────────────────────────────────────────────────
	//
	// The roles must exist AND carry no per-project permission rows. That
	// emptiness is load-bearing, not an omission: legacyrbac falls back to the
	// central default-mode grants only for a project with no per-project rows,
	// so seeding permissions here would cut the project off from every grant
	// migration 0062-0069 adds.
	roles := projectRoleNames(ctx, t, pool, projectID)
	for _, want := range []string{"admin", "editor", "viewer", "system"} {
		if !contains(roles, want) {
			t.Errorf("project role %q was not created (have %v)", want, roles)
		}
	}
	var perProjectGrants int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.auth_core__project_role_permission WHERE project_id = $1`,
		projectID,
	).Scan(&perProjectGrants); err != nil {
		t.Fatalf("count per-project grants: %v", err)
	}
	if perProjectGrants != 0 {
		t.Errorf("per-project role_permission rows = %d, want 0 — any row here suppresses the central grant fallback",
			perProjectGrants)
	}

	// The named administrator is a member with the admin role.
	var adminAssigned bool
	if err := pool.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM public.auth_core__project_user_role AS assignment
    JOIN public.auth_core__project_role AS role ON role.id = assignment.role_id
    WHERE assignment.project_id = $1 AND assignment.user_id = $2 AND role.name = 'admin'
)`, projectID, adminUserID).Scan(&adminAssigned); err != nil {
		t.Fatalf("check administrator assignment: %v", err)
	}
	if !adminAssigned {
		t.Error("project_admin_email did not become a project admin; the caller named an administrator who cannot reach the project")
	}

	// ── the system identity ──────────────────────────────────────────────
	//
	// This is the assertion that proves the project is USABLE rather than merely
	// present. queries/auth_pat.sql's GetActiveProjectSystemPAT is what
	// index_runtime_context, the index-schedule token and authcomposition all
	// resolve; it requires the system user, its project-role assignment, an
	// unexpired token named 'api', and create_success = true. Running the real
	// query is the only way to assert all five at once.
	var (
		patProjectID int64
		patUserID    int64
		patTokenID   int64
		patUUID      *string
		patExpires   *time.Time
		patEmail     string
	)
	if err := pool.QueryRow(ctx, `
SELECT project.id, owner.id, token.id, token.uuid, token.expires, COALESCE(owner.email, '')::text
FROM centry.project AS project
JOIN public.auth_core__user AS owner
  ON owner.email = ('system_user_' || project.id::text || '@centry.user')
JOIN public.auth_core__project_user_role AS assignment
  ON assignment.project_id = project.id AND assignment.user_id = owner.id
JOIN public.auth_core__project_role AS project_role
  ON project_role.id = assignment.role_id AND project_role.project_id = project.id
JOIN public.auth_core__token AS token ON token.user_id = owner.id
WHERE project.id = $1
  AND project.create_success = true
  AND project.suspended = false
  AND owner.suspended = false
  AND token.name = 'api'
  AND token.uuid IS NOT NULL
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'))
ORDER BY token.id
LIMIT 1`, projectID).Scan(
		&patProjectID, &patUserID, &patTokenID, &patUUID, &patExpires, &patEmail,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			t.Fatal("GetActiveProjectSystemPAT finds nothing for the new project: " +
				"indexing and scheduled index runs would fail with 'active project-system PAT not found'")
		}
		t.Fatalf("resolve project system PAT: %v", err)
	}
	if patEmail != fmt.Sprintf("system_user_%d@centry.user", projectID) {
		t.Errorf("system user email = %q, want system_user_%d@centry.user", patEmail, projectID)
	}
	if patUUID == nil || *patUUID == "" {
		t.Error("system PAT has no uuid; authsvc cannot sign a bearer form from it")
	}

	// The system user's NAME carries the prefix middleware/project_resolver.go
	// matches when mapping a system principal back to its project.
	var systemName *string
	if err := pool.QueryRow(ctx,
		`SELECT name FROM public.auth_core__user WHERE id = $1`, patUserID,
	).Scan(&systemName); err != nil {
		t.Fatalf("read system user name: %v", err)
	}
	if systemName == nil || *systemName != fmt.Sprintf(":system:project:%d:", projectID) {
		t.Errorf("system user name = %v, want :system:project:%d:", systemName, projectID)
	}

	// Every step reported success, and the successful path rolled nothing back.
	if len(result.RollbackSteps) != 0 {
		t.Errorf("rollback steps on a successful provision: %+v", result.RollbackSteps)
	}
	for _, status := range result.Steps {
		if status.OK == nil || !*status.OK {
			t.Errorf("step %q did not report success: %+v", status.Step, status)
		}
	}
}

// TestProvisionIsIdempotent proves a second provision of the SAME project
// converges instead of erroring or duplicating.
//
// This is the property that makes a retry after a partial failure safe, and it
// is not free: the schema function, the migration ledger, the role inserts, the
// system user and the token insert each had to be written to converge. A
// regression in any one of them shows up here.
func TestProvisionIsIdempotent(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)
	request := projectprovisioning.Request{
		Name: "Idempotent Project", OwnerID: 1, Limits: projectprovisioning.DefaultLimits(),
	}
	first, err := provisioner.Provision(ctx, request)
	if err != nil {
		t.Fatalf("first provision: %v", err)
	}

	// Re-running the tenant-side steps for the SAME project id is the retry an
	// operator performs after a partial failure. Provision allocates a new row
	// each time by design (the reference has no name uniqueness either), so the
	// convergence that matters is asserted directly against the steps that a
	// retry repeats.
	if _, err := pool.Exec(ctx, `SELECT create_tenant_schema($1)`,
		fmt.Sprintf("p_%d", first.ProjectID)); err != nil {
		t.Fatalf("re-run create_tenant_schema: %v", err)
	}
	if err := migrate.New(pool, platformmigrations.Files).ApplyTenant(ctx, first.ProjectID); err != nil {
		t.Fatalf("re-run ApplyTenant: %v", err)
	}

	tables := schemaTables(ctx, t, pool, fmt.Sprintf("p_%d", first.ProjectID))
	if !equalStrings(schemaTables(ctx, t, pool, "p_1"), tables) {
		t.Error("re-running the tenant steps changed the schema; provisioning is not idempotent")
	}

	// A second Provision with the same request must produce a SEPARATE project,
	// fully provisioned, rather than colliding with the first.
	second, err := provisioner.Provision(ctx, request)
	if err != nil {
		t.Fatalf("second provision: %v", err)
	}
	if second.ProjectID == first.ProjectID {
		t.Fatalf("second provision reused project id %d", second.ProjectID)
	}
	if !equalStrings(schemaTables(ctx, t, pool, "p_1"),
		schemaTables(ctx, t, pool, fmt.Sprintf("p_%d", second.ProjectID))) {
		t.Error("the second project's tenant does not match the reference")
	}
}

// failingMigrator fails ApplyTenant, which is the most dangerous point in the
// pipeline: the project row is already committed, the schema already exists,
// and an implementation that ignored the error would leave a project whose
// tenant is half-built.
type failingMigrator struct{ err error }

func (m failingMigrator) ApplyTenant(context.Context, int64) error { return m.err }

func TestProvisionLeavesNothingBehindWhenAStepFails(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	before := projectIDs(ctx, t, pool)

	provisioner := projectprovisioning.New(pool, failingMigrator{err: errors.New("corpus unavailable")}, nil)
	result, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "Doomed Project", OwnerID: 1, Limits: projectprovisioning.DefaultLimits(),
	})
	if err == nil {
		t.Fatal("provision reported success while the tenant corpus could not be applied")
	}
	if result.ProjectID == 0 {
		t.Fatal("the failure path reported no project id, so the test cannot check what was left behind")
	}
	projectID := result.ProjectID

	// The project row must be gone. A survivor is not a cosmetic leak: a
	// create_success = TRUE project with no schema makes cmd/elitea-migrate's
	// -all-tenants preflight fail for the ENTIRE deployment.
	var projectRows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM centry.project WHERE id = $1`, projectID).Scan(&projectRows); err != nil {
		t.Fatalf("count project rows: %v", err)
	}
	if projectRows != 0 {
		t.Error("the failed project row survived compensation")
	}

	// And so must everything the completed steps created.
	for _, check := range []struct {
		what  string
		query string
		arg   any
	}{
		{"quota rows", `SELECT count(*) FROM centry.project_quota WHERE project_id = $1`, projectID},
		{"statistic rows", `SELECT count(*) FROM centry.statistic WHERE project_id = $1`, projectID},
		{"project roles", `SELECT count(*) FROM public.auth_core__project_role WHERE project_id = $1`, projectID},
		{"role assignments", `SELECT count(*) FROM public.auth_core__project_user_role WHERE project_id = $1`, projectID},
		// target_id is TEXT in the ledger, so the id is bound as one.
		{"tenant ledger rows", `SELECT count(*) FROM elitea_runtime.schema_migrations
                                WHERE target_kind = 'tenant' AND target_id = $1`, fmt.Sprintf("%d", projectID)},
	} {
		var rows int
		if err := pool.QueryRow(ctx, check.query, check.arg).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", check.what, err)
		}
		if rows != 0 {
			t.Errorf("%s survived compensation: %d left", check.what, rows)
		}
	}

	// The system user is keyed by the project id, so a survivor would collide
	// with the next project that draws the same id from a restored sequence.
	var systemUsers int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM public.auth_core__user WHERE email = $1`,
		fmt.Sprintf("system_user_%d@centry.user", projectID),
	).Scan(&systemUsers); err != nil {
		t.Fatalf("count system users: %v", err)
	}
	if systemUsers != 0 {
		t.Errorf("the system user survived compensation: %d left", systemUsers)
	}

	// The schema itself.
	var schemaExists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1)`,
		fmt.Sprintf("p_%d", projectID),
	).Scan(&schemaExists); err != nil {
		t.Fatalf("check schema: %v", err)
	}
	if schemaExists {
		t.Error("the tenant schema survived compensation")
	}

	// Nothing else moved.
	if after := projectIDs(ctx, t, pool); !equalStrings(before, after) {
		t.Errorf("the project table changed: before %v, after %v", before, after)
	}

	// The failure is reported per step, and the message carries no raw database
	// error across the boundary.
	var failed bool
	for _, status := range result.Steps {
		if status.OK != nil && !*status.OK {
			failed = true
			if status.Step != "project_schema" {
				t.Errorf("the failing step is reported as %q, want project_schema", status.Step)
			}
			if status.Msg == "corpus unavailable" {
				t.Error("the raw error crossed the trust boundary in the step message")
			}
		}
	}
	if !failed {
		t.Error("no step reported a failure, so the caller cannot tell what went wrong")
	}
	if len(result.RollbackSteps) == 0 {
		t.Error("no compensation was reported")
	}
}

func TestProvisionRejectsAnEmptyNameAndAnUnknownOwner(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)

	if _, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "   ", OwnerID: 1,
	}); !errors.Is(err, projectprovisioning.ErrNameRequired) {
		t.Errorf("blank name err = %v, want ErrNameRequired", err)
	}
	if _, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "No Owner", OwnerID: 0,
	}); !errors.Is(err, projectprovisioning.ErrOwnerRequired) {
		t.Errorf("missing owner err = %v, want ErrOwnerRequired", err)
	}
}

// TestProvisionRefusesAnUnknownAdministrator pins the deliberate narrowing
// documented on createProjectAdmin: pylon CREATES an account for an unknown
// address; this does not, and it must fail loudly rather than answer 201 with an
// administrator who has no access.
func TestProvisionRefusesAnUnknownAdministrator(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)
	result, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name:        "Typo Project",
		OwnerID:     1,
		AdminEmails: []string{"nobody@example.test"},
		AdminRoles:  []string{"admin"},
		Limits:      projectprovisioning.DefaultLimits(),
	})
	if !errors.Is(err, projectprovisioning.ErrUnknownAdminEmail) {
		t.Fatalf("err = %v, want ErrUnknownAdminEmail", err)
	}
	// And the whole project is rolled back rather than left without its admin.
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM centry.project WHERE id = $1`, result.ProjectID).Scan(&rows); err != nil {
		t.Fatalf("count project rows: %v", err)
	}
	if rows != 0 {
		t.Error("a project with an unresolvable administrator survived")
	}
}

// TestDeprovisionRemovesEverythingProvisionCreated is the symmetric half.
//
// It provisions for real and then deletes, asserting the database is back where
// it started. Asserting only the 200 would accept a delete that removed the
// project row and orphaned the schema — which is the state the elitea-migrate
// preflight cannot repair, because the row it would name is gone.
func TestDeprovisionRemovesEverythingProvisionCreated(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)
	created, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "Doomed", OwnerID: 1, Limits: projectprovisioning.DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("provision: %v", err)
	}
	projectID := created.ProjectID

	// Premise: it really was provisioned. Without this the delete assertions
	// below would pass against a project that never existed.
	if tables := schemaTables(ctx, t, pool, fmt.Sprintf("p_%d", projectID)); len(tables) == 0 {
		t.Fatal("nothing was provisioned, so this test cannot prove anything was deleted")
	}

	result, err := provisioner.Deprovision(ctx, projectID)
	if err != nil {
		t.Fatalf("deprovision: %v (steps=%+v)", err, result.RollbackSteps)
	}

	var schemaExists bool
	if err := pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = $1)`,
		fmt.Sprintf("p_%d", projectID),
	).Scan(&schemaExists); err != nil {
		t.Fatalf("check schema: %v", err)
	}
	if schemaExists {
		t.Error("the tenant schema survived deletion")
	}

	for _, check := range []struct {
		what  string
		query string
		arg   any
	}{
		{"project row", `SELECT count(*) FROM centry.project WHERE id = $1`, projectID},
		{"quota rows", `SELECT count(*) FROM centry.project_quota WHERE project_id = $1`, projectID},
		{"statistic rows", `SELECT count(*) FROM centry.statistic WHERE project_id = $1`, projectID},
		{"project roles", `SELECT count(*) FROM public.auth_core__project_role WHERE project_id = $1`, projectID},
		{"role assignments", `SELECT count(*) FROM public.auth_core__project_user_role WHERE project_id = $1`, projectID},
		{"system users", `SELECT count(*) FROM public.auth_core__user WHERE email = $1`,
			fmt.Sprintf("system_user_%d@centry.user", projectID)},
		{"tenant ledger rows", `SELECT count(*) FROM elitea_runtime.schema_migrations
                                WHERE target_kind = 'tenant' AND target_id = $1`, fmt.Sprintf("%d", projectID)},
	} {
		var rows int
		if err := pool.QueryRow(ctx, check.query, check.arg).Scan(&rows); err != nil {
			t.Fatalf("count %s: %v", check.what, err)
		}
		if rows != 0 {
			t.Errorf("%s survived deletion: %d left", check.what, rows)
		}
	}

	// The reference leaves orphan project_role rows behind for every deleted
	// project because its ProjectPermissions.delete is a no-op. The loop above
	// pins the correction.

	// p_1 must be untouched: the delete names one schema, and a CASCADE against
	// the wrong one would take the whole deployment with it.
	if len(schemaTables(ctx, t, pool, "p_1")) == 0 {
		t.Fatal("deleting one project destroyed the reference tenant p_1")
	}

	// A second delete is a clean not-found rather than a partial re-run.
	if _, err := provisioner.Deprovision(ctx, projectID); !errors.Is(err, projectprovisioning.ErrProjectNotFound) {
		t.Errorf("second deprovision err = %v, want ErrProjectNotFound", err)
	}
}

// TestDeprovisionRevokesTokenBindingsForThatProjectOnly pins ADR-0018's §7.3
// invariant at the project level: a token binding must not outlive membership.
//
// Deleting one member from a project revokes that member's bindings for it, in
// eliteacore.UsersDelete. Deleting the whole project takes every membership
// with it — removeProjectPermissions deletes auth_core__project_role, and
// auth_core__project_user_role cascades from the role — so it must take every
// binding too. elitea_identity.token_project_binding.project_id carries no
// foreign key, because centry.project is pylon-owned, so nothing revokes these
// rows for us.
//
// The surviving binding is the half that makes this test discriminate. A
// `DELETE FROM token_project_binding` with no WHERE clause would pass the first
// assertion and fail the second.
func TestDeprovisionRevokesTokenBindingsForThatProjectOnly(t *testing.T) {
	pool := newProvisioningPool(t)
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	provisioner := projectprovisioning.New(pool, migrate.New(pool, platformmigrations.Files), nil)
	doomed, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "Doomed With A Bound Key", OwnerID: 1, Limits: projectprovisioning.DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("provision doomed: %v", err)
	}
	kept, err := provisioner.Provision(ctx, projectprovisioning.Request{
		Name: "Kept With A Bound Key", OwnerID: 1, Limits: projectprovisioning.DefaultLimits(),
	})
	if err != nil {
		t.Fatalf("provision kept: %v", err)
	}

	doomedToken := bindTokenToProject(ctx, t, pool, "deprovision-doomed", doomed.ProjectID)
	keptToken := bindTokenToProject(ctx, t, pool, "deprovision-kept", kept.ProjectID)

	// Premise: both bindings exist. Without this the "gone" assertion below
	// would pass against a binding that was never written.
	if got := countBindings(ctx, t, pool, doomedToken); got != 1 {
		t.Fatalf("doomed binding was not written: got %d rows, want 1", got)
	}

	if _, err := provisioner.Deprovision(ctx, doomed.ProjectID); err != nil {
		t.Fatalf("deprovision: %v", err)
	}

	if got := countBindings(ctx, t, pool, doomedToken); got != 0 {
		t.Errorf("the binding survived the project it names: got %d rows, want 0", got)
	}
	if got := countBindings(ctx, t, pool, keptToken); got != 1 {
		t.Errorf("deleting one project revoked another project's binding: got %d rows, want 1", got)
	}
}

// bindTokenToProject writes one token owned by user 1 and binds it to
// projectID. It returns the token id. It writes the rows directly because the
// token API lives in another package; the columns are the same ones that API
// writes.
func bindTokenToProject(ctx context.Context, t *testing.T, pool *pgxpool.Pool, tokenUUID string, projectID int64) int32 {
	t.Helper()
	var tokenID int32
	if err := pool.QueryRow(ctx,
		`INSERT INTO public.auth_core__token (uuid, user_id, name) VALUES ($1, 1, $2) RETURNING id`,
		tokenUUID, tokenUUID,
	).Scan(&tokenID); err != nil {
		t.Fatalf("insert token %s: %v", tokenUUID, err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO elitea_identity.token_project_binding (token_id, project_id) VALUES ($1, $2)`,
		tokenID, projectID,
	); err != nil {
		t.Fatalf("bind token %s to project %d: %v", tokenUUID, projectID, err)
	}
	return tokenID
}

func countBindings(ctx context.Context, t *testing.T, pool *pgxpool.Pool, tokenID int32) int {
	t.Helper()
	var rows int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM elitea_identity.token_project_binding WHERE token_id = $1`,
		tokenID,
	).Scan(&rows); err != nil {
		t.Fatalf("count bindings for token %d: %v", tokenID, err)
	}
	return rows
}

/* ── fixture ───────────────────────────────────────────────────────────── */

// newProvisioningPool builds an isolated database holding exactly what a real
// deployment holds: the bootstrap schema plus the embedded corpus. Nothing is
// hand-created, so a divergence between the fixture and production cannot hide
// a defect. Same shape as migrations/corpus_postgres_integration_test.go.
func newProvisioningPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	databaseURL := os.Getenv(databaseURLEnv)
	if databaseURL == "" && os.Getenv("ELITEA_TEST_USE_SERVICE_DATABASE_URL") == "1" {
		databaseURL = os.Getenv("DATABASE_URL")
	}
	if databaseURL == "" {
		t.Skipf("set %s to run the project provisioning integration test", databaseURLEnv)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()

	adminPool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatalf("open admin pool: %v", err)
	}
	defer adminPool.Close()

	databaseName := fmt.Sprintf("elitea_provision_%d_%d", os.Getpid(), time.Now().UnixNano())
	if _, err := adminPool.Exec(ctx, "CREATE DATABASE "+pgx.Identifier{databaseName}.Sanitize()); err != nil {
		t.Fatalf("create isolated database: %v", err)
	}

	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		t.Fatalf("parse %s: %v", databaseURLEnv, err)
	}
	config.ConnConfig.Database = databaseName
	config.MaxConns = 4
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		t.Fatalf("open isolated pool: %v", err)
	}
	t.Cleanup(func() {
		pool.Close()
		dropCtx, dropCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer dropCancel()
		dropPool, dropErr := pgxpool.New(dropCtx, databaseURL)
		if dropErr != nil {
			return
		}
		defer dropPool.Close()
		_, _ = dropPool.Exec(dropCtx,
			"DROP DATABASE IF EXISTS "+pgx.Identifier{databaseName}.Sanitize()+" WITH (FORCE)")
	})

	bootstrap, err := os.ReadFile(bootstrapSchema)
	if err != nil {
		t.Fatalf("read bootstrap schema: %v", err)
	}
	if _, err := pool.Exec(ctx, string(bootstrap)); err != nil {
		t.Fatalf("apply bootstrap schema: %v", err)
	}

	runner := migrate.New(pool, platformmigrations.Files)
	if err := runner.ApplyShared(ctx); err != nil {
		t.Fatalf("apply shared migrations: %v", err)
	}
	// p_1 is the reference tenant every assertion compares against, so it must
	// be at head before any test runs.
	if err := runner.ApplyTenant(ctx, 1); err != nil {
		t.Fatalf("apply tenant migrations to p_1: %v", err)
	}
	return pool
}

func schemaTables(ctx context.Context, t *testing.T, pool *pgxpool.Pool, schema string) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `
SELECT table_name FROM information_schema.tables
WHERE table_schema = $1 AND table_type = 'BASE TABLE'
ORDER BY table_name`, schema)
	if err != nil {
		t.Fatalf("list tables in %s: %v", schema, err)
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan table name: %v", err)
		}
		names = append(names, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate tables in %s: %v", schema, err)
	}
	return names
}

func projectRoleNames(ctx context.Context, t *testing.T, pool *pgxpool.Pool, projectID int64) []string {
	t.Helper()
	rows, err := pool.Query(ctx,
		`SELECT name FROM public.auth_core__project_role WHERE project_id = $1 ORDER BY name`, projectID)
	if err != nil {
		t.Fatalf("list project roles: %v", err)
	}
	defer rows.Close()
	names := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			t.Fatalf("scan role name: %v", err)
		}
		names = append(names, name)
	}
	return names
}

func projectIDs(ctx context.Context, t *testing.T, pool *pgxpool.Pool) []string {
	t.Helper()
	rows, err := pool.Query(ctx, `SELECT id::text FROM centry.project ORDER BY id`)
	if err != nil {
		t.Fatalf("list projects: %v", err)
	}
	defer rows.Close()
	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			t.Fatalf("scan project id: %v", err)
		}
		ids = append(ids, id)
	}
	return ids
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	left := append([]string(nil), a...)
	right := append([]string(nil), b...)
	sort.Strings(left)
	sort.Strings(right)
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func difference(from, remove []string) []string {
	present := make(map[string]struct{}, len(remove))
	for _, value := range remove {
		present[value] = struct{}{}
	}
	missing := make([]string, 0)
	for _, value := range from {
		if _, ok := present[value]; !ok {
			missing = append(missing, value)
		}
	}
	return missing
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
