-- SQLC compiler projection for the current EliteA tenant toolkit table.
--
-- This file is NOT a runtime migration. The table already exists in each
-- p_<project_id> schema and is owned by the current tenant-schema lifecycle.
-- Keep this projection aligned with EliteATool and the deployed PostgreSQL
-- shape.

CREATE TABLE elitea_tools (
    id serial PRIMARY KEY,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp,
    type varchar NOT NULL,
    name varchar(128),
    description varchar(1024),
    settings jsonb NOT NULL,
    author_id integer NOT NULL,
    shared_owner_id integer,
    shared_id integer,
    meta jsonb NOT NULL
);
