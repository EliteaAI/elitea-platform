-- The unqualified table name is intentional. This query runs only inside an
-- authorized project transaction whose local search_path is p_<project_id>.
--
-- The two predicates are independent to preserve the current endpoint:
-- requesting MCP rows does not implicitly include application rows, and
-- requesting application rows does not implicitly include MCP rows.

-- name: ListCurrentToolkitTypes :many
SELECT DISTINCT type
FROM elitea_tools
WHERE (
        (
          sqlc.arg('filter_mcp')::boolean
          AND (
            COALESCE((meta ->> 'mcp')::boolean, false)
            OR type = 'mcp'
          )
        )
        OR (
          NOT sqlc.arg('filter_mcp')::boolean
          AND NOT COALESCE((meta ->> 'mcp')::boolean, false)
          AND type <> 'mcp'
        )
      )
  AND (
        (
          sqlc.arg('filter_application')::boolean
          AND (
            COALESCE((meta ->> 'application')::boolean, false)
            OR type = 'application'
          )
        )
        OR (
          NOT sqlc.arg('filter_application')::boolean
          AND NOT COALESCE((meta ->> 'application')::boolean, false)
          AND type <> 'application'
        )
      )
ORDER BY type ASC;
