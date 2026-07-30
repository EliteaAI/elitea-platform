-- The unqualified toolkit table is intentional. These queries execute only
-- inside an authorized project transaction whose local search_path is the
-- exact p_<project_id> tenant schema.

-- name: LockCurrentIndexScheduleToolkitMeta :one
SELECT meta
FROM elitea_tools
WHERE id = sqlc.arg('toolkit_id')::integer
FOR UPDATE;

-- name: UpdateCurrentIndexScheduleToolkitMeta :execrows
UPDATE elitea_tools
SET meta = sqlc.arg('meta')::jsonb,
    updated_at = clock_timestamp()
WHERE id = sqlc.arg('toolkit_id')::integer;

-- name: InsertCurrentIndexScheduleNotification :execrows
INSERT INTO centry.notifications (
    uuid,
    is_seen,
    project_id,
    user_id,
    meta,
    event_type
) VALUES (
    sqlc.arg('notification_uuid')::text::uuid,
    FALSE,
    sqlc.arg('project_id')::integer,
    sqlc.arg('user_id')::integer,
    sqlc.arg('meta')::jsonb,
    'index_data_changed'
)
ON CONFLICT (uuid) DO NOTHING;
