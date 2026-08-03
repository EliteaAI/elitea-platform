-- name: ResolveCurrentTenantContext :one
SELECT EXISTS (
           SELECT 1
           FROM centry.project
           WHERE id = sqlc.arg(project_id)::bigint
       ) AS project_exists,
       EXISTS (
           SELECT 1
           FROM pg_catalog.pg_namespace
           WHERE nspname = sqlc.arg(schema_name)::text
       ) AS schema_exists;

-- name: InstallCurrentTenantSearchPath :one
SELECT set_config('search_path', sqlc.arg(search_path)::text, TRUE);

-- name: GetCurrentTenantSchema :one
SELECT current_schema()::text;
