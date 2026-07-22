-- name: GetRuntimeAdmissionByIdempotency :one
SELECT j.execution_id,
       j.command_id,
       j.request_digest,
       j.admitted_at,
       o.deadline
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
WHERE j.idempotency_scope = sqlc.arg(idempotency_scope)::text
  AND j.idempotency_key = sqlc.arg(idempotency_key)::text;

-- name: EnsureRuntimeAdmissionPolicy :exec
INSERT INTO elitea_runtime.execution_admission_policies (
    capability_id, max_outstanding
) VALUES (
    sqlc.arg(capability_id)::text,
    sqlc.arg(max_outstanding)::bigint
)
ON CONFLICT (capability_id) DO NOTHING;

-- name: LockRuntimeAdmissionPolicy :one
SELECT max_outstanding
FROM elitea_runtime.execution_admission_policies
WHERE capability_id = sqlc.arg(capability_id)::text
FOR UPDATE;

-- name: CountActiveRuntimeExecutionsUpTo :one
SELECT count(*)
FROM (
    SELECT 1
    FROM elitea_runtime.execution_jobs
    WHERE capability_id = sqlc.arg(capability_id)::text
      AND state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING')
    LIMIT sqlc.arg(max_outstanding)::bigint
) AS bounded_active;

-- name: LoadRuntimeAdmissionTiming :one
WITH authority AS MATERIALIZED (
    SELECT date_trunc('milliseconds', clock_timestamp()) AS admitted_at
)
SELECT admitted_at::timestamptz AS admitted_at,
       (admitted_at + (sqlc.arg(deadline_ttl_millis)::bigint * interval '1 millisecond'))::timestamptz AS deadline
FROM authority;

-- name: InsertRuntimeInputBundle :exec
INSERT INTO elitea_runtime.input_bundles (
    input_bundle_id, immutable_version, media_type, resource_project_id,
    manifest_digest, manifest_size, manifest_bytes, created_by, created_at
) VALUES (
    sqlc.arg(input_bundle_id)::text,
    sqlc.arg(immutable_version)::text,
    sqlc.arg(media_type)::text,
    sqlc.arg(resource_project_id)::integer,
    sqlc.arg(manifest_digest)::bytea,
    sqlc.arg(manifest_size)::bigint,
    sqlc.arg(manifest_bytes)::bytea,
    sqlc.arg(created_by)::text,
    sqlc.arg(created_at)::timestamptz
);

-- name: InsertRuntimeInputBundleEntry :exec
INSERT INTO elitea_runtime.input_bundle_entries (
    input_bundle_id, entry_id, entry_version, semantic_role, media_type,
    content_digest, content_size, content_reference, classification,
    required_grant_audience, content_bytes
) VALUES (
    sqlc.arg(input_bundle_id)::text,
    sqlc.arg(entry_id)::text,
    sqlc.arg(entry_version)::text,
    sqlc.arg(semantic_role)::text,
    sqlc.arg(media_type)::text,
    sqlc.arg(content_digest)::bytea,
    sqlc.arg(content_size)::bigint,
    sqlc.arg(content_reference)::text,
    sqlc.arg(classification)::text,
    sqlc.arg(required_grant_audience)::text,
    sqlc.arg(content_bytes)::bytea
);

-- name: InsertIndexIngestExecutionJob :one
INSERT INTO elitea_runtime.execution_jobs (
    execution_id, generation, command_id, tenant_id, resource_project_id,
    projection_project_id, actor_id, principal_ref, capability_id,
    capability_version, input_bundle_id, request_digest,
    idempotency_scope, idempotency_key, state, desired_state, admitted_at
) VALUES (
    sqlc.arg(execution_id)::text,
    sqlc.arg(generation)::bigint,
    sqlc.arg(command_id)::text,
    sqlc.arg(tenant_id)::text,
    sqlc.arg(resource_project_id)::integer,
    sqlc.arg(projection_project_id)::integer,
    sqlc.arg(actor_id)::text,
    sqlc.arg(principal_ref)::text,
    'index.ingest.v1',
    sqlc.arg(capability_version)::text,
    sqlc.arg(input_bundle_id)::text,
    sqlc.arg(request_digest)::bytea,
    sqlc.arg(idempotency_scope)::text,
    sqlc.arg(idempotency_key)::text,
    sqlc.arg(state)::text,
    'RUNNING',
    sqlc.arg(admitted_at)::timestamptz
)
ON CONFLICT (idempotency_scope, idempotency_key) DO NOTHING
RETURNING execution_id;

-- name: InsertIndexIngestJob :exec
INSERT INTO elitea_runtime.index_ingest_jobs (
    execution_id, generation, capability_id, input_bundle_id,
    toolkit_configuration_entry_id, tool_parameters_entry_id,
    llm_model_entry_id, llm_configuration_entry_id, mcp_tokens_entry_id,
    toolkit_id, index_name, initiator
) VALUES (
    sqlc.arg(execution_id)::text,
    sqlc.arg(generation)::bigint,
    'index.ingest.v1',
    sqlc.arg(input_bundle_id)::text,
    sqlc.arg(toolkit_configuration_entry_id)::text,
    sqlc.arg(tool_parameters_entry_id)::text,
    sqlc.narg(llm_model_entry_id)::text,
    sqlc.narg(llm_configuration_entry_id)::text,
    sqlc.narg(mcp_tokens_entry_id)::text,
    sqlc.arg(toolkit_id)::integer,
    sqlc.arg(index_name)::text,
    sqlc.arg(initiator)::text
);

-- name: InsertRuntimeCommandOutbox :exec
INSERT INTO elitea_runtime.command_outbox (
    outbox_id, execution_id, generation, stream_name, dispatch_ordinal,
    resource_class, isolation_class, priority, deadline, limits_revision,
    traceparent, tracestate, created_at, publish_attempts
) VALUES (
    sqlc.arg(outbox_id)::text,
    sqlc.arg(execution_id)::text,
    sqlc.arg(generation)::bigint,
    sqlc.arg(stream_name)::text,
    1,
    sqlc.arg(resource_class)::text,
    sqlc.arg(isolation_class)::text,
    sqlc.arg(priority)::integer,
    sqlc.arg(deadline)::timestamptz,
    sqlc.arg(limits_revision)::text,
    '',
    '',
    sqlc.arg(created_at)::timestamptz,
    0
);
