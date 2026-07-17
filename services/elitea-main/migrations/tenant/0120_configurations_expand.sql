CREATE TABLE IF NOT EXISTS configuration_revisions (
    revision_id TEXT PRIMARY KEY,
    configuration_id INTEGER REFERENCES configuration(id) ON DELETE RESTRICT,
    supersedes_revision_id TEXT REFERENCES configuration_revisions(revision_id),
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

CREATE UNIQUE INDEX IF NOT EXISTS configuration_revision_successor_idx
    ON configuration_revisions (supersedes_revision_id)
    WHERE supersedes_revision_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS configuration_revision_heads (
    configuration_id INTEGER PRIMARY KEY REFERENCES configuration(id) ON DELETE CASCADE,
    revision_id TEXT NOT NULL UNIQUE REFERENCES configuration_revisions(revision_id),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
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

CREATE OR REPLACE FUNCTION reject_configuration_revision_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'configuration revisions are immutable';
END;
$$;

DROP TRIGGER IF EXISTS configuration_revisions_immutable
    ON configuration_revisions;
CREATE TRIGGER configuration_revisions_immutable
BEFORE UPDATE OR DELETE ON configuration_revisions
FOR EACH ROW EXECUTE FUNCTION reject_configuration_revision_mutation();
