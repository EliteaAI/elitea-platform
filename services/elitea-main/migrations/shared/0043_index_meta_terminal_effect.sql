-- These nullable columns record source-driven reconciliation of external
-- index-metadata terminal effects. New writers persist lightweight PENDING
-- intent in the same PostgreSQL transaction as the durable terminal source.
--
-- The one-time source scan below is an idempotent seed for the single-instance
-- PoV, where this migration completes before the new writer starts. A rolling
-- mixed-version production rollout requires a separate rerunnable post-cutover
-- backfill after every writer persists terminal intent; this pre-start seed
-- must not be presented as closing that mixed-version window.
ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN index_meta_terminal_state TEXT,
    ADD COLUMN index_meta_terminal_occurred_at TIMESTAMPTZ,
    ADD COLUMN index_meta_terminal_status TEXT,
    ADD COLUMN index_meta_terminal_claim_token TEXT,
    ADD COLUMN index_meta_terminal_claim_expires_at TIMESTAMPTZ,
    ADD COLUMN index_meta_terminal_attempt_count INTEGER,
    ADD COLUMN index_meta_terminal_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN index_meta_terminal_last_error_code TEXT,
    ADD COLUMN index_meta_terminalized_at TIMESTAMPTZ;

ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_state CHECK (
        index_meta_terminal_state IS NULL
        OR index_meta_terminal_state IN ('failed', 'cancelled')
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_identity CHECK (
        num_nonnulls(
            index_meta_terminal_state,
            index_meta_terminal_occurred_at,
            index_meta_terminal_status
        ) IN (0, 3)
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_status CHECK (
        index_meta_terminal_status IS NULL
        OR index_meta_terminal_status IN ('PENDING', 'APPLIED', 'SUPERSEDED')
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_resolution CHECK (
        (
            index_meta_terminal_status IS NULL
            AND index_meta_terminalized_at IS NULL
        )
        OR (
            index_meta_terminal_status = 'PENDING'
            AND index_meta_terminalized_at IS NULL
        )
        OR (
            index_meta_terminal_status IN ('APPLIED', 'SUPERSEDED')
            AND index_meta_terminalized_at IS NOT NULL
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_claim CHECK (
        (
            index_meta_terminal_claim_token IS NULL
            AND index_meta_terminal_claim_expires_at IS NULL
        )
        OR (
            index_meta_terminal_status = 'PENDING'
            AND index_meta_terminal_claim_token IS NOT NULL
            AND index_meta_terminal_claim_expires_at IS NOT NULL
            AND octet_length(index_meta_terminal_claim_token)
                BETWEEN 1 AND 256
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_last_error CHECK (
        index_meta_terminal_last_error_code IS NULL
        OR octet_length(index_meta_terminal_last_error_code) BETWEEN 1 AND 64
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_retry CHECK (
        (
            index_meta_terminal_status IS NULL
            AND index_meta_terminal_attempt_count IS NULL
            AND index_meta_terminal_next_attempt_at IS NULL
            AND index_meta_terminal_last_error_code IS NULL
        )
        OR (
            index_meta_terminal_status = 'PENDING'
            AND index_meta_terminal_attempt_count IS NOT NULL
            AND index_meta_terminal_attempt_count >= 0
            AND index_meta_terminal_next_attempt_at IS NOT NULL
        )
        OR (
            index_meta_terminal_status IN ('APPLIED', 'SUPERSEDED')
            AND index_meta_terminal_attempt_count IS NOT NULL
            AND index_meta_terminal_attempt_count > 0
            AND index_meta_terminal_next_attempt_at IS NULL
            AND index_meta_terminal_last_error_code IS NULL
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_terminal_requires_initialization CHECK (
        index_meta_terminal_status IS NULL
        OR index_meta_initialized_at IS NOT NULL
    );

WITH terminal_evidence AS (
    SELECT o.execution_id,
           o.generation,
           CASE o.settlement_outcome
               WHEN 'FAILED' THEN 'failed'
               WHEN 'CANCELLED' THEN 'cancelled'
           END AS terminal_state,
           o.occurred_at,
           1 AS source_priority,
           o.event_id AS source_id
    FROM elitea_runtime.output_inbox AS o
    WHERE o.projected_at IS NOT NULL
      AND o.payload_type = 'RUNTIME_FAILURE'
      AND o.settlement_outcome IN ('FAILED', 'CANCELLED')
    UNION ALL
    SELECT o.execution_id,
           o.generation,
           CASE o.retirement_code
               WHEN 'DEADLINE_EXCEEDED' THEN 'failed'
               WHEN 'CANCELLED' THEN 'cancelled'
           END,
           o.retired_at,
           2,
           o.outbox_id
    FROM elitea_runtime.command_outbox AS o
    WHERE o.retired_at IS NOT NULL
      AND o.authority_granted_at IS NULL
      AND o.retirement_code IN ('CANCELLED', 'DEADLINE_EXCEEDED')
),
terminal_sources AS (
    SELECT DISTINCT ON (execution_id, generation)
           execution_id,
           generation,
           terminal_state,
           occurred_at
    FROM terminal_evidence
    ORDER BY execution_id,
             generation,
             source_priority,
             occurred_at,
             source_id
)
UPDATE elitea_runtime.index_ingest_jobs AS i
SET index_meta_terminal_state = source.terminal_state,
    index_meta_terminal_occurred_at = source.occurred_at,
    index_meta_terminal_status = 'PENDING',
    index_meta_terminal_attempt_count = 0,
    index_meta_terminal_next_attempt_at = clock_timestamp()
FROM terminal_sources AS source
WHERE i.execution_id = source.execution_id
  AND i.generation = source.generation
  AND i.capability_id = 'index.ingest.v1'
  AND i.index_meta_initialized_at IS NOT NULL
  AND i.index_meta_terminal_status IS NULL;

CREATE INDEX index_ingest_jobs_meta_terminal_pending_idx
    ON elitea_runtime.index_ingest_jobs (
        index_meta_terminal_next_attempt_at, execution_id, generation
    )
    INCLUDE (
        index_meta_terminal_state, index_meta_terminal_occurred_at,
        index_meta_terminal_claim_expires_at
    )
    WHERE index_meta_terminal_status = 'PENDING';
