package repos

// AnalyticsRepo — the /elitea_core/analytics reads.
//
// # What used to be here, and why the refusal was right at the time
//
// Four methods, each a SELECT against `usage_records` or `tool_usage_records`.
// Neither table has ever existed: no migration creates them, nothing INSERTs
// into them, and every call raised PostgreSQL 42P01 on every deployment this
// service has ever had. It went unnoticed because the handler discarded the
// error (`summary, _ :=`) and answered 200 with hardcoded zeros, so a project
// with real spend and a project that does not exist produced byte-identical
// dashboards (issue #303).
//
// The queries were deleted and every method returned ErrNoSource, because at
// that moment nothing in the platform produced the figures. That was accurate
// when it was written and it is no longer accurate for half of this file, which
// is the point worth keeping: a disclosed gap is a claim about the corpus at a
// moment in time, and nothing re-checks it when the corpus changes.
//
// # What changed: gateway.llm_request_logs (shared migration 0099)
//
// The LLM Proxy work gave the gateway a per-request log — one row per request
// it served, billed or not, succeeded or not — carrying project_id, user_id,
// model, provider, prompt_tokens, completion_tokens, status, duration_ms and
// occurred_at. That is a direct producer for the figures this endpoint could
// not source before, and it sidesteps every modelling fork the old note listed
// as the reason not to guess:
//
//   - ONE project column. `elitea_runtime.execution_jobs` has
//     `resource_project_id` AND `projection_project_id` and they can differ, so
//     "analytics for project N" had no single answer. This table has
//     `project_id` and nothing else.
//   - ONE clock. The chat and trace tables are scoped by TENANT SCHEMA and
//     store `timestamp` where the gateway tables store `timestamptz`, so one
//     query spanning both needed dynamic SQL and an explicit cast — the kind of
//     mismatch that yields a plausible wrong window rather than an error. This
//     table is `timestamptz`, in one schema.
//   - PER-CALL ROWS. `gateway.llm_budget_accumulators` holds one row per
//     (scope, scope_id, period), so its count(*) counts billing periods, not
//     calls; /analytics_costs is careful to publish that as `rows`. This table
//     has a row per call, so `llm_calls` is a real count.
//
// # What is STILL refused, and why it is not the same kind of gap
//
//   - AGENT analytics. The request log has no agent dimension. A gateway
//     request knows the model it addressed, not the agent that composed it, and
//     nothing correlates the two: there is no trace id on the log and the
//     runtime's execution_jobs carries no token or duration figures to join to.
//   - TOOL analytics. Same shape. `p_<id>.chat_message_trace_step` records a
//     `tool_name` but no `toolkit_id`, and covers chat turns only — so a
//     "toolkit usage" table built from it would silently exclude every tool
//     call an agent made outside a chat.
//
// Both are answered with ErrNoSource, which the API layer turns into a FINAL
// status rather than a retryable one. They are a product gap, not a fault.
//
// # Money is deliberately not read here
//
// `total_cost` has a producer — gateway.llm_budget_accumulators — and
// /analytics_costs already reports it, with the scope rules that keep it from
// double-counting (a user-scope row is a subset of its project's spend, not an
// addition to it). Reading the same table a second way here would be a second
// view of the same money that could disagree with the first. The client asks
// /analytics_costs for cost and this endpoint for volume.

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

// analyticsReadTimeout bounds one dashboard read. Every statement below is
// served by 0099's (project_id, occurred_at DESC) index over a clamped window,
// so this is a backstop rather than a budget.
const analyticsReadTimeout = 20 * time.Second

// topUsersLimit caps the overview's leaderboard, and userRowsLimit caps the
// Users tab's full list.
//
// Both are capped because the row count here is the project's CALLER count, not
// its call count — a group-by collapses a million calls to one row per user —
// but a project bound to a large SCIM group is a real thing on this deployment
// and an uncapped list is a way for one request to serialise all of it.
//
// THE CAP IS STATED IN THE RESPONSE. GetUserActivity reports whether it cut the
// list, the handler publishes that as `truncated`, and the Users tab says so on
// screen. A silent cap would be worse here than almost anywhere else in this
// service, because the CLIENT PAGINATES AND SEARCHES OVER WHAT IT RECEIVES:
// apps/elitea-web/src/features/analytics/api/useAnalytics.ts asks for the
// schema maximum once and treats the result as the complete set. Cut silently,
// a 900-caller project would show the top 500 with a "500 users" count and a
// working pagination footer — presented as everyone, with nothing anywhere able
// to tell the difference.
//
// The leaderboard has no such flag and needs none: it is labelled a top-N list
// on screen, so its cap is the feature rather than a truncation of one.
const (
	topUsersLimit  = 10
	userRowsLimit  = 500
	modelRowsLimit = 100
)

// AnalyticsRepo answers the analytics reads from the gateway's request log.
type AnalyticsRepo struct {
	pool *pgxpool.Pool
}

func NewAnalyticsRepo(pool *pgxpool.Pool) *AnalyticsRepo {
	return &AnalyticsRepo{pool: pool}
}

// requestLogWindow is the row set every query below reads, written once so no
// two of them can describe different rows.
//
// Half-open at the top: a window ending at midnight must not also claim the
// first instant of the next day, or two adjacent windows both count it.
const requestLogWindow = `
WHERE project_id = $1
  AND occurred_at >= $2
  AND occurred_at < $3`

// missingRelation reports whether err is PostgreSQL's undefined_table (42P01)
// or undefined_schema (3F000).
//
// It exists so an absent table becomes a NAMED absence rather than a generic
// 500. A deployment that has not run shared migration 0099 has no
// gateway.llm_request_logs, and "this deployment does not have the request log"
// is a true, actionable sentence; "failed to query analytics" is not.
func missingRelation(err error) bool {
	var pgErr interface{ SQLState() string }
	if !errors.As(err, &pgErr) {
		return false
	}
	switch pgErr.SQLState() {
	case "42P01", "3F000":
		return true
	default:
		return false
	}
}

// projectID parses the path segment once, so a malformed id fails as a bad
// REQUEST rather than as a database error — the API layer maps ErrBadProject to
// 400. It was a plain fmt.Errorf first, which reached writeRepoFailure, matched
// no branch there and answered `500 {"code":"query_failed"}`: the server taking
// the blame for a value the caller sent, and inviting a retry that cannot
// succeed. /analytics_costs answers 400 for the same input.
func projectID(params analytics.QueryParams) (int64, error) {
	id, err := strconv.ParseInt(params.ProjectID, 10, 64)
	if err != nil || id < 1 {
		return 0, analytics.BadProjectError(params.ProjectID)
	}
	return id, nil
}

// GetUsageSummary is the Overview tab: totals, the per-model split, the daily
// series and the leaderboard, all from the request log.
func (r *AnalyticsRepo) GetUsageSummary(ctx context.Context, params analytics.QueryParams) (analytics.UsageSummary, error) {
	id, err := projectID(params)
	if err != nil {
		return analytics.UsageSummary{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, analyticsReadTimeout)
	defer cancel()

	// ONE snapshot for all four statements, for the reason /analytics_costs
	// opens one: the gateway commits into this table continuously, so without
	// it the totals could be summed over rows the daily series never saw, and a
	// dashboard whose header disagrees with its own chart is worse than a stale
	// one. Read-only REPEATABLE READ cannot raise a serialization failure, so
	// this buys a snapshot and no retry path.
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return analytics.UsageSummary{}, fmt.Errorf("analytics: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	summary := analytics.UsageSummary{ProjectID: params.ProjectID, Period: params.Period}

	const totalsQuery = `
SELECT count(*)::bigint,
       coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint,
       count(DISTINCT user_id)::bigint
FROM gateway.llm_request_logs` + requestLogWindow

	if err := tx.QueryRow(ctx, totalsQuery, id, params.From, params.To).
		Scan(&summary.TotalRuns, &summary.TotalTokens, &summary.ActiveUsers); err != nil {
		if missingRelation(err) {
			return analytics.UsageSummary{}, analytics.NoSourceError("usage summary",
				"gateway.llm_request_logs is absent — shared migration 0099 has not run on this database")
		}
		return analytics.UsageSummary{}, fmt.Errorf("analytics: usage totals: %w", err)
	}

	if summary.ByModel, err = modelUsage(ctx, tx, id, params); err != nil {
		return analytics.UsageSummary{}, err
	}
	if summary.DailyActivity, err = dailyActivity(ctx, tx, id, params); err != nil {
		return analytics.UsageSummary{}, err
	}
	if summary.TopUsers, err = userActivity(ctx, tx, id, params, topUsersLimit); err != nil {
		return analytics.UsageSummary{}, err
	}
	members, activeMembers, ok, err := projectAdoption(ctx, tx, id, params)
	if err != nil {
		return analytics.UsageSummary{}, err
	}
	if ok {
		summary.TotalProjectUsers = &members
		summary.ActiveMembers = &activeMembers
	}

	return summary, nil
}

// GetUserActivity is the Users tab: every caller who made a request in the
// window, and whether that list had to be cut.
func (r *AnalyticsRepo) GetUserActivity(ctx context.Context, params analytics.QueryParams) ([]analytics.UserActivity, bool, error) {
	id, err := projectID(params)
	if err != nil {
		return nil, false, err
	}

	ctx, cancel := context.WithTimeout(ctx, analyticsReadTimeout)
	defer cancel()

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, false, fmt.Errorf("analytics: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// One row OVER the cap is requested, so "there is more" is a fact about the
	// result set rather than a guess from `len(rows) == limit` — which cannot
	// tell a project with exactly 500 callers from one with 5,000.
	users, err := userActivity(ctx, tx, id, params, userRowsLimit+1)
	if err != nil {
		return nil, false, err
	}
	if len(users) > userRowsLimit {
		return users[:userRowsLimit], true, nil
	}
	return users, false, nil
}

// GetAgentAnalytics has no source. See the file header for why this is a
// product gap rather than a fault, and why it is not sourced from
// elitea_runtime.execution_jobs.
func (r *AnalyticsRepo) GetAgentAnalytics(context.Context, analytics.QueryParams) ([]analytics.AgentAnalytics, error) {
	return nil, analytics.NoSourceError("agent analytics",
		"the gateway request log carries no agent dimension, and elitea_runtime.execution_jobs is project-scoped by two different columns and records no token or duration figures")
}

// GetToolAnalytics has no source. See the file header.
func (r *AnalyticsRepo) GetToolAnalytics(context.Context, analytics.QueryParams) ([]analytics.ToolAnalytics, error) {
	return nil, analytics.NoSourceError("tool analytics",
		"p_<id>.chat_message_trace_step records tool_name but no toolkit_id, and covers chat turns only")
}

// analyticsQuerier is the read seam every helper takes, so they run inside
// whichever snapshot the caller opened. Named for this file because the package
// already has a narrower `querier` (applications.go) that carries only QueryRow.
type analyticsQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// modelUsage splits the window by (provider, model).
//
// Rows with an empty model are EXCLUDED. An empty model means the request never
// got far enough to resolve one — a 404, an auth refusal, a malformed body —
// and those are real traffic but they are not a model's usage; folding them
// into a nameless row would put a blank bar on the chart that no operator can
// act on. They are still in the totals, which is where "we served N requests"
// belongs.
func modelUsage(ctx context.Context, q analyticsQuerier, id int64, params analytics.QueryParams) ([]analytics.ModelUsage, error) {
	const query = `
SELECT model,
       provider,
       coalesce(sum(prompt_tokens), 0)::bigint,
       coalesce(sum(completion_tokens), 0)::bigint,
       count(*)::bigint
FROM gateway.llm_request_logs` + requestLogWindow + `
  AND model <> ''
GROUP BY model, provider
ORDER BY count(*) DESC, model ASC
LIMIT $4`

	rows, err := q.Query(ctx, query, id, params.From, params.To, modelRowsLimit)
	if err != nil {
		return nil, fmt.Errorf("analytics: model usage: %w", err)
	}
	defer rows.Close()

	models := make([]analytics.ModelUsage, 0)
	for rows.Next() {
		var m analytics.ModelUsage
		if err := rows.Scan(&m.Model, &m.Provider, &m.PromptTokens, &m.CompletionTokens, &m.RunCount); err != nil {
			return nil, fmt.Errorf("analytics: model usage scan: %w", err)
		}
		models = append(models, m)
	}
	return models, rows.Err()
}

// dailyActivity is one point per UTC day that had traffic.
//
// The bucket is `AT TIME ZONE 'UTC'` rather than the session's TimeZone, which
// is whatever the connection happened to inherit. Without the cast, the same
// window bucketed on a server set to a different zone yields a different first
// and last day, and the chart shifts by one column with nothing to show for it.
func dailyActivity(ctx context.Context, q analyticsQuerier, id int64, params analytics.QueryParams) ([]analytics.DailyPoint, error) {
	const query = `
SELECT to_char(date_trunc('day', occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD'),
       count(*)::bigint,
       coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint,
       count(DISTINCT user_id)::bigint
FROM gateway.llm_request_logs` + requestLogWindow + `
GROUP BY 1
ORDER BY 1`

	rows, err := q.Query(ctx, query, id, params.From, params.To)
	if err != nil {
		return nil, fmt.Errorf("analytics: daily activity: %w", err)
	}
	defer rows.Close()

	points := make([]analytics.DailyPoint, 0)
	for rows.Next() {
		var p analytics.DailyPoint
		if err := rows.Scan(&p.Date, &p.LLMCalls, &p.TotalTokens, &p.ActiveUsers); err != nil {
			return nil, fmt.Errorf("analytics: daily activity scan: %w", err)
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

// userActivity groups the window by member, then enriches with identity.
//
// Rows whose user_id is NULL are excluded: 0099 stores NULL for a request that
// resolved no member, and "no member" is not a user to put on a leaderboard.
func userActivity(ctx context.Context, q analyticsQuerier, id int64, params analytics.QueryParams, limit int) ([]analytics.UserActivity, error) {
	const query = `
SELECT user_id,
       count(*)::bigint,
       coalesce(sum(prompt_tokens + completion_tokens), 0)::bigint,
       max(occurred_at)
FROM gateway.llm_request_logs` + requestLogWindow + `
  AND user_id IS NOT NULL
GROUP BY user_id
ORDER BY count(*) DESC, user_id ASC
LIMIT $4`

	rows, err := q.Query(ctx, query, id, params.From, params.To, limit)
	if err != nil {
		if missingRelation(err) {
			return nil, analytics.NoSourceError("user activity",
				"gateway.llm_request_logs is absent — shared migration 0099 has not run on this database")
		}
		return nil, fmt.Errorf("analytics: user activity: %w", err)
	}
	defer rows.Close()

	users := make([]analytics.UserActivity, 0)
	ids := make([]int64, 0)
	for rows.Next() {
		var (
			user   analytics.UserActivity
			userID int64
		)
		if err := rows.Scan(&userID, &user.RunCount, &user.TotalTokens, &user.LastActiveAt); err != nil {
			return nil, fmt.Errorf("analytics: user activity scan: %w", err)
		}
		user.UserID = strconv.FormatInt(userID, 10)
		users = append(users, user)
		ids = append(ids, userID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(users) == 0 {
		return users, nil
	}

	identities, err := userIdentities(ctx, q, ids)
	if err != nil {
		return nil, err
	}
	for i := range users {
		if identity, ok := identities[users[i].UserID]; ok {
			users[i].Email = identity.email
			users[i].Name = identity.name
		}
	}
	return users, nil
}

type userIdentity struct {
	email string
	name  string
}

// userIdentities resolves display identity for the ids on the leaderboard.
//
// A MISS IS NOT A FAILURE. `public.auth_core__user` is owned by a different
// corpus — 0060 guards on `to_regclass` before touching it for the same reason
// — so a Go-bootstrapped database legitimately has no such table. If the join
// cannot run, every row keeps its numbers and loses only its email. Failing the
// whole read because a decoration is unavailable is the "absence reads as
// failure" defect, and it is why this is a second statement rather than a LEFT
// JOIN on the query above.
//
// THE MISS MUST BE DETECTED BEFORE THE STATEMENT RUNS, NOT AFTER IT FAILS.
//
// A `WHERE to_regclass(...) IS NOT NULL` predicate inside the query reads like a
// guard and is not one: PostgreSQL resolves the names in the FROM clause while
// PARSING, so a query naming a missing table raises 42P01 before any predicate
// is evaluated. checkRelations CAN ask the question in SQL only because
// to_regclass takes the name as a STRING and nothing in that statement's FROM
// clause has to resolve.
//
// Catching the 42P01 afterwards is not enough either, and this is the part that
// cost a real figure. GetUsageSummary runs every statement in ONE transaction,
// and in PostgreSQL a failed statement aborts the whole transaction: every
// later statement on it answers 25P02 (in_failed_sql_transaction) until it is
// rolled back. So tolerating the error here did not contain it — it poisoned
// the tx, projectMemberCount's own probe then failed, checkRelations reported
// "absent", and a project with a populated membership table reported NO
// denominator and NO adoption rate.
//
// That state is real and not exotic: `public.auth_core__user` and the two role
// tables are created by different corpora, and a database can legitimately have
// the role tables and not the user table. TestMembershipSurvivesAnAbsentUserTable
// pins it; the pre-existing missing-tables test could not, because it dropped
// all three and the denominator would have been absent either way.
//
// The error check below stays as the belt to this braces: the probe and the
// query are two statements and a table could vanish between them.
func userIdentities(ctx context.Context, q analyticsQuerier, ids []int64) (map[string]userIdentity, error) {
	const query = `
SELECT u.id, coalesce(u.email, ''), coalesce(u.name, '')
FROM public.auth_core__user AS u
WHERE u.id = ANY($1)`

	if !checkRelations(ctx, q, "public.auth_core__user") {
		return map[string]userIdentity{}, nil
	}

	rows, err := q.Query(ctx, query, ids)
	if err != nil {
		if missingRelation(err) {
			return map[string]userIdentity{}, nil
		}
		return nil, fmt.Errorf("analytics: user identities: %w", err)
	}
	defer rows.Close()

	identities := make(map[string]userIdentity, len(ids))
	for rows.Next() {
		var (
			id       int64
			identity userIdentity
		)
		if err := rows.Scan(&id, &identity.email, &identity.name); err != nil {
			return nil, fmt.Errorf("analytics: user identities scan: %w", err)
		}
		identities[strconv.FormatInt(id, 10)] = identity
	}
	return identities, rows.Err()
}

// projectAdoption measures BOTH sides of the adoption rate in one statement,
// and reports whether it could be measured at all.
//
// # WHY BOTH SIDES, AND NOT JUST THE DENOMINATOR
//
// The obvious shape — count the members, divide the request log's distinct
// callers by it — produces rates above 100% as a matter of course, because the
// two figures are drawn from unrelated sets. `count(DISTINCT user_id)` over the
// request log counts everyone who called the gateway under this project:
// a member who has since been removed, a global administrator, a service token.
// None of them is in the denominator. Measured on a real schema, one member and
// three non-member callers reported `adoption_rate: 300`, `ai_active_users: 3`,
// `total_project_users: 1` — and the tile rendered "3 of 1, ↑300% adoption".
//
// That is the same defect as dividing by an invented zero, in the other
// direction: a percentage of two different populations. So the numerator here
// is the INTERSECTION — members who called — and both sides come from one
// statement over one snapshot, which is also the only way they cannot disagree.
//
// The unintersected caller count is still reported, as ai_active_users. It is a
// true and useful figure ("this many people used AI here"); it is just not the
// numerator of an adoption rate.
//
// DISTINCT on the member count, because membership is expressed as role grants
// and one member can hold several roles in the same project — counting grants
// would inflate the denominator and understate adoption.
//
// Guarded like userIdentities, and for the same reason: these tables belong to
// a different corpus. When they are absent the caller omits total_project_users
// and adoption_rate entirely rather than reporting a rate over a denominator it
// invented.
func projectAdoption(ctx context.Context, q analyticsQuerier, id int64, params analytics.QueryParams) (members, active int64, ok bool, err error) {
	const query = `
WITH project_members AS (
    SELECT DISTINCT ur.user_id
    FROM public.auth_core__user_role AS ur
    JOIN public.auth_core__project_role AS pr ON pr.id = ur.role_id
    WHERE pr.project_id = $1
)
SELECT (SELECT count(*)::bigint FROM project_members),
       (SELECT count(DISTINCT l.user_id)::bigint
        FROM gateway.llm_request_logs AS l
        WHERE l.project_id = $1
          AND l.occurred_at >= $2
          AND l.occurred_at < $3
          AND l.user_id IN (SELECT user_id FROM project_members))`

	// Asked BEFORE the statement below, for the reason userIdentities gives at
	// length: the query names both tables in its FROM clause, so a missing one
	// raises 42P01 at parse time, no in-query predicate can prevent it, and the
	// resulting error would abort the shared transaction rather than being
	// contained. The missingRelation check after it is the belt to this braces
	// — the two statements are not atomic.
	if !checkRelations(ctx, q, "public.auth_core__user_role", "public.auth_core__project_role") {
		return 0, 0, false, nil
	}

	if err := q.QueryRow(ctx, query, id, params.From, params.To).Scan(&members, &active); err != nil {
		if missingRelation(err) {
			return 0, 0, false, nil
		}
		return 0, 0, false, fmt.Errorf("analytics: project adoption: %w", err)
	}
	return members, active, true, nil
}

// checkRelations reports whether every named relation exists, in one round
// trip. `to_regclass` returns NULL rather than raising for a missing name,
// which is what makes this askable at all.
func checkRelations(ctx context.Context, q analyticsQuerier, names ...string) bool {
	var present bool
	if err := q.QueryRow(ctx,
		`SELECT bool_and(to_regclass(name) IS NOT NULL) FROM unnest($1::text[]) AS name`,
		names).Scan(&present); err != nil {
		return false
	}
	return present
}
