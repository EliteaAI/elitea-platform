ALTER TABLE elitea_runtime.execution_claims
    ADD COLUMN IF NOT EXISTS initial_output_watermark BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'execution_claims_initial_output_watermark'
          AND conrelid = 'elitea_runtime.execution_claims'::regclass
    ) THEN
        ALTER TABLE elitea_runtime.execution_claims
            ADD CONSTRAINT execution_claims_initial_output_watermark
            CHECK (initial_output_watermark >= 0);
    END IF;
END
$$;
