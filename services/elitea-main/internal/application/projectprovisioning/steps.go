package projectprovisioning

// The step pipeline, and the port/drop disposition issue #333 asks for.
//
// pylon's sequence (legacy/plugins/projects/utils/project_steps.py:319-332) is:
//
//     project_model → project_schema → project_permissions → system_user →
//     system_token → project_secrets → minio_buckets → rabbit_vhost →
//     influx_databases → project_admin
//
// PORTED, in the same relative order:
//
//   project_model        The centry.project row, its project_quota row and its
//                        statistic row. /projects/quota and /projects/statistics
//                        (#246) read those two tables and answer 404 without
//                        them, so a project provisioned without this step would
//                        report "no such project" on its own settings page.
//   project_schema       create_tenant_schema('p_<id>') then the tenant corpus.
//                        pylon runs CreateSchema + create_all inside its one
//                        step; this is the same two halves.
//   project_permissions  The per-project roles. pylon writes ROLES ONLY and no
//                        auth_core__project_role_permission rows, so permission
//                        resolution falls back to the central default-mode
//                        grants by role NAME. legacyrbac.projectPermissions()
//                        implements exactly that fallback, and it is suppressed
//                        for any project that carries per-project rows — so
//                        seeding permissions here would silently CUT a new
//                        project off from every grant migration 0062-0069 adds.
//   system_user          The `system_user_<id>@centry.user` identity.
//   system_token         Its PAT, named 'api'.
//   artifact_buckets     The project's `reports` and `tasks` system buckets.
//   project_admin        Membership for the caller-supplied admin emails.
//
// DROPPED, with the reason:
//
//   project_secrets      pylon calls VaultClient.create_project_space() and
//                        stores an approle blob in centry.project.secrets_json.
//                        Neither half has a consumer here. The Go vault
//                        (internal/api/v2/secrets) mints a project's Fernet key
//                        LAZILY on first write and reports an absent vault as
//                        an empty list, precisely so a new project does not look
//                        broken; and `secrets_json` is a dead column — its only
//                        occurrence in Go is the sqlc struct field. Provisioning
//                        a vault space here would create state nothing reads.
//   rabbit_vhost         AGENTS.md forbids the Arbiter transport, and this
//                        platform's durable worker transport is Redis Streams.
//                        pylon itself skips this step unless ARBITER_RUNTIME is
//                        "rabbitmq", so dropping it is parity with a
//                        Redis-Streams deployment rather than a behaviour
//                        change. This is the drop the issue asked to confirm.
//   influx_databases     No component of this platform reads or writes InfluxDB.
//                        pylon gates the step on CENTRY_USE_INFLUX, which is
//                        false by default, so it is already inert on a stock
//                        deployment.
//
// NOT REPRODUCED, deliberately:
//
//   project_created      pylon fires an event two listeners consume: pgvector
//                        credential creation, and LiteLLM team/key creation.
//                        Nothing in the Go tree fires or consumes a project
//                        lifecycle event, the LLM path is Bifrost rather than
//                        LiteLLM, and pgvector credentials are resolved through
//                        a different mechanism. Adding an event with no
//                        subscriber would be dead wiring.

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

// Step names, as they appear in a Result's status records.
const (
	StepProjectModel       = "project_model"
	StepProjectSchema      = "project_schema"
	StepProjectPermissions = "project_permissions"
	StepSystemUser         = "system_user"
	StepSystemToken        = "system_token"
	StepArtifactBuckets    = "artifact_buckets"
	StepProjectAdmin       = "project_admin"
)

// systemProjectRole is the project role the per-project system identity holds.
//
// It is not one of the central default-mode role names. pylon's
// `auth.get_roles(mode='default')` returns `system` alongside admin/editor/
// viewer, so its `admin_add_role` creates a `system` project role as a side
// effect; this repository deliberately does not seed a central `system` role
// (001_initial.sql: "not in the Go product's role vocabulary"), so the project
// role has to be named explicitly here.
//
// It must exist. queries/auth_pat.sql's GetActiveProjectSystemPAT joins through
// auth_core__project_user_role, so a system user with no project role assignment
// yields no token at all — the shape
// authsvc/project_system_pat_issuer_postgres_integration_test.go pins as
// "missing-system-role".
const systemProjectRole = "system"

// systemTokenName is the PAT name GetActiveProjectSystemPAT matches on
// (`token.name = 'api'`). pylon's SystemToken step uses the same literal.
const systemTokenName = "api"

type step struct {
	name   string
	create func(ctx context.Context, p *Provisioner, state *provisionState) error
	remove func(ctx context.Context, p *Provisioner, state *provisionState) error
}

func createSteps() []step {
	return []step{
		{name: StepProjectModel, create: createProjectModel, remove: removeProjectModel},
		{name: StepProjectSchema, create: createProjectSchema, remove: removeProjectSchema},
		{name: StepProjectPermissions, create: createProjectPermissions, remove: removeProjectPermissions},
		{name: StepSystemUser, create: createSystemUser, remove: removeSystemUser},
		{name: StepSystemToken, create: createSystemToken, remove: removeSystemToken},
		{name: StepArtifactBuckets, create: createArtifactBuckets, remove: removeArtifactBuckets},
		{name: StepProjectAdmin, create: createProjectAdmin, remove: removeProjectAdmin},
	}
}

/* ── project_model ─────────────────────────────────────────────────────── */

// createProjectModel writes the project row and its two companion rows.
//
// pylon commits after each of the three inserts. This does all three in ONE
// transaction, which is a strict improvement available here and not there: the
// three rows are in the same database, so either the project exists with its
// quota and statistics or it does not exist at all. There is no state in which
// /projects/quota answers 404 for a project the list endpoint returns.
func createProjectModel(ctx context.Context, p *Provisioner, state *provisionState) error {
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.WithoutCancel(ctx)) }()

	plugins := state.request.Plugins
	if plugins == nil {
		// TEXT[] NOT NULL-by-default column; pylon defaults the field to [].
		plugins = []string{}
	}

	// create_success stays FALSE until every step has succeeded. See the
	// package comment for why that ordering is load-bearing.
	if err := transaction.QueryRow(ctx, `
INSERT INTO centry.project (name, owner_id, plugins, create_success)
VALUES ($1, $2, $3, false)
RETURNING id`,
		state.request.Name, state.request.OwnerID, plugins,
	).Scan(&state.projectID); err != nil {
		return fmt.Errorf("insert project: %w", err)
	}

	limits := state.request.Limits
	if _, err := transaction.Exec(ctx, `
INSERT INTO centry.project_quota (
    project_id, data_retention_limit, test_duration_limit, cpu_limit,
    memory_limit, vcu_hard_limit, vcu_soft_limit, vcu_limit_total_block,
    storage_hard_limit, storage_soft_limit, storage_limit_total_block
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
		state.projectID,
		limits.DataRetentionLimit, limits.TestDurationLimit, limits.CPULimit,
		limits.MemoryLimit, limits.VCUHardLimit, limits.VCUSoftLimit,
		limits.VCULimitTotalBlock, limits.StorageHardLimit, limits.StorageSoftLimit,
		limits.StorageLimitTotalBlock,
	); err != nil {
		return fmt.Errorf("insert project quota: %w", err)
	}

	// dast_scans and sast_scans are left to their column defaults (-1), exactly
	// as pylon leaves them; every counter defaults to 0.
	if _, err := transaction.Exec(ctx, `
INSERT INTO centry.statistic (project_id, start_time)
VALUES ($1, (now() AT TIME ZONE 'utc'))`,
		state.projectID,
	); err != nil {
		return fmt.Errorf("insert project statistic: %w", err)
	}

	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

// removeProjectModel deletes the project row, its two companion rows, and every
// shared row that points at it.
//
// THE MECHANISM ISSUE #374 ASKS TO RECORD: the delete REMOVES THE REFERENCING
// ROWS. It does not disarm a foreign key and it does not add one. Seven foreign
// keys name centry.project(id) with no ON DELETE action, so a project that ever
// ran an agent turn or an index ingest could not be deleted at all — the row
// delete failed on the first of them. See referencingDeletes for the list and
// for the order.
//
// All of it runs in ONE transaction, the referencing rows included. Either the
// project and everything that names it go together, or nothing goes. A partial
// delete cannot commit, so the project row and its tenant schema stay in step.
func removeProjectModel(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.projectID == 0 {
		return nil
	}
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.WithoutCancel(ctx)) }()

	for _, cleanup := range referencingDeletes() {
		// A deployment that has not applied the shared history yet does not
		// have these tables. deleteTenantLedger guards the same way, and an
		// undefined table would abort the whole transaction.
		var present bool
		if err := transaction.QueryRow(ctx,
			`SELECT to_regclass($1) IS NOT NULL`, cleanup.table,
		).Scan(&present); err != nil {
			return fmt.Errorf("resolve %s: %w", cleanup.table, err)
		}
		if !present {
			continue
		}
		if _, err := transaction.Exec(ctx, cleanup.statement, state.projectID); err != nil {
			return fmt.Errorf("delete rows in %s: %w", cleanup.table, err)
		}
	}

	for _, statement := range []string{
		`DELETE FROM centry.statistic WHERE project_id = $1`,
		`DELETE FROM centry.project_quota WHERE project_id = $1`,
		`DELETE FROM centry.project WHERE id = $1`,
	} {
		if _, err := transaction.Exec(ctx, statement, state.projectID); err != nil {
			return fmt.Errorf("delete project rows: %w", err)
		}
	}
	return transaction.Commit(ctx)
}

// referencingDelete is one table to clear before the project row goes.
type referencingDelete struct {
	// table is the qualified name, used both as the to_regclass guard argument
	// and as the key the coverage test compares against the live catalogue.
	table string
	// statement takes the project id as $1.
	statement string
}

// referencingDeletes clears every shared row that would block the project row
// delete, in an order that leaves nothing dangling at any point.
//
// WHY A LIST RATHER THAN A CASCADE. The seven foreign keys are declared in
// shipped migrations, and a migration carries a content checksum, so the
// declarations cannot be edited. Adding ON DELETE CASCADE to them would also
// make every future project delete silently destroy the execution and index
// attestation records, without a reader of this package being able to see it.
// The list states what a delete removes.
//
// THE ORDER. Two of these tables hold rows that no project column selects:
// index_ingest_results and configuration_validation_results reach the project
// only through their execution job. They come first, because they block the
// tables below them. execution_jobs comes next to last of the runtime tables,
// because it cascades to the claims, the settlements, the outbox and the ingest
// jobs. input_bundles comes after it, because a job names its bundle.
//
// COVERAGE IS TESTED, NOT ASSUMED. A migration that adds a foreign key to
// centry.project reopens this defect. TestEveryBlockingForeignKeyIsCovered
// reads the live catalogue and fails while a table that can block the delete is
// absent from this list.
func referencingDeletes() []referencingDelete {
	// The project's execution jobs. Both project columns select them: a job
	// carries the project that owns the resource and the project the result is
	// projected into, and either one can name this project.
	const jobsOfProject = `
    SELECT job.execution_id, job.generation
    FROM elitea_runtime.execution_jobs AS job
    WHERE job.resource_project_id = $1 OR job.projection_project_id = $1`

	return []referencingDelete{
		{
			table: "elitea_runtime.index_ingest_results",
			statement: `
DELETE FROM elitea_runtime.index_ingest_results
WHERE (execution_id, generation) IN (` + jobsOfProject + `)`,
		},
		{
			table: "elitea_runtime.configuration_validation_results",
			statement: `
DELETE FROM elitea_runtime.configuration_validation_results
WHERE (execution_id, generation) IN (` + jobsOfProject + `)`,
		},
		{
			// Also a cascade child of execution_jobs. This statement takes the
			// rows this project owns whose job belongs to another project.
			table: "elitea_runtime.index_result_artifacts",
			statement: `
DELETE FROM elitea_runtime.index_result_artifacts WHERE resource_project_id = $1`,
		},
		{
			table: "elitea_runtime.execution_replay_events",
			statement: `
DELETE FROM elitea_runtime.execution_replay_events WHERE projection_project_id = $1`,
		},
		{
			table: "elitea_runtime.execution_replay_state",
			statement: `
DELETE FROM elitea_runtime.execution_replay_state WHERE projection_project_id = $1`,
		},
		{
			table: "elitea_runtime.execution_jobs",
			statement: `
DELETE FROM elitea_runtime.execution_jobs
WHERE resource_project_id = $1 OR projection_project_id = $1`,
		},
		{
			table: "elitea_runtime.input_bundles",
			statement: `
DELETE FROM elitea_runtime.input_bundles WHERE resource_project_id = $1`,
		},
		{
			table: "elitea_runtime.index_generation_counters",
			statement: `
DELETE FROM elitea_runtime.index_generation_counters WHERE resource_project_id = $1`,
		},
	}
}

/* ── project_schema ────────────────────────────────────────────────────── */

// createProjectSchema builds the tenant.
//
// create_tenant_schema is the repository's single definition of the baseline
// tenant tables (internal/infra/db/migrations/001_initial.sql) and is idempotent
// throughout — every statement in it is CREATE ... IF NOT EXISTS. ApplyTenant
// then brings the schema to the head of migrations/tenant/. No table definition
// is restated in Go, which is what issue #333 requires.
func createProjectSchema(ctx context.Context, p *Provisioner, state *provisionState) error {
	if _, err := p.pool.Exec(ctx, `SELECT create_tenant_schema($1)`, state.tenantSchema()); err != nil {
		return fmt.Errorf("create tenant schema: %w", err)
	}
	// ApplyTenant re-reads centry.project on its own pooled connection, so this
	// can only run after createProjectModel committed. It is idempotent through
	// the migration ledger: versions already recorded for this project are
	// skipped, and the whole history applies in one transaction.
	if err := p.migrator.ApplyTenant(ctx, state.projectID); err != nil {
		return fmt.Errorf("apply tenant migrations: %w", err)
	}
	return nil
}

func removeProjectSchema(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.projectID == 0 {
		return nil
	}
	// Ledger first: if the DROP succeeds and this fails, the ledger would claim
	// a corpus is applied to a schema that no longer exists.
	if err := p.deleteTenantLedger(ctx, state.projectID); err != nil {
		return err
	}
	return p.dropTenantSchema(ctx, state.tenantSchema())
}

/* ── project_permissions ───────────────────────────────────────────────── */

// createProjectPermissions creates the project's roles, and only its roles.
//
// See the disposition note at the top of this file for why no
// auth_core__project_role_permission row is written: doing so would suppress
// legacyrbac's central fallback and cut the project off from the corpus grants.
func createProjectPermissions(ctx context.Context, p *Provisioner, state *provisionState) error {
	// Every central default-mode role name, plus `system`. pylon derives the
	// list from auth.get_roles(mode='default'), which includes `system` there.
	if _, err := p.pool.Exec(ctx, `
INSERT INTO public.auth_core__project_role (project_id, name)
SELECT $1, role_name
FROM (
    SELECT name AS role_name FROM public.auth_core__role WHERE mode = 'default'
    UNION
    SELECT $2::text
) AS project_roles
ON CONFLICT (project_id, name) DO NOTHING`,
		state.projectID, systemProjectRole,
	); err != nil {
		return fmt.Errorf("create project roles: %w", err)
	}
	return nil
}

// removeProjectPermissions deletes the project's roles and the token bindings
// that name it.
//
// pylon's counterpart is a no-op, which leaves orphan auth_core__project_role
// and auth_core__project_user_role rows behind after a project is deleted — its
// own deletion path has the same hole. Compensating properly here is a
// deliberate correction: the rows describe a project that will not exist, and
// auth_core__project_user_role cascades from the role, so one delete clears
// both.
//
// The binding delete is the same invariant one level up (ADR-0018,
// spec-llm-project-scope §7.3): a binding must not outlive membership. Removing
// one user from a project revokes that user's bindings for it, in
// eliteacore.UsersDelete. Removing the whole project takes every membership
// with it through the role cascade, so it must take every binding too.
// elitea_identity.token_project_binding.project_id carries no foreign key —
// centry.project is pylon-owned as well — so nothing deletes these rows for us.
//
// Both statements run in one transaction. Half a teardown leaves bindings that
// name a project no longer there, which is the state this function exists to
// prevent.
func removeProjectPermissions(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.projectID == 0 {
		return nil
	}
	transaction, err := p.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = transaction.Rollback(context.WithoutCancel(ctx)) }()

	if _, err := transaction.Exec(ctx,
		`DELETE FROM elitea_identity.token_project_binding WHERE project_id = $1`,
		state.projectID,
	); err != nil {
		return fmt.Errorf("delete token project bindings: %w", err)
	}
	if _, err := transaction.Exec(ctx,
		`DELETE FROM public.auth_core__project_role WHERE project_id = $1`,
		state.projectID,
	); err != nil {
		return fmt.Errorf("delete project roles: %w", err)
	}
	if err := transaction.Commit(ctx); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}

/* ── system_user ───────────────────────────────────────────────────────── */

// createSystemUser creates the project's system identity and gives it the
// `system` project role.
//
// This is not optional decoration. Three subsystems resolve a project's system
// PAT through queries/auth_pat.sql's GetActiveProjectSystemPAT —
// infra/storage/index_runtime_context.go, runtimecomposition's index-schedule
// token, and authcomposition's graph — and that query matches the identity by
// the literal email below. A project provisioned without it answers every
// indexing request with "active project-system PAT not found".
func createSystemUser(ctx context.Context, p *Provisioner, state *provisionState) error {
	email := systemUserEmail(state.projectID)
	name := systemUserName(state.projectID)

	// pylon probes for an existing user first and skips creation. ON CONFLICT
	// does the same thing without the race, and without the defect pylon's
	// early return carries (it returns a bare int rather than a dict, so the
	// next step loses its argument and re-provisioning fails outright).
	var userID int64
	if err := p.pool.QueryRow(ctx, `
WITH created AS (
    INSERT INTO public.auth_core__user (email, name)
    VALUES ($1, $2)
    ON CONFLICT (email) DO NOTHING
    RETURNING id
)
SELECT id FROM created
UNION ALL
SELECT id FROM public.auth_core__user WHERE email = $1
LIMIT 1`,
		email, name,
	).Scan(&userID); err != nil {
		return fmt.Errorf("create system user: %w", err)
	}
	state.systemUserID = userID

	// The role assignment GetActiveProjectSystemPAT joins through.
	if _, err := p.pool.Exec(ctx, `
INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
SELECT $1, $2, role.id
FROM public.auth_core__project_role AS role
WHERE role.project_id = $1 AND role.name = $3
ON CONFLICT (project_id, user_id, role_id) DO NOTHING`,
		state.projectID, userID, systemProjectRole,
	); err != nil {
		return fmt.Errorf("assign system role: %w", err)
	}
	return nil
}

func removeSystemUser(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.systemUserID == 0 {
		return nil
	}
	// auth_core__token and auth_core__project_user_role both cascade from the
	// user row, so this also removes the PAT created by the next step.
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM public.auth_core__user WHERE id = $1`, state.systemUserID,
	); err != nil {
		return fmt.Errorf("delete system user: %w", err)
	}
	return nil
}

func systemUserEmail(projectID int64) string {
	// PROJECT_USER_EMAIL_TEMPLATE, and the literal GetActiveProjectSystemPAT
	// reconstructs in SQL. Changing either without the other breaks the join.
	return fmt.Sprintf("system_user_%d@centry.user", projectID)
}

func systemUserName(projectID int64) string {
	// PROJECT_USER_NAME_TEMPLATE. middleware/project_resolver.go recognises this
	// prefix when mapping a system principal back to its project.
	return fmt.Sprintf(":system:project:%d:", projectID)
}

/* ── system_token ──────────────────────────────────────────────────────── */

// createSystemToken mints the project system PAT.
//
// auth_core__token stores no secret material: the row's `uuid` is the identity,
// and authsvc signs a bearer form from it on demand. So provisioning inserts a
// row and never handles a credential value.
func createSystemToken(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.systemUserID == 0 {
		return errors.New("system user was not created")
	}
	// pylon reuses the first existing token rather than minting a second. The
	// same rule, expressed as a conditional insert so that a re-run converges.
	// No expiry: GetActiveProjectSystemPAT accepts a NULL `expires`, and pylon
	// leaves the argument commented out.
	if _, err := p.pool.Exec(ctx, `
INSERT INTO public.auth_core__token (uuid, expires, user_id, name)
SELECT $1, NULL, $2, $3
WHERE NOT EXISTS (
    SELECT 1 FROM public.auth_core__token
    WHERE user_id = $2 AND name = $3
)`,
		uuid.NewString(), state.systemUserID, systemTokenName,
	); err != nil {
		return fmt.Errorf("create system token: %w", err)
	}
	return nil
}

func removeSystemToken(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.systemUserID == 0 {
		return nil
	}
	if _, err := p.pool.Exec(ctx,
		`DELETE FROM public.auth_core__token WHERE user_id = $1 AND name = $2`,
		state.systemUserID, systemTokenName,
	); err != nil {
		return fmt.Errorf("delete system token: %w", err)
	}
	return nil
}

/* ── artifact_buckets ──────────────────────────────────────────────────── */

// createArtifactBuckets creates the project's `reports` and `tasks` buckets.
//
// internal/application/artifactbootstrap already ports this step exactly, and
// its own doc comment records that nothing calls it because no project-creation
// path existed: "every project created after this migration ships has no system
// buckets". This is that call site.
//
// The bucket names are metadata rows rather than physical MinIO buckets — the
// S3 backend keys one configured bucket by project prefix — but the artifacts
// HTTP API answers 404 for a bucket with no row, so the rows are what make a new
// project's artifact surface reachable.
//
// The dependency is optional: a deployment with artifacts disabled configures no
// bootstrapper, and the step then reports success without doing anything rather
// than failing provisioning over a subsystem that deployment does not run.
func createArtifactBuckets(ctx context.Context, p *Provisioner, state *provisionState) error {
	if p.buckets == nil {
		return nil
	}
	if err := p.buckets.BootstrapProjectBuckets(ctx, state.projectIDString()); err != nil {
		return fmt.Errorf("bootstrap project buckets: %w", err)
	}
	return nil
}

func removeArtifactBuckets(ctx context.Context, p *Provisioner, state *provisionState) error {
	if p.buckets == nil || state.projectID == 0 {
		return nil
	}
	if err := p.buckets.TeardownProjectBuckets(ctx, state.projectIDString()); err != nil {
		return fmt.Errorf("teardown project buckets: %w", err)
	}
	return nil
}

/* ── project_admin ─────────────────────────────────────────────────────── */

// createProjectAdmin gives the requested administrators membership.
//
// NARROWED FROM THE REFERENCE, deliberately. pylon's
// `add_user_to_project_or_create` CREATES an account — in Keycloak and in
// auth_core — for an address it does not recognise, with a hardcoded temporary
// password. Minting an identity as a side effect of creating a project is not a
// behaviour this route should carry, and this platform has a dedicated invite
// surface for it (internal/api/v2/eliteacore's UsersCreate). So an address that
// matches no existing user FAILS the step.
//
// Failing is the point. Silently skipping an unknown address would answer 201
// while the administrator the caller named has no access — the "answers 200,
// provisioned nothing" shape this codebase keeps re-shipping. The whole create
// rolls back instead, and the caller sees which step failed.
func createProjectAdmin(ctx context.Context, p *Provisioner, state *provisionState) error {
	if len(state.request.AdminEmails) == 0 {
		return nil
	}
	roles := state.request.AdminRoles
	if len(roles) == 0 {
		return nil
	}

	for _, email := range state.request.AdminEmails {
		// Matched case-insensitively, as pylon lowercases before comparing.
		tag, err := p.pool.Exec(ctx, `
INSERT INTO public.auth_core__project_user_role (project_id, user_id, role_id)
SELECT $1, account.id, role.id
FROM public.auth_core__user AS account
JOIN public.auth_core__project_role AS role
  ON role.project_id = $1 AND role.name = ANY($3::text[])
WHERE lower(account.email) = lower($2)
  AND account.suspended = false
ON CONFLICT (project_id, user_id, role_id) DO NOTHING`,
			state.projectID, email, roles,
		)
		if err != nil {
			return fmt.Errorf("assign project administrator: %w", err)
		}
		if tag.RowsAffected() == 0 {
			// Either the address matches no active account, or the assignment
			// already existed. Distinguish them, so a re-run stays idempotent
			// while a typo still fails.
			var member bool
			if err := p.pool.QueryRow(ctx, `
SELECT EXISTS (
    SELECT 1
    FROM public.auth_core__user AS account
    JOIN public.auth_core__project_user_role AS assignment
      ON assignment.user_id = account.id AND assignment.project_id = $1
    WHERE lower(account.email) = lower($2)
)`, state.projectID, email).Scan(&member); err != nil {
				return fmt.Errorf("verify project administrator: %w", err)
			}
			if !member {
				return fmt.Errorf("%w: %s", ErrUnknownAdminEmail, email)
			}
		}
	}
	return nil
}

func removeProjectAdmin(ctx context.Context, p *Provisioner, state *provisionState) error {
	if state.projectID == 0 || len(state.request.AdminEmails) == 0 {
		return nil
	}
	// Only the assignments this step could have made. The system user's own
	// assignment is removed by removeSystemUser.
	if _, err := p.pool.Exec(ctx, `
DELETE FROM public.auth_core__project_user_role AS assignment
USING public.auth_core__user AS account
WHERE assignment.project_id = $1
  AND assignment.user_id = account.id
  AND lower(account.email) = ANY($2::text[])`,
		state.projectID, lowerAll(state.request.AdminEmails),
	); err != nil {
		return fmt.Errorf("remove project administrators: %w", err)
	}
	return nil
}

// ErrUnknownAdminEmail reports a project_admin_email that matches no active
// account. The handler maps it to 400.
var ErrUnknownAdminEmail = errors.New("projectprovisioning: no active account for administrator email")

func lowerAll(values []string) []string {
	lowered := make([]string, 0, len(values))
	for _, value := range values {
		lowered = append(lowered, strings.ToLower(value))
	}
	return lowered
}
