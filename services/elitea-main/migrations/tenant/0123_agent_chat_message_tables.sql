-- Give the agent-execution chat tables an owner in this repository.
--
-- internal/db/queries/{agent_chat,agent_cancel}.sql reference these three
-- tables 13 times, and until now no migration created any of them.
-- internal/db/schema/agent_chat_baseline.sql declares them for the sqlc
-- compiler and says why it is not a migration: "These tables already exist in
-- each p_<project_id> schema and remain owned by the current tenant-schema
-- lifecycle." That lifecycle is pylon's. The assumption holds in
-- deploy/centry-hybrid, which still runs pylon_main; it does not hold in a
-- deployment built to drop pylon, where an authenticated agent turn fails with
-- `relation "chat_messages_text" does not exist` (SQLSTATE 42P01) before it
-- can dispatch. See #287.
--
-- Every statement is IF NOT EXISTS because in a mixed deployment pylon has
-- already created these tables and owns their shape: there this migration must
-- record itself and change nothing. It becomes the definition only where
-- nothing else defines them.
--
-- The column list mirrors agent_chat_baseline.sql exactly, with one correction
-- the projection could not express: chat_message_trace_step.id is declared
-- there as a bare `bigint PRIMARY KEY`, but repos/agent_trace.go inserts a
-- trace step WITHOUT supplying an id, so the column must carry a default. The
-- integration fixtures that exercise that insert use BIGSERIAL
-- (index_activity_postgres_integration_test.go:553,
-- messagetraces_postgres_integration_test.go:174); a projection has no reason
-- to record a default, so sqlc's view dropped it.

-- One row per text message item. Shares chat_message_items' primary key rather
-- than carrying its own, which is what makes the item's type discriminator and
-- its payload impossible to disagree.
CREATE TABLE IF NOT EXISTS chat_messages_text (
    id integer PRIMARY KEY REFERENCES chat_message_items(id) ON DELETE CASCADE,
    content text NOT NULL
);

-- Same 1:1 shape for context items (support-assistant context and friends).
-- context_type is nullable: the adhoc resolver treats a NULL type as "not a
-- support_assistant_context" and refuses the turn on it, so the column has to
-- be able to hold that state rather than defaulting to something plausible.
CREATE TABLE IF NOT EXISTS chat_messages_context (
    context_data jsonb NOT NULL,
    context_type text,
    id integer PRIMARY KEY REFERENCES chat_message_items(id) ON DELETE CASCADE
);

-- Execution-step drill-down (#277). Written by repos/agent_trace.go as the
-- worker streams node events, read by the message-traces API, and deleted
-- wholesale per message group on regeneration.
CREATE TABLE IF NOT EXISTS chat_message_trace_step (
    id bigserial PRIMARY KEY,
    message_group_id integer NOT NULL REFERENCES chat_message_group(id) ON DELETE CASCADE,
    kind text NOT NULL,
    run_id text,
    parent_agent_name text,
    parent_agent_call_id text,
    started_at timestamptz,
    finished_at timestamptz,
    is_error boolean NOT NULL DEFAULT FALSE,
    has_visible_content boolean NOT NULL DEFAULT TRUE,
    tool_name text,
    tool_inputs jsonb,
    tool_output text,
    finish_reason text,
    step_type text,
    text text,
    thinking text,
    model_name text,
    attrs jsonb
);

-- PostgreSQL does not index a referencing column for you. Every access path in
-- the query set is by message group — the trace read, the FOR UPDATE lock and
-- the regeneration DELETE — so without this each one degrades to a sequential
-- scan over the project's whole trace history as conversations accumulate.
CREATE INDEX IF NOT EXISTS chat_message_trace_step_message_group_id_idx
    ON chat_message_trace_step (message_group_id, id);
