CREATE TABLE IF NOT EXISTS elitea_runtime.execution_admission_policies (
    capability_id TEXT PRIMARY KEY,
    max_outstanding BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT execution_admission_policy_capability_length
        CHECK (octet_length(capability_id) BETWEEN 1 AND 256),
    -- Keep this hard ceiling synchronized with maxSupportedOutstandingJobs.
    -- It bounds both admitted work and the active-count query performed while
    -- the capability policy row is locked.
    CONSTRAINT execution_admission_policy_max_outstanding
        CHECK (max_outstanding BETWEEN 1 AND 1024)
);

CREATE INDEX IF NOT EXISTS execution_jobs_active_capability_idx
    ON elitea_runtime.execution_jobs (capability_id)
    WHERE state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING');
