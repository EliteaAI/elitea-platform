-- Runtime execution generation fences one execution attempt. Index generation
-- orders successive logical rebuilds of one project/toolkit/index target and
-- therefore has a separate, target-scoped authority.
ALTER TABLE elitea_runtime.index_ingest_jobs
    ADD COLUMN index_generation BIGINT;

-- Existing initialized and non-initialized rows are the first observed logical
-- generation for their target. Historical rows are deliberately not renumbered:
-- PgVector rows without index_generation use execution_generation as the
-- compatibility fallback.
UPDATE elitea_runtime.index_ingest_jobs
SET index_generation = 1
WHERE index_generation IS NULL;

ALTER TABLE elitea_runtime.index_ingest_jobs
    ALTER COLUMN index_generation SET NOT NULL,
    ADD CONSTRAINT index_ingest_jobs_index_generation_positive
        CHECK (index_generation > 0);

CREATE TABLE elitea_runtime.index_generation_counters (
    resource_project_id INTEGER NOT NULL REFERENCES centry.project(id),
    toolkit_id INTEGER NOT NULL,
    index_name TEXT NOT NULL,
    last_generation BIGINT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (resource_project_id, toolkit_id, index_name),
    CONSTRAINT index_generation_counters_toolkit_positive
        CHECK (toolkit_id > 0),
    CONSTRAINT index_generation_counters_index_name_bounded
        CHECK (octet_length(index_name) BETWEEN 1 AND 256),
    CONSTRAINT index_generation_counters_generation_positive
        CHECK (last_generation > 0)
);

INSERT INTO elitea_runtime.index_generation_counters (
    resource_project_id,
    toolkit_id,
    index_name,
    last_generation,
    updated_at
)
SELECT j.resource_project_id,
       i.toolkit_id,
       i.index_name,
       max(i.index_generation),
       clock_timestamp()
FROM elitea_runtime.index_ingest_jobs AS i
JOIN elitea_runtime.execution_jobs AS j
  ON j.execution_id = i.execution_id
 AND j.generation = i.generation
 AND j.capability_id = i.capability_id
WHERE i.capability_id = 'index.ingest.v1'
GROUP BY j.resource_project_id, i.toolkit_id, i.index_name
ON CONFLICT (resource_project_id, toolkit_id, index_name) DO UPDATE
SET last_generation = greatest(
        elitea_runtime.index_generation_counters.last_generation,
        EXCLUDED.last_generation
    ),
    updated_at = clock_timestamp();

CREATE INDEX index_ingest_jobs_initialized_generation_idx
    ON elitea_runtime.index_ingest_jobs (
        toolkit_id, index_name, index_generation, execution_id, generation
    )
    WHERE index_meta_initialized_at IS NOT NULL
      AND capability_id = 'index.ingest.v1';
