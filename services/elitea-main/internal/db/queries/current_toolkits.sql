-- The unqualified table name is intentional. This query runs only inside an
-- authorized project transaction whose local search_path is p_<project_id>.

-- name: GetCurrentToolkit :one
SELECT id,
       created_at,
       updated_at,
       type,
       name,
       description,
       settings,
       author_id,
       shared_owner_id,
       shared_id,
       meta
FROM elitea_tools
WHERE id = sqlc.arg('toolkit_id')::integer
LIMIT 1;
