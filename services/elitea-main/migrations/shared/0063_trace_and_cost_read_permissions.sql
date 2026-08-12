-- 0063_trace_and_cost_read_permissions.sql — the three DEFAULT-mode grants
-- issue 253's routes are gated on.
--
--   models.monitoring.tracing.view  ← elitea_core/api/v2/analytics_costs.py
--   models.chat.messages.list       ← elitea_core/api/v2/message_traces.py
--   models.chat.messages.details    ← elitea_core/api/v2/message_trace.py
--
-- All three are transcribed from those handlers' `check_api` declarations,
-- which name `{"admin": True, "editor": True, "viewer": True}` in
-- DEFAULT_MODE. They are PROJECT-scoped permissions granted to project-scoped
-- roles, which is what 0062 established with `models.project_context.view`;
-- they are not the "central admin permission leaking into project resolution"
-- that 001_initial.sql warns about.
--
-- WHY THIS FILE EXISTS AT ALL, restating 0060/0061/0062's shared reason:
-- gating a route on a permission nothing grants is 403-for-everyone, which
-- reads as a broken page rather than as a missing grant. `legacyrbac`'s
-- projectPermissions() falls back to CENTRAL default-mode grants by role name
-- when a project carries no per-project rows, and a Go-bootstrapped database
-- has default-mode roles but only the one default-mode role_permission row
-- 0062 seeded. Without these three, every caller of the cost breakdown and of
-- both trace reads resolves the empty set.
--
-- BLAST RADIUS, and why it is smaller than 0062's. 0062's grant was the first
-- default-mode row in this codebase, so it changed a member's permission set
-- from EMPTY to non-empty and two unrelated places reacted to that transition
-- (the project-info read, and public_authorizer.go's
-- `len(resolution.Permissions) != 0` membership stand-in, tracked as issue
-- 276). That transition has already happened. These three add members to an
-- already-non-empty set, and none of the three strings is read anywhere else
-- in this service — verified by grep across internal/: the only nearby
-- permission in use is `models.chat.messages.create`
-- (internal/api/v2/agentexecution/route.go, public_authorizer.go), which is a
-- different string and is NOT granted here. So the reachable surface changes
-- by exactly the three routes 253 adds.
--
-- Idempotent and additive: it grants to roles that already exist, never creates
-- one, and conflicts are ignored. `system` is omitted, as everywhere else in
-- this corpus.

-- Two guards, and one deliberately not taken — the same three decisions 0061
-- and 0062 document:
--
--   * the auth_core tables can be absent entirely (elitea-migrate runs against
--     databases whose auth_core schema arrives later, from 001_initial.sql at
--     elitea-main startup or from a legacy dump), so nothing to grant then;
--   * 0060's VIRGIN-mode guard is NOT reproduced: these permissions have never
--     existed on a Go deployment, so no operator can have revoked them, and
--     skipping configured deployments would leave exactly those unable to reach
--     the routes;
--   * no unique index or constraint is added; the ON CONFLICT target is the
--     existing (role_id, permission) key.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0063: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('models.monitoring.tracing.view'),
    ('models.chat.messages.list'),
    ('models.chat.messages.details')
) AS grant_row(permission)
WHERE role.mode = 'default' AND role.name IN ('admin', 'editor', 'viewer')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
