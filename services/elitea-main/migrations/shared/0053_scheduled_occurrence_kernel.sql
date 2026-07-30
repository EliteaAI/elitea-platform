CREATE TABLE elitea_runtime.scheduled_job_cursors (
    job_id TEXT PRIMARY KEY,
    schedule_revision TEXT NOT NULL,
    observed_through TIMESTAMPTZ NOT NULL,
    lease_owner TEXT,
    lease_epoch BIGINT NOT NULL DEFAULT 0,
    claim_fence BYTEA,
    lease_expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT scheduled_job_cursors_job_id_length
        CHECK (octet_length(job_id) BETWEEN 1 AND 128),
    CONSTRAINT scheduled_job_cursors_revision_length
        CHECK (octet_length(schedule_revision) BETWEEN 1 AND 128),
    CONSTRAINT scheduled_job_cursors_lease_epoch
        CHECK (lease_epoch >= 0),
    CONSTRAINT scheduled_job_cursors_lease_shape CHECK (
        (
            lease_owner IS NULL
            AND claim_fence IS NULL
            AND lease_expires_at IS NULL
        )
        OR
        (
            lease_owner IS NOT NULL
            AND octet_length(lease_owner) BETWEEN 1 AND 128
            AND claim_fence IS NOT NULL
            AND octet_length(claim_fence) = 32
            AND lease_expires_at IS NOT NULL
            AND lease_epoch > 0
        )
    )
);

CREATE TABLE elitea_runtime.scheduled_occurrences (
    invocation_id TEXT PRIMARY KEY,
    job_id TEXT NOT NULL,
    schedule_revision TEXT NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    outcome_mode TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    next_attempt_at TIMESTAMPTZ NOT NULL,
    lease_owner TEXT,
    lease_epoch BIGINT NOT NULL DEFAULT 0,
    claim_fence BYTEA,
    lease_expires_at TIMESTAMPTZ,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    outcome TEXT,
    admitted_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (job_id, schedule_revision, due_at),
    CONSTRAINT scheduled_occurrences_invocation_id
        CHECK (invocation_id ~ '^[0-9a-f]{64}$'),
    CONSTRAINT scheduled_occurrences_job_id_length
        CHECK (octet_length(job_id) BETWEEN 1 AND 128),
    CONSTRAINT scheduled_occurrences_revision_length
        CHECK (octet_length(schedule_revision) BETWEEN 1 AND 128),
    CONSTRAINT scheduled_occurrences_mode
        CHECK (outcome_mode IN ('local_bounded', 'durable_admission')),
    CONSTRAINT scheduled_occurrences_state
        CHECK (state IN ('PENDING', 'COMPLETED', 'SUPERSEDED')),
    CONSTRAINT scheduled_occurrences_lease_epoch
        CHECK (lease_epoch >= 0),
    CONSTRAINT scheduled_occurrences_attempt_count
        CHECK (attempt_count >= 0),
    CONSTRAINT scheduled_occurrences_last_error_code_length
        CHECK (
            last_error_code IS NULL
            OR octet_length(last_error_code) BETWEEN 1 AND 64
        ),
    CONSTRAINT scheduled_occurrences_lease_shape CHECK (
        (
            lease_owner IS NULL
            AND claim_fence IS NULL
            AND lease_expires_at IS NULL
        )
        OR
        (
            lease_owner IS NOT NULL
            AND octet_length(lease_owner) BETWEEN 1 AND 128
            AND claim_fence IS NOT NULL
            AND octet_length(claim_fence) = 32
            AND lease_expires_at IS NOT NULL
            AND lease_epoch > 0
        )
    ),
    CONSTRAINT scheduled_occurrences_terminal_shape CHECK (
        (
            state = 'PENDING'
            AND outcome IS NULL
            AND admitted_at IS NULL
            AND completed_at IS NULL
        )
        OR
        (
            state = 'COMPLETED'
            AND outcome IN ('local_completed', 'durably_admitted')
            AND completed_at IS NOT NULL
            AND (
                (outcome = 'local_completed' AND admitted_at IS NULL)
                OR
                (outcome = 'durably_admitted' AND admitted_at IS NOT NULL)
            )
        )
        OR
        (
            state = 'SUPERSEDED'
            AND outcome IS NULL
            AND admitted_at IS NULL
            AND completed_at IS NOT NULL
        )
    )
);

CREATE INDEX scheduled_occurrences_claimable_idx
    ON elitea_runtime.scheduled_occurrences (
        job_id, schedule_revision, state,
        next_attempt_at, lease_expires_at, due_at, invocation_id
    )
    INCLUDE (outcome_mode, lease_epoch)
    WHERE state = 'PENDING';

CREATE INDEX scheduled_occurrences_job_history_idx
    ON elitea_runtime.scheduled_occurrences (
        job_id, schedule_revision, due_at DESC, invocation_id
    );
