package repos

// AnalyticsRepo — the /elitea_core/analytics reads, and the reason they now
// refuse instead of answering.
//
// # What was here
//
// Four methods, each a SELECT against `usage_records` or `tool_usage_records`.
// Neither table exists. No migration in any of this service's four migration
// sets creates them, nothing in the repository INSERTs into them, and a
// repository-wide search for the names found only those four queries
// (issue #303). Every call raised PostgreSQL 42P01 — undefined_table — on every
// deployment this service has ever had.
//
// It went unnoticed because the handler discarded the error (`summary, _ :=`)
// and answered 200 with hardcoded zeros. So a project with real spend and a
// project that does not exist produced byte-identical dashboards, and the one
// state the endpoint could actually be in — broken — was the one it could not
// report. Deleting the queries is not a behaviour change: they never returned a
// row. What changes is that the failure is now visible.
//
// # Why they are not simply repointed at real tables
//
// Because most of what this endpoint claims to report has no producer anywhere
// in the platform, and the rest cannot be sourced without a product decision
// this file is not the place to take. Measured against the current corpus:
//
//   - total_tokens — NO producer. The gateway computes token counts and
//     converts them to nano-USD on the spot; a GATEWAY_BUDGET_DELTAS delta
//     carries {event_id, scope, scope_id, project_id, org_id, period_start,
//     period_end, delta_nano_usd} and no token fields
//     (elitea-scheduler/internal/budgetwriteback/types.go), so the counts are
//     not recoverable downstream. `centry.audit_events` has the columns and is
//     READ-ONLY from this service — the legacy tracing plugin was its writer.
//   - llm_calls — NO producer, same reason. There is no per-call row. The
//     accumulator's count(*) counts billing periods, not calls; /analytics_costs
//     is careful to publish it as `rows` and this endpoint must be too.
//   - unique_users / ai_active_users / adoption_rate — NO producer. Per-user AI
//     attribution lives in `centry.audit_events`, which nothing writes here.
//   - total_cost — HAS a producer (gateway.llm_budget_accumulators), and
//     /analytics_costs already reports it. Duplicating that read here would be
//     a second view of the same money, which is fine, but on its own it does
//     not make this endpoint answerable.
//   - agent_runs, tool_runs, chat_msgs — HAVE producers, and each carries a
//     real modelling fork that has to be decided rather than guessed:
//     elitea_runtime.execution_jobs has no `project_id`, it has
//     `resource_project_id` AND `projection_project_id` and they can differ;
//     the chat and trace tables are scoped by TENANT SCHEMA rather than by a
//     column and store `timestamp` where the runtime and gateway tables store
//     `timestamptz`, so one "analytics for project N" query spans both only
//     with dynamic SQL and an explicit cast — the kind of mismatch that yields
//     a plausible wrong window rather than an error.
//
// Answering "what should the analytics dashboard count, from which of those
// two project columns, over which clock" is a product question. Until it is
// answered, this repository reports that it has no source rather than inventing
// one, and the handler turns that into a 500. A 500 is a worse dashboard than
// real numbers and a better one than fabricated zeros: an operator can see it.

import (
	"context"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

type AnalyticsRepo struct {
	pool *pgxpool.Pool
}

func NewAnalyticsRepo(pool *pgxpool.Pool) *AnalyticsRepo {
	return &AnalyticsRepo{pool: pool}
}

// The pool field is retained deliberately. Nothing reads it today because every
// method below refuses, and it is what the first real query will need —
// dropping it would turn wiring one back up into a constructor change across
// cmd/elitea-main/main.go and internal/api/router.go as well.

func (r *AnalyticsRepo) GetUsageSummary(context.Context, analytics.QueryParams) (analytics.UsageSummary, error) {
	return analytics.UsageSummary{}, analytics.NoSourceError("usage summary",
		"total_tokens and llm_calls have no producer; total_cost is served by /analytics_costs")
}

func (r *AnalyticsRepo) GetAgentAnalytics(context.Context, analytics.QueryParams) ([]analytics.AgentAnalytics, error) {
	return nil, analytics.NoSourceError("agent analytics",
		"elitea_runtime.execution_jobs is project-scoped by two different columns and records no token or duration figures")
}

func (r *AnalyticsRepo) GetToolAnalytics(context.Context, analytics.QueryParams) ([]analytics.ToolAnalytics, error) {
	return nil, analytics.NoSourceError("tool analytics",
		"p_<id>.chat_message_trace_step records tool_name but no toolkit_id, and covers chat turns only")
}

func (r *AnalyticsRepo) GetUserActivity(context.Context, analytics.QueryParams) ([]analytics.UserActivity, error) {
	return nil, analytics.NoSourceError("user activity",
		"centry.audit_events is the per-user AI attribution table and is READ-ONLY from this service")
}
