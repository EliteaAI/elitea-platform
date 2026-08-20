-- Native ADK-Rust 2.0.0 graph checkpoints use a fresh lineage. They do not
-- reuse or translate the legacy LangGraph checkpoint/blob tables.
--
-- The writer row is deliberately retained when a thread's checkpoints are
-- deleted. It is the stale-writer fence: deleting graph history must not let an
-- older, still-running claimant reacquire the thread by recreating its row.
-- This history runs against the separate agentstate database. The legacy
-- LangGraph tables remain untouched in public; native ADK state is isolated in
-- elitea_runtime and therefore cannot carry cross-database centry.project FKs.
CREATE SCHEMA IF NOT EXISTS elitea_runtime;

CREATE TABLE elitea_runtime.agent_graph_checkpoint_writers (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    checkpoint_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    thread_id TEXT NOT NULL,
    writer_claim_id TEXT NOT NULL,
    writer_execution_id TEXT NOT NULL,
    writer_generation BIGINT NOT NULL,
    writer_claim_attempt BIGINT NOT NULL,
    writer_lease_epoch BIGINT NOT NULL,
    writer_claimed_at TIMESTAMPTZ NOT NULL,
    next_save_ordinal BIGINT NOT NULL DEFAULT 1,
    activated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id
    ),
    CONSTRAINT agent_graph_checkpoint_writers_capability CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
    ),
    CONSTRAINT agent_graph_checkpoint_writers_family CHECK (
        checkpoint_family = 'adk-graph.2.0.0.v1'
    ),
    CONSTRAINT agent_graph_checkpoint_writers_definition CHECK (
        octet_length(definition_digest) = 32
    ),
    CONSTRAINT agent_graph_checkpoint_writers_identity CHECK (
        octet_length(tenant_id) BETWEEN 1 AND 256
        AND resource_project_id > 0
        AND projection_project_id > 0
        AND octet_length(thread_id) BETWEEN 1 AND 512
        AND octet_length(writer_claim_id) BETWEEN 1 AND 256
        AND octet_length(writer_execution_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_graph_checkpoint_writers_counters CHECK (
        writer_generation > 0
        AND writer_claim_attempt > 0
        AND writer_lease_epoch > 0
        AND next_save_ordinal > 0
    ),
    CONSTRAINT agent_graph_checkpoint_writers_times CHECK (
        isfinite(writer_claimed_at) AND isfinite(activated_at)
    )
);

CREATE TABLE elitea_runtime.agent_graph_checkpoints (
    tenant_id TEXT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    projection_project_id INTEGER NOT NULL,
    capability_id TEXT NOT NULL,
    checkpoint_family TEXT NOT NULL,
    definition_digest BYTEA NOT NULL,
    thread_id TEXT NOT NULL,
    checkpoint_id TEXT NOT NULL,
    state TEXT NOT NULL,
    step BIGINT NOT NULL,
    pending_nodes TEXT NOT NULL,
    metadata TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    created_at_rfc3339 TEXT NOT NULL,
    cleared_interrupt TEXT,
    attempts TEXT NOT NULL,
    child_ledger TEXT NOT NULL,
    save_ordinal BIGINT NOT NULL,
    payload_bytes BIGINT GENERATED ALWAYS AS (
        octet_length(state)
        + octet_length(pending_nodes)
        + octet_length(metadata)
        + octet_length(attempts)
        + octet_length(child_ledger)
    ) STORED,
    writer_claim_id TEXT NOT NULL,
    writer_execution_id TEXT NOT NULL,
    writer_generation BIGINT NOT NULL,
    writer_claim_attempt BIGINT NOT NULL,
    writer_lease_epoch BIGINT NOT NULL,
    stored_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id, checkpoint_id
    ),
    FOREIGN KEY (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id
    ) REFERENCES elitea_runtime.agent_graph_checkpoint_writers (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id
    ) ON DELETE CASCADE,
    UNIQUE (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id, save_ordinal
    ),
    CONSTRAINT agent_graph_checkpoints_capability CHECK (
        capability_id IN (
            'agent.execute.application.v1',
            'agent.execute.adhoc.v1'
        )
    ),
    CONSTRAINT agent_graph_checkpoints_family CHECK (
        checkpoint_family = 'adk-graph.2.0.0.v1'
    ),
    CONSTRAINT agent_graph_checkpoints_definition CHECK (
        octet_length(definition_digest) = 32
    ),
    CONSTRAINT agent_graph_checkpoints_identity CHECK (
        octet_length(tenant_id) BETWEEN 1 AND 256
        AND octet_length(thread_id) BETWEEN 1 AND 512
        AND octet_length(checkpoint_id) BETWEEN 1 AND 256
        AND octet_length(writer_claim_id) BETWEEN 1 AND 256
        AND octet_length(writer_execution_id) BETWEEN 1 AND 256
    ),
    CONSTRAINT agent_graph_checkpoints_shape CHECK (
        state IS JSON OBJECT WITH UNIQUE KEYS
        AND pending_nodes IS JSON ARRAY
        AND metadata IS JSON OBJECT WITH UNIQUE KEYS
        AND attempts IS JSON OBJECT WITH UNIQUE KEYS
        AND child_ledger IS JSON OBJECT WITH UNIQUE KEYS
    ),
    -- Bound the uncompressed JSON representation so a privileged accidental
    -- write cannot turn a later worker restore into an unbounded allocation.
    CONSTRAINT agent_graph_checkpoints_payload_size CHECK (
        octet_length(state)
        + octet_length(pending_nodes)
        + octet_length(metadata)
        + octet_length(attempts)
        + octet_length(child_ledger)
        BETWEEN 5 AND 8388608
        AND payload_bytes BETWEEN 5 AND 8388608
    ),
    CONSTRAINT agent_graph_checkpoints_frontier CHECK (
        json_array_length(pending_nodes::json) <= 4096
        AND (
            cleared_interrupt IS NULL
            OR octet_length(cleared_interrupt) BETWEEN 1 AND 512
        )
    ),
    CONSTRAINT agent_graph_checkpoints_counters CHECK (
        step >= 0
        AND save_ordinal > 0
        AND writer_generation > 0
        AND writer_claim_attempt > 0
        AND writer_lease_epoch > 0
    ),
    CONSTRAINT agent_graph_checkpoints_times CHECK (
        isfinite(created_at)
        AND octet_length(created_at_rfc3339) BETWEEN 20 AND 64
        AND isfinite(stored_at)
    )
);

-- ADK's reference backends load the most recently saved checkpoint and list in
-- append order. A writer-serialized ordinal preserves that behavior even when
-- user-visible creation timestamps tie or move backwards.
CREATE INDEX agent_graph_checkpoints_thread_order_idx
    ON elitea_runtime.agent_graph_checkpoints (
        tenant_id, resource_project_id, projection_project_id, capability_id,
        checkpoint_family, definition_digest, thread_id, save_ordinal DESC
    );

CREATE INDEX agent_graph_checkpoints_writer_audit_idx
    ON elitea_runtime.agent_graph_checkpoints (
        writer_execution_id, writer_generation, writer_claim_id
    );
