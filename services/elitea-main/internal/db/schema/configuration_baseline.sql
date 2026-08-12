-- SQLC compiler projection for the current EliteA tenant configuration table.
--
-- This file is NOT a runtime migration. The tables already exist in each
-- p_<project_id> schema and are owned by the current platform migrations. Keep
-- this projection aligned with the current SQLAlchemy models before extending
-- configuration queries.

CREATE TABLE configuration (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    project_id integer NOT NULL,
    label varchar,
    elitea_title varchar NOT NULL UNIQUE,
    type varchar NOT NULL,
    section varchar NOT NULL,
    data jsonb NOT NULL,
    meta jsonb NOT NULL,
    shared boolean NOT NULL,
    status_ok boolean NOT NULL,
    status_logs text,
    source varchar NOT NULL,
    author_id integer,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp
);
