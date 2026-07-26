-- The terminal reconciler compares one claimed initialized execution with
-- durably initialized successors in the same resource project. This partial
-- index keeps that asynchronous lookup ordered by the admission authority's
-- total order without adding work to non-index capabilities.
CREATE INDEX execution_jobs_index_identity_order_idx
    ON elitea_runtime.execution_jobs (
        resource_project_id, admitted_at, execution_id, generation
    )
    WHERE capability_id = 'index.ingest.v1';
