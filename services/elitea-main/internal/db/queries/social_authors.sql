-- name: ListCurrentProjectAuthors :many
SELECT DISTINCT
    user_account.id,
    user_account.email,
    user_account.name,
    user_account.last_login,
    user_account.suspended,
    social_user.avatar
FROM public.auth_core__project_user_role AS assignment
JOIN public.auth_core__user AS user_account
    ON user_account.id = assignment.user_id
LEFT JOIN centry.social_users AS social_user
    ON social_user.user_id = user_account.id
WHERE assignment.project_id = sqlc.arg('project_id')::integer
  AND user_account.email IS DISTINCT FROM
      ('system_user_' || sqlc.arg('project_id')::integer::text || '@centry.user')
ORDER BY user_account.id;
