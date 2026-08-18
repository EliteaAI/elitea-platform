-- 0067_gateway_budget_schema.sql (issue #306)
-- The gateway governance / budget / price-catalog schema, moved into the
-- corpus that production actually runs.
--
-- WHY THIS FILE EXISTS
--
-- These seven tables used to live ONLY in internal/infra/db/gateway_migrations/,
-- a directory applied exclusively by infradb.RunMigrations — which
-- cmd/elitea-main/main.go calls only when ELITEA_DEV_BOOTSTRAP_LEGACY_SCHEMA is
-- "true". That flag is set in no Helm values file, no compose file, and no CI
-- job; it is a local-developer convenience and cmd/elitea-main actively refuses
-- it outside dev. The Helm pre-install/pre-upgrade hook runs `elitea-migrate`,
-- which applies ONLY the ledgered shared + tenant histories (deploy/helm/
-- elitea-main/templates/migrate-job.yaml). So on a Helm-deployed database the
-- gateway.* tables were never created by anything, while three services read
-- them:
--
--   * elitea-llm-gateway   — failmode/store.go point-reads gateway.project_budget
--                            + gateway.llm_budget_accumulators on EVERY /llm
--                            call; cost/cost.go reads gateway.gateway_models.
--   * elitea-scheduler     — budgetwriteback UPSERTs gateway.llm_budget_accumulators
--                            and gateway.processed_event_ids; pricesync writes
--                            gateway.gateway_models.
--   * elitea-main          — the #246 budgets/quotas API and the #253 cost
--                            breakdown read gateway.project_budget,
--                            gateway.user_budget, gateway.llm_budget_accumulators.
--
-- This is now the ONLY copy of that DDL. gateway_migrations/ was deleted rather
-- than duplicated: two corpora holding the same tables is the divergence that
-- GatewayMigrationSQL()'s own doc comment exists to prevent ("a schema change
-- cannot pass a test against a hand-copied DDL and then fail against
-- production"). The dev bootstrap path still works — infradb.RunMigrations now
-- execs THIS file, read out of the ledgered corpus.
--
-- IDEMPOTENCE IS LOAD-BEARING, not decoration. Every existing dev and
-- dump-loaded database already has these tables from the old unledgered runner,
-- and none of them has a ledger row for 0067. When elitea-migrate first runs
-- against such a database it will apply this file over a schema that already
-- exists, so every statement is guarded (IF NOT EXISTS / a column-existence DO
-- block) and this file is inert there. It creates the schema only where nothing
-- created it — which is precisely the Helm case #306 is about.
--
-- No BEGIN/COMMIT: the ledgered runner already executes each file inside one
-- transaction alongside its ledger row (migrate/runner.go apply), and a nested
-- explicit block would break that pairing. The old copies carried BEGIN/COMMIT
-- because the unledgered runner exec'd them standalone.
--
-- DENOMINATIONS — three of them, deliberately distinct, do not mix:
--   * limits and accumulated spend : USD NUMERIC (hard_limit_usd, accumulated_cost)
--   * the gateway's NATS counter   : int64 nano-USD (NanoUSD = 1e9)
--   * model prices                 : USD per 1,000,000 TOKENS (input_cost_per_1m_tokens)
-- Using per-1k or per-token for the last one is a 1000×/1e6 costing bug.

CREATE SCHEMA IF NOT EXISTS gateway;

-- ---------------------------------------------------------------------------
-- project_budget — per-project LLM budget configuration
-- ---------------------------------------------------------------------------
-- `enabled` vs `is_unlimited` (issue #246): is_unlimited is what the gateway
-- enforces and is DERIVED on write —
--
--     is_unlimited = (NOT enabled) OR hard_limit_usd IS NULL
--
-- so the two are not interchangeable. An operator may save
-- `enabled=true, hard_limit_usd=NULL` ("governed, no ceiling yet") or
-- `enabled=false` ("deliberately exempt"); both are unlimited to the gateway,
-- only one is what they typed. Deriving `enabled` back from `is_unlimited`
-- would show them a value nobody entered, which is why it is stored.
CREATE TABLE IF NOT EXISTS gateway.project_budget (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     INTEGER NOT NULL,
    -- hard_limit_usd is authored in USD; the gateway scales it to nano-USD for
    -- counter comparison. NULL when is_unlimited.
    hard_limit_usd NUMERIC(12,2),
    budget_period  VARCHAR(16) NOT NULL DEFAULT 'monthly',
    soft_alert_pct SMALLINT NOT NULL DEFAULT 80
        CHECK (soft_alert_pct BETWEEN 1 AND 100),
    is_unlimited   BOOLEAN NOT NULL DEFAULT true,
    enabled        BOOLEAN NOT NULL DEFAULT true,
    -- NULL inherits the global LLM_BUDGET_NATS_FAIL_MODE default (§8.5).
    nats_fail_mode VARCHAR(16)
        CHECK (nats_fail_mode IN ('tiered_hybrid','fail_open','fail_closed')),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT project_budget_project_uc UNIQUE (project_id)
);

-- Backfill columns for databases that already carry an earlier shape of this
-- table from the deleted unledgered corpus.
ALTER TABLE gateway.project_budget
    ADD COLUMN IF NOT EXISTS soft_alert_pct SMALLINT NOT NULL DEFAULT 80;
ALTER TABLE gateway.project_budget
    ADD COLUMN IF NOT EXISTS nats_fail_mode VARCHAR(16);

-- `enabled` is added and back-filled in one guarded block, and the guard is
-- load-bearing twice over.
--
-- A bare ADD COLUMN ... DEFAULT true would stamp enabled=true onto a row with
-- is_unlimited=true AND a non-null hard_limit_usd — an operator who set a
-- ceiling and then marked the project exempt. The API would read that back as
-- an enforced explicit limit while the gateway, reading is_unlimited, admits
-- every call: a ceiling on the screen that stops nothing.
-- `enabled = NOT is_unlimited` is the only backfill that cannot invent that.
--
-- And the backfill must run ONLY when the column is created, hence a DO block
-- rather than an unconditional UPDATE: a project legitimately saved as
-- `enabled=true, hard_limit_usd=NULL` is is_unlimited, and re-running the
-- UPDATE would silently rewrite it to "deliberately exempt", which is not what
-- anybody chose. On a fresh database the CREATE TABLE above already declared
-- the column, so this block is a no-op over zero rows.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'gateway'
          AND table_name = 'project_budget'
          AND column_name = 'enabled'
    ) THEN
        ALTER TABLE gateway.project_budget
            ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT true;
        UPDATE gateway.project_budget SET enabled = NOT is_unlimited;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- llm_budget_accumulators — durable budget counters (write-behind target)
-- ---------------------------------------------------------------------------
-- accumulated_cost is USD NUMERIC for the durable tier; the gateway's KV
-- counter holds int64 nano-USD and the write-behind consumer converts deltas.
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
    -- One accumulator row per (scope, scope_id, period_start) — the delta-UPSERT
    -- key the scheduler's write-back conflicts on. Without this constraint the
    -- UPSERT fails with 42P10 at runtime.
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

-- The cost-breakdown read (issue #253) asks a different question from every
-- other reader: "every accumulator row for THIS PROJECT, whatever its scope,
-- whose period overlaps a window". project_id leads no other index, so both of
-- that endpoint's queries would sequentially scan a table that only grows — one
-- row per (scope, scope_id, period), per project, per billing period, kept
-- indefinitely. (project_id, period_start) rather than (project_id) alone turns
-- the window into a range scan; period_end stays a recheck, because a two-sided
-- interval overlap cannot be a single btree range on both bounds.
--
-- NOT `CREATE INDEX CONCURRENTLY`, deliberately: the ledgered runner applies
-- each file inside a transaction, and CONCURRENTLY is rejected in a transaction
-- block. A plain CREATE INDEX takes a SHARE lock for the duration of the build,
-- which at these row counts is well under a second and happens once, during a
-- migration that already runs before the service serves traffic.
CREATE INDEX IF NOT EXISTS idx_accumulators_project_period
    ON gateway.llm_budget_accumulators (project_id, period_start);

-- ---------------------------------------------------------------------------
-- llm_credentials — per-credential rate policy (§8.7)
-- ---------------------------------------------------------------------------
-- The Fernet vault (centry.configuration ai_credentials) remains the secret
-- source of truth; this table records only the per-credential rate_policy that
-- the governance usage path reads.
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
    -- The conflict target of the scheduler's price-sync UPSERT.
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

-- ---------------------------------------------------------------------------
-- governance_config — global governance authoring rows (JSONB definitions)
-- ---------------------------------------------------------------------------
-- Governance config is admin/global-scoped, so it lives in one global table
-- rather than per-project p_{id}.configuration. elitea-main owns the authoring
-- path; the gateway's GovernanceStore reads these rows at load / warm reload.
-- There is no gateway-side write path for definitions.
CREATE TABLE IF NOT EXISTS gateway.governance_config (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- `type` identifies the governance entity kind ('budget', 'rate_limit',
    -- 'model_config', 'routing_rule', 'mcp_allowlist', 'credential_policy');
    -- `section` groups them under the admin UI 'governance' section.
    type       VARCHAR(64) NOT NULL,
    section    VARCHAR(64) NOT NULL DEFAULT 'governance',
    name       VARCHAR(255) NOT NULL,
    data       JSONB NOT NULL DEFAULT '{}'::jsonb,
    enabled    BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT governance_config_section_type_name_uc UNIQUE (section, type, name)
);

-- The gateway reads by (type) at load; index the discriminator it filters on.
CREATE INDEX IF NOT EXISTS idx_governance_config_type
    ON gateway.governance_config (type)
    WHERE enabled = true;

-- ---------------------------------------------------------------------------
-- user_budget — per-member monthly limit within a project
-- ---------------------------------------------------------------------------
-- NOT ENFORCED, and the API says so rather than this file: the gateway's
-- admission check is project-scoped only (llmproxy declares a single
-- budgetScopeProject = "project"). Every read of a row here carries
-- "enforced": false, and TestUserBudgetStateReportsItIsNotEnforced fails the
-- day that stops being true.
CREATE TABLE IF NOT EXISTS gateway.user_budget (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     INTEGER NOT NULL,
    user_id        INTEGER NOT NULL,
    -- NULL means no ceiling for this member, exactly as project_budget's
    -- hard_limit_usd does.
    hard_limit_usd NUMERIC(12,2),
    enabled        BOOLEAN NOT NULL DEFAULT true,
    soft_alert_pct SMALLINT NOT NULL DEFAULT 80
        CHECK (soft_alert_pct BETWEEN 1 AND 100),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_budget_project_user_uc UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_budget_project
    ON gateway.user_budget (project_id);
