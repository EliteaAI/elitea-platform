-- 003_budget_authoring.sql (issue #246)
-- Authoring columns and the per-member table behind the budgets/quotas/usage API.
--
-- The budgets API writes gateway.project_budget — the SAME row the gateway's
-- failmode store point-reads on every LLM call (services/elitea-llm-gateway/
-- internal/failmode/store.go snapshotSQL). Setting a project limit through the
-- API therefore takes effect on the next call. That is the deliberate contrast
-- with gateway.governance_config (#218), which elitea-main writes and nothing
-- reads: this port does not add a second write-only config path.
--
-- Applied UNCONDITIONALLY by migrate.go's gateway_migrations runner and fully
-- idempotent, matching 001/002 — see 001_gateway_budget.sql's dump-guard note.
--
-- Denomination, restated because it is the field that gets it wrong: limits are
-- USD (hard_limit_usd NUMERIC), accumulated spend is USD NUMERIC, the gateway's
-- NATS counter is int64 nano-USD, model prices are per 1,000,000 tokens. Nothing
-- in this file introduces a fourth.

BEGIN;

CREATE SCHEMA IF NOT EXISTS gateway;

-- ---------------------------------------------------------------------------
-- project_budget.enabled — the authored exemption flag
-- ---------------------------------------------------------------------------
-- `is_unlimited` is what the gateway enforces, and it is DERIVED on write:
--
--     is_unlimited = (NOT enabled) OR hard_limit_usd IS NULL
--
-- The two are not interchangeable, which is why `enabled` has to be stored
-- separately rather than read back as `NOT is_unlimited`. The reference
-- (legacy/plugins/elitea_core/api/v2/project_budget.py) lets an operator save
-- `enabled=true, monthly_limit=null` — "this project is governed, it just has
-- no ceiling yet" — and lets them save `enabled=false` to mark the project
-- deliberately exempt. Both are unlimited to the gateway; only one of them is
-- what the operator typed. Deriving `enabled` from `is_unlimited` would make
-- the first case read back as the second, so the form would show a value
-- nobody entered.
-- The column is added AND back-filled in one guarded block, and the guard is
-- load-bearing twice over.
--
-- A bare `ADD COLUMN ... DEFAULT true` stamps `enabled = true` on every row that
-- already exists, including a row with `is_unlimited = true` and a non-null
-- hard_limit_usd — an operator who set a ceiling and then marked the project
-- exempt. The API would then read that row as an enforced explicit limit while
-- the gateway, reading is_unlimited, admits every call: a ceiling on the screen
-- that stops nothing. `enabled = NOT is_unlimited` is the only backfill that
-- cannot invent that state.
--
-- The backfill must run ONLY when the column is created, which is why this is a
-- DO block and not an unconditional UPDATE. Re-running it on a later migration
-- pass would overwrite authored values: a project saved as
-- `enabled = true, monthly_limit = NULL` is legitimately is_unlimited, and the
-- UPDATE would silently rewrite it to `enabled = false` — "deliberately exempt",
-- which is not what anybody chose.
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
-- user_budget — per-member monthly limit within a project
-- ---------------------------------------------------------------------------
-- The port of legacy/plugins/elitea_core/models/user_budget.py, keeping the
-- limit in the same USD denomination and the same schema as project_budget so
-- the admin surface reads both from one place.
--
-- NOT ENFORCED, and the API says so rather than this file: the gateway's
-- admission check is project-scoped only (internal/llmproxy/budget_gate.go
-- declares a single `budgetScopeProject = "project"`), and issue #246's scope
-- boundary forbids changing gateway enforcement semantics. So every read of a
-- row in this table carries `"enforced": false`, and
-- TestUserBudgetStateReportsItIsNotEnforced fails the day that stops being
-- true — the machine-checked version of the disclosure, because the comment
-- version of it is what #135 and #218 are made of.
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

COMMIT;
