-- SQLC compiler projection for the current EliteA tenant chat tables used by
-- the first direct agent-execution slice.
--
-- This file is NOT a runtime migration. These tables already exist in each
-- p_<project_id> schema and remain owned by the current tenant-schema lifecycle.
-- Keep this projection aligned with the deployed PostgreSQL shape.

CREATE TABLE chat_conversations (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    name varchar NOT NULL,
    is_private boolean NOT NULL DEFAULT TRUE,
    author_id integer NOT NULL,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    source varchar(64) NOT NULL DEFAULT 'elitea',
    instructions varchar,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp
);

CREATE TABLE chat_participants (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    entity_name varchar NOT NULL,
    entity_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    meta json NOT NULL DEFAULT '{}'::json
);

CREATE TABLE chat_participant_mapping (
    id serial PRIMARY KEY,
    conversation_id integer NOT NULL REFERENCES chat_conversations(id),
    participant_id integer NOT NULL REFERENCES chat_participants(id),
    entity_settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    UNIQUE (participant_id, conversation_id)
);

CREATE TABLE chat_message_group (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    author_participant_id integer NOT NULL REFERENCES chat_participants(id),
    conversation_id integer NOT NULL REFERENCES chat_conversations(id),
    sent_to_id integer REFERENCES chat_participants(id),
    reply_to_id integer REFERENCES chat_message_group(id),
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    is_streaming boolean NOT NULL DEFAULT FALSE,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    task_id varchar(64)
);

CREATE TABLE chat_message_items (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    item_type varchar(50) NOT NULL,
    order_index integer NOT NULL,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    message_group_id integer NOT NULL REFERENCES chat_message_group(id)
);

CREATE TABLE chat_messages_text (
    id integer PRIMARY KEY REFERENCES chat_message_items(id),
    content text NOT NULL
);

-- Current application/tool ownership projection used only to keep admission
-- queries type-checked. The tenant schema lifecycle continues to own this
-- already-existing table; this compiler input is not a migration.
CREATE TABLE entity_tool_mapping (
    id serial PRIMARY KEY,
    tool_id integer NOT NULL,
    entity_id integer NOT NULL,
    entity_version_id integer NOT NULL,
    entity_type varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    selected_tools jsonb,
    CONSTRAINT entity_tool_mapping_version_tool_type_unique
        UNIQUE (entity_version_id, tool_id, entity_type)
);
