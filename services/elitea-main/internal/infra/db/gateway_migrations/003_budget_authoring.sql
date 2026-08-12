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
ALTER TABLE gateway.project_budget
    ADD COLUMN IF NOT EXISTS enabled BOOLEAN NOT NULL DEFAULT true;

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
