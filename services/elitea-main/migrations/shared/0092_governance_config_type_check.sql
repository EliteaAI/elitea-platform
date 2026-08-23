-- 0092_governance_config_type_check.sql (issue #218)
--
-- Two jobs: correct a claim that 0067 could not carry, and stop a row that no
-- reader understands from being written.
--
-- ---------------------------------------------------------------------------
-- 1. THE CORRECTION 0067 COULD NOT CARRY
-- ---------------------------------------------------------------------------
--
-- The header of shared/0067_gateway_budget_schema.sql says:
--
--     "the gateway's GovernanceStore reads these rows at load / warm reload"
--
-- That was NOT true when it was written. `grep -rn governance_config
-- services/elitea-llm-gateway` returned nothing: the gateway's GovernanceStore
-- is the budget COUNTER engine, it reads gateway.project_budget and
-- gateway.llm_budget_accumulators, and it had never opened this table. The
-- admin Configuration page said the opposite in its own words, and #466
-- confirmed the denial was the correct half.
--
-- 0067 is checksum-immutable once applied
-- (internal/infra/db/migrate/manifest.go), so the sentence in its header
-- cannot be edited. This file is the correction, and the correction is that the
-- sentence has become TRUE by the gateway catching up with it:
--
--   * services/elitea-llm-gateway/internal/policy reads every enabled row of
--     this table on a 30 s poll (LLM_GOVERNANCE_REFRESH_SEC) and compiles it
--     into an immutable snapshot.
--   * internal/llmproxy enforces that snapshot on the /llm request path:
--     provider and model allowlists, MCP server allowlists, per-minute request
--     and token ceilings, credential rate policy, and CEL routing rules.
--   * An authored budget row is the fallback ceiling for a project with no
--     gateway.project_budget row.
--
-- One correction to 0067 still stands, and it is the opposite direction: 0067
-- says "warm reload". There is no warm reload. The poll is the only refresh
-- path, deliberately, so a replica that missed an event still converges. A
-- definition takes effect within the poll interval, not instantly.
--
-- ---------------------------------------------------------------------------
-- 2. THE CONSTRAINT
-- ---------------------------------------------------------------------------
--
-- `type` is the discriminator every reader switches on, and it was an
-- unconstrained VARCHAR(64). A row with a misspelled type is accepted by the
-- database, is invisible to every reader, and governs nothing — while sitting
-- in the admin list looking exactly like a row that works.
--
-- The value set is the one 0067's own comment enumerates, plus `budget_alert`,
-- which 0067 did not list and which #322 added later. `budget_alert` is read by
-- the budget snapshot SQL in the gateway's internal/failmode on every /llm
-- call, so omitting it here would reject the one row that was already working.
--
-- NOT VALID is load-bearing. An existing deployment may already hold a row with
-- some other type — this table has been writable through a generic CRUD since
-- 0067 — and a validating constraint would fail the migration and block the
-- whole release. NOT VALID checks every future INSERT and UPDATE while leaving
-- existing rows alone. An operator who wants the back-fill checked can run
-- `ALTER TABLE gateway.governance_config VALIDATE CONSTRAINT
-- governance_config_type_known` when they have dealt with any offending row;
-- the gateway names them in its logs and on GET /governance/status.
--
-- Idempotent, like every file in this corpus: the DO block adds the constraint
-- only when it is absent, so re-applying over a database that already has it is
-- inert.

DO $$
BEGIN
    IF to_regclass('gateway.governance_config') IS NULL THEN
        -- 0067 has not run on this database. Nothing to constrain; the CREATE
        -- TABLE there will not carry this constraint, and a later run of this
        -- file over the created table will add it.
        RETURN;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conrelid = 'gateway.governance_config'::regclass
          AND conname  = 'governance_config_type_known'
    ) THEN
        ALTER TABLE gateway.governance_config
            ADD CONSTRAINT governance_config_type_known
            CHECK (type IN (
                'budget',
                'rate_limit',
                'model_config',
                'routing_rule',
                'mcp_allowlist',
                'credential_policy',
                'budget_alert'
            ))
            NOT VALID;
    END IF;
END
$$;

-- The gateway reads EVERY enabled row on each refresh, ordered by
-- (section, type, name). The 0067 index is on `type` alone, which that read
-- cannot use. This index matches the read the enforcement path actually makes.
--
-- Plain CREATE INDEX, not CONCURRENTLY, for the same reason 0067 gives: the
-- ledgered runner applies each file inside a transaction, and CONCURRENTLY
-- cannot run in one. The table holds operator-authored rows — tens, not
-- millions — so the SHARE lock is momentary.
CREATE INDEX IF NOT EXISTS idx_governance_config_enabled_order
    ON gateway.governance_config (section, type, name)
    WHERE enabled = true;
