ALTER TABLE elitea_runtime.output_inbox
    DROP CONSTRAINT output_inbox_payload_type;

ALTER TABLE elitea_runtime.output_inbox
    ADD CONSTRAINT output_inbox_payload_type CHECK (
        payload_type IN (
            'CONFIGURATION_VALIDATION',
            'RUNTIME_FAILURE',
            'INDEX_INGEST_RESULT'
        )
    );

-- This table is an attestation boundary owned by the future artifact upload
-- data plane. elitea-main only reads rows whose bytes_verified_at is present;
-- receiving terminal worker metadata is never sufficient to create one.
CREATE TABLE elitea_runtime.index_result_artifacts (
    artifact_id TEXT NOT NULL,
    immutable_version TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    resource_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    media_type TEXT NOT NULL,
    byte_length BIGINT NOT NULL,
    digest BYTEA NOT NULL,
    classification TEXT NOT NULL,
    storage_record_id TEXT NOT NULL UNIQUE,
    bytes_verified_at TIMESTAMPTZ NOT NULL,
    metadata_created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (artifact_id, immutable_version),
    FOREIGN KEY (execution_id, generation)
        REFERENCES elitea_runtime.execution_jobs(execution_id, generation)
        ON DELETE CASCADE,
    UNIQUE (
        artifact_id, immutable_version, execution_id, generation,
        storage_record_id
    ),
    CONSTRAINT index_result_artifact_digest
        CHECK (octet_length(digest) = 32),
    CONSTRAINT index_result_artifact_length CHECK (byte_length > 0),
    CONSTRAINT index_result_artifact_identity_bounds CHECK (
        char_length(artifact_id) BETWEEN 1 AND 256
        AND char_length(immutable_version) BETWEEN 1 AND 256
        AND char_length(media_type) BETWEEN 1 AND 256
        AND char_length(classification) BETWEEN 1 AND 256
        AND char_length(storage_record_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT index_result_artifact_verified_order CHECK (
        bytes_verified_at >= metadata_created_at
    )
);

CREATE INDEX index_result_artifacts_execution_idx
    ON elitea_runtime.index_result_artifacts
       (execution_id, generation, artifact_id);

CREATE TABLE elitea_runtime.index_ingest_results (
    logical_output_id TEXT NOT NULL,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    input_bundle_id TEXT NOT NULL
        REFERENCES elitea_runtime.input_bundles(input_bundle_id),
    input_bundle_digest BYTEA NOT NULL,
    artifact_id TEXT NOT NULL,
    artifact_immutable_version TEXT NOT NULL,
    artifact_storage_record_id TEXT NOT NULL,
    projected_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (execution_id, generation, logical_output_id),
    FOREIGN KEY (execution_id, generation, logical_output_id)
        REFERENCES elitea_runtime.output_inbox
                   (execution_id, generation, logical_output_id),
    FOREIGN KEY (
        artifact_id, artifact_immutable_version, execution_id, generation,
        artifact_storage_record_id
    ) REFERENCES elitea_runtime.index_result_artifacts (
        artifact_id, immutable_version, execution_id, generation,
        storage_record_id
    ),
    CONSTRAINT index_ingest_result_bundle_digest
        CHECK (octet_length(input_bundle_digest) = 32)
);
