-- name: GetActivePATPrincipalByID :one
SELECT
    token.id AS token_id,
    owner.id AS user_id,
    COALESCE(owner.email, '')::text AS email
FROM public.auth_core__token AS token
JOIN public.auth_core__user AS owner ON owner.id = token.user_id
WHERE token.id = sqlc.arg(token_id)::integer
  AND owner.suspended = false
  AND (token.expires IS NULL OR token.expires > (clock_timestamp() AT TIME ZONE 'UTC'));

-- name: GetActiveUserPrincipalByID :one
SELECT
    owner.id AS user_id,
    COALESCE(owner.email, '')::text AS email
FROM public.auth_core__user AS owner
WHERE owner.id = sqlc.arg(user_id)::integer
  AND owner.suspended = false;
