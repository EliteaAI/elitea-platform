ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN index_meta_initialization_status TEXT,
    ADD COLUMN index_meta_initialization_claim_token TEXT,
    ADD COLUMN index_meta_initialization_claim_expires_at TIMESTAMPTZ,
    ADD COLUMN index_meta_initialization_attempt_count INTEGER,
    ADD COLUMN index_meta_initialization_next_attempt_at TIMESTAMPTZ,
    ADD COLUMN index_meta_initialization_last_error_code TEXT,
    ADD COLUMN index_meta_initialization_resolved_at TIMESTAMPTZ,
    ADD COLUMN index_meta_initialization_failed_at TIMESTAMPTZ;

-- Admission writes the execution, capability row, and outbox atomically.
-- Refuse to infer recovery state if historical data violates that ownership
-- invariant; otherwise the backfill could leave NULL state behind or guess
-- whether a command was externally visible.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM elitea_runtime.index_ingest_jobs AS i
        LEFT JOIN elitea_runtime.execution_jobs AS j
          ON j.execution_id = i.execution_id
         AND j.generation = i.generation
         AND j.capability_id = i.capability_id
        LEFT JOIN elitea_runtime.command_outbox AS o
          ON o.execution_id = i.execution_id
         AND o.generation = i.generation
        WHERE j.execution_id IS NULL
           OR o.execution_id IS NULL
    ) THEN
        RAISE EXCEPTION
            'index metadata initialization recovery requires complete admission ownership'
            USING ERRCODE = '23514';
    END IF;
END
$$;

-- The immutable input bundle and index identity are the initialization intent.
-- Only exact, active, pre-authority rows are recoverable. Older rows without
-- that complete evidence are retained for audit but never guessed or retried.
UPDATE elitea_runtime.index_ingest_jobs AS i
SET index_meta_initialization_status =
        CASE
            WHEN i.index_meta_initialized_at IS NOT NULL THEN 'INITIALIZED'
            WHEN i.index_meta_id IS NOT NULL
             AND i.index_meta_correlation_id IS NOT NULL
             AND j.state = 'PENDING'
             AND j.desired_state = 'RUNNING'
             AND o.prepared_at IS NULL
             AND o.published_at IS NULL
             AND o.authority_granted_at IS NULL
             AND o.retired_at IS NULL
                THEN 'PENDING'
            ELSE 'QUARANTINED'
        END,
    index_meta_initialization_attempt_count = 0,
    index_meta_initialization_next_attempt_at =
        CASE
            WHEN i.index_meta_initialized_at IS NULL
             AND i.index_meta_id IS NOT NULL
             AND i.index_meta_correlation_id IS NOT NULL
             AND j.state = 'PENDING'
             AND j.desired_state = 'RUNNING'
             AND o.prepared_at IS NULL
             AND o.published_at IS NULL
             AND o.authority_granted_at IS NULL
             AND o.retired_at IS NULL
                THEN j.admitted_at
            ELSE NULL
        END,
    index_meta_initialization_last_error_code =
        CASE
            WHEN i.index_meta_initialized_at IS NULL
             AND NOT (
                 i.index_meta_id IS NOT NULL
                 AND i.index_meta_correlation_id IS NOT NULL
                 AND j.state = 'PENDING'
                 AND j.desired_state = 'RUNNING'
                 AND o.prepared_at IS NULL
                 AND o.published_at IS NULL
                 AND o.authority_granted_at IS NULL
                 AND o.retired_at IS NULL
             )
                THEN 'UNSAFE_PRE_RECOVERY_ADMISSION'
            ELSE NULL
        END,
    index_meta_initialization_resolved_at = i.index_meta_initialized_at,
    index_meta_initialization_failed_at =
        CASE
            WHEN i.index_meta_initialized_at IS NULL
             AND NOT (
                 i.index_meta_id IS NOT NULL
                 AND i.index_meta_correlation_id IS NOT NULL
                 AND j.state = 'PENDING'
                 AND j.desired_state = 'RUNNING'
                 AND o.prepared_at IS NULL
                 AND o.published_at IS NULL
                 AND o.authority_granted_at IS NULL
                 AND o.retired_at IS NULL
             )
                THEN clock_timestamp()
            ELSE NULL
        END
FROM elitea_runtime.execution_jobs AS j,
     elitea_runtime.command_outbox AS o
WHERE j.execution_id = i.execution_id
  AND j.generation = i.generation
  AND j.capability_id = i.capability_id
  AND o.execution_id = i.execution_id
  AND o.generation = i.generation;

-- A pre-authority row that cannot be reconstructed must not remain an active
-- target forever. Terminalize only active executions with no authority;
-- existing terminal and post-authority history remains unchanged. The outbox
-- is retired in the same migration transaction, so no quarantined command can
-- become newly visible.
UPDATE elitea_runtime.execution_jobs AS j
SET state = 'QUARANTINED',
    desired_state = 'CANCELLED',
    settled_at = COALESCE(
        j.settled_at,
        date_trunc('milliseconds', clock_timestamp())
    )
FROM elitea_runtime.index_ingest_jobs AS i,
     elitea_runtime.command_outbox AS o
WHERE i.execution_id = j.execution_id
  AND i.generation = j.generation
  AND i.index_meta_initialization_status = 'QUARANTINED'
  AND o.execution_id = j.execution_id
  AND o.generation = j.generation
  AND o.authority_granted_at IS NULL
  AND j.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING');

-- Authority-granted work may already have external effects. Request
-- cancellation, but do not retire its outbox, synthesize a failure, or claim
-- that it was safely terminalized before the worker settles it.
UPDATE elitea_runtime.execution_jobs AS j
SET desired_state = 'CANCELLED'
FROM elitea_runtime.index_ingest_jobs AS i,
     elitea_runtime.command_outbox AS o
WHERE i.execution_id = j.execution_id
  AND i.generation = j.generation
  AND i.index_meta_initialization_status = 'QUARANTINED'
  AND o.execution_id = j.execution_id
  AND o.generation = j.generation
  AND o.authority_granted_at IS NOT NULL
  AND j.state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING');

UPDATE elitea_runtime.command_outbox AS o
SET retired_at = COALESCE(
        o.retired_at,
        date_trunc('milliseconds', clock_timestamp())
    ),
    retirement_code = COALESCE(o.retirement_code, 'CANCELLED')
FROM elitea_runtime.index_ingest_jobs AS i
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = i.execution_id
 AND j.generation = i.generation
WHERE i.execution_id = o.execution_id
  AND i.generation = o.generation
  AND i.index_meta_initialization_status = 'QUARANTINED'
  AND j.state = 'QUARANTINED'
  AND j.desired_state = 'CANCELLED'
  AND o.authority_granted_at IS NULL;

-- Preserve a terminal browser observation for an unsafe active row that never
-- reached worker authority. The payload is fixed, bounded, non-retryable, and
-- contains no protected value or internal cause.
INSERT INTO elitea_runtime.execution_replay_events (
    event_id, execution_id, generation, projection_project_id,
    event_type, event_bytes, event_digest
)
SELECT 'index-meta-initialization-quarantine:' || o.outbox_id,
       i.execution_id,
       i.generation,
       j.projection_project_id,
       'execution.failed',
       convert_to(
           '{"code":"INTERNAL","safe_message":"The runtime operation failed.","retryable":false}',
           'UTF8'
       ),
       decode(
           '56beddb414e183b1cece7ebc123a2e48f97a523477ee4cfce8275dd682ddc0ae',
           'hex'
       )
FROM elitea_runtime.index_ingest_jobs AS i
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = i.execution_id
 AND j.generation = i.generation
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = i.execution_id
 AND o.generation = i.generation
WHERE i.index_meta_initialization_status = 'QUARANTINED'
  AND j.state = 'QUARANTINED'
  AND j.desired_state = 'CANCELLED'
  AND o.retired_at IS NOT NULL
  AND o.authority_granted_at IS NULL
  AND NOT EXISTS (
      SELECT 1
      FROM elitea_runtime.execution_replay_events AS r
      WHERE r.execution_id = i.execution_id
        AND r.generation = i.generation
        AND r.event_type IN (
            'execution.failed',
            'index.ingest.completed',
            'configuration.validation.completed'
        )
  );

ALTER TABLE elitea_runtime.index_ingest_jobs
    ALTER COLUMN index_meta_initialization_status SET NOT NULL,
    ALTER COLUMN index_meta_initialization_attempt_count SET NOT NULL,
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_status CHECK (
        index_meta_initialization_status IN (
            'PENDING', 'RUNNING', 'INITIALIZED', 'QUARANTINED'
        )
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_attempts CHECK (
        index_meta_initialization_attempt_count >= 0
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_claim_pair CHECK (
        num_nonnulls(
            index_meta_initialization_claim_token,
            index_meta_initialization_claim_expires_at
        ) IN (0, 2)
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_claim_bounds CHECK (
        index_meta_initialization_claim_token IS NULL
        OR octet_length(index_meta_initialization_claim_token)
            BETWEEN 1 AND 256
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_error_bounds CHECK (
        index_meta_initialization_last_error_code IS NULL
        OR octet_length(index_meta_initialization_last_error_code)
            BETWEEN 1 AND 128
    ),
    ADD CONSTRAINT index_ingest_jobs_meta_initialization_shape CHECK (
        (
            index_meta_initialization_status = 'PENDING'
            AND index_meta_initialized_at IS NULL
            AND index_meta_initialization_claim_token IS NULL
            AND index_meta_initialization_claim_expires_at IS NULL
            AND index_meta_initialization_next_attempt_at IS NOT NULL
            AND index_meta_initialization_resolved_at IS NULL
            AND index_meta_initialization_failed_at IS NULL
        )
        OR
        (
            index_meta_initialization_status = 'RUNNING'
            AND index_meta_initialized_at IS NULL
            AND index_meta_initialization_claim_token IS NOT NULL
            AND index_meta_initialization_claim_expires_at IS NOT NULL
            AND index_meta_initialization_next_attempt_at IS NULL
            AND index_meta_initialization_resolved_at IS NULL
            AND index_meta_initialization_failed_at IS NULL
        )
        OR
        (
            index_meta_initialization_status = 'INITIALIZED'
            AND index_meta_initialized_at IS NOT NULL
            AND index_meta_initialization_claim_token IS NULL
            AND index_meta_initialization_claim_expires_at IS NULL
            AND index_meta_initialization_next_attempt_at IS NULL
            AND index_meta_initialization_last_error_code IS NULL
            AND index_meta_initialization_resolved_at
                = index_meta_initialized_at
            AND index_meta_initialization_failed_at IS NULL
        )
        OR
        (
            index_meta_initialization_status = 'QUARANTINED'
            AND index_meta_initialized_at IS NULL
            AND index_meta_initialization_claim_token IS NULL
            AND index_meta_initialization_claim_expires_at IS NULL
            AND index_meta_initialization_next_attempt_at IS NULL
            AND index_meta_initialization_last_error_code IS NOT NULL
            AND index_meta_initialization_resolved_at IS NULL
            AND index_meta_initialization_failed_at IS NOT NULL
        )
    );

CREATE INDEX index_ingest_jobs_meta_initialization_pending_idx
    ON elitea_runtime.index_ingest_jobs (
        index_meta_initialization_next_attempt_at,
        execution_id,
        generation
    )
    WHERE index_meta_initialized_at IS NULL
      AND index_meta_initialization_status = 'PENDING';

CREATE INDEX index_ingest_jobs_meta_initialization_lease_idx
    ON elitea_runtime.index_ingest_jobs (
        index_meta_initialization_claim_expires_at,
        execution_id,
        generation
    )
    WHERE index_meta_initialized_at IS NULL
      AND index_meta_initialization_status = 'RUNNING';
