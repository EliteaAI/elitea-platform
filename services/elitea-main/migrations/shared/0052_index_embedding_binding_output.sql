ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN embedding_binding_entry_id TEXT;

UPDATE elitea_runtime.index_ingest_jobs AS ingest
SET embedding_binding_entry_id = (
    SELECT entry.entry_id
    FROM elitea_runtime.input_bundle_entries AS entry
    WHERE entry.input_bundle_id = ingest.input_bundle_id
      AND entry.semantic_role = 'index.embedding_binding'
)
WHERE EXISTS (
    SELECT 1
    FROM elitea_runtime.input_bundle_entries AS entry
    WHERE entry.input_bundle_id = ingest.input_bundle_id
      AND entry.semantic_role = 'index.embedding_binding'
);

ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD CONSTRAINT index_ingest_jobs_embedding_binding_entry
        FOREIGN KEY (input_bundle_id, embedding_binding_entry_id)
        REFERENCES elitea_runtime.input_bundle_entries (input_bundle_id, entry_id);

ALTER TABLE elitea_runtime.index_ingest_jobs
    DROP CONSTRAINT index_ingest_jobs_optional_entries_distinct,
    ADD CONSTRAINT index_ingest_jobs_optional_entries_distinct CHECK (
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
        AND (
            embedding_binding_entry_id IS NULL
            OR embedding_binding_entry_id NOT IN (
                toolkit_configuration_entry_id, tool_parameters_entry_id,
                llm_model_entry_id, llm_configuration_entry_id,
                mcp_tokens_entry_id
            )
        )
    );
