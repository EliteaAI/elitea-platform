-- 0100_skill_icon_permissions.sql — the DEFAULT-mode grants for the skill icon
-- route family (GET/POST/PUT/DELETE
-- /api/v2/elitea_core/upload_skill_icon/prompt_lib/{projectID}).
--
-- WHY A NEW FILE. Migrations here are checksum-immutable: 0068 already ran on
-- every deployment, so the four strings below cannot be appended to it. They
-- are also not optional. The routes are gated on these permissions, and 0063's
-- header states the consequence of gating a route on a permission nothing
-- grants: "403-for-everyone, which reads as a broken page rather than as a
-- missing grant". Without this file the skill icon picker would open and every
-- request inside it would refuse.
--
-- WHERE THE SPLIT COMES FROM. testdata/postgres/legacy-rbac-matrix.json, the
-- `mode = 'default'` rows: `admin` and `editor` carry all four
-- `models.applications.skills.upload_icon.*` strings and `viewer` carries none
-- — the same shape 0068 records for the AGENT icon family
-- (`models.applications.upload_icon.*`), where the header already notes that a
-- viewer cannot even LIST uploaded icons. The names themselves come from
-- testdata/legacy/legacy-rbac-static-catalog.json's `check_api` declarations
-- for elitea_core/api/v2/upload_skill_icon.py, and
-- internal/api/router_elitea_core_permission_map_test.go re-checks both
-- directions, so a gate this file does not grant fails the build.
--
-- BLAST RADIUS. Identical to 0068's, for the same reason: legacyrbac's
-- projectPermissions() falls back to the CENTRAL default-mode grants by role
-- name only for a project carrying NO per-project role_permission rows, which
-- is the fresh-Go-database shape alone. A pylon-backed database, a legacy dump
-- and the E2E stack all seed per-project rows and suppress the fallback, so no
-- existing deployment's members gain anything here. A non-member has no
-- assigned role to fall back from and gains nothing at all.
--
-- Idempotent and additive: it grants to roles that already exist, never creates
-- one, and conflicts are ignored. `system` and `super_admin` are omitted, as
-- everywhere else in this corpus. 0060's VIRGIN-mode guard is not reproduced,
-- for the reason 0061/0062/0063/0066/0068 all give — these permissions have
-- never existed on a Go deployment, so no operator can have revoked them.
DO $$
BEGIN

IF to_regclass('public.auth_core__role') IS NULL
   OR to_regclass('public.auth_core__role_permission') IS NULL THEN
    RAISE NOTICE '0100: auth_core tables absent, nothing to grant';
    RETURN;
END IF;

INSERT INTO public.auth_core__role_permission (role_id, permission)
SELECT role.id, grant_row.permission
FROM public.auth_core__role AS role
CROSS JOIN (VALUES
    ('models.applications.skills.upload_icon.get'),
    ('models.applications.skills.upload_icon.post'),
    ('models.applications.skills.upload_icon.update'),
    ('models.applications.skills.upload_icon.delete')
) AS grant_row(permission)
WHERE role.mode = 'default' AND role.name IN ('admin', 'editor')
ON CONFLICT (role_id, permission) DO NOTHING;

END
$$;
