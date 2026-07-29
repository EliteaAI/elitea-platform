CREATE TABLE IF NOT EXISTS elitea_runtime.input_bundles (
    input_bundle_id TEXT PRIMARY KEY,
    immutable_version TEXT NOT NULL,
    media_type TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    manifest_digest BYTEA NOT NULL,
    manifest_size BIGINT NOT NULL,
    manifest_bytes BYTEA NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT input_bundles_digest_length
        CHECK (octet_length(manifest_digest) = 32),
    CONSTRAINT input_bundles_manifest_size
        CHECK (manifest_size BETWEEN 1 AND 65536),
    CONSTRAINT input_bundles_manifest_length
        CHECK (octet_length(manifest_bytes) = manifest_size),
    CONSTRAINT input_bundles_media_type
        CHECK (media_type = 'application/x-protobuf')
);

CREATE TABLE IF NOT EXISTS elitea_runtime.input_bundle_entries (
    input_bundle_id TEXT NOT NULL
        REFERENCES elitea_runtime.input_bundles(input_bundle_id) ON DELETE CASCADE,
    entry_id TEXT NOT NULL,
    entry_version TEXT NOT NULL,
    semantic_role TEXT NOT NULL,
    media_type TEXT NOT NULL,
    content_digest BYTEA NOT NULL,
    content_size BIGINT NOT NULL,
    content_reference TEXT NOT NULL,
    classification TEXT NOT NULL,
    required_grant_audience TEXT NOT NULL,
    content_bytes BYTEA NOT NULL,
    PRIMARY KEY (input_bundle_id, entry_id),
    CONSTRAINT input_bundle_entries_digest_length
        CHECK (octet_length(content_digest) = 32),
    CONSTRAINT input_bundle_entries_content_size
        CHECK (content_size BETWEEN 1 AND 262144),
    CONSTRAINT input_bundle_entries_content_length
        CHECK (octet_length(content_bytes) = content_size)
);

CREATE TABLE IF NOT EXISTS elitea_runtime.execution_jobs (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    command_id TEXT NOT NULL,
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    projection_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    actor_id TEXT NOT NULL,
    principal_ref TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    capability_version TEXT NOT NULL,
    input_bundle_id TEXT NOT NULL
        REFERENCES elitea_runtime.input_bundles(input_bundle_id),
    request_digest BYTEA NOT NULL,
    idempotency_scope TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    configuration_revision_id TEXT NOT NULL,
    configuration_type TEXT NOT NULL,
    catalog_revision TEXT NOT NULL,
    catalog_digest BYTEA NOT NULL,
    schema_id TEXT NOT NULL,
    schema_revision TEXT NOT NULL,
    schema_digest BYTEA NOT NULL,
    settings_entry_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    desired_state TEXT NOT NULL DEFAULT 'RUNNING',
    admitted_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    settled_at TIMESTAMPTZ,
    terminal_error_code TEXT,
    PRIMARY KEY (execution_id, generation),
    UNIQUE (command_id),
    UNIQUE (idempotency_scope, idempotency_key),
    CONSTRAINT execution_jobs_generation CHECK (generation > 0),
    CONSTRAINT execution_jobs_request_digest_length
        CHECK (octet_length(request_digest) = 32),
    CONSTRAINT execution_jobs_catalog_digest_length
        CHECK (octet_length(catalog_digest) = 32),
    CONSTRAINT execution_jobs_schema_digest_length
        CHECK (octet_length(schema_digest) = 32),
    CONSTRAINT execution_jobs_state CHECK (
        state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING',
                  'SUCCEEDED', 'FAILED', 'CANCELLED')
    ),
    CONSTRAINT execution_jobs_desired_state
        CHECK (desired_state IN ('RUNNING', 'CANCELLED', 'DRAINING')),
    CONSTRAINT execution_jobs_terminal_error CHECK (
        terminal_error_code IS NULL
        OR (state = 'FAILED' AND terminal_error_code = 'DEADLINE_EXCEEDED')
    )
);

CREATE TABLE IF NOT EXISTS elitea_runtime.command_outbox (
    outbox_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    stream_name TEXT NOT NULL,
    dispatch_ordinal BIGINT NOT NULL DEFAULT 1,
    resource_class TEXT NOT NULL,
    isolation_class TEXT NOT NULL,
    priority INTEGER NOT NULL,
    deadline TIMESTAMPTZ NOT NULL,
    limits_revision TEXT NOT NULL,
    traceparent TEXT NOT NULL DEFAULT '',
    tracestate TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    prepared_signed_envelope_bytes BYTEA,
    prepared_signed_envelope_digest BYTEA,
    prepared_signature_profile INTEGER,
    prepared_key_id TEXT,
    prepared_at TIMESTAMPTZ,
    published_at TIMESTAMPTZ,
    published_envelope_digest BYTEA,
    authority_granted_at TIMESTAMPTZ,
    publish_attempts INTEGER NOT NULL DEFAULT 0,
    last_error_code TEXT,
    retired_at TIMESTAMPTZ,
    retirement_code TEXT,
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    UNIQUE (execution_id, generation),
    CONSTRAINT command_outbox_dispatch_ordinal CHECK (dispatch_ordinal > 0),
    CONSTRAINT command_outbox_priority CHECK (priority > 0),
    CONSTRAINT command_outbox_prepared_envelope CHECK (
        (
            prepared_signed_envelope_bytes IS NULL
            AND prepared_signed_envelope_digest IS NULL
            AND prepared_signature_profile IS NULL
            AND prepared_key_id IS NULL
            AND prepared_at IS NULL
        )
        OR
        (
            prepared_signed_envelope_bytes IS NOT NULL
            AND prepared_signed_envelope_digest IS NOT NULL
            AND prepared_signature_profile IS NOT NULL
            AND prepared_key_id IS NOT NULL
            AND octet_length(prepared_signed_envelope_bytes) BETWEEN 1 AND 65536
            AND octet_length(prepared_signed_envelope_digest) = 32
            AND prepared_signature_profile > 0
            AND octet_length(prepared_key_id) BETWEEN 1 AND 256
            AND prepared_at IS NOT NULL
        )
    ),
    CONSTRAINT command_outbox_published_digest CHECK (
        (published_at IS NULL AND published_envelope_digest IS NULL)
        OR
        (
            published_at IS NOT NULL
            AND prepared_signed_envelope_digest IS NOT NULL
            AND published_envelope_digest IS NOT NULL
            AND octet_length(published_envelope_digest) = 32
            AND published_envelope_digest = prepared_signed_envelope_digest
        )
    ),
    CONSTRAINT command_outbox_retirement CHECK (
        (
            retired_at IS NULL
            AND retirement_code IS NULL
        )
        OR
        (
            retired_at IS NOT NULL
            AND retirement_code IN ('DEADLINE_EXCEEDED', 'CANCELLED')
            AND authority_granted_at IS NULL
        )
    ),
    CONSTRAINT command_outbox_authority CHECK (
        authority_granted_at IS NULL
        OR (
            retired_at IS NULL
            AND published_at IS NOT NULL
            AND published_envelope_digest IS NOT NULL
        )
    ),
    CONSTRAINT command_outbox_attempts CHECK (publish_attempts >= 0)
);

CREATE INDEX IF NOT EXISTS command_outbox_unpublished_idx
    ON elitea_runtime.command_outbox (stream_name, created_at, outbox_id)
    INCLUDE (execution_id, generation)
    WHERE published_at IS NULL AND retired_at IS NULL;

CREATE INDEX IF NOT EXISTS command_outbox_deadline_idx
    ON elitea_runtime.command_outbox (stream_name, deadline, outbox_id)
    INCLUDE (execution_id, generation)
    WHERE retired_at IS NULL AND authority_granted_at IS NULL;

CREATE INDEX IF NOT EXISTS execution_jobs_cancel_pending_idx
    ON elitea_runtime.execution_jobs (
        capability_id, generation, admitted_at, execution_id
    )
    WHERE desired_state = 'CANCELLED' AND state IN ('PENDING', 'DISPATCHED');

CREATE TABLE IF NOT EXISTS elitea_runtime.execution_claims (
    claim_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    workload_session_id TEXT NOT NULL,
    workload_identity TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    claim_attempt BIGINT NOT NULL,
    lease_epoch BIGINT NOT NULL,
    fence_token BYTEA NOT NULL,
    claimed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    lease_expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ,
    release_reason TEXT,
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    CONSTRAINT execution_claims_fence_token
        CHECK (octet_length(fence_token) = 32),
    CONSTRAINT execution_claims_claim_attempt CHECK (claim_attempt > 0),
    CONSTRAINT execution_claims_lease_epoch CHECK (lease_epoch > 0),
    CONSTRAINT execution_claims_lease_order
        CHECK (lease_expires_at > claimed_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS execution_claims_attempt_idx
    ON elitea_runtime.execution_claims (execution_id, generation, claim_attempt);

CREATE UNIQUE INDEX IF NOT EXISTS execution_claims_active_idx
    ON elitea_runtime.execution_claims (execution_id, generation)
    WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS execution_claims_expiry_idx
    ON elitea_runtime.execution_claims (lease_expires_at)
    WHERE released_at IS NULL;
