-- name: CurrentNotificationHighWater :one
SELECT COALESCE(MAX(id), 0)::bigint AS cursor
FROM centry.notifications
WHERE user_id = sqlc.arg(user_id);

-- name: ListCurrentNotificationEventsAfter :many
SELECT id,
       uuid::text AS uuid,
       is_seen,
       project_id,
       user_id,
       meta,
       event_type,
       created_at,
       updated_at
FROM centry.notifications
WHERE user_id = sqlc.arg(user_id)
  AND id > sqlc.arg(after_cursor)
ORDER BY id
LIMIT sqlc.arg(page_limit);
