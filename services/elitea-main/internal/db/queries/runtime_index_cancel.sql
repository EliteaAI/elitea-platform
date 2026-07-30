-- name: RequestCurrentIndexIngestCancellation :one
WITH transitioned AS MATERIALIZED (
    UPDATE elitea_runtime.execution_jobs AS job
    SET desired_state = 'CANCELLED'
    FROM elitea_runtime.index_ingest_jobs AS ingest
    WHERE job.execution_id = sqlc.arg(execution_id)::text
      -- The current distributed-monolith tenant canonical identity is the
      -- project ID. Bind cancellation to the same tenant as its authenticated
      -- project route rather than treating a project ID as tenant authority.
      AND job.tenant_id = (sqlc.arg(resource_project_id)::integer)::text
      AND job.resource_project_id = sqlc.arg(resource_project_id)::integer
      AND job.projection_project_id = sqlc.arg(resource_project_id)::integer
      AND job.capability_id = 'index.ingest.v1'
      AND job.desired_state = 'RUNNING'
      AND job.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING')
      AND ingest.execution_id = job.execution_id
      AND ingest.generation = job.generation
      AND ingest.capability_id = job.capability_id
      AND ingest.toolkit_id = sqlc.arg(toolkit_id)::integer
      AND ingest.index_name = sqlc.arg(index_name)::text
    RETURNING job.execution_id,
              job.generation
),
cleanup_intent AS (
    UPDATE elitea_runtime.index_ingest_jobs AS ingest
    SET index_manual_stop_requested_at = clock_timestamp(),
        index_manual_cleanup_status = 'PENDING',
        index_manual_cleanup_attempt_count = 0,
        index_manual_cleanup_next_attempt_at = clock_timestamp(),
        index_manual_cleanup_last_error_code = NULL
    FROM transitioned
    WHERE ingest.execution_id = transitioned.execution_id
      AND ingest.generation = transitioned.generation
      AND ingest.capability_id = 'index.ingest.v1'
      AND ingest.index_meta_initialized_at IS NOT NULL
      AND ingest.index_manual_cleanup_status IS NULL
    RETURNING ingest.execution_id
)
SELECT EXISTS (SELECT 1 FROM transitioned) AS transitioned;
