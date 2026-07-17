ALTER TABLE elitea_runtime.command_outbox
    ADD COLUMN IF NOT EXISTS last_visibility_at TIMESTAMPTZ;

ALTER TABLE elitea_runtime.command_outbox
    ADD CONSTRAINT command_outbox_visibility_state CHECK (
        last_visibility_at IS NULL OR published_at IS NOT NULL
    ) NOT VALID;

CREATE INDEX IF NOT EXISTS command_outbox_visibility_repair_idx
    ON elitea_runtime.command_outbox (
        stream_name,
        (COALESCE(last_visibility_at, published_at)),
        outbox_id
    )
    WHERE published_at IS NOT NULL
      AND authority_granted_at IS NULL
      AND retired_at IS NULL;
