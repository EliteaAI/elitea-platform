ALTER TABLE elitea_runtime.execution_jobs
    ALTER COLUMN configuration_revision_id DROP NOT NULL,
    ALTER COLUMN configuration_type DROP NOT NULL,
    ALTER COLUMN catalog_revision DROP NOT NULL,
    ALTER COLUMN catalog_digest DROP NOT NULL,
    ALTER COLUMN schema_id DROP NOT NULL,
    ALTER COLUMN schema_revision DROP NOT NULL,
    ALTER COLUMN schema_digest DROP NOT NULL,
    ALTER COLUMN settings_entry_id DROP NOT NULL;

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
            capability_id = 'index.ingest.v1'
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

ALTER TABLE elitea_runtime.execution_jobs
    ADD CONSTRAINT execution_jobs_capability_bundle_identity
        UNIQUE (execution_id, generation, capability_id, input_bundle_id);

CREATE TABLE elitea_runtime.index_ingest_jobs (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    capability_id TEXT NOT NULL,
    input_bundle_id TEXT NOT NULL,
    toolkit_configuration_entry_id TEXT NOT NULL,
    tool_parameters_entry_id TEXT NOT NULL,
    llm_model_entry_id TEXT,
    llm_configuration_entry_id TEXT,
    mcp_tokens_entry_id TEXT,
    toolkit_id INTEGER NOT NULL,
    index_name TEXT NOT NULL,
    initiator TEXT NOT NULL,
    PRIMARY KEY (execution_id, generation),
    FOREIGN KEY (execution_id, generation, capability_id, input_bundle_id)
        REFERENCES elitea_runtime.execution_jobs
                   (execution_id, generation, capability_id, input_bundle_id)
        ON DELETE CASCADE,
    FOREIGN KEY (input_bundle_id, toolkit_configuration_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    FOREIGN KEY (input_bundle_id, tool_parameters_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    FOREIGN KEY (input_bundle_id, llm_model_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    FOREIGN KEY (input_bundle_id, llm_configuration_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    FOREIGN KEY (input_bundle_id, mcp_tokens_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id),
    CONSTRAINT index_ingest_jobs_capability
        CHECK (capability_id = 'index.ingest.v1'),
    CONSTRAINT index_ingest_jobs_toolkit_id CHECK (toolkit_id > 0),
    CONSTRAINT index_ingest_jobs_index_name
        CHECK (octet_length(index_name) BETWEEN 1 AND 256),
    CONSTRAINT index_ingest_jobs_initiator
        CHECK (initiator IN ('user', 'llm', 'schedule')),
    CONSTRAINT index_ingest_jobs_required_entries_distinct CHECK (
        toolkit_configuration_entry_id <> tool_parameters_entry_id
    ),
    CONSTRAINT index_ingest_jobs_optional_entries_distinct CHECK (
        (llm_model_entry_id IS NULL OR llm_model_entry_id NOT IN (
            toolkit_configuration_entry_id, tool_parameters_entry_id
        ))
        AND (llm_configuration_entry_id IS NULL OR llm_configuration_entry_id NOT IN (
            toolkit_configuration_entry_id, tool_parameters_entry_id,
            llm_model_entry_id
        ))
        AND (mcp_tokens_entry_id IS NULL OR mcp_tokens_entry_id NOT IN (
            toolkit_configuration_entry_id, tool_parameters_entry_id,
            llm_model_entry_id, llm_configuration_entry_id
        ))
    )
);

CREATE INDEX index_ingest_jobs_current_identity_idx
    ON elitea_runtime.index_ingest_jobs
       (toolkit_id, index_name, execution_id, generation);
