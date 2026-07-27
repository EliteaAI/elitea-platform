-- Manual Stop has a different external-data contract from dependency or
-- system cancellation: after the exact execution settles CANCELLED, its
-- matching collection rows with an explicit non-index_meta type must be
-- removed. The HTTP transaction records this intent only; a bounded reconciler
-- owns PgVector I/O.
--
-- No historical backfill is safe because existing cancellation evidence does
-- not distinguish a user-requested Stop from a system/dependency cancellation.
ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN index_manual_stop_requested_at TIMESTAMPTZ,
    ADD COLUMN index_manual_cleanup_status TEXT,
    ADD COLUMN index_manual_cleanup_claim_token TEXT,
    ADD COLUMN index_manual_cleanup_claim_expires_at TIMESTAMPTZ,
    ADD COLUMN index_manual_cleanup_attempt_count INTEGER,
    ADD COLUMN index_manual_cleanup_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN index_manual_cleanup_last_error_code TEXT,
    ADD COLUMN index_manual_cleanup_resolved_at TIMESTAMPTZ;

ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_identity CHECK (
        num_nonnulls(
            index_manual_stop_requested_at,
            index_manual_cleanup_status
        ) IN (0, 2)
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_status CHECK (
        index_manual_cleanup_status IS NULL
        OR index_manual_cleanup_status IN ('PENDING', 'APPLIED', 'SUPERSEDED')
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_resolution CHECK (
        (
            index_manual_cleanup_status IS NULL
            AND index_manual_cleanup_resolved_at IS NULL
        )
        OR (
            index_manual_cleanup_status = 'PENDING'
            AND index_manual_cleanup_resolved_at IS NULL
        )
        OR (
            index_manual_cleanup_status IN ('APPLIED', 'SUPERSEDED')
            AND index_manual_cleanup_resolved_at IS NOT NULL
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_claim CHECK (
        (
            index_manual_cleanup_claim_token IS NULL
            AND index_manual_cleanup_claim_expires_at IS NULL
        )
        OR (
            index_manual_cleanup_status = 'PENDING'
            AND index_manual_cleanup_claim_token IS NOT NULL
            AND index_manual_cleanup_claim_expires_at IS NOT NULL
            AND octet_length(index_manual_cleanup_claim_token)
                BETWEEN 1 AND 256
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_last_error CHECK (
        index_manual_cleanup_last_error_code IS NULL
        OR octet_length(index_manual_cleanup_last_error_code) BETWEEN 1 AND 64
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_retry CHECK (
        (
            index_manual_cleanup_status IS NULL
            AND index_manual_cleanup_attempt_count IS NULL
            AND index_manual_cleanup_next_attempt_at IS NULL
            AND index_manual_cleanup_last_error_code IS NULL
        )
        OR (
            index_manual_cleanup_status = 'PENDING'
            AND index_manual_cleanup_attempt_count IS NOT NULL
            AND index_manual_cleanup_attempt_count >= 0
            AND index_manual_cleanup_next_attempt_at IS NOT NULL
        )
        OR (
            index_manual_cleanup_status IN ('APPLIED', 'SUPERSEDED')
            AND index_manual_cleanup_attempt_count IS NOT NULL
            AND index_manual_cleanup_attempt_count > 0
            AND index_manual_cleanup_next_attempt_at IS NULL
            AND index_manual_cleanup_last_error_code IS NULL
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_manual_cleanup_requires_initialization CHECK (
        index_manual_cleanup_status IS NULL
        OR index_meta_initialized_at IS NOT NULL
    );

CREATE INDEX index_ingest_jobs_manual_cleanup_pending_idx
    ON elitea_runtime.index_ingest_jobs (
        index_manual_cleanup_next_attempt_at, execution_id, generation
    )
    INCLUDE (
        index_manual_stop_requested_at,
        index_manual_cleanup_claim_expires_at
    )
    WHERE index_manual_cleanup_status = 'PENDING';
