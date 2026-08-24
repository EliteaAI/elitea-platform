-- 0095_gateway_model_price_override.sql
--
-- Lets an operator author a model price that the upstream price sync will not
-- overwrite.
--
-- ── Why this column has to exist before the editor does ──────────────────────
--
-- gateway.gateway_models is the cost basis for every billed request: the
-- gateway prices a call by looking the (provider, model_name) pair up here. A
-- model with no row is not refused — for a token model internal/cost falls back
-- to a prefix table and then to a flat invented rate, so the call is billed and
-- budgeted at a figure nobody chose; only audio, whose rate is never
-- fabricated, is genuinely billed at zero. Either way the recorded spend is not
-- the real spend, which makes an admin-authored price a real operational need — a newly released model, a negotiated enterprise rate, or a
-- self-hosted deployment the public catalogue has never heard of.
--
-- It cannot simply be an UPDATE, because the row is not solely ours. The
-- scheduler's price-sync worker UPSERTs this table on the
-- (provider, model_name) unique key and its ON CONFLICT DO UPDATE assigns
-- EVERY price column from EXCLUDED (services/elitea-scheduler/internal/pricesync/
-- syncer.go). An operator price written without this flag would be correct
-- until the next sync tick and then silently revert to the upstream number,
-- with nothing on any screen saying it had — the billing equivalent of a form
-- that saves into a void.
--
-- So the override is declared in the data, and the syncer's DO UPDATE gains a
-- WHERE that skips a row carrying it. The flag is the handshake between the two
-- writers; without it the guard has nothing to read.
--
-- ── Why a flag rather than a separate overrides table ────────────────────────
--
-- A second table would need a join on the cost hot path, which reads this table
-- under a 5-minute cache for every billed request. The flag keeps the read
-- exactly as it is: cost.go selects the same columns from the same row and is
-- untouched by this migration. What changes is only who is allowed to write
-- them.
--
-- ── Denomination is unchanged ───────────────────────────────────────────────
--
-- Prices stay per 1M tokens (and per 1M seconds / characters for the audio
-- columns added by 0086). This migration adds no price column and converts
-- nothing; using a different denominator here would be the 1000x costing bug
-- that design-bifrost-gateway §7.3 exists to warn about.

-- price_overridden marks a row whose prices were authored by an operator and
-- must survive the upstream sync. Default false, so every existing row and
-- every future sync-created row keeps today's behaviour exactly.
ALTER TABLE gateway.gateway_models
    ADD COLUMN IF NOT EXISTS price_overridden BOOLEAN NOT NULL DEFAULT false;

-- price_overridden_at and price_overridden_by record when the override was
-- authored and by whom. They are provenance, not access control: the
-- authorization boundary is RequireCentralPermissions on the admin route. They
-- exist because "why is this model priced differently from the catalogue?" is
-- the first question asked of an unexpected bill, and a flag alone cannot
-- answer it.
ALTER TABLE gateway.gateway_models
    ADD COLUMN IF NOT EXISTS price_overridden_at TIMESTAMPTZ;

ALTER TABLE gateway.gateway_models
    ADD COLUMN IF NOT EXISTS price_overridden_by VARCHAR(255);

-- No index on price_overridden.
--
-- An earlier draft of this migration added a partial one and justified it with a
-- screen that does not exist: the admin catalogue orders by (provider,
-- model_name) and offers no overridden-only filter, and the price sync evaluates
-- the flag AFTER the unique-constraint lookup has already found the row. Nothing
-- would have used it, and an unused index is write amplification on the table
-- every billed request reads.

COMMENT ON COLUMN gateway.gateway_models.price_overridden IS
    'Operator-authored price. The scheduler price-sync UPSERT skips the DO UPDATE for these rows.';
