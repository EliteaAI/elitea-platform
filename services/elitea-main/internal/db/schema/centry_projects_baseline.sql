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

-- Quota ceilings and usage counters, as the deployed legacy table declares
-- them (\d centry.project_quota / \d centry.statistic). The uniqueness the
-- reference model omits is NOT projected here: this file is the CURRENT
-- baseline, and the quota handler has to behave correctly against a
-- dump-loaded table that does not have it. See
-- migrations/shared/0062_budgets_quota_statistics.sql, which adds it going
-- forward.
CREATE TABLE centry.project_quota (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    data_retention_limit integer,
    test_duration_limit integer DEFAULT -1,
    cpu_limit integer DEFAULT -1,
    memory_limit integer DEFAULT -1,
    last_update_time timestamp DEFAULT (now() AT TIME ZONE 'utc'),
    dast_scans integer DEFAULT -1,
    sast_scans integer DEFAULT -1,
    vcu_hard_limit integer,
    vcu_soft_limit integer,
    vcu_limit_total_block boolean NOT NULL DEFAULT false,
    storage_hard_limit integer,
    storage_soft_limit integer,
    storage_limit_total_block boolean NOT NULL DEFAULT false
);

CREATE TABLE centry.statistic (
    id serial PRIMARY KEY,
    project_id integer NOT NULL,
    start_time timestamp DEFAULT (now() AT TIME ZONE 'utc'),
    vuh_used integer DEFAULT 0,
    performance_test_runs integer DEFAULT 0,
    sast_scans integer DEFAULT 0,
    dast_scans integer DEFAULT 0,
    public_pool_workers integer DEFAULT 0,
    ui_performance_test_runs integer DEFAULT 0,
    tasks_executions integer DEFAULT 0
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
