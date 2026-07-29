ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN index_meta_id TEXT,
    ADD COLUMN index_meta_correlation_id TEXT,
    ADD COLUMN index_meta_initialized_at TIMESTAMPTZ;

-- Nullable columns keep the forward migration compatible with already-admitted
-- work. Such rows deliberately remain non-dispatchable until an operator or a
-- later reconciliation design can materialize their exact PgVector metadata;
-- this migration never invents an external-row identity.
ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD CONSTRAINT index_ingest_jobs_meta_identity_pair CHECK (
        num_nonnulls(index_meta_id, index_meta_correlation_id) IN (0, 2)
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_id_bounds CHECK (
        index_meta_id IS NULL
        OR octet_length(index_meta_id) BETWEEN 1 AND 256
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_correlation_bounds CHECK (
        index_meta_correlation_id IS NULL
        OR octet_length(index_meta_correlation_id) BETWEEN 1 AND 512
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_identity CHECK (
        index_meta_initialized_at IS NULL
        OR (
            index_meta_id IS NOT NULL
            AND index_meta_correlation_id IS NOT NULL
        )
    );

CREATE UNIQUE INDEX index_ingest_jobs_meta_id_idx
    ON elitea_runtime.index_ingest_jobs (index_meta_id)
    WHERE index_meta_id IS NOT NULL;

CREATE INDEX index_ingest_jobs_dispatch_ready_idx
    ON elitea_runtime.index_ingest_jobs (
        index_meta_initialized_at,
        execution_id,
        generation
    )
    WHERE index_meta_initialized_at IS NOT NULL;
