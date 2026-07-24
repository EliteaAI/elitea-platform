-- 001_gateway_budget.sql (BF0.4)
-- Go-owned gateway governance / budget / price-catalog schema.
--
-- These tables back the LLM-gateway budget enforcement path (design §7.2, §8):
--   * gateway.project_budget         — per-project budget config (hard limit, period, fail-mode)
--   * gateway.llm_budget_accumulators — durable budget counters, kept seconds-fresh by the
--                                       write-behind stream consumer; outage_mode / reconciled
--                                       coordinate the tiered-hybrid fallback (§8.5/§8.6)
--   * gateway.llm_credentials         — per-credential rate_policy (billed|zero-rate-metered|excluded)
--   * gateway.gateway_models          — provider model price catalog, PER-1M-TOKEN denomination
--   * gateway.processed_event_ids     — write-behind consumer dedup ledger (§8.6)
--
-- IMPORTANT — dump-guard: the main migration runner (migrate.go) SKIPS 001_initial.sql when
-- a p_% tenant schema already exists (a restored production dump). This gateway migration set
-- is applied UNCONDITIONALLY and is fully idempotent (CREATE ... IF NOT EXISTS, ADD COLUMN IF
-- NOT EXISTS) so the gateway tables also land on dump-loaded instances. Never move these into
-- 001_initial.sql — that file is dump-guarded away.
--
-- Denomination invariant (the load-bearing fix, §7.1/§8.8): prices are PER 1,000,000 TOKENS
-- (input_cost_per_1m_tokens), matching the pylon centry gateway_models migration and the
-- cost calculator's divisor. Using per-1k or per-token here is a 1000×/1e6 costing bug.

BEGIN;

CREATE SCHEMA IF NOT EXISTS gateway;

-- ---------------------------------------------------------------------------
-- project_budget — per-project LLM budget configuration
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway.project_budget (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     INTEGER NOT NULL,
    -- hard_limit_usd is authored in USD; the gateway scales it to nano-USD for
    -- counter comparison (NanoUSD = 1e9). NULL when is_unlimited.
    hard_limit_usd NUMERIC(12,2),
    budget_period  VARCHAR(16) NOT NULL DEFAULT 'monthly',
    soft_alert_pct SMALLINT NOT NULL DEFAULT 80
        CHECK (soft_alert_pct BETWEEN 1 AND 100),
    is_unlimited   BOOLEAN NOT NULL DEFAULT true,
    -- NULL inherits the global LLM_BUDGET_NATS_FAIL_MODE default (§8.5).
    nats_fail_mode VARCHAR(16)
        CHECK (nats_fail_mode IN ('tiered_hybrid','fail_open','fail_closed')),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_budget_project_uc UNIQUE (project_id)
);

-- Backfill columns for pre-existing deployments that created an earlier shape.
ALTER TABLE gateway.project_budget
    ADD COLUMN IF NOT EXISTS soft_alert_pct SMALLINT NOT NULL DEFAULT 80;
ALTER TABLE gateway.project_budget
    ADD COLUMN IF NOT EXISTS nats_fail_mode VARCHAR(16);

-- ---------------------------------------------------------------------------
-- llm_budget_accumulators — durable budget counters (write-behind target)
-- ---------------------------------------------------------------------------
-- accumulated_cost is stored in USD NUMERIC for the durable tier; the gateway's
-- KV counter holds int64 nano-USD and the write-behind consumer converts deltas.
-- outage_mode / reconciled coordinate the tiered-hybrid recovery (§8.5): the
-- write-back consumer owns rows where NOT (outage_mode AND NOT reconciled); the
-- gateway recovery goroutine owns rows where (outage_mode AND NOT reconciled).
CREATE TABLE IF NOT EXISTS gateway.llm_budget_accumulators (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id                INTEGER NOT NULL,
    org_id                    INTEGER,
    budget_rule_id            UUID REFERENCES gateway.project_budget(id) ON DELETE CASCADE,
    scope                     VARCHAR(16) NOT NULL DEFAULT 'project',
    scope_id                  VARCHAR(64) NOT NULL,
    period_start              TIMESTAMPTZ NOT NULL,
    period_end                TIMESTAMPTZ NOT NULL,
    accumulated_cost          NUMERIC(20,8) NOT NULL DEFAULT 0,
    outage_mode               BOOLEAN NOT NULL DEFAULT false,
    reconciled                BOOLEAN NOT NULL DEFAULT false,
    -- Step-1 marker for the crash-safe recovery reconciliation (§8.5): set under
    -- SELECT ... FOR UPDATE so a restarted goroutine cannot re-select the rows.
    reconciliation_in_progress BOOLEAN NOT NULL DEFAULT false,
    last_updated              TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- One accumulator row per (scope, scope_id, period_start) — the delta-UPSERT key.
    CONSTRAINT llm_budget_accumulators_scope_period_uc
        UNIQUE (scope, scope_id, period_start)
);

ALTER TABLE gateway.llm_budget_accumulators
    ADD COLUMN IF NOT EXISTS outage_mode BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gateway.llm_budget_accumulators
    ADD COLUMN IF NOT EXISTS reconciled BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE gateway.llm_budget_accumulators
    ADD COLUMN IF NOT EXISTS reconciliation_in_progress BOOLEAN NOT NULL DEFAULT false;

-- Partial index for the recovery goroutine's hot selection predicate.
CREATE INDEX IF NOT EXISTS idx_accumulators_outage_unreconciled
    ON gateway.llm_budget_accumulators (scope, scope_id, period_start)
    WHERE outage_mode = true AND reconciled = false;

-- ---------------------------------------------------------------------------
-- llm_credentials — per-credential rate policy (§8.7)
-- ---------------------------------------------------------------------------
-- Minimal Go-owned credential registry carrying the billing policy. The Fernet
-- vault (centry.configuration ai_credentials) remains the secret source of
-- truth (BF0.2-account); this table only records the per-credential rate_policy
-- that the governance usage path reads.
CREATE TABLE IF NOT EXISTS gateway.llm_credentials (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id      INTEGER NOT NULL,
    provider        VARCHAR(64) NOT NULL,
    credential_type VARCHAR(64),
    -- 'billed'            : normal cost accounting, budget counters incremented
    -- 'zero-rate-metered' : usage recorded, cost 0.00, counters NOT incremented
    -- 'excluded'          : usage recorded is_excluded, zero cost, counters NOT incremented
    rate_policy     VARCHAR(24) NOT NULL DEFAULT 'billed'
        CHECK (rate_policy IN ('billed','zero-rate-metered','excluded')),
    enabled         BOOLEAN NOT NULL DEFAULT true,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Nullable-with-default add so existing rows are unaffected (§7.2).
ALTER TABLE gateway.llm_credentials
    ADD COLUMN IF NOT EXISTS rate_policy VARCHAR(24) NOT NULL DEFAULT 'billed';

-- ---------------------------------------------------------------------------
-- gateway_models — provider model price catalog (PER-1M-TOKEN denomination)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway.gateway_models (
    id                                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    model_name                          VARCHAR(128) NOT NULL,
    provider                            VARCHAR(64) NOT NULL,
    input_cost_per_1m_tokens            NUMERIC(20,8),
    output_cost_per_1m_tokens           NUMERIC(20,8),
    cache_creation_input_token_cost     NUMERIC(20,8),
    cache_read_input_token_cost         NUMERIC(20,8),
    input_cost_per_1m_tokens_above_128k NUMERIC(20,8),
    source                              VARCHAR(32),
    source_synced_at                    TIMESTAMPTZ,
    last_sync_at                        TIMESTAMPTZ,
    updated_at                          TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT gateway_models_provider_model_uc UNIQUE (provider, model_name)
);

ALTER TABLE gateway.gateway_models
    ADD COLUMN IF NOT EXISTS input_cost_per_1m_tokens NUMERIC(20,8);

-- ---------------------------------------------------------------------------
-- processed_event_ids — write-behind consumer dedup ledger (§8.6)
-- ---------------------------------------------------------------------------
-- The consumer inserts the delta event_id in the SAME transaction as the
-- accumulator UPSERT; ON CONFLICT DO NOTHING RETURNING event_id detects a
-- redelivery of an already-applied event and skips the UPSERT.
CREATE TABLE IF NOT EXISTS gateway.processed_event_ids (
    event_id     UUID PRIMARY KEY,
    processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMIT;
