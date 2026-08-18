-- 0084_budget_usage_dimensions.sql (issues #320, #321, #322)
--
-- Three related budget defects share this schema change.
--
-- #320 — the accumulator holds money per (scope, scope_id, period) and nothing
-- else. LiteLLM kept a per-tag daily ledger with model, token and request
-- counts, and the Usage page drew a daily chart, a per-model table and token
-- columns from it. None of those dimensions exist in Postgres, so the port of
-- that page has a meter and nothing else. gateway.llm_usage_events below is the
-- per-request ledger those views need.
--
-- #321 — gateway.user_budget is authored, served and rendered, and no component
-- enforces it. Enforcement needs no new table: gateway.llm_budget_accumulators
-- already keys rows by (scope, scope_id, period_start), and elitea-main already
-- reads scope='user' with scope_id='{project_id}:{user_id}'. Only the gateway
-- write and admission path were missing, and both are Go. So #321 needs no DDL
-- of its own here; it needs the threshold column below to behave the same way
-- for a member as for a project.
--
-- #322 — PUT /admin/gateway/budget-alerts held its value in a process-local
-- struct, so it was lost on restart and diverged per replica, and no gateway
-- read it. The row seeded below is where that config now lives.
-- gateway.governance_config is the existing global authoring table and needs no
-- new DDL, only a seeded row so a GET before the first PUT reads the same
-- defaults the in-process store used to return.
--
-- THE LEDGER IS NOT A SECOND MONEY PATH. gateway.llm_budget_accumulators stays
-- the only table budget admission reads and the only one the write-back
-- consumer and the outage-recovery goroutine contend over. The ledger is
-- write-once per billed request, keyed by the same event_id that
-- gateway.processed_event_ids dedups on, and no reader of it feeds a budget
-- decision. Summing the ledger and the accumulator together would double-count;
-- nothing does.
--
-- IDEMPOTENCE, as in 0067: every statement is guarded, because dev and
-- dump-loaded databases reach this file in several different states.
--
-- No BEGIN/COMMIT: the ledgered runner wraps each file in one transaction with
-- its ledger row (migrate/runner.go apply).

-- ---------------------------------------------------------------------------
-- llm_usage_events — the per-request usage ledger (#320)
-- ---------------------------------------------------------------------------
-- One row per BILLED request. The writer is the scheduler's write-back consumer
-- (in the same transaction as the accumulator UPSERT and the processed_event_ids
-- dedup insert) and, while NATS is down, the gateway's outage-window persist.
-- Both write ON CONFLICT (event_id) DO NOTHING, so a redelivery or an overlap
-- between the two writers produces one row, never two.
--
-- CARDINALITY AND RETENTION are decided here rather than left open. This table
-- grows with call volume, not with projects or periods, so it is the first
-- unbounded-by-traffic table in the gateway schema. The scheduler prunes rows
-- older than the retention window on its write-back loop
-- (budgetwriteback.RetentionWindow); the window is a compiled constant, not an
-- environment variable, so no deployment can silently disable the prune.
--
-- DENOMINATION: cost_usd is USD NUMERIC, the same denomination as
-- llm_budget_accumulators.accumulated_cost. The gateway's counter is nano-USD
-- and the conversion happens once, in the writer's SQL, exactly as the
-- accumulator UPSERT does it.
CREATE TABLE IF NOT EXISTS gateway.llm_usage_events (
    -- The billing event id. PRIMARY KEY rather than a surrogate: it is what
    -- makes both writers idempotent, and it is the same value the accumulator
    -- dedups on in gateway.processed_event_ids.
    event_id          UUID PRIMARY KEY,
    project_id        INTEGER NOT NULL,
    -- NULL when the call carried no resolvable member (a service account, a
    -- token-authenticated integration). It is NOT zero-filled: "no member" and
    -- "member 0" are different claims, and the per-member views must be able to
    -- tell them apart.
    user_id           INTEGER,
    provider          VARCHAR(64)  NOT NULL DEFAULT '',
    model             VARCHAR(128) NOT NULL DEFAULT '',
    prompt_tokens     BIGINT NOT NULL DEFAULT 0,
    completion_tokens BIGINT NOT NULL DEFAULT 0,
    -- Generated, not written: a stored total the writer supplies can disagree
    -- with its own parts, and the reference's per-model table reported all
    -- three. Postgres computes it once on write.
    total_tokens      BIGINT GENERATED ALWAYS AS (prompt_tokens + completion_tokens) STORED,
    -- The reference's tag_daily_activity carried api_requests alongside spend
    -- and tokens. One ledger row is one request; the column exists so the
    -- per-day and per-model aggregates can SUM it instead of COUNT(*), which
    -- keeps the shape stable if a future writer ever coalesces.
    api_requests      INTEGER NOT NULL DEFAULT 1,
    cost_usd          NUMERIC(20,8) NOT NULL DEFAULT 0,
    -- The billing period this request was billed into, matching the
    -- accumulator's period_start/period_end for the same event.
    period_start      TIMESTAMPTZ NOT NULL,
    period_end        TIMESTAMPTZ NOT NULL,
    -- When the request was billed. The per-day series buckets on this column in
    -- UTC, the same zone billing periods are computed in, so a day boundary and
    -- a period boundary cannot disagree.
    occurred_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The per-day series and the per-model table both ask "every event for THIS
-- project inside a period". project_id leads, occurred_at ranges.
CREATE INDEX IF NOT EXISTS idx_llm_usage_events_project_time
    ON gateway.llm_usage_events (project_id, occurred_at);

-- The member-scoped usage read adds user_id to the same question.
CREATE INDEX IF NOT EXISTS idx_llm_usage_events_project_user_time
    ON gateway.llm_usage_events (project_id, user_id, occurred_at);

-- The retention prune deletes by age across all projects, which the two indexes
-- above cannot serve (both lead with project_id).
CREATE INDEX IF NOT EXISTS idx_llm_usage_events_occurred_at
    ON gateway.llm_usage_events (occurred_at);

-- ---------------------------------------------------------------------------
-- user_budget — index the gateway's per-member admission point-read (#321)
-- ---------------------------------------------------------------------------
-- The UNIQUE (project_id, user_id) constraint from 0067 already serves this
-- lookup, so no index is added: stating it here rather than creating a
-- redundant one, because "the hot read has no index" is the question a reader
-- arrives with. gateway.user_budget is now read on every /llm call that carries
-- a member id, through user_budget_project_user_uc.

-- ---------------------------------------------------------------------------
-- project_budget.soft_alert_pct — nullable, so a global default can exist (#322)
-- ---------------------------------------------------------------------------
-- The budget-alerts surface documents threshold_pct as "the default budget
-- utilisation percentage that triggers a soft alert for projects without their
-- own soft_alert_pct". Under 0067 the column is NOT NULL DEFAULT 80, so no
-- project can be without its own value and the global default could never
-- apply to anything — a control with no reachable effect.
--
-- Dropping NOT NULL and the column default makes "this project did not author a
-- threshold" representable. Existing rows keep the value they hold, including
-- the 80 that 0067's default stamped on them; this migration does NOT null them
-- out, because an operator who saved 80 deliberately and an operator who never
-- chose are indistinguishable after the fact, and rewriting both to "inherit"
-- would move the first one's threshold the next time the global default changes.
--
-- Every reader already COALESCEs this column, and the two that decide the
-- effective threshold — the gateway snapshot and the elitea-main budget read —
-- now COALESCE through the global row seeded below before falling back to 80.
-- gateway.user_budget.soft_alert_pct is relaxed the same way and for the same
-- reason: a member threshold nobody authored must inherit the platform default,
-- not a column default that shadows it. The two tables are relaxed together
-- because the member listing and the project read resolve the threshold through
-- the same COALESCE chain, and a NOT NULL on one of them would make that chain
-- reachable for one scope and dead for the other.
DO $$
BEGIN
    IF to_regclass('gateway.project_budget') IS NOT NULL THEN
        ALTER TABLE gateway.project_budget ALTER COLUMN soft_alert_pct DROP NOT NULL;
        ALTER TABLE gateway.project_budget ALTER COLUMN soft_alert_pct DROP DEFAULT;
    END IF;
    IF to_regclass('gateway.user_budget') IS NOT NULL THEN
        ALTER TABLE gateway.user_budget ALTER COLUMN soft_alert_pct DROP NOT NULL;
        ALTER TABLE gateway.user_budget ALTER COLUMN soft_alert_pct DROP DEFAULT;
    END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- The global budget-alert config row (#322)
-- ---------------------------------------------------------------------------
-- (section, type, name) is gateway.governance_config's unique key, so
-- ON CONFLICT DO NOTHING makes re-application inert and, more importantly,
-- never overwrites a value an operator has already saved through the API.
--
-- The seeded values are the ones NewBudgetAlertStore() returned in memory —
-- enabled, 80 — so a database that reaches this migration answers GET
-- /admin/gateway/budget-alerts exactly as it did before, and only the losing of
-- the value on restart changes.
--
-- `enabled` on the ROW means "this governance_config row is live" and is not
-- the alert switch; the alert switch is data->>'enabled'. The two are separate
-- so disabling alerts does not make the row invisible to the reader that has to
-- see it in order to know alerts are off.
DO $$
BEGIN
    IF to_regclass('gateway.governance_config') IS NOT NULL THEN
        INSERT INTO gateway.governance_config (type, section, name, data, enabled)
        VALUES (
            'budget_alert', 'governance', 'global',
            '{"enabled": true, "threshold_pct": 80}'::jsonb,
            true
        )
        ON CONFLICT DO NOTHING;
    END IF;
END
$$;
