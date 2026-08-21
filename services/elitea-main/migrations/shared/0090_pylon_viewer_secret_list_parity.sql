-- 0090_pylon_viewer_secret_list_parity.sql — keep the #402 viewer split on a
-- Go-managed database, and withdraw it from a pylon-managed one.
--
-- THE DEFECT THIS FILE CORRECTS.
--
-- shared/0083_viewer_secret_list_and_own_avatar.sql grants
-- `configuration.secrets.secret.list` to the CENTRAL default-mode `viewer`.
-- Its header states the blast radius as follows:
--
--   "That shape is the fresh Go database. It is never the shape of a
--    pylon-backed database, of a legacy dump, or of the end-to-end stack: each
--    one seeds per-project rows, and those rows suppress the central fallback
--    completely. So no existing deployment's members gain anything here."
--
-- That paragraph is wrong, and nine other files in this corpus repeat it. A
-- pylon-backed database seeds NO per-project permission row:
--
--   * legacy/plugins/auth_core/db/migrations/202602261000_permission_consolidation.py
--     TRUNCATEs auth_core__project_role_permission and calls the table dead.
--   * pylon project creation writes auth_core__project_role rows only. Its
--     admin_set_permission_for_role RPC is a `pass`.
--   * testdata/postgres/legacy-rbac-matrix.json, exported from pylon at
--     migration head 202604161400, reports project_role_permission_rows: 0.
--     Every one of its ten project roles carries an empty permission list.
--
-- So the central fallback in internal/infra/legacyrbac/postgres.go IS live on
-- such a database, and 0083 DOES widen every project viewer there. The hybrid
-- proof of value in deploy/centry-hybrid/pov-compose.yml runs elitea-migrate
-- against exactly that database.
--
-- WHY THE WIDENING IS REFUSED FOR THE SECRET LISTING.
--
-- legacy/plugins/secrets/api/v2/secrets.py gates the pylon listing route on the
-- same string, and declares `DEFAULT_MODE: {"admin": True, "viewer": False,
-- "editor": True}`. The row therefore changes what a PYLON route admits, not
-- only what a Go route admits. #402 decided the Go product's split. It did not
-- decide pylon's, and this corpus has no mandate to widen a second product's
-- surface. This file removes the row where pylon owns the auth tables.
--
-- WHY THE TWO AVATAR STRINGS STAY.
--
-- 0083 also grants `models.social.avatar.get` and `models.social.avatar.update`
-- to the default-mode `editor` and `viewer`. Neither widens a pylon route:
--
--   * `models.social.avatar.update` is not in pylon's catalogue at all. 0080
--     mapped it onto the legacy name `models.social.avatar.post`, so pylon gates
--     nothing on the Go string.
--   * `models.social.avatar.get` gates
--     legacy/plugins/social/api/v2/avatar.py, which lists the STOCK avatar image
--     files under the plugin's own avatar directory. It reads no project data
--     and no other person's data.
--
-- Removing either one would only stop an editor and a viewer from seeing and
-- setting their own picture in the Go product on a hybrid deployment. So both
-- rows stay, and this file is deliberately narrower than the three deviations
-- 0083 names.
--
-- THE DISCRIMINATOR, AND WHY IT IS NOT A ROW COUNT.
--
-- "auth_core__project_role_permission is empty" is a transient state that an
-- operator changes with one press of the admin console. Ownership of auth_core
-- is not. pylon seeds two role shapes that this repository never creates:
--
--   * the whole `developer` mode (five roles), and
--   * a `default`-mode `super_admin`.
--
-- internal/infra/db/migrations/001_initial.sql seeds `admin`, `editor` and
-- `viewer` in `default` and four roles in `administration`; shared/0060 seeds
-- the same administration set; shared/0088 seeds `system` in `default`.
-- apps/elitea-web/scripts/e2e-stack.sh uses the same shape. None of them
-- creates a `developer`-mode role or a `default`-mode `super_admin`.
--
-- THE COST, STATED PLAINLY. auth_core__role_permission carries no provenance.
-- An operator who granted this one string to the pylon default-mode `viewer`
-- through the admin Permissions page loses that grant here. The legacy matrix
-- withholds the string from that role, so the row is far more likely to be
-- 0083's than an operator's, and the admin console can restore it.
--
-- THE PROJECT-OVERRIDE HALF. shared/0089 delivers the central default-mode
-- grants to every project that carries its own permission rows. It runs before
-- this file, so on a pylon-managed database that holds any override row it has
-- already copied 0083's grant into that project. The second statement withdraws
-- those copies. It carries the same provenance cost as the first.
--
-- migrations/pylon_shape_blast_radius_postgres_integration_test.go is the gate.
-- It applies this corpus to a pylon-shaped auth_core and measures what a
-- default-mode viewer resolves.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0090: auth_core tables absent, nothing to correct';
    RETURN;
END IF;

IF NOT EXISTS (
    SELECT 1
    FROM public.auth_core__role
    WHERE mode = 'developer'
       OR (mode = 'default' AND name = 'super_admin')
) THEN
    RAISE NOTICE '0090: auth_core is Go-managed, the #402 viewer split stands';
    RETURN;
END IF;

-- The central row 0083 adds.
DELETE FROM public.auth_core__role_permission AS central_grant
USING public.auth_core__role AS central_role
WHERE central_grant.role_id = central_role.id
  AND central_role.mode = 'default'
  AND central_role.name = 'viewer'
  AND central_grant.permission = 'configuration.secrets.secret.list';

-- The per-project copies shared/0089 makes of that row.
IF to_regclass('public.auth_core__project_role') IS NOT NULL
   AND to_regclass('public.auth_core__project_role_permission') IS NOT NULL THEN
    DELETE FROM public.auth_core__project_role_permission AS project_grant
    USING public.auth_core__project_role AS project_role
    WHERE project_grant.role_id = project_role.id
      AND project_grant.project_id = project_role.project_id
      AND project_role.name = 'viewer'
      AND project_grant.permission = 'configuration.secrets.secret.list';
END IF;

END
$$;
