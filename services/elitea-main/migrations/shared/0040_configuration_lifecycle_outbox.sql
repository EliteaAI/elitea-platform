CREATE TABLE IF NOT EXISTS elitea_runtime.configuration_lifecycle_outbox (
    event_id UUID PRIMARY KEY,
    resource_project_id INTEGER NOT NULL,
    configuration_uuid UUID NOT NULL,
    revision BIGINT NOT NULL,
    operation TEXT NOT NULL,
    actor_id INTEGER NOT NULL,
    sanitized_snapshot JSON NOT NULL,
    snapshot_digest BYTEA NOT NULL,
    state TEXT NOT NULL DEFAULT 'PENDING',
    attempt_count INTEGER NOT NULL DEFAULT 0,
    available_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    last_attempt_at TIMESTAMPTZ,
    lease_owner TEXT,
    lease_expires_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    dead_at TIMESTAMPTZ,
    last_error_code TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (resource_project_id, configuration_uuid, revision),
    CONSTRAINT configuration_lifecycle_outbox_project
        CHECK (resource_project_id > 0),
    CONSTRAINT configuration_lifecycle_outbox_revision
        CHECK (revision > 0),
    CONSTRAINT configuration_lifecycle_outbox_operation
        CHECK (operation IN (
            'configuration_created',
            'configuration_updated',
            'configuration_deleted'
        )),
    CONSTRAINT configuration_lifecycle_outbox_actor
        CHECK (actor_id > 0),
    CONSTRAINT configuration_lifecycle_outbox_snapshot
        CHECK (
            json_typeof(sanitized_snapshot) = 'object'
            AND octet_length(sanitized_snapshot::text) BETWEEN 2 AND 2097152
            AND octet_length(snapshot_digest) = 32
        ),
    CONSTRAINT configuration_lifecycle_outbox_state
        CHECK (state IN ('PENDING', 'PROCESSING', 'RETRY', 'DELIVERED', 'DEAD')),
    CONSTRAINT configuration_lifecycle_outbox_attempts
        CHECK (attempt_count BETWEEN 0 AND 1000),
    CONSTRAINT configuration_lifecycle_outbox_lease_owner
        CHECK (
            lease_owner IS NULL
            OR (
                octet_length(lease_owner) BETWEEN 1 AND 128
                AND lease_owner ~ '^[A-Za-z0-9._:-]+$'
            )
        ),
    CONSTRAINT configuration_lifecycle_outbox_error_code
        CHECK (
            last_error_code IS NULL
            OR (
                octet_length(last_error_code) BETWEEN 1 AND 128
                AND last_error_code ~ '^[A-Z0-9_]+$'
            )
        ),
    CONSTRAINT configuration_lifecycle_outbox_processing_state
        CHECK (
            (state = 'PROCESSING') =
            (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
            AND (
                state <> 'PROCESSING'
                OR (
                    attempt_count > 0
                    AND last_attempt_at IS NOT NULL
                    AND lease_expires_at > last_attempt_at
                )
            )
        ),
    CONSTRAINT configuration_lifecycle_outbox_terminal_state
        CHECK (
            (state = 'DELIVERED') = (delivered_at IS NOT NULL)
            AND (state = 'DEAD') = (dead_at IS NOT NULL)
            AND NOT (delivered_at IS NOT NULL AND dead_at IS NOT NULL)
            AND (
                state NOT IN ('DELIVERED', 'DEAD')
                OR (lease_owner IS NULL AND lease_expires_at IS NULL)
            )
            AND (state <> 'DEAD' OR last_error_code IS NOT NULL)
        ),
    CONSTRAINT configuration_lifecycle_outbox_retry_state
        CHECK (
            (
                state = 'PENDING'
                AND attempt_count = 0
                AND last_attempt_at IS NULL
                AND last_error_code IS NULL
            )
            OR (
                state <> 'PENDING'
                AND attempt_count > 0
                AND last_attempt_at IS NOT NULL
            )
        ),
    CONSTRAINT configuration_lifecycle_outbox_retry_error
        CHECK (
            state <> 'RETRY'
            OR (
                attempt_count > 0
                AND last_attempt_at IS NOT NULL
                AND last_error_code IS NOT NULL
            )
        ),
    CONSTRAINT configuration_lifecycle_outbox_timestamps
        CHECK (
            updated_at >= created_at
            AND (last_attempt_at IS NULL OR last_attempt_at >= created_at)
            AND (delivered_at IS NULL OR delivered_at >= created_at)
            AND (dead_at IS NULL OR dead_at >= created_at)
        )
);

CREATE INDEX IF NOT EXISTS configuration_lifecycle_outbox_ready_idx
    ON elitea_runtime.configuration_lifecycle_outbox (
        available_at, created_at, event_id
    )
    INCLUDE (resource_project_id, configuration_uuid, revision, operation, actor_id)
    WHERE state IN ('PENDING', 'RETRY');

CREATE INDEX IF NOT EXISTS configuration_lifecycle_outbox_lease_expiry_idx
    ON elitea_runtime.configuration_lifecycle_outbox (lease_expires_at, event_id)
    INCLUDE (resource_project_id, configuration_uuid, revision)
    WHERE state = 'PROCESSING';
