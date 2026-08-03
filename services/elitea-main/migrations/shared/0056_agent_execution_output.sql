ALTER TABLE elitea_runtime.output_inbox
    DROP CONSTRAINT output_inbox_payload_type;

ALTER TABLE elitea_runtime.output_inbox
    ADD CONSTRAINT output_inbox_payload_type CHECK (
        payload_type IN (
            'CONFIGURATION_VALIDATION',
            'RUNTIME_FAILURE',
            'INDEX_INGEST_RESULT',
            'AGENT_EXECUTION_RESULT'
        )
    );
