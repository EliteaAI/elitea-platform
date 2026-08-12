-- 004_accumulator_project_index.sql (issue 253)
-- The index the cost-breakdown read needs, and the first one this table has had
-- for a project-scoped query.
--
-- gateway.llm_budget_accumulators carried three access paths before this file:
-- the primary key, UNIQUE (scope, scope_id, period_start), and the partial
-- outage index. Every reader so far went through the unique one — the gateway's
-- failmode snapshot and issue 246's budgets endpoints all point-read by
-- (scope, scope_id, period_start), and the write-back consumer's UPSERT
-- conflicts on it.
--
-- `/elitea_core/analytics_costs/prompt_lib/{project_id}` is the first reader
-- that asks a different question: "every accumulator row for THIS PROJECT,
-- whatever its scope, whose period overlaps a window". project_id is not the
-- leading column of any existing index, so both of that endpoint's queries —
-- the per-scope aggregate and the row listing — degrade to a sequential scan of
-- the whole table.
--
-- That table only grows: one row per (scope, scope_id, period), for every
-- project, for every billing period, kept indefinitely. A deployment with a few
-- thousand projects accumulates six figures of rows within a few years, and the
-- cost view is a dashboard read, so the scans repeat per page load.
--
-- (project_id, period_start) rather than (project_id) alone: the queries filter
-- `period_start < $2 AND period_end > $3`, so the second column turns the
-- window into an index range scan instead of a filter over every row the
-- project has ever had. period_end stays a recheck — a two-sided interval
-- overlap cannot be a single btree range on both bounds, and the leading pair
-- already cuts the candidate set to one project's handful of periods.
--
-- NOT `CREATE INDEX CONCURRENTLY`, deliberately. The migration runner execs
-- each file through a single pool.Exec (internal/infra/db/migrate.go,
-- applyMigrationDir), which Postgres treats as one implicit transaction, and
-- GatewayMigrationSQL() concatenates the whole directory into one string for
-- the integration tests. CONCURRENTLY is rejected inside a transaction block,
-- so it would fail at startup and in every test that builds the gateway schema.
-- A plain CREATE INDEX takes a SHARE lock that blocks writes to this table for
-- the duration of the build; at the row counts above that is well under a
-- second, and it happens once, during a migration that already runs before the
-- service serves traffic.
--
-- Idempotent, like 001-003: IF NOT EXISTS, applied unconditionally on every
-- boot (see 001_gateway_budget.sql's dump-guard note).

BEGIN;

CREATE INDEX IF NOT EXISTS idx_accumulators_project_period
    ON gateway.llm_budget_accumulators (project_id, period_start);

COMMIT;
