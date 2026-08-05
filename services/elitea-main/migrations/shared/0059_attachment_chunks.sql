-- Required by S20a (chat attachment byte path). Legacy buffers each
-- chunk of a chunked upload as its own file on local disk
-- ({tempdir}/elitea_chunks/{file_id}/chunk_{index:06d}) and detects
-- completeness by counting present files — both are unsafe once any number
-- of elitea-main replicas can receive one chunk each with no sticky session
-- (see this file's own ADR-0016 standing constraint: "no stage may rely on
-- in-process-only state or same-replica request affinity"). Postgres is the
-- shared, replica-safe substitute: each chunk is one row, keyed so a retried
-- chunk_index overwrites rather than double-counts (ON CONFLICT DO UPDATE in
-- the query, not enforced here), and "how many distinct chunks have
-- arrived" becomes a COUNT(*) instead of a directory listing. Chunk bytes
-- are bounded (the wire contract caps a single chunk at 5 MiB, and the
-- 150 MB total-upload limit bounds total_chunks to ~30) and always
-- deleted once merged, so BYTEA is a deliberate, bounded, transient use —
-- not a general blob store.
CREATE TABLE elitea_storage.attachment_chunks (
    project_id      BIGINT      NOT NULL,
    conversation_id TEXT        NOT NULL,
    file_id         TEXT        NOT NULL,
    chunk_index     INTEGER     NOT NULL,
    total_chunks    INTEGER     NOT NULL,
    file_name       TEXT        NOT NULL,
    content_type    TEXT        NOT NULL DEFAULT '',
    bytes           BYTEA       NOT NULL,
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (project_id, conversation_id, file_id, chunk_index)
);
