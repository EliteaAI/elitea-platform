-- SQLC compiler projection for the current EliteA tenant application-version
-- table.
--
-- This file is NOT a runtime migration. The table already exists in each
-- p_<project_id> schema and is owned by the current tenant-schema lifecycle.
-- Keep this projection aligned with the deployed PostgreSQL shape.

CREATE TABLE application_versions (
    id serial PRIMARY KEY,
    application_id integer NOT NULL,
    name varchar(128) NOT NULL,
    status varchar NOT NULL,
    author_id integer NOT NULL,
    uuid uuid NOT NULL UNIQUE,
    created_at timestamp NOT NULL DEFAULT now(),
    shared_owner_id integer,
    shared_id integer,
    llm_settings json NOT NULL,
    instructions varchar,
    conversation_starters json NOT NULL,
    welcome_message varchar NOT NULL,
    agent_type varchar NOT NULL,
    meta jsonb NOT NULL,
    pipeline_settings jsonb NOT NULL,
    UNIQUE (application_id, name),
    UNIQUE (shared_owner_id, shared_id)
);
