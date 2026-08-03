ALTER TABLE elitea_runtime.execution_jobs
    DROP CONSTRAINT execution_jobs_capability_payload;

ALTER TABLE elitea_runtime.execution_jobs
    ADD CONSTRAINT execution_jobs_capability_payload CHECK (
        (
            capability_id = 'configuration.validate.v1'
            AND num_nonnulls(
                configuration_revision_id,
                configuration_type,
                catalog_revision,
                catalog_digest,
                schema_id,
                schema_revision,
                schema_digest,
                settings_entry_id
            ) = 8
        )
        OR
        (
            capability_id IN (
                'index.ingest.v1',
                'agent.execute.application.v1',
                'agent.execute.adhoc.v1'
            )
            AND num_nonnulls(
                configuration_revision_id,
                configuration_type,
                catalog_revision,
                catalog_digest,
                schema_id,
                schema_revision,
                schema_digest,
                settings_entry_id
            ) = 0
        )
    );

CREATE TABLE elitea_runtime.agent_execution_jobs (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    capability_id TEXT NOT NULL,
    input_bundle_id TEXT NOT NULL,
    request_entry_id TEXT NOT NULL,
    client_stream_id TEXT NOT NULL,
    client_message_id TEXT NOT NULL,
    client_execution_generation TEXT NOT NULL,
    sio_event TEXT NOT NULL,
    PRIMARY KEY (execution_id, generation),
    FOREIGN KEY (execution_id, generation, capability_id, input_bundle_id)
        REFERENCES elitea_runtime.execution_jobs
                   (execution_id, generation, capability_id, input_bundle_id)
        ON DELETE CASCADE,
    FOREIGN KEY (input_bundle_id, request_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    CONSTRAINT agent_execution_jobs_capability CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
    ),
    CONSTRAINT agent_execution_jobs_request_entry CHECK (
        octet_length(request_entry_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_execution_jobs_client_stream CHECK (
        octet_length(client_stream_id) BETWEEN 1 AND 512
        AND client_stream_id !~ E'[\\r\\n]'
    ),
    CONSTRAINT agent_execution_jobs_client_message CHECK (
        octet_length(client_message_id) BETWEEN 1 AND 512
        AND client_message_id !~ E'[\\r\\n]'
    ),
    CONSTRAINT agent_execution_jobs_client_generation CHECK (
        octet_length(client_execution_generation) BETWEEN 1 AND 512
        AND client_execution_generation !~ E'[\\r\\n]'
    ),
    CONSTRAINT agent_execution_jobs_sio_event CHECK (
        sio_event IN ('chat_predict', 'chat_continue_predict')
    )
);

CREATE INDEX agent_execution_jobs_current_correlation_idx
    ON elitea_runtime.agent_execution_jobs
       (client_stream_id, client_message_id, client_execution_generation,
        execution_id, generation);
