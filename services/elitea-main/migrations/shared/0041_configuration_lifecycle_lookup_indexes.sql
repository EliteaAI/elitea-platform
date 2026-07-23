-- The deleted-public-model repair enumerates only active projects in stable ID
-- order. Keep the predicate and ordering index-only as the project directory
-- grows; inactive projects are intentionally absent from this index.
CREATE INDEX IF NOT EXISTS project_active_configuration_lifecycle_idx
    ON centry.project (id)
    WHERE create_success IS TRUE
      AND suspended IS FALSE;
