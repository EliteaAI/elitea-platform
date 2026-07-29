-- Deterministic, sanitized legacy RBAC evidence.
--
-- This export intentionally contains permission strings, role names/modes and
-- aggregate assignment counts only. It never exports user identifiers,
-- emails, session/token data, public-rule targets or secret-bearing rows.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;

WITH global_roles AS (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'mode', role.mode,
                'name', role.name,
                'permissions', COALESCE((
                    SELECT jsonb_agg(role_grant.permission ORDER BY role_grant.permission)
                    FROM public.auth_core__role_permission AS role_grant
                    WHERE role_grant.role_id = role.id
                ), '[]'::jsonb),
                'assigned_users', (
                    SELECT count(*)
                    FROM public.auth_core__user_role AS assignment
                    WHERE assignment.role_id = role.id
                )
            )
            ORDER BY role.mode, role.name
        ),
        '[]'::jsonb
    ) AS document
    FROM public.auth_core__role AS role
), project_roles AS (
    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'project_id', role.project_id,
                'name', role.name,
                'permissions', COALESCE((
                    SELECT jsonb_agg(role_grant.permission ORDER BY role_grant.permission)
                    FROM public.auth_core__project_role_permission AS role_grant
                    WHERE role_grant.project_id = role.project_id
                      AND role_grant.role_id = role.id
                ), '[]'::jsonb),
                'assigned_users', (
                    SELECT count(*)
                    FROM public.auth_core__project_user_role AS assignment
                    WHERE assignment.project_id = role.project_id
                      AND assignment.role_id = role.id
                )
            )
            ORDER BY role.project_id, role.name
        ),
        '[]'::jsonb
    ) AS document
    FROM public.auth_core__project_role AS role
), global_permission_catalog AS (
    SELECT COALESCE(
        jsonb_agg(permission ORDER BY permission),
        '[]'::jsonb
    ) AS document
    FROM (
        SELECT DISTINCT permission
        FROM public.auth_core__role_permission
        WHERE permission IS NOT NULL
    ) AS permission_set
), summary AS (
    SELECT jsonb_build_object(
        'global_roles', (SELECT count(*) FROM public.auth_core__role),
        'global_role_permission_rows', (SELECT count(*) FROM public.auth_core__role_permission),
        'distinct_global_permissions', (
            SELECT count(DISTINCT permission)
            FROM public.auth_core__role_permission
            WHERE permission IS NOT NULL
        ),
        'global_user_role_assignments', (SELECT count(*) FROM public.auth_core__user_role),
        'project_roles', (SELECT count(*) FROM public.auth_core__project_role),
        'project_role_permission_rows', (SELECT count(*) FROM public.auth_core__project_role_permission),
        'project_user_role_assignments', (SELECT count(*) FROM public.auth_core__project_user_role)
    ) AS document
)
SELECT jsonb_pretty(jsonb_build_object(
    'schema_version', 1,
    'source', jsonb_build_object(
        'database', current_database(),
        'schema', 'public',
        'postgresql_server_version_num', current_setting('server_version_num'),
        'database_timezone', current_setting('TimeZone'),
        'auth_migration_heads', COALESCE((
            SELECT jsonb_agg(version_num ORDER BY version_num)
            FROM public.db_version__auth_core
        ), '[]'::jsonb)
    ),
    'summary', summary.document,
    'global_permission_catalog', global_permission_catalog.document,
    'global_roles', global_roles.document,
    'project_roles', project_roles.document,
    'excluded', jsonb_build_array(
        'user identifiers and profile data',
        'session and token rows',
        'public-rule patterns and targets',
        'group membership and identity-provider data',
        'secret-bearing application rows'
    )
))
FROM global_roles, project_roles, global_permission_catalog, summary;

COMMIT;
