-- These unqualified names are intentional. The repository executes every
-- query inside a transaction whose local search_path is the authorized
-- p_<project_id> schema.

-- name: GetCurrentIndexToolkit :one
SELECT id, name, type, settings
FROM elitea_tools
WHERE id = sqlc.arg('toolkit_id')::integer
LIMIT 1;

-- name: GetCurrentIndexConfiguration :one
SELECT uuid::text AS configuration_uuid,
       project_id,
       type,
       data,
       shared,
       status_ok
FROM configuration
WHERE elitea_title = sqlc.arg('elitea_title')::text
LIMIT 1;

-- name: GetCurrentSharedIndexConfiguration :one
SELECT uuid::text AS configuration_uuid,
       project_id,
       type,
       data,
       shared,
       status_ok
FROM configuration
WHERE elitea_title = sqlc.arg('elitea_title')::text
  AND shared = true
LIMIT 1;

-- name: CurrentIndexEmbeddingModelExists :one
SELECT EXISTS (
    SELECT 1
    FROM configuration
    WHERE project_id = sqlc.arg('project_id')::integer
      AND status_ok = true
      AND section = 'embedding'
      AND data->>'name' = sqlc.arg('model_name')::text
);

-- name: SharedIndexEmbeddingModelExists :one
SELECT EXISTS (
    SELECT 1
    FROM configuration
    WHERE project_id = sqlc.arg('project_id')::integer
      AND shared = true
      AND status_ok = true
      AND section = 'embedding'
      AND data->>'name' = sqlc.arg('model_name')::text
);

-- name: GetCurrentIndexLLMModel :one
SELECT project_id,
       shared,
       COALESCE(data->>'name', '')::text AS model_name,
       COALESCE(data->>'supports_reasoning', 'false')::boolean AS supports_reasoning,
       COALESCE(data->>'openai_compatible', 'false')::boolean AS openai_compatible,
       COALESCE(data->>'max_output_tokens', '0')::integer AS max_output_tokens
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND status_ok = true
  AND section = 'llm'
  AND data->>'name' = sqlc.arg('model_name')::text
ORDER BY COALESCE(data->>'max_output_tokens', '0')::integer DESC, id
LIMIT 1;

-- name: GetSharedIndexLLMModel :one
SELECT project_id,
       shared,
       COALESCE(data->>'name', '')::text AS model_name,
       COALESCE(data->>'supports_reasoning', 'false')::boolean AS supports_reasoning,
       COALESCE(data->>'openai_compatible', 'false')::boolean AS openai_compatible,
       COALESCE(data->>'max_output_tokens', '0')::integer AS max_output_tokens
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND shared = true
  AND status_ok = true
  AND section = 'llm'
  AND data->>'name' = sqlc.arg('model_name')::text
ORDER BY COALESCE(data->>'max_output_tokens', '0')::integer DESC, id
LIMIT 1;
