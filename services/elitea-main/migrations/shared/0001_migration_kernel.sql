CREATE SCHEMA IF NOT EXISTS elitea_runtime;

CREATE TABLE IF NOT EXISTS centry.project_runtime_schema (
    project_id INTEGER PRIMARY KEY REFERENCES centry.project(id) ON DELETE CASCADE,
    schema_name TEXT NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT project_runtime_schema_name_format
        CHECK (schema_name ~ '^p_[1-9][0-9]*$')
);

INSERT INTO centry.project_runtime_schema (project_id, schema_name)
SELECT id, 'p_' || id::text
FROM centry.project
ON CONFLICT (project_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS elitea_runtime.schema_migrations (
    target_kind TEXT NOT NULL,
    target_id TEXT NOT NULL,
    version BIGINT NOT NULL,
    name TEXT NOT NULL,
    checksum BYTEA NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (target_kind, target_id, version),
    CONSTRAINT schema_migrations_target_kind
        CHECK (target_kind IN ('shared', 'tenant')),
    CONSTRAINT schema_migrations_checksum_length
        CHECK (octet_length(checksum) = 32)
);
