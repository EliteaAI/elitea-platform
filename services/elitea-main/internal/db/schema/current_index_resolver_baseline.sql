-- SQLC compiler projection for the current EliteA tenant tables read by the
-- fixed GitHub indexing resolver.
--
-- This file is NOT a runtime migration. The tables already exist in each
-- p_<project_id> schema and are owned by the current platform migrations. Keep
-- this projection aligned with the current SQLAlchemy models before extending
-- resolver queries.

CREATE TABLE elitea_tools (
    id serial PRIMARY KEY,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    type varchar NOT NULL,
    name varchar(128),
    description varchar(1024),
    settings jsonb NOT NULL DEFAULT '{}'::jsonb,
    author_id integer NOT NULL DEFAULT 0,
    shared_owner_id integer,
    shared_id integer,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE configuration (
    id serial PRIMARY KEY,
    uuid uuid NOT NULL UNIQUE,
    project_id integer NOT NULL,
    label varchar,
    elitea_title varchar NOT NULL UNIQUE,
    type varchar NOT NULL,
    section varchar NOT NULL,
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    meta jsonb NOT NULL DEFAULT '{}'::jsonb,
    shared boolean NOT NULL DEFAULT false,
    status_ok boolean NOT NULL DEFAULT false,
    status_logs text,
    source varchar NOT NULL DEFAULT 'user',
    author_id integer,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp
);
