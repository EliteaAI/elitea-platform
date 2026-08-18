-- 0085_project_member_and_role_listings_administration.sql — the
-- ADMINISTRATION-mode grants for the project member listing and the project
-- role listing (#313).
--
--   configuration.users.users.view   in administration mode
--   configuration.roles.roles.view   in administration mode
--
-- THIS FILE ADDS NO NEW PERMISSION NAME. Both strings are already in the
-- catalogue. 0068 grants them in DEFAULT mode to `admin`, `editor` and
-- `viewer`. This file adds the ADMINISTRATION-mode holders, which no migration
-- granted, and which two admin panel screens now need.
--
-- WHY THE MODE MATTERS HERE, AND WHY A DEFAULT-MODE GRANT IS NOT ENOUGH.
--
-- legacyrbac resolves a `default`-mode gate purely from the caller's membership
-- OF THE NAMED PROJECT: the central default-mode fallback is joined THROUGH the
-- caller's assigned project roles, so a principal who holds no role in that
-- project resolves the empty set. That is correct for the project settings
-- Members page, whose caller is a member by definition.
--
-- It is wrong for the admin panel. An operator answering for every tenant is a
-- member of none of those projects, so a default-mode gate refuses every
-- legitimate caller of the admin panel's project member dialog. The panel's
-- whole purpose is acting on projects one is not in. That is the same split
-- 0082 needed for `configuration.users.users.create` and `.edit`, which are the
-- WRITES of this same dialog; this file supplies the two READS that were left
-- behind.
--
-- THE ROUTES. internal/api/api/router.go registers each listing TWICE, because
-- the gate differs and the handler does not:
--
--   GET /api/v2/admin/users/{mode}/{projectID}          default mode
--   GET /api/v2/admin/users/administration/{projectID}  administration mode
--   GET /api/v2/admin/roles/{mode}/{projectID}          default mode
--   GET /api/v2/admin/roles/administration/{projectID}  administration mode
--
-- The `administration` segment is STATIC, so chi prefers it over the `{mode}`
-- route. Without it the admin panel's read would land on the default-mode gate.
--
-- WHERE THE SPLIT COMES FROM. testdata/postgres/legacy-rbac-matrix.json, read
-- for the `administration` mode:
--
--   configuration.users.users.view   admin, editor, super_admin, system
--   configuration.roles.roles.view   admin, editor, super_admin, system, viewer
--
-- This file copies that. It makes no new policy.
--
-- THE TWO LISTINGS DO NOT GET THE SAME HOLDERS, AND THAT IS THE MATRIX. The
-- administration-mode `viewer` may list a project's ROLES and may not list its
-- MEMBERS. The asymmetry looks like an error at first reading. It is not one in
-- effect, and this file transcribes it rather than level it, for a reason that
-- was checked before the decision:
--
--   The admin panel's member dialog sits behind the admin Projects page, which
--   is gated on `projects.projects.projects.view`. The matrix withholds that
--   string from the administration-mode `viewer` AND from the administration-
--   mode `editor`. So neither role can reach the page that opens the dialog,
--   and neither can call either listing whatever this file grants. The
--   asymmetry costs no caller a screen.
--
-- That check is what separates this file from #402, which found two splits that
-- were faithful to the matrix and still wrong for the product — a viewer who
-- could see no secret NAMES, and a user who could not set their own avatar. In
-- both of those the matrix denied a caller a screen the product means them to
-- have. Here it does not, so the matrix stands.
--
-- `system` is omitted, as every other file in this corpus omits it. 0060 seeds
-- four administration-mode roles — super_admin, admin, editor and viewer — and
-- `system` is not one of them.
--
-- BLAST RADIUS. These are CENTRAL grants, read by role NAME from
-- auth_core__user_role. They widen nothing for a project member: the routes
-- they reach are the two `administration` registrations, which no project
-- settings page calls. An operator who already holds `projects…view` can
-- already read the same project's row in the admin Projects listing.
--
-- 0060's VIRGIN-mode guard is NOT reproduced here, for the reason 0061, 0072
-- and 0079 state. Neither grant has ever existed in this mode on a Go
-- deployment, so no operator can have revoked it.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0085: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

-- The member listing. Granted to super_admin, admin and editor. The legacy
-- matrix withholds it from the administration-mode viewer.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('configuration.users.users.view')
) AS grant_row(permission)
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin', 'editor')
ON CONFLICT (role_id, permission) DO NOTHING;

-- The project role listing. Granted to the viewer as well, which is the one
-- place the matrix separates the two listings.
INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('configuration.roles.roles.view')
) AS grant_row(permission)
WHERE role.mode = 'administration' AND role.name IN ('super_admin', 'admin', 'editor', 'viewer')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
