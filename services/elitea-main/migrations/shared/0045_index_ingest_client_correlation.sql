ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN client_stream_id TEXT,
    ADD COLUMN client_message_id TEXT,
    ADD COLUMN sio_event TEXT,
    ADD CONSTRAINT index_ingest_jobs_client_stream_id CHECK (
        client_stream_id IS NULL
        OR (
            octet_length(client_stream_id) BETWEEN 1 AND 512
            AND position(chr(10) IN client_stream_id) = 0
            AND position(chr(13) IN client_stream_id) = 0
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_client_message_id CHECK (
        client_message_id IS NULL
        OR (
            octet_length(client_message_id) BETWEEN 1 AND 512
            AND position(chr(10) IN client_message_id) = 0
            AND position(chr(13) IN client_message_id) = 0
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_sio_event CHECK (
        sio_event IS NULL OR sio_event IN ('chat_predict', 'test_toolkit_tool')
    );
