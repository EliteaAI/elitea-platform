package analytics

import "time"

// UsageSummary is the project overview: what the LLM path did in a window.
//
// Every field here has a producer. The figures that do not — tool_runs,
// chat_msgs, agent_runs, and a per-model cost — are ABSENT from this struct
// rather than present and zero, for the reason errors.go gives: a zero is a
// count, and a count nobody measured is a claim.
type UsageSummary struct {
	ProjectID   string       `json:"project_id,omitempty"`
	Period      string       `json:"period"`
	TotalTokens int64        `json:"total_tokens"`
	TotalRuns   int64        `json:"total_runs"`
	ByModel     []ModelUsage `json:"by_model,omitempty"`

	// ModelsTruncated is true when ByModel was cut to the busiest N pairs. The
	// client normalises its share column by summing that array, so a silent cut
	// turns every share into a percentage of the subset rather than of the
	// project — beside a llm_calls figure carrying the real total.
	ModelsTruncated bool `json:"models_truncated"`

	// ActiveUsers is how many distinct callers made an LLM call in the window.
	//
	// CALLERS, not members. It counts every identity the gateway resolved under
	// this project, which includes a removed member, a global administrator and
	// a service token — all of them real usage, none of them in the membership
	// table. That is why it is NOT the numerator of the adoption rate; see
	// ActiveMembers.
	ActiveUsers int64 `json:"active_users"`

	// ActiveMembers is the subset of ActiveUsers that the project's membership
	// actually contains, and is the numerator of the adoption rate. Nil
	// whenever TotalProjectUsers is: both come from the same statement, because
	// a numerator and a denominator measured over two snapshots can disagree.
	ActiveMembers *int64 `json:"active_members,omitempty"`

	// TotalProjectUsers is the project's membership count, and is nil when the
	// membership tables are absent — `public.auth_core__user_role` and
	// `public.auth_core__project_role` are owned by a different corpus and are
	// not created by this service's migrations, so a Go-bootstrapped database
	// legitimately has neither. Nil rather than 0 because "no membership
	// source" and "a project with no members" are different claims, and an
	// adoption rate computed from the second would be a division by zero
	// dressed up as a percentage.
	TotalProjectUsers *int64 `json:"total_project_users,omitempty"`

	// DailyActivity is one point per UTC day that had traffic. Days with no
	// traffic are absent rather than zero-filled: the client draws the axis
	// from the window it asked for and knows which days it is missing.
	DailyActivity []DailyPoint `json:"daily_activity,omitempty"`

	// TopUsers is the leaderboard, most calls first, capped at TopUsersLimit.
	TopUsers []UserActivity `json:"top_users,omitempty"`

	// Health is what went WRONG, and how slowly. Nil only when the read failed;
	// a project with no traffic has a Health with zero totals and empty
	// breakdowns, which is a different and true statement.
	Health *Health `json:"health,omitempty"`
}

// Health is the reliability and latency view of the same window.
//
// It exists because the gateway's per-request log records the requests that
// FAILED, and no other table in this platform does: the billing ledger is
// written from a billing delta, and a billing delta rides only a billed
// request, so a call refused by a budget, rejected by a policy, addressed to an
// unresolvable model or failed upstream never reaches it. A health view built
// over the ledger would list successes and no failures — the opposite of what
// an operator opens one for.
type Health struct {
	// Requests and Errors are the window's totals. An error is status >= 400,
	// the same predicate 0099's partial index is built on.
	Requests int64 `json:"requests"`
	Errors   int64 `json:"errors"`
	// ErrorRate is Errors over Requests, as a percentage to one decimal. Zero
	// for a window with no traffic, which is honest: nothing failed.
	ErrorRate float64 `json:"error_rate"`

	// ByErrorCode is the failure breakdown, most frequent first.
	//
	// The gateway's own CLASSIFICATION, never an upstream string — 0099 has no
	// column a provider's error text can reach, and that is structural rather
	// than a policy somebody has to remember: upstream errors routinely quote
	// the offending fragment of the request back, and a request is user-authored
	// free text.
	ByErrorCode []ErrorCodeCount `json:"by_error_code"`
	// ErrorCodesTruncated is true when ByErrorCode was cut. It sits beside an
	// uncapped Errors total, so a silent cut leaves an operator reconciling the
	// two with failures that belong to no listed classification.
	ErrorCodesTruncated bool `json:"error_codes_truncated"`

	// ByModel is per (provider, model, streaming). Empty for a window whose
	// requests never resolved a model.
	ByModel []ModelHealth `json:"by_model"`

	// Daily is one point per UTC day that had traffic, for the trend chart.
	Daily []DailyHealth `json:"daily"`
}

// ErrorCodeCount is one failure classification's share of the window.
type ErrorCodeCount struct {
	ErrorCode string `json:"error_code"`
	Requests  int64  `json:"requests"`
}

// ModelHealth is one (provider, model, streaming) triple's reliability.
//
// STREAMING IS PART OF THE KEY, not a column. 0099's own header says a streamed
// and a buffered request of the same model have very different latency
// profiles and that averaging them together makes both unreadable — a streamed
// response's duration is the whole stream, which is seconds where a buffered
// call is milliseconds. Folding them into one row would produce a number that
// describes neither, and would move whenever the streamed/buffered mix did.
type ModelHealth struct {
	Provider  string  `json:"provider"`
	Model     string  `json:"model"`
	Streaming bool    `json:"streaming"`
	Requests  int64   `json:"requests"`
	Errors    int64   `json:"errors"`
	ErrorRate float64 `json:"error_rate"`
	// AvgDurationMS and P95DurationMS are wall-clock milliseconds from the start
	// of the handler to the response being complete. Both are reported because
	// they answer different questions and an average alone hides the tail an
	// operator investigating "chat feels slow" is looking for.
	AvgDurationMS float64 `json:"avg_duration_ms"`
	P95DurationMS float64 `json:"p95_duration_ms"`
}

// DailyHealth is one UTC day: how much was served and how much of it failed.
type DailyHealth struct {
	Date     string `json:"date"`
	Requests int64  `json:"requests"`
	Errors   int64  `json:"errors"`
}

// ModelUsage is one (provider, model) pair's share of the window.
//
// There is no TotalCost. Money is keyed by (scope, scope_id, period) in
// gateway.llm_budget_accumulators and carries no model dimension, so a
// per-model cost cannot be derived from anything this platform writes —
// /analytics_costs says the same thing about the same table. A zero here would
// read as "this model was free".
type ModelUsage struct {
	Model            string `json:"model"`
	Provider         string `json:"provider"`
	PromptTokens     int64  `json:"prompt_tokens"`
	CompletionTokens int64  `json:"completion_tokens"`
	RunCount         int64  `json:"run_count"`
}

// DailyPoint is one UTC day of the window.
type DailyPoint struct {
	Date        string `json:"date"`
	LLMCalls    int64  `json:"llm_calls"`
	TotalTokens int64  `json:"total_tokens"`
	ActiveUsers int64  `json:"active_users"`
}

type AgentAnalytics struct {
	ApplicationID string  `json:"application_id"`
	Name          string  `json:"name"`
	RunCount      int64   `json:"run_count"`
	AvgDuration   float64 `json:"avg_duration_ms"`
	TotalTokens   int64   `json:"total_tokens"`
	ErrorRate     float64 `json:"error_rate"`
}

type ToolAnalytics struct {
	ToolkitID   string  `json:"toolkit_id"`
	ToolName    string  `json:"tool_name"`
	RunCount    int64   `json:"run_count"`
	AvgDuration float64 `json:"avg_duration_ms"`
	ErrorRate   float64 `json:"error_rate"`
}

// UserActivity is one member's LLM usage in the window.
//
// Email is empty when the identity tables are absent — the same guarded read as
// TotalProjectUsers. The row is still reported: "user 41 made 900 calls" is
// useful without a display name, and dropping the row because a join failed
// would silently shrink a leaderboard.
type UserActivity struct {
	UserID       string    `json:"user_id"`
	Email        string    `json:"email"`
	Name         string    `json:"name,omitempty"`
	RunCount     int64     `json:"run_count"`
	TotalTokens  int64     `json:"total_tokens"`
	LastActiveAt time.Time `json:"last_active_at"`
}

// QueryParams is one analytics read's scope.
//
// From/To are the RESOLVED window — parsed, defaulted and clamped by the API
// layer's dateWindow, so every repository method reads the same instants and no
// query has to re-interpret a raw string. StartDate/EndDate are kept as the
// caller sent them for diagnostics only; nothing queries on them.
type QueryParams struct {
	ProjectID string    `json:"-"`
	From      time.Time `json:"-"`
	To        time.Time `json:"-"`
	StartDate string    `json:"start_date,omitempty"`
	EndDate   string    `json:"end_date,omitempty"`
	Period    string    `json:"period,omitempty"`
	Page      int       `json:"page,omitempty"`
	PageSize  int       `json:"page_size,omitempty"`
}
