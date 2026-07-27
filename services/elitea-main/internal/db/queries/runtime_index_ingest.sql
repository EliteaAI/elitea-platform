-- name: GetRuntimeAdmissionByIdempotency :one
SELECT j.execution_id,
       j.command_id,
       j.generation,
       i.index_generation,
       j.request_digest,
       j.admitted_at,
       o.deadline,
       i.index_meta_id,
       i.index_meta_correlation_id,
       i.index_meta_initialized_at
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id AND i.generation = j.generation
WHERE j.idempotency_scope = sqlc.arg(idempotency_scope)::text
  AND j.idempotency_key = sqlc.arg(idempotency_key)::text
  AND j.capability_id = 'index.ingest.v1';

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

-- name: HasActiveIndexIngestTarget :one
SELECT EXISTS (
    SELECT 1
    FROM elitea_runtime.execution_jobs AS j
    JOIN elitea_runtime.index_ingest_jobs AS i
      ON i.execution_id = j.execution_id
     AND i.generation = j.generation
    WHERE j.capability_id = 'index.ingest.v1'
      AND j.resource_project_id = sqlc.arg(resource_project_id)::integer
      AND i.toolkit_id = sqlc.arg(toolkit_id)::integer
      AND i.index_name = sqlc.arg(index_name)::text
      AND j.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING')
    LIMIT 1
);

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

-- name: AllocateIndexGeneration :one
INSERT INTO elitea_runtime.index_generation_counters (
    resource_project_id, toolkit_id, index_name, last_generation, updated_at
) VALUES (
    sqlc.arg(resource_project_id)::integer,
    sqlc.arg(toolkit_id)::integer,
    sqlc.arg(index_name)::text,
    1,
    clock_timestamp()
)
ON CONFLICT (resource_project_id, toolkit_id, index_name) DO UPDATE
SET last_generation =
        elitea_runtime.index_generation_counters.last_generation + 1,
    updated_at = clock_timestamp()
WHERE elitea_runtime.index_generation_counters.last_generation
      < 9223372036854775807
RETURNING last_generation;

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
    execution_id, generation, index_generation, capability_id, input_bundle_id,
    toolkit_configuration_entry_id, tool_parameters_entry_id,
    llm_model_entry_id, llm_configuration_entry_id, mcp_tokens_entry_id,
    index_meta_id, index_meta_correlation_id,
    toolkit_id, index_name, initiator
) VALUES (
    sqlc.arg(execution_id)::text,
    sqlc.arg(generation)::bigint,
    sqlc.arg(index_generation)::bigint,
    'index.ingest.v1',
    sqlc.arg(input_bundle_id)::text,
    sqlc.arg(toolkit_configuration_entry_id)::text,
    sqlc.arg(tool_parameters_entry_id)::text,
    sqlc.narg(llm_model_entry_id)::text,
    sqlc.narg(llm_configuration_entry_id)::text,
    sqlc.narg(mcp_tokens_entry_id)::text,
    sqlc.arg(index_meta_id)::text,
    sqlc.arg(index_meta_correlation_id)::text,
    sqlc.arg(toolkit_id)::integer,
    sqlc.arg(index_name)::text,
    sqlc.arg(initiator)::text
);

-- name: MarkIndexMetaInitialized :one
UPDATE elitea_runtime.index_ingest_jobs AS i
SET index_meta_initialized_at = COALESCE(
    i.index_meta_initialized_at,
    date_trunc('milliseconds', clock_timestamp())
)
FROM elitea_runtime.execution_jobs AS j
WHERE i.execution_id = sqlc.arg(execution_id)::text
  AND i.generation = sqlc.arg(generation)::bigint
  AND i.index_generation = sqlc.arg(index_generation)::bigint
  AND i.capability_id = 'index.ingest.v1'
  AND i.index_meta_id = sqlc.arg(index_meta_id)::text
  AND i.index_meta_correlation_id = sqlc.arg(index_meta_correlation_id)::text
  AND j.execution_id = i.execution_id
  AND j.generation = i.generation
  AND j.capability_id = i.capability_id
  AND j.state = 'PENDING'
  AND j.desired_state = 'RUNNING'
RETURNING i.index_meta_initialized_at;

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

-- name: GetExpectedIndexIngestHeader :one
SELECT j.tenant_id,
       j.resource_project_id,
       j.projection_project_id,
       j.capability_id,
       j.command_id,
       j.execution_id,
       j.generation,
       b.input_bundle_id,
       b.manifest_digest AS input_bundle_digest,
       i.toolkit_configuration_entry_id,
       i.tool_parameters_entry_id,
       i.llm_model_entry_id,
       i.llm_configuration_entry_id,
       i.mcp_tokens_entry_id,
       o.limits_revision
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id
 AND i.generation = j.generation
JOIN elitea_runtime.input_bundles AS b
  ON b.input_bundle_id = j.input_bundle_id
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id
 AND o.generation = j.generation
WHERE j.execution_id = sqlc.arg(execution_id)::text
  AND j.generation = sqlc.arg(generation)::bigint
  AND j.capability_id = 'index.ingest.v1';

-- name: ListExpectedIndexIngestEntries :many
SELECT e.entry_id,
       e.entry_version,
       e.semantic_role,
       e.content_digest,
       e.classification
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id
 AND i.generation = j.generation
JOIN elitea_runtime.input_bundle_entries AS e
  ON e.input_bundle_id = j.input_bundle_id
WHERE j.execution_id = sqlc.arg(execution_id)::text
  AND j.generation = sqlc.arg(generation)::bigint
  AND j.capability_id = 'index.ingest.v1'
ORDER BY e.entry_id;

-- name: GetDurableIndexResultArtifact :one
SELECT a.artifact_id,
       a.immutable_version,
       a.media_type,
       a.byte_length,
       a.digest,
       a.classification,
       a.storage_record_id,
       a.bytes_verified_at
FROM elitea_runtime.index_result_artifacts AS a
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = a.execution_id
 AND j.generation = a.generation
WHERE a.artifact_id = sqlc.arg(artifact_id)::text
  AND a.immutable_version = sqlc.arg(immutable_version)::text
  AND a.execution_id = sqlc.arg(execution_id)::text
  AND a.generation = sqlc.arg(generation)::bigint
  AND a.resource_project_id = sqlc.arg(resource_project_id)::integer
  AND j.tenant_id = sqlc.arg(tenant_id)::text
  AND j.resource_project_id = sqlc.arg(resource_project_id)::integer
  AND j.projection_project_id = sqlc.arg(projection_project_id)::integer
  AND j.command_id = sqlc.arg(command_id)::text
  AND j.capability_id = 'index.ingest.v1';
