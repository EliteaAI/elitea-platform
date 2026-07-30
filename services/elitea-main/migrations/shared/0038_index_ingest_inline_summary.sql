ALTER TABLE elitea_runtime.index_ingest_results
    ALTER COLUMN artifact_id DROP NOT NULL,
    ALTER COLUMN artifact_immutable_version DROP NOT NULL,
    ALTER COLUMN artifact_storage_record_id DROP NOT NULL,
    ADD COLUMN completion_status TEXT,
    ADD COLUMN completion_message TEXT,
    ADD CONSTRAINT index_ingest_result_terminal_shape CHECK (
        (
            artifact_id IS NOT NULL
            AND artifact_immutable_version IS NOT NULL
            AND artifact_storage_record_id IS NOT NULL
            AND completion_status IS NULL
            AND completion_message IS NULL
        )
        OR
        (
            artifact_id IS NULL
            AND artifact_immutable_version IS NULL
            AND artifact_storage_record_id IS NULL
            AND completion_status IS NOT NULL
            AND completion_message IS NOT NULL
        )
    ),
    ADD CONSTRAINT index_ingest_result_completion_status CHECK (
        completion_status IS NULL
        OR completion_status IN ('ok', 'partly_indexed', 'error')
    ),
    ADD CONSTRAINT index_ingest_result_completion_message_bounds CHECK (
        completion_message IS NULL
        OR octet_length(completion_message) BETWEEN 1 AND 49152
    );
