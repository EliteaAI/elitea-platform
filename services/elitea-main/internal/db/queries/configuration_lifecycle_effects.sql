-- Configuration lifecycle internal effects. Unqualified tenant tables are
-- intentional: every such statement runs inside an authorized project
-- transaction whose local search_path is p_<project_id>.

-- name: SetCurrentConfigurationLifecycleStatus :execrows
UPDATE configuration
SET status_ok = sqlc.arg('status_ok')::boolean
WHERE project_id = sqlc.arg('project_id')::integer
  AND id = sqlc.arg('configuration_id')::integer
  AND uuid = sqlc.arg('configuration_uuid')::text::uuid;

-- name: ListCurrentConfigurationRenameToolkits :many
WITH candidate AS MATERIALIZED (
    SELECT id,
           octet_length(settings::text)::bigint AS settings_bytes
    FROM elitea_tools
    ORDER BY id
    LIMIT sqlc.arg('limit_rows')::integer
), bounded AS (
    SELECT id,
           settings_bytes,
           sum(settings_bytes) OVER (
               ORDER BY id
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
           )::bigint AS total_bytes
    FROM candidate
)
SELECT toolkit.id,
       md5(toolkit.settings::text) AS settings_version,
       CASE
           WHEN bounded.settings_bytes <= sqlc.arg('max_settings_bytes')::bigint
            AND bounded.total_bytes <= sqlc.arg('max_total_bytes')::bigint
           THEN toolkit.settings
           ELSE NULL::jsonb
       END AS settings,
       bounded.settings_bytes,
       bounded.total_bytes
FROM bounded
JOIN elitea_tools AS toolkit ON toolkit.id = bounded.id
ORDER BY toolkit.id;

-- name: GetCurrentConfigurationRenameToolkit :one
WITH candidate AS MATERIALIZED (
    SELECT id,
           md5(settings::text) AS settings_version,
           octet_length(settings::text)::bigint AS settings_bytes,
           settings
    FROM elitea_tools
    WHERE id = sqlc.arg('toolkit_id')::integer
    LIMIT 1
)
SELECT id,
       settings_version,
       CASE
           WHEN settings_bytes <= sqlc.arg('max_settings_bytes')::bigint
           THEN settings
           ELSE NULL::jsonb
       END AS settings,
       settings_bytes
FROM candidate;

-- name: CompareAndSwapCurrentConfigurationRenameToolkit :execrows
UPDATE elitea_tools
SET settings = sqlc.arg('settings')::jsonb
WHERE id = sqlc.arg('toolkit_id')::integer
  AND md5(settings::text) = sqlc.arg('expected_version')::text;

-- name: ListActiveCurrentProjectIDs :many
SELECT id
FROM centry.project AS project
WHERE project.create_success IS TRUE
  AND project.suspended IS FALSE
ORDER BY id
LIMIT sqlc.arg('limit_rows')::integer;

-- name: ReplaceCurrentDeletedLLMApplicationReferences :one
WITH matched AS MATERIALIZED (
    SELECT id
    FROM application_versions
    WHERE llm_settings ->> 'model_name' = sqlc.arg('deleted_model_name')::text
    ORDER BY id
    LIMIT sqlc.arg('scan_limit')::integer
    FOR UPDATE
), within_limit AS MATERIALIZED (
    SELECT id
    FROM matched
    WHERE (SELECT count(*) FROM matched) <= sqlc.arg('max_rows')::integer
), updated AS (
    UPDATE application_versions AS version
    SET llm_settings = (
        version.llm_settings::jsonb || jsonb_build_object(
            'model_name', sqlc.arg('default_model_name')::text,
            'model_project_id', sqlc.arg('default_model_project_id')::integer
        )
    )::json
    FROM within_limit
    WHERE version.id = within_limit.id
    RETURNING version.id
)
SELECT (SELECT count(*) FROM matched)::bigint AS matched_count,
       (SELECT count(*) FROM updated)::bigint AS updated_count;
