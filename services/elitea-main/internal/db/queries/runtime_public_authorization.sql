-- name: AuthorizeRuntimeValidationProject :one
SELECT EXISTS (
    SELECT 1
    FROM centry.project AS project
    WHERE project.id = sqlc.arg(project_id)::integer
      AND project.suspended = FALSE
      AND (
          project.owner_id = sqlc.arg(user_id)::integer
          OR EXISTS (
              SELECT 1
              FROM public.auth_core__project_user_role AS assignment
              WHERE assignment.project_id = project.id
                AND assignment.user_id = sqlc.arg(user_id)::integer
          )
      )
) AS authorized;

-- name: ResolveRuntimeExecutionEventCapability :one
SELECT COALESCE(
    CASE WHEN COUNT(*) = 1 THEN MIN(job.capability_id) END,
    ''::text
)::text AS capability_id
FROM elitea_runtime.execution_jobs AS job
JOIN centry.project AS project
  ON project.id = job.projection_project_id
WHERE job.execution_id = sqlc.arg(execution_id)::text
  AND job.tenant_id = (sqlc.arg(project_id)::integer)::text
  AND job.resource_project_id = sqlc.arg(project_id)::integer
  AND job.projection_project_id = sqlc.arg(project_id)::integer
  AND job.capability_id IN (
      'configuration.validate.v1',
      'index.ingest.v1',
      'agent.execute.application.v1'
  )
  AND project.suspended = FALSE;
