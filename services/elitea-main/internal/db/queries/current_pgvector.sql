-- The project transaction establishes the authorized p_<project_id>
-- search_path before this statement runs. The public PgVector bootstrap
-- configuration is never copied into this tenant row: only the current vault
-- reference is stored.

-- name: UpsertCurrentProjectPgvectorConfiguration :one
INSERT INTO configuration (
    uuid,
    project_id,
    label,
    elitea_title,
    type,
    section,
    data,
    meta,
    shared,
    status_ok,
    status_logs,
    source,
    author_id
) VALUES (
    sqlc.arg('configuration_uuid')::text::uuid,
    sqlc.arg('project_id')::integer,
    sqlc.narg('label')::text,
    sqlc.arg('elitea_title')::text,
    'pgvector',
    'vectorstorage',
    jsonb_build_object(
        'connection_string',
        '{{secret.pgvector_project_connstr}}'::text
    ),
    '{}'::jsonb,
    false,
    true,
    NULL,
    'system',
    NULL
)
ON CONFLICT (elitea_title) DO UPDATE
SET data = EXCLUDED.data,
    updated_at = now()
WHERE configuration.project_id = EXCLUDED.project_id
  AND configuration.type = EXCLUDED.type
  AND configuration.section = EXCLUDED.section
  AND configuration.source = EXCLUDED.source
RETURNING id;
