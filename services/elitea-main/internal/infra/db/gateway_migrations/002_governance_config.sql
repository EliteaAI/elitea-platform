-- 002_governance_config.sql (BF0.6)
-- Global (NOT per-project) governance config-authoring table.
--
-- Governance config is admin/global-scoped, so it lives in a single global table
-- rather than the p_{projectID}.configuration per-project schema
-- (design-governance-config-authoring §5). elitea-main (the thin auth edge) OWNS
-- the authoring path: the admin surface writes governance definitions — budgets,
-- rate limits, rate_policy, per-model/provider scopes, MCP allowlists, and CEL
-- routing rules — as JSONB rows here. The elitea-llm-gateway GovernanceStore reads
-- these rows at service load / warm reload and maps them to Bifrost Table* types
-- for enforcement. There is NO gateway-side write path for definitions.
--
-- Shape mirrors the reusable configurations CRUD contract
-- (internal/api/v2/configurations/handler.go): a JSONB `data` column plus
-- `type`/`section` discriminators. The (section, type, name) triple is unique so
-- authoring is idempotent per named entity.
--
-- Applied UNCONDITIONALLY by migrate.go's gateway_migrations runner and fully
-- idempotent (CREATE ... IF NOT EXISTS), matching 001_gateway_budget.sql — see
-- that file's dump-guard note. Never fold into 001_initial.sql (dump-guarded away).
--
-- Denomination note (design §5.1): budget LIMIT values authored here are USD
-- `number`s (e.g. 10.00). The gateway scales them to nano-USD (NanoUSD = 1e9) for
-- comparison against the NATS KV counter; per-1M model prices live in
-- gateway.gateway_models. These three denominations are distinct — do not mix them
-- in the authored JSONB.

BEGIN;

CREATE SCHEMA IF NOT EXISTS gateway;

-- ---------------------------------------------------------------------------
-- governance_config — global governance authoring rows (JSONB definitions)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS gateway.governance_config (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Discriminators mirror the configurations CRUD shape. `type` identifies the
    -- governance entity kind ('budget', 'rate_limit', 'model_config',
    -- 'routing_rule', 'mcp_allowlist', 'credential_policy'); `section` groups them
    -- under the admin UI 'governance' section.
    type       VARCHAR(64) NOT NULL,
    section    VARCHAR(64) NOT NULL DEFAULT 'governance',
    -- Human/UI name for the authored entity; unique within its (section, type).
    name       VARCHAR(255) NOT NULL,
    -- The authored definition. JSONB so the schema-driven admin form and the
    -- gateway GovernanceStore agree on a single serialisation.
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

COMMIT;
