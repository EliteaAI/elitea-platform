CREATE TABLE IF NOT EXISTS elitea_runtime.workload_sessions (
    workload_session_id TEXT PRIMARY KEY,
    workload_identity TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    CONSTRAINT workload_sessions_session_id_length
        CHECK (octet_length(workload_session_id) BETWEEN 1 AND 256),
    CONSTRAINT workload_sessions_identity_length
        CHECK (octet_length(workload_identity) BETWEEN 1 AND 512),
    CONSTRAINT workload_sessions_producer_id_length
        CHECK (octet_length(producer_id) BETWEEN 1 AND 256),
    CONSTRAINT workload_sessions_expiry_order
        CHECK (expires_at > issued_at),
    CONSTRAINT workload_sessions_revocation_order
        CHECK (revoked_at IS NULL OR revoked_at >= issued_at)
);

CREATE INDEX IF NOT EXISTS workload_sessions_active_expiry_idx
    ON elitea_runtime.workload_sessions (expires_at, workload_session_id)
    WHERE revoked_at IS NULL;
