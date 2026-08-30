-- Native ADK-Rust 2.0.0 session persistence for direct LLM agents and the
-- conversation side of graph agents. Workflow frontier/state remains in the
-- separate agent_graph_checkpoints lineage.
--
-- Writer rows survive session deletion. They are the stale-claim fence: an
-- older worker must not regain a conversation after its durable events are
-- erased or compacted.
-- This history runs against the separate agentstate database. The legacy
-- LangGraph tables remain untouched in public; native ADK state is isolated in
-- elitea_runtime and therefore cannot carry cross-database centry.project FKs.
CREATE SCHEMA IF NOT EXISTS elitea_runtime;

CREATE TABLE elitea_runtime.agent_session_writers (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    session_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    thread_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    writer_claim_id TEXT NOT NULL,
    writer_execution_id TEXT NOT NULL,
    writer_generation BIGINT NOT NULL,
    writer_claim_attempt BIGINT NOT NULL,
    writer_lease_epoch BIGINT NOT NULL,
    writer_claimed_at TIMESTAMPTZ NOT NULL,
    next_event_ordinal BIGINT NOT NULL DEFAULT 1,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ),
    CONSTRAINT agent_session_writers_capability CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
    ),
    CONSTRAINT agent_session_writers_family CHECK (
        session_family = 'adk-session.2.0.0.v1'
    ),
    CONSTRAINT agent_session_writers_definition CHECK (
        octet_length(definition_digest) = 32
    ),
    CONSTRAINT agent_session_writers_identity CHECK (
        octet_length(tenant_id) BETWEEN 1 AND 256
        AND resource_project_id > 0
        AND projection_project_id > 0
        AND octet_length(thread_id) BETWEEN 1 AND 512
        AND octet_length(app_name) BETWEEN 1 AND 256
        AND octet_length(user_id) BETWEEN 1 AND 256
        AND octet_length(session_id) BETWEEN 1 AND 256
        AND octet_length(writer_claim_id) BETWEEN 1 AND 256
        AND octet_length(writer_execution_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_session_writers_counters CHECK (
        writer_generation > 0
        AND writer_claim_attempt > 0
        AND writer_lease_epoch > 0
        AND next_event_ordinal > 0
    ),
    CONSTRAINT agent_session_writers_times CHECK (
        isfinite(writer_claimed_at) AND isfinite(activated_at)
    )
);

CREATE TABLE elitea_runtime.agent_session_app_states (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    session_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    app_name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, app_name
    ),
    CONSTRAINT agent_session_app_state_scope CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
        AND session_family = 'adk-session.2.0.0.v1'
        AND octet_length(definition_digest) = 32
        AND octet_length(tenant_id) BETWEEN 1 AND 256
        AND resource_project_id > 0
        AND projection_project_id > 0
        AND octet_length(app_name) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_session_app_state_shape CHECK (
        state IS JSON OBJECT WITH UNIQUE KEYS
    ),
    CONSTRAINT agent_session_app_state_size CHECK (
        octet_length(state) BETWEEN 2 AND 1048576
    ),
    CONSTRAINT agent_session_app_state_time CHECK (isfinite(updated_at))
);

CREATE TABLE elitea_runtime.agent_session_user_states (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    session_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, app_name, user_id
    ),
    CONSTRAINT agent_session_user_state_scope CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
        AND session_family = 'adk-session.2.0.0.v1'
        AND octet_length(definition_digest) = 32
        AND octet_length(tenant_id) BETWEEN 1 AND 256
        AND resource_project_id > 0
        AND projection_project_id > 0
        AND octet_length(app_name) BETWEEN 1 AND 256
        AND octet_length(user_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_session_user_state_shape CHECK (
        state IS JSON OBJECT WITH UNIQUE KEYS
    ),
    CONSTRAINT agent_session_user_state_size CHECK (
        octet_length(state) BETWEEN 2 AND 1048576
    ),
    CONSTRAINT agent_session_user_state_time CHECK (isfinite(updated_at))
);

CREATE TABLE elitea_runtime.agent_sessions (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    session_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    thread_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ),
    FOREIGN KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ) REFERENCES elitea_runtime.agent_session_writers (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ) ON DELETE CASCADE,
    CONSTRAINT agent_sessions_state_shape CHECK (
        state IS JSON OBJECT WITH UNIQUE KEYS
    ),
    CONSTRAINT agent_sessions_state_size CHECK (
        octet_length(state) BETWEEN 2 AND 1048576
    ),
    CONSTRAINT agent_sessions_times CHECK (
        isfinite(created_at) AND isfinite(updated_at)
    )
);

CREATE TABLE elitea_runtime.agent_session_events (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    session_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    thread_id TEXT NOT NULL,
    app_name TEXT NOT NULL,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    event_id TEXT NOT NULL,
    event_ordinal BIGINT NOT NULL,
    event_timestamp TIMESTAMPTZ NOT NULL,
    event_payload TEXT NOT NULL,
    payload_bytes BIGINT GENERATED ALWAYS AS (
        octet_length(event_payload)
    ) STORED,
    writer_claim_id TEXT NOT NULL,
    writer_execution_id TEXT NOT NULL,
    writer_generation BIGINT NOT NULL,
    writer_claim_attempt BIGINT NOT NULL,
    writer_lease_epoch BIGINT NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id, event_id
    ),
    FOREIGN KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ) REFERENCES elitea_runtime.agent_sessions (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id
    ) ON DELETE CASCADE,
    UNIQUE (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id, event_ordinal
    ),
    CONSTRAINT agent_session_events_identity CHECK (
        octet_length(event_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_session_events_shape CHECK (
        event_payload IS JSON OBJECT WITH UNIQUE KEYS
    ),
    CONSTRAINT agent_session_events_size CHECK (
        octet_length(event_payload) BETWEEN 2 AND 2097152
        AND payload_bytes BETWEEN 2 AND 2097152
    ),
    CONSTRAINT agent_session_events_counters CHECK (
        event_ordinal > 0
        AND writer_generation > 0
        AND writer_claim_attempt > 0
        AND writer_lease_epoch > 0
    ),
    CONSTRAINT agent_session_events_times CHECK (
        isfinite(event_timestamp) AND isfinite(stored_at)
    )
);

CREATE INDEX agent_session_events_order_idx
    ON elitea_runtime.agent_session_events (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        session_family, definition_digest, thread_id, app_name, user_id,
        session_id, event_ordinal DESC
    );

CREATE INDEX agent_session_events_writer_audit_idx
    ON elitea_runtime.agent_session_events (
        writer_execution_id, writer_generation, writer_claim_id
    );
