-- 0062_budgets_quota_statistics.sql — the tables and grants issue #246's
-- budgets/quotas/usage routes need.
--
-- Three independent pieces, kept in one migration because they land with one
-- API surface:
--
--   1. centry.project_quota and centry.statistic. Both exist in every
--      pylon-backed database (legacy/plugins/projects/models/{quota,statistics}.py
--      create them) and in NO Go-bootstrapped one — 001_initial.sql never
--      carried them. `GET/PUT /api/v2/projects/quota/{project_id}` and
--      `GET /api/v2/projects/statistics/{project_id}` read them, so a fresh
--      database needs them or those three routes answer 500 forever.
--   2. The two administration-mode grants the admin budget routes are gated on.
--   3. The default-mode grant the project-scoped budget/usage READS are gated
--      on.
--
-- Why (3) matters more than it looks: `legacyrbac.PostgresResolver`'s
-- projectPermissions() falls back to CENTRAL default-mode grants by role name
-- when a project has no per-project rows, and a Go-bootstrapped database has
-- default-mode ROLES (001_initial.sql) but not one default-mode
-- role_permission row. So every project-scoped permission resolves to the
-- empty set, and gating a project read without this grant is
-- 403-for-everyone — the exact failure 0060's header exists to describe.
--
-- Idempotent and additive throughout: CREATE TABLE IF NOT EXISTS leaves a
-- dump-loaded quota table and its data untouched, and the grants are
-- ON CONFLICT DO NOTHING against roles that must already exist.

CREATE SCHEMA IF NOT EXISTS centry;

-- ---------------------------------------------------------------------------
-- centry.project_quota — per-project resource ceilings
-- ---------------------------------------------------------------------------
-- Column-for-column legacy/plugins/projects/models/quota.py, verified against
-- the deployed table (\d centry.project_quota). The commented-out columns in
-- that model (vuh_limit, storage_space) are absent from the deployed table too
-- and are absent here; -1 is its "unlimited" sentinel, which check_quota reads
-- before comparing against centry.statistic.
CREATE TABLE IF NOT EXISTS centry.project_quota (
    id                        SERIAL PRIMARY KEY,
    project_id                INTEGER NOT NULL,
    data_retention_limit      INTEGER,
    test_duration_limit       INTEGER DEFAULT -1,
    cpu_limit                 INTEGER DEFAULT -1,
    memory_limit              INTEGER DEFAULT -1,
    last_update_time          TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    dast_scans                INTEGER DEFAULT -1,
    sast_scans                INTEGER DEFAULT -1,
    vcu_hard_limit            INTEGER,
    vcu_soft_limit            INTEGER,
    vcu_limit_total_block     BOOLEAN NOT NULL DEFAULT false,
    storage_hard_limit        INTEGER,
    storage_soft_limit        INTEGER,
    storage_limit_total_block BOOLEAN NOT NULL DEFAULT false
);

-- The reference model has no unique constraint and its readers all take
-- `.first()`, so two rows for one project would make the quota a coin flip.
-- A UNIQUE INDEX rather than a table constraint so this stays applicable to a
-- dump-loaded table that already has rows.
CREATE UNIQUE INDEX IF NOT EXISTS project_quota_project_uniq
    ON centry.project_quota (project_id);

-- ---------------------------------------------------------------------------
-- centry.statistic — per-project usage counters
-- ---------------------------------------------------------------------------
-- legacy/plugins/projects/models/statistics.py. The counters are written by
-- the carrier-era test runners, none of which exist in this platform, so on a
-- Go deployment they stay at their defaults; the row still has to exist for
-- the statistics endpoint to have a current-value side at all.
CREATE TABLE IF NOT EXISTS centry.statistic (
    id                       SERIAL PRIMARY KEY,
    project_id               INTEGER NOT NULL,
    start_time               TIMESTAMP DEFAULT (now() AT TIME ZONE 'utc'),
    vuh_used                 INTEGER DEFAULT 0,
    performance_test_runs    INTEGER DEFAULT 0,
    sast_scans               INTEGER DEFAULT 0,
    dast_scans               INTEGER DEFAULT 0,
    public_pool_workers      INTEGER DEFAULT 0,
    ui_performance_test_runs INTEGER DEFAULT 0,
    tasks_executions         INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS statistic_project_uniq
    ON centry.statistic (project_id);

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
DO $$
BEGIN

-- elitea-migrate can run before 001_initial.sql has created auth_core (see
-- 0060/0061, which open with the same check). Nothing to grant in that case.
IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0062: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

-- Administration mode. project_budget.py, project_budgets.py, user_budget.py
-- and user_budgets.py all declare `{"admin": True, "editor": False,
-- "viewer": False}` in ADMINISTRATION_MODE, which — per the transcription trap
-- 0060, 0061 and 001_initial.sql all document — leaves super_admin at its
-- default True. So both roles, and neither editor nor viewer.
--
-- 0060's virgin-mode guard is deliberately NOT reproduced, for 0061's reason:
-- these two permissions did not exist before this migration, so no operator
-- can have revoked them, and skipping a configured deployment would leave
-- exactly that deployment unable to reach the routes.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
JOIN (VALUES
    ('super_admin', 'models.admin.project_budgets.view'),
    ('super_admin', 'models.admin.project_budgets.edit'),
    ('admin', 'models.admin.project_budgets.view'),
    ('admin', 'models.admin.project_budgets.edit')
) AS grant_row(role_name, permission) ON grant_row.role_name = role.name
WHERE role.mode = 'administration'
ON CONFLICT (role_id, permission) DO NOTHING;

-- Default mode. project_budget.py, user_budget.py, user_budgets.py and
-- usage.py declare `{"admin": True, "editor": True, "viewer": True}` in
-- DEFAULT_MODE for their project-scoped reads, so all three project roles hold
-- it. This is a project-scoped permission being granted to project-scoped
-- roles; it is not the "central admin permission leaking into project
-- resolution" that 001_initial.sql warns about.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, 'models.project_context.view'
FROM public.auth_core__role AS role
WHERE role.mode = 'default' AND role.name IN ('admin', 'editor', 'viewer')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
