ALTER TABLE elitea_runtime.execution_jobs
    ADD COLUMN invocation_state TEXT NOT NULL DEFAULT 'NOT_STARTED';

UPDATE elitea_runtime.execution_jobs
SET invocation_state = 'MAY_HAVE_STARTED'
WHERE state IN ('RUNNING', 'SETTLING', 'SUCCEEDED', 'FAILED');

ALTER TABLE elitea_runtime.execution_jobs
    ADD CONSTRAINT execution_jobs_invocation_state
    CHECK (
        invocation_state IN ('NOT_STARTED', 'PREPARING', 'MAY_HAVE_STARTED')
    );
