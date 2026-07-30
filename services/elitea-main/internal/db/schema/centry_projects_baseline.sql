-- SQLC compiler input for the current-baseline centry project tables.
--
-- This file is NOT a runtime migration. It mirrors the populated schema used
-- by the current Projects plugin so typed read queries can be generated during
-- incremental route ownership transfer.

CREATE SCHEMA centry;

CREATE TABLE centry.project (
    id serial PRIMARY KEY,
    name varchar(256) NOT NULL,
    owner_id integer NOT NULL,
    secrets_json json,
    plugins text[],
    keycloak_groups json NOT NULL,
    create_success boolean NOT NULL,
    suspended boolean NOT NULL DEFAULT false
);

CREATE TABLE centry.project_group (
    id serial PRIMARY KEY,
    name varchar(256) NOT NULL UNIQUE
);

CREATE TABLE centry.project_group_association (
    project_id integer
        REFERENCES centry.project (id)
        ON DELETE CASCADE,
    group_id integer
        REFERENCES centry.project_group (id)
        ON DELETE CASCADE
);

CREATE TABLE centry.social_pins (
    id serial PRIMARY KEY,
    entity varchar NOT NULL,
    user_id integer NOT NULL,
    project_id integer,
    entity_id integer NOT NULL,
    created_at timestamp NOT NULL DEFAULT now(),
    updated_at timestamp NOT NULL DEFAULT now(),
    UNIQUE (entity, project_id, entity_id)
);
