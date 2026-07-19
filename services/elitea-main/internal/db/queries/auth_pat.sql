-- name: ListOwnedPATs :many
SELECT
    token.id,
    COALESCE(token.uuid, '')::text AS uuid,
    token.expires,
    COALESCE(token.user_id, 0)::integer AS user_id,
    COALESCE(token.name, '')::text AS name
FROM public.auth_core__token AS token
WHERE token.user_id = sqlc.arg(user_id)::integer
ORDER BY token.id;

-- name: GetOwnedPAT :one
SELECT
    token.id,
    COALESCE(token.uuid, '')::text AS uuid,
    token.expires,
    COALESCE(token.user_id, 0)::integer AS user_id,
    COALESCE(token.name, '')::text AS name
FROM public.auth_core__token AS token
WHERE token.uuid = sqlc.arg(uuid)::text
  AND token.user_id = sqlc.arg(user_id)::integer;

-- name: CreatePATForActiveUser :one
INSERT INTO public.auth_core__token (uuid, expires, user_id, name)
SELECT
    sqlc.arg(uuid)::varchar(36),
    sqlc.narg(expires)::timestamp without time zone,
    owner.id,
    sqlc.arg(name)::text
FROM public.auth_core__user AS owner
WHERE owner.id = sqlc.arg(user_id)::integer
  AND owner.suspended = false
RETURNING
    id,
    COALESCE(uuid, '')::text AS uuid,
    expires,
    COALESCE(user_id, 0)::integer AS user_id,
    COALESCE(name, '')::text AS name;

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
