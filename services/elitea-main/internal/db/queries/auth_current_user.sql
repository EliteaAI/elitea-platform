-- name: GetCurrentActiveAuthUser :one
SELECT id, email, name, last_login, suspended
FROM public.auth_core__user
WHERE id = sqlc.arg(user_id)::integer
  AND suspended = false;
