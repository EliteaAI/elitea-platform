CREATE TABLE IF NOT EXISTS elitea_runtime.output_inbox (
    event_id TEXT PRIMARY KEY,
    logical_output_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    claim_id TEXT NOT NULL REFERENCES elitea_runtime.execution_claims(claim_id),
    fence_token BYTEA NOT NULL,
    workload_identity TEXT NOT NULL,
    workload_session_id TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    claim_attempt BIGINT NOT NULL,
    lease_epoch BIGINT NOT NULL,
    stream_id TEXT NOT NULL,
    sequence BIGINT NOT NULL,
    claim_handoff_watermark BIGINT NOT NULL DEFAULT 0,
    payload_type TEXT NOT NULL,
    payload_digest BYTEA NOT NULL,
    payload_bytes BYTEA NOT NULL,
    settlement_proposal_id TEXT NOT NULL,
    settlement_outcome TEXT NOT NULL,
    settlement_proposal_bytes BYTEA NOT NULL,
    settlement_proposal_digest BYTEA NOT NULL,
    settlement_idempotency_key TEXT NOT NULL,
    occurred_at TIMESTAMPTZ NOT NULL,
    received_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    projected_at TIMESTAMPTZ,
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    UNIQUE (execution_id, generation, logical_output_id),
    UNIQUE (execution_id, generation, producer_id, sequence),
    CONSTRAINT output_inbox_sequence CHECK (sequence > 0),
    CONSTRAINT output_inbox_claim_attempt CHECK (claim_attempt > 0),
    CONSTRAINT output_inbox_lease_epoch CHECK (lease_epoch > 0),
    CONSTRAINT output_inbox_handoff_watermark CHECK (claim_handoff_watermark >= 0),
    CONSTRAINT output_inbox_fence_length
        CHECK (octet_length(fence_token) = 32),
    CONSTRAINT output_inbox_digest_length
        CHECK (octet_length(payload_digest) = 32),
    CONSTRAINT output_inbox_payload_type CHECK (
        payload_type IN ('CONFIGURATION_VALIDATION', 'RUNTIME_FAILURE')
    ),
    CONSTRAINT output_inbox_payload_size
        CHECK (octet_length(payload_bytes) BETWEEN 1 AND 262144),
    CONSTRAINT output_inbox_settlement_outcome CHECK (
        settlement_outcome IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN')
    ),
    CONSTRAINT output_inbox_settlement_proposal_size
        CHECK (octet_length(settlement_proposal_bytes) BETWEEN 1 AND 65536),
    CONSTRAINT output_inbox_settlement_proposal_digest
        CHECK (octet_length(settlement_proposal_digest) = 32)
);

CREATE INDEX IF NOT EXISTS output_inbox_unprojected_idx
    ON elitea_runtime.output_inbox (received_at, event_id)
    WHERE projected_at IS NULL;

CREATE TABLE IF NOT EXISTS elitea_runtime.configuration_validation_results (
    logical_output_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    configuration_revision_id TEXT NOT NULL,
    configuration_type TEXT NOT NULL,
    catalog_revision TEXT NOT NULL,
    catalog_digest BYTEA NOT NULL,
    schema_id TEXT NOT NULL,
    schema_revision TEXT NOT NULL,
    schema_digest BYTEA NOT NULL,
    input_bundle_id TEXT NOT NULL,
    input_bundle_digest BYTEA NOT NULL,
    settings_entry_id TEXT NOT NULL,
    settings_entry_version TEXT NOT NULL,
    settings_content_digest BYTEA NOT NULL,
    valid BOOLEAN NOT NULL,
    issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    projected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (execution_id, generation, logical_output_id),
    FOREIGN KEY (execution_id, generation, logical_output_id)
        REFERENCES elitea_runtime.output_inbox
                   (execution_id, generation, logical_output_id),
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation),
    CONSTRAINT configuration_validation_catalog_digest
        CHECK (octet_length(catalog_digest) = 32),
    CONSTRAINT configuration_validation_schema_digest
        CHECK (octet_length(schema_digest) = 32),
    CONSTRAINT configuration_validation_bundle_digest
        CHECK (octet_length(input_bundle_digest) = 32),
    CONSTRAINT configuration_validation_settings_digest
        CHECK (octet_length(settings_content_digest) = 32),
    CONSTRAINT configuration_validation_issues_array
        CHECK (jsonb_typeof(issues_json) = 'array')
);

CREATE TABLE IF NOT EXISTS elitea_runtime.execution_replay_events (
    cursor BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id TEXT NOT NULL UNIQUE,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    projection_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    event_type TEXT NOT NULL,
    event_bytes BYTEA NOT NULL,
    event_digest BYTEA NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    CONSTRAINT execution_replay_event_size
        CHECK (octet_length(event_bytes) BETWEEN 1 AND 65536),
    CONSTRAINT execution_replay_event_digest
        CHECK (octet_length(event_digest) = 32)
);

CREATE INDEX IF NOT EXISTS execution_replay_cursor_idx
    ON elitea_runtime.execution_replay_events
       (projection_project_id, execution_id, cursor);

CREATE TABLE IF NOT EXISTS elitea_runtime.execution_settlements (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    claim_id TEXT NOT NULL REFERENCES elitea_runtime.execution_claims(claim_id),
    fence_token BYTEA NOT NULL,
    workload_identity TEXT NOT NULL,
    workload_session_id TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    claim_attempt BIGINT NOT NULL,
    lease_epoch BIGINT NOT NULL,
    settlement_receipt_id TEXT NOT NULL UNIQUE,
    proposal_id TEXT NOT NULL,
    proposal_bytes BYTEA NOT NULL,
    proposal_digest BYTEA NOT NULL,
    idempotency_key TEXT NOT NULL,
    disposition TEXT NOT NULL,
    final_logical_output_id TEXT NOT NULL,
    terminal_event_id TEXT NOT NULL,
    terminal_sequence BIGINT NOT NULL,
    terminal_payload_digest BYTEA NOT NULL,
    error_code TEXT,
    prepared_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    committed_at TIMESTAMPTZ,
    PRIMARY KEY (execution_id, generation),
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    CONSTRAINT execution_settlement_fence
        CHECK (octet_length(fence_token) = 32),
    CONSTRAINT execution_settlement_claim_attempt CHECK (claim_attempt > 0),
    CONSTRAINT execution_settlement_lease_epoch CHECK (lease_epoch > 0),
    CONSTRAINT execution_settlement_proposal_bytes
        CHECK (octet_length(proposal_bytes) BETWEEN 1 AND 65536),
    CONSTRAINT execution_settlement_proposal_digest
        CHECK (octet_length(proposal_digest) = 32),
    CONSTRAINT execution_settlement_terminal_sequence
        CHECK (terminal_sequence > 0),
    CONSTRAINT execution_settlement_terminal_payload_digest
        CHECK (octet_length(terminal_payload_digest) = 32),
    CONSTRAINT execution_settlement_disposition
        CHECK (disposition IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'OUTCOME_UNKNOWN'))
);
