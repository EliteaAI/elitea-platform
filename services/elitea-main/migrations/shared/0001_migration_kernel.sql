CREATE SCHEMA IF NOT EXISTS elitea_runtime;

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
