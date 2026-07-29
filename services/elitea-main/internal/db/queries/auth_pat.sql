-- name: ListOwnedPATs :many
SELECT
    token.id,
    token.uuid,
    token.expires,
    COALESCE(token.user_id, 0)::integer AS user_id,
    token.name
FROM public.auth_core__token AS token
WHERE token.user_id = sqlc.arg(user_id)::integer
ORDER BY token.id;

-- name: GetOwnedPAT :one
SELECT
    token.id,
    token.uuid,
    token.expires,
    COALESCE(token.user_id, 0)::integer AS user_id,
    token.name
FROM public.auth_core__token AS token
WHERE token.uuid = sqlc.arg(uuid)::text
  AND token.user_id = sqlc.arg(user_id)::integer;

-- name: CreatePATForActiveUser :one
INSERT INTO public.auth_core__token (uuid, expires, user_id, name)
SELECT
    sqlc.arg(uuid)::varchar(36),
    sqlc.narg(expires)::timestamp without time zone,
    owner.id,
    sqlc.narg(name)::text
FROM public.auth_core__user AS owner
WHERE owner.id = sqlc.arg(user_id)::integer
  AND owner.suspended = false
RETURNING
    id,
    uuid,
    expires,
    COALESCE(user_id, 0)::integer AS user_id,
    name;

-- name: LockPATByUUID :one
SELECT
    token.id,
    COALESCE(token.user_id, 0)::integer AS user_id
FROM public.auth_core__token AS token
WHERE token.uuid = sqlc.arg(uuid)::text
FOR UPDATE;

-- name: DeletePATByID :execrows
DELETE FROM public.auth_core__token
WHERE id = sqlc.arg(id)::integer;

-- name: GetActivePATPrincipalByUUID :one
SELECT
    token.id AS token_id,
    owner.id AS user_id,
    COALESCE(owner.email, '')::text AS email
FROM public.auth_core__token AS token
JOIN public.auth_core__user AS owner ON owner.id = token.user_id
WHERE token.uuid = sqlc.arg(uuid)::text
  AND owner.suspended = false
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'));

-- name: GetActivePATForUser :one
SELECT
    token.id AS token_id,
    token.uuid,
    token.expires,
    owner.id AS user_id,
    COALESCE(owner.email, '')::text AS email
FROM public.auth_core__token AS token
JOIN public.auth_core__user AS owner ON owner.id = token.user_id
WHERE owner.id = sqlc.arg(user_id)::integer
  AND owner.suspended = false
  AND token.uuid IS NOT NULL
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'))
ORDER BY token.id
LIMIT 1;

-- name: GetActiveProjectSystemPAT :one
SELECT
    project.id AS project_id,
    owner.id AS user_id,
    token.id AS token_id,
    token.uuid,
    token.expires,
    COALESCE(owner.email, '')::text AS email
FROM centry.project AS project
JOIN public.auth_core__user AS owner
  ON owner.email = ('system_user_' || project.id::text || '@centry.user')
JOIN public.auth_core__project_user_role AS assignment
  ON assignment.project_id = project.id
 AND assignment.user_id = owner.id
JOIN public.auth_core__project_role AS project_role
  ON project_role.id = assignment.role_id
 AND project_role.project_id = project.id
JOIN public.auth_core__token AS token
  ON token.user_id = owner.id
WHERE project.id = sqlc.arg(project_id)::integer
  AND project.create_success = true
  AND project.suspended = false
  AND owner.suspended = false
  AND token.name = 'api'
  AND token.uuid IS NOT NULL
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'))
ORDER BY token.id
LIMIT 1;
