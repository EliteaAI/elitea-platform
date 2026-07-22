-- These unqualified names are intentional. Every query is executed inside a
-- transaction whose local search_path is derived from the authorized project.
-- This file projects the existing 16-column tenant table; it does not define a
-- replacement configuration store.

-- name: GetCurrentConfiguration :one
SELECT id,
       uuid::text AS configuration_uuid,
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
       author_id,
       created_at,
       updated_at
FROM configuration
WHERE id = sqlc.arg('configuration_id')::integer
  AND project_id = sqlc.arg('project_id')::integer
LIMIT 1;

-- name: CountCurrentConfigurations :one
SELECT count(*)
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND (COALESCE(cardinality(sqlc.arg('types')::text[]), 0) = 0 OR type = ANY(sqlc.arg('types')::text[]))
  AND (COALESCE(cardinality(sqlc.arg('sections')::text[]), 0) = 0 OR section = ANY(sqlc.arg('sections')::text[]))
  AND (sqlc.arg('label_query')::text = '' OR label ILIKE ('%' || sqlc.arg('label_query')::text || '%'));

-- name: ListCurrentConfigurations :many
SELECT id,
       uuid::text AS configuration_uuid,
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
       author_id,
       created_at,
       updated_at
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND (COALESCE(cardinality(sqlc.arg('types')::text[]), 0) = 0 OR type = ANY(sqlc.arg('types')::text[]))
  AND (COALESCE(cardinality(sqlc.arg('sections')::text[]), 0) = 0 OR section = ANY(sqlc.arg('sections')::text[]))
  AND (sqlc.arg('label_query')::text = '' OR label ILIKE ('%' || sqlc.arg('label_query')::text || '%'))
ORDER BY
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'id'            THEN id END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'id'            THEN id END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'uuid'          THEN uuid END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'uuid'          THEN uuid END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'project_id'    THEN project_id END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'project_id'    THEN project_id END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'label'         THEN label END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'label'         THEN label END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'elitea_title'  THEN elitea_title END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'elitea_title'  THEN elitea_title END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'type'          THEN type END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'type'          THEN type END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'section'       THEN section END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'section'       THEN section END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'data'          THEN data END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'data'          THEN data END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'meta'          THEN meta END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'meta'          THEN meta END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'shared'        THEN shared END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'shared'        THEN shared END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'status_ok'     THEN status_ok END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'status_ok'     THEN status_ok END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'status_logs'   THEN status_logs END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'status_logs'   THEN status_logs END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'source'        THEN source END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'source'        THEN source END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'author_id'     THEN author_id END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'author_id'     THEN author_id END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'created_at'    THEN created_at END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'created_at'    THEN created_at END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'updated_at'    THEN updated_at END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'updated_at'    THEN updated_at END DESC NULLS LAST,
  id ASC
LIMIT sqlc.arg('limit_rows')::integer
OFFSET sqlc.arg('offset_rows')::integer;

-- name: CountCurrentSharedConfigurations :one
SELECT count(*)
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND shared = true
  AND (COALESCE(cardinality(sqlc.arg('types')::text[]), 0) = 0 OR type = ANY(sqlc.arg('types')::text[]))
  AND (COALESCE(cardinality(sqlc.arg('sections')::text[]), 0) = 0 OR section = ANY(sqlc.arg('sections')::text[]));

-- name: ListCurrentSharedConfigurations :many
SELECT id,
       uuid::text AS configuration_uuid,
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
       author_id,
       created_at,
       updated_at
FROM configuration
WHERE project_id = sqlc.arg('project_id')::integer
  AND shared = true
  AND (COALESCE(cardinality(sqlc.arg('types')::text[]), 0) = 0 OR type = ANY(sqlc.arg('types')::text[]))
  AND (COALESCE(cardinality(sqlc.arg('sections')::text[]), 0) = 0 OR section = ANY(sqlc.arg('sections')::text[]))
ORDER BY
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'id'            THEN id END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'id'            THEN id END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'uuid'          THEN uuid END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'uuid'          THEN uuid END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'project_id'    THEN project_id END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'project_id'    THEN project_id END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'label'         THEN label END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'label'         THEN label END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'elitea_title'  THEN elitea_title END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'elitea_title'  THEN elitea_title END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'type'          THEN type END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'type'          THEN type END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'section'       THEN section END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'section'       THEN section END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'data'          THEN data END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'data'          THEN data END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'meta'          THEN meta END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'meta'          THEN meta END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'shared'        THEN shared END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'shared'        THEN shared END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'status_ok'     THEN status_ok END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'status_ok'     THEN status_ok END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'status_logs'   THEN status_logs END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'status_logs'   THEN status_logs END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'source'        THEN source END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'source'        THEN source END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'author_id'     THEN author_id END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'author_id'     THEN author_id END DESC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'created_at'    THEN created_at END ASC,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'created_at'    THEN created_at END DESC,
  CASE WHEN sqlc.arg('sort_order')::text = 'asc'  AND sqlc.arg('sort_by')::text = 'updated_at'    THEN updated_at END ASC NULLS LAST,
  CASE WHEN sqlc.arg('sort_order')::text = 'desc' AND sqlc.arg('sort_by')::text = 'updated_at'    THEN updated_at END DESC NULLS LAST,
  id ASC
LIMIT sqlc.arg('limit_rows')::integer
OFFSET sqlc.arg('offset_rows')::integer;

-- name: InsertCurrentConfiguration :one
INSERT INTO configuration (
    uuid, project_id, label, elitea_title, type, section, data, meta, shared,
    status_ok, status_logs, source, author_id
) VALUES (
    sqlc.arg('configuration_uuid')::text::uuid,
    sqlc.arg('project_id')::integer,
    sqlc.narg('label')::text,
    sqlc.arg('elitea_title')::text,
    sqlc.arg('configuration_type')::text,
    sqlc.arg('section')::text,
    sqlc.arg('data')::jsonb,
    sqlc.arg('meta')::jsonb,
    sqlc.arg('shared')::boolean,
    sqlc.arg('status_ok')::boolean,
    sqlc.narg('status_logs')::text,
    sqlc.arg('source')::text,
    sqlc.narg('author_id')::integer
)
RETURNING id,
          uuid::text AS configuration_uuid,
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
          author_id,
          created_at,
          updated_at;

-- name: ReplaceCurrentConfiguration :one
UPDATE configuration
SET label = sqlc.narg('label')::text,
    elitea_title = sqlc.arg('elitea_title')::text,
    data = sqlc.arg('data')::jsonb,
    meta = sqlc.arg('meta')::jsonb,
    shared = sqlc.arg('shared')::boolean,
    status_ok = sqlc.arg('status_ok')::boolean,
    status_logs = sqlc.narg('status_logs')::text,
    updated_at = now()
WHERE id = sqlc.arg('configuration_id')::integer
  AND project_id = sqlc.arg('project_id')::integer
RETURNING id,
          uuid::text AS configuration_uuid,
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
          author_id,
          created_at,
          updated_at;

-- name: DeleteCurrentConfiguration :one
DELETE FROM configuration
WHERE id = sqlc.arg('configuration_id')::integer
  AND project_id = sqlc.arg('project_id')::integer
RETURNING id;
