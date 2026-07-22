-- name: ListCurrentUserProjects :many
WITH candidate_projects AS MATERIALIZED (
    SELECT
        project.id,
        project.name,
        project.owner_id,
        project.plugins,
        project.keycloak_groups,
        project.create_success,
        project.suspended
    FROM centry.project AS project
    WHERE (
        sqlc.narg('search')::text IS NULL
        OR project.name ILIKE ('%' || sqlc.narg('search')::text || '%')
    )
    ORDER BY project.id
    LIMIT sqlc.narg('limit')::integer
    OFFSET sqlc.narg('offset')::integer
), member_projects AS MATERIALIZED (
    SELECT DISTINCT assignment.project_id
    FROM public.auth_core__project_user_role AS assignment
    WHERE assignment.user_id = sqlc.arg('user_id')::integer
)
SELECT
    project.id,
    project.name,
    project.owner_id,
    project.plugins,
    project.keycloak_groups,
    project.create_success,
    project.suspended,
    project_group.id AS group_id,
    project_group.name AS group_name
FROM candidate_projects AS project
JOIN member_projects AS membership ON membership.project_id = project.id
LEFT JOIN centry.project_group_association AS association
    ON association.project_id = project.id
LEFT JOIN centry.project_group AS project_group
    ON project_group.id = association.group_id
WHERE (
    NOT sqlc.arg('check_public_role')::boolean
    OR project.id <> sqlc.arg('public_project_id')::integer
    OR EXISTS (
        SELECT 1
        FROM public.auth_core__project_user_role AS assignment
        JOIN public.auth_core__project_role AS project_role
            ON project_role.id = assignment.role_id
            AND project_role.project_id = assignment.project_id
        WHERE assignment.project_id = project.id
          AND assignment.user_id = sqlc.arg('user_id')::integer
          AND project_role.name = 'admin'
    )
)
ORDER BY project.id, project_group.id;
