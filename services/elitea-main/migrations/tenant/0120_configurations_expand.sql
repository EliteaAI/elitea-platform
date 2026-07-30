CREATE TABLE IF NOT EXISTS configuration_revisions (
    revision_id TEXT PRIMARY KEY,
    configuration_id INTEGER REFERENCES configuration(id) ON DELETE SET NULL,
    configuration_type TEXT NOT NULL,
    settings_entry_id TEXT NOT NULL,
    settings_entry_version TEXT NOT NULL,
    settings_content_digest BYTEA NOT NULL,
    input_bundle_id TEXT NOT NULL,
    catalog_revision TEXT NOT NULL,
    catalog_digest BYTEA NOT NULL,
    schema_id TEXT NOT NULL,
    schema_revision TEXT NOT NULL,
    schema_digest BYTEA NOT NULL,
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT configuration_revision_settings_digest
        CHECK (octet_length(settings_content_digest) = 32),
    CONSTRAINT configuration_revision_catalog_digest
        CHECK (octet_length(catalog_digest) = 32),
    CONSTRAINT configuration_revision_schema_digest
        CHECK (octet_length(schema_digest) = 32)
);

CREATE TABLE IF NOT EXISTS configuration_validation_projection (
    revision_id TEXT PRIMARY KEY REFERENCES configuration_revisions(revision_id),
    execution_id TEXT NOT NULL,
    execution_generation BIGINT NOT NULL,
    logical_output_id TEXT NOT NULL UNIQUE,
    valid BOOLEAN NOT NULL,
    issues_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    projected_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT configuration_validation_projection_issues
        CHECK (jsonb_typeof(issues_json) = 'array')
);
