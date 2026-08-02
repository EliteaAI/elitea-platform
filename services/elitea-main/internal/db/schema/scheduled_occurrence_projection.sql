-- SQLC compiler projection for the post-0053 capability-neutral scheduler
-- ledger. This file is not a runtime migration; the embedded shared migration
-- history remains the only target-schema authority.

CREATE TABLE elitea_runtime.scheduled_job_cursors (
    job_id text PRIMARY KEY,
    schedule_revision text NOT NULL,
    observed_through timestamptz NOT NULL,
    lease_owner text,
    lease_epoch bigint NOT NULL,
    claim_fence bytea,
    lease_expires_at timestamptz,
    updated_at timestamptz NOT NULL
);

CREATE TABLE elitea_runtime.scheduled_occurrences (
    invocation_id text PRIMARY KEY,
    job_id text NOT NULL,
    schedule_revision text NOT NULL,
    due_at timestamptz NOT NULL,
    outcome_mode text NOT NULL,
    state text NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    lease_owner text,
    lease_epoch bigint NOT NULL,
    claim_fence bytea,
    lease_expires_at timestamptz,
    attempt_count integer NOT NULL,
    outcome text,
    admitted_at timestamptz,
    completed_at timestamptz,
    last_error_code text,
    created_at timestamptz NOT NULL,
    updated_at timestamptz NOT NULL,
    UNIQUE (job_id, schedule_revision, due_at)
);
