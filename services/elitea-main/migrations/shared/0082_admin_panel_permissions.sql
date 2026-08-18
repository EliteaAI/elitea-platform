-- 0082_admin_panel_permissions.sql — the ADMINISTRATION-mode grants for the
-- admin panel (#386).
--
--   configuration.users.users.create
--   configuration.users.users.edit
--   admin.moderation.edit
--   configuration.roles.permissions.edit
--   projects.projects.projects.edit
--   configuration.scheduling.schedules.view
--   configuration.scheduling.schedules.edit
--   models.admin.audit_trail.view
--   runtime.airun.serviceproviders
--   provider_hub.descriptor.register
--   configuration.governance
--
-- WHY THIS FILE EXISTS. Each permission above gates a mounted admin route. No
-- migration in this corpus grants any of them.
--
-- THERE IS NO SUPER-ADMIN BYPASS. legacyrbac's centralPermissions() reads
-- auth_core__user_role, auth_core__role filtered on the mode, and
-- auth_core__role_permission. It gives `super_admin` no special case. So an
-- administration gate with no grant answers 403 to the operator too. An operator
-- cannot grant their way out either, because the admin write APIs are themselves
-- gated on strings in this list.
--
-- WHY A NEW FILE RATHER THAN AN EDIT. 0060 returns early when ANY
-- administration-mode role already exists. So every deployment that has run it
-- skips it forever. Adding rows to its VALUES list would seed them on fresh
-- databases only, and leave every existing deployment at 403. Migrations are
-- also checksum-immutable, so an applied file must never change.
--
-- WHAT 0060 AND 0061 ALREADY GRANT. 0060 grants five strings and 0061 grants
-- four more. The list above names strings that neither file carries. Three of
-- them are the WRITE half of a pair whose READ half is already granted, which is
-- why the fault is easy to miss: the page loads, and every button on it answers
-- 403.
--
--   * 0060 grants `configuration.roles.permissions.view`, not `…edit`.
--   * 0060 grants `projects.projects.projects.view`, not `…edit`.
--   * 0060 grants the BARE `admin.moderation`, not `admin.moderation.edit`.
--     middleware.hasIntersection compares exact strings, so the bare grant
--     satisfies no suffixed gate.
--
-- WHERE THE SPLIT COMES FROM. testdata/postgres/legacy-rbac-matrix.json gives
-- every string above to `admin` in the `administration` mode, and gives
-- `admin.moderation.edit` to `editor` as well. This file copies that split.
--
-- `super_admin` is added to each row, as 0060 and 0061 both do. In the
-- `administration` mode the matrix gives `super_admin` every one of these
-- strings, and Go seeds the role. That differs from the `default` mode, where Go
-- seeds no `super_admin` role and this corpus therefore omits it.
--
-- `system` is omitted, as everywhere else in this corpus. It is not in the Go
-- product's role vocabulary; see users.go `adminRolePriority`.
--
-- ONE STRING HAS NO MATRIX ENTRY: `configuration.governance`. The legacy
-- permission catalogue does not carry it, so there is nothing to transcribe.
-- This file gives it `super_admin` and `admin`, for three reasons:
--
--   1. It gates platform-wide gateway governance and budget alerts at
--      /api/v2/admin/gateway/*. The path carries no project id, so it is a
--      central administration surface by shape.
--   2. internal/api/v2/admin/config_schemas.go:617 already declares
--      `configuration.governance` as the required permission for the same
--      schema-driven admin screen. That is an independent statement of the same
--      intent inside this repository.
--   3. Every other central administration grant in 0060 and 0061 lands on
--      `super_admin` and `admin`, and on neither `editor` nor `viewer`. A
--      narrower holder set would leave the route unreachable. A wider one would
--      hand an editor the platform budget controls.
--
-- THE GOVERNANCE GATE ALSO NEEDED A CODE CHANGE. router.go gated that route with
-- `RequirePermissions`, which reads auth.User.Permissions. Production never fills
-- that field, so the gate refused every caller by construction and no grant could
-- reach it. This change moves the route to `RequireCentralPermissions` in the
-- `administration` mode, which resolves against the tables this file writes. The
-- permission string does not change.
--
-- IDEMPOTENT AND ADDITIVE. It grants to roles that already exist and never
-- creates one. A deployment whose administration roles were curated by hand keeps
-- its shape. ON CONFLICT DO NOTHING makes a repeat run inert.
--
-- 0060's VIRGIN-mode guard is NOT reproduced here, for the reason 0061 states.
-- These permissions never existed on a Go deployment, so no operator can have
-- revoked them. A guard that skips configured deployments leaves exactly those
-- unable to reach the admin panel.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0082: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

-- Granted to super_admin and admin.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('configuration.users.users.create'),
    ('configuration.users.users.edit'),
    ('configuration.roles.permissions.edit'),
    ('projects.projects.projects.edit'),
    ('configuration.scheduling.schedules.view'),
    ('configuration.scheduling.schedules.edit'),
    ('models.admin.audit_trail.view'),
    ('runtime.airun.serviceproviders'),
    ('provider_hub.descriptor.register'),
    ('configuration.governance')
) AS grant_row(permission)
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin')
ON CONFLICT (role_id, permission) DO NOTHING;

-- Granted to super_admin, admin and editor. The legacy matrix gives the
-- moderation DECISION to the administration-mode editor as well.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('admin.moderation.edit')
) AS grant_row(permission)
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin', 'editor')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
