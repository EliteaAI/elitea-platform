ALTER TABLE elitea_runtime.execution_jobs
    DROP CONSTRAINT execution_jobs_state;

ALTER TABLE elitea_runtime.execution_jobs
    ADD CONSTRAINT execution_jobs_state CHECK (
        state IN ('PENDING', 'DISPATCHED', 'CLAIMED', 'RUNNING', 'SETTLING',
                  'SUCCEEDED', 'FAILED', 'CANCELLED', 'QUARANTINED')
    );
