-- SQLC compiler projection for the current shared notification table.
--
-- This file is NOT a runtime migration. centry.notifications is owned by the
-- current platform schema lifecycle. The projection was verified against the
-- running current PostgreSQL schema before adding generated schedule queries.

CREATE SCHEMA IF NOT EXISTS centry;

CREATE TABLE centry.notifications (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    is_seen boolean NOT NULL,
    project_id integer NOT NULL,
    user_id integer NOT NULL,
    meta jsonb NOT NULL,
    event_type varchar NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp
);
