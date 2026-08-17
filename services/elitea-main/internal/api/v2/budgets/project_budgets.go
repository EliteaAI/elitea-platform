package budgets

// Project budgets.
//
//	GET  /elitea_core/project_budget/{mode}/{project_id}/budget   ← project_budget.py
//	PUT  /elitea_core/project_budget/administration/{project_id}/budget
//	GET  /elitea_core/project_budgets/administration              ← project_budgets.py
//
// The PUT is the only write in this package that reaches enforcement: it sets
// gateway.project_budget.is_unlimited and hard_limit_usd, which the gateway's
// failmode snapshot reads on the next call.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

// budgetState is the assembled read model both the project and the member
// endpoints answer with. Its money fields are *json.Number so an unlimited
// scope reports `null` rather than a zero that reads like "no budget left".
type budgetState struct {
	MonthlyLimit   *json.Number `json:"monthly_limit"`
	EffectiveLimit *json.Number `json:"effective_limit"`
	LimitSource    string       `json:"limit_source"`
	Currency       string       `json:"currency"`
	Enabled        bool         `json:"enabled"`
	WarningPct     int          `json:"warning_pct"`
	Spend          *json.Number `json:"spend"`
	Remaining      *json.Number `json:"remaining"`
	PercentUsed    *json.Number `json:"percent_used"`
	SpendAvailable bool         `json:"spend_available"`
	Period         string       `json:"period"`
	PeriodStart    string       `json:"period_start"`
	PeriodEnd      string       `json:"period_end"`
	ResetsAt       string       `json:"resets_at"`
}

// projectBudgetState is a project's budget plus the period it accrues over.
type projectBudgetState struct {
	ProjectID    int64  `json:"project_id"`
	BudgetPeriod string `json:"budget_period"`
	budgetState
}

// budgetStateSelect assembles one scope's budget and current-period spend in a
// single round trip.
//
// Every derived money figure — remaining, percent_used — is computed by
// PostgreSQL in NUMERIC and returned as text. Computing them here in float64
// would reintroduce the rounding the whole money path is built to avoid, and
// the percentage is what a warning banner triggers on.
//
// The LEFT JOINs from a one-row anchor are what make "this project has no
// budget row" and "this project has a budget row" the same shape: the query
// always returns exactly one row, so a project nobody has configured reports an
// unlimited state instead of 404-ing a page that legitimately has nothing to
// show yet.
//
// Arguments: $1 scope_id, $2 scope, $3 period_start, $4 default warning pct,
// then whatever the caller's limit-table join binds from $5 on.
//
// `enforced` is read from the limit join's `is_unlimited`, NOT from `enabled`.
// For gateway.project_budget those are two different columns and only the first
// one governs: it is what the gateway's failmode snapshot reads. `enabled` is
// the AUTHORED flag, and a row this API did not write can have the two
// disagree — a pre-existing row with `is_unlimited = true` and a non-null
// hard_limit_usd is backfilled to `enabled = true` by 003, and deriving from
// `enabled` would then report an enforced ceiling that admits every call. Both
// limit joins project an `is_unlimited`, so this select reads what is enforced
// and reports `enabled` alongside it without conflating them.
const budgetStateSelect = `
SELECT
    limits.hard_limit_usd::text                                  AS monthly_limit,
    COALESCE(limits.enabled, false)                              AS enabled,
    (NOT COALESCE(limits.is_unlimited, true))                    AS enforced,
    COALESCE(limits.soft_alert_pct, `+globalWarningPctSQL+`, $4::smallint) AS warning_pct,
    COALESCE(accrued.accumulated_cost, 0)::text                  AS spend,
    (accrued.accumulated_cost IS NOT NULL)                       AS spend_available,
    CASE WHEN NOT COALESCE(limits.is_unlimited, true) AND limits.hard_limit_usd IS NOT NULL
         THEN GREATEST(0, limits.hard_limit_usd - COALESCE(accrued.accumulated_cost, 0))::text
    END                                                          AS remaining,
    CASE WHEN NOT COALESCE(limits.is_unlimited, true) AND limits.hard_limit_usd > 0
         THEN round(COALESCE(accrued.accumulated_cost, 0) / limits.hard_limit_usd * 100, 2)::text
    END                                                          AS percent_used`

// readBudgetState runs budgetStateSelect against one limit table. limitJoin is
// a fixed SQL fragment chosen by the caller from the two constants below, never
// assembled from request data; joinArgs bind its $5-onward placeholders.
func (h *Handler) readBudgetState(
	ctx context.Context, limitJoin, scope, scopeID string, period reportingPeriod, joinArgs ...any,
) (budgetState, error) {
	var (
		monthlyLimit   *string
		enabled        bool
		enforced       bool
		warningPct     int
		spend          string
		spendAvailable bool
		remaining      *string
		percentUsed    *string
	)
	query := budgetStateSelect + `
FROM (SELECT 1) AS anchor(one)
` + limitJoin + `
LEFT JOIN gateway.llm_budget_accumulators AS accrued
       ON accrued.scope = $2 AND accrued.scope_id = $1
      AND accrued.period_start = $3::timestamptz`
	args := append([]any{scopeID, scope, period.start, DefaultWarningPct}, joinArgs...)
	err := h.pool.QueryRow(ctx, query, args...).Scan(
		&monthlyLimit, &enabled, &enforced, &warningPct, &spend, &spendAvailable, &remaining, &percentUsed,
	)
	if err != nil {
		return budgetState{}, fmt.Errorf("budgets: read %s budget state: %w", scope, err)
	}

	state := budgetState{
		MonthlyLimit:   numeric(monthlyLimit),
		Currency:       defaultCurrency,
		Enabled:        enabled,
		WarningPct:     warningPct,
		Spend:          numeric(&spend),
		Remaining:      numeric(remaining),
		PercentUsed:    numeric(percentUsed),
		SpendAvailable: spendAvailable,
		Period:         period.label(),
		PeriodStart:    period.firstDay(),
		PeriodEnd:      period.lastDay(),
		ResetsAt:       period.resetsAt(),
	}
	// The enforced limit, which is not the stored one: a scope the gateway
	// treats as unlimited keeps the number an operator typed but is not held
	// to it. `enforced` comes from is_unlimited, so this cannot claim a ceiling
	// the gateway is not applying.
	state.LimitSource = limitSourceUnlimited
	if enforced && monthlyLimit != nil {
		state.EffectiveLimit = state.MonthlyLimit
		state.LimitSource = limitSourceExplicit
	}
	return state, nil
}

// DefaultWarningPct is the last-resort utilisation percentage, used when
// neither the scope nor the platform config names one.
//
// It is the SAME number as internal/api/gateway.DefaultSoftAlertThresholdPct
// and as the literal in the gateway's own snapshot query
// (failmode/store.go defaultSoftAlertPctSQL). It is a FALLBACK now rather than
// a default: since #322 the platform threshold an operator sets through
// PUT /admin/gateway/budget-alerts is consulted first, and migration 0084 made
// gateway.project_budget.soft_alert_pct nullable so "this project authored no
// threshold" is representable and that platform value has something to apply
// to. Before that the column was NOT NULL DEFAULT 80 and the global default
// could never reach anything.
const DefaultWarningPct = 80

// globalWarningPctSQL is the platform default threshold: the same
// gateway.governance_config row the gateway's snapshot query reads and the
// budget-alerts surface writes (internal/api/gateway/budget_alerts.go).
//
// It is spliced into the COALESCE chain of every read that reports a warning
// percentage, so the API and the gateway resolve the same threshold for the
// same project. A reader that stopped at DefaultWarningPct would show an
// operator 80 while the gateway alerted at the value they set.
const globalWarningPctSQL = `(SELECT (data->>'threshold_pct')::smallint
	FROM gateway.governance_config
	WHERE section = 'governance' AND type = 'budget_alert' AND name = 'global'
	  AND enabled)`

// projectLimitJoin and userLimitJoin (user_budgets.go) are the two fixed
// limit-table joins readBudgetState selects between. Both MUST expose
// hard_limit_usd, enabled, soft_alert_pct and is_unlimited — the last is what
// budgetStateSelect reads to decide whether a ceiling is enforced, and for the
// project table it is a real column rather than a derivation.
const projectLimitJoin = `LEFT JOIN (
    SELECT project_id, hard_limit_usd, enabled, soft_alert_pct, is_unlimited
    FROM gateway.project_budget
) AS limits ON limits.project_id = $5::integer`

// userBudgetScopeID is the accumulator scope_id a per-member figure would be
// keyed by. Nothing publishes it today (see budgetScopeUser); the shape is
// project-qualified because a user id alone would collide across projects, and
// the accumulator's unique key is (scope, scope_id, period_start).
func userBudgetScopeID(projectID, userID int64) string {
	return strconv.FormatInt(projectID, 10) + ":" + strconv.FormatInt(userID, 10)
}

/* ── GET the project's own budget ──────────────────────────────────────── */

// GetProjectBudget serves the PROJECT-SCOPED (prompt_lib) read, gated on
// `models.project_context.view` against the project in the path.
//
// It applies the same amount redaction /usage does, and for the same reason:
// the two endpoints serve the SAME spend and limit figures behind the SAME
// gate, so a member refused the amounts on one could simply read them off the
// other. The reference redacts on /usage only, which makes the control
// decorative the moment both endpoints exist; the divergence is deliberate.
func (h *Handler) GetProjectBudget(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}
	caller, authenticated := callerID(r)
	if !authenticated {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	ctx := r.Context()
	state, err := h.projectBudget(ctx, projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read project budget")
		return
	}
	payload, err := structToMap(state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read project budget")
		return
	}
	visible, err := h.canSeeAmounts(ctx, projectID, caller)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve project role")
		return
	}
	applyAmountVisibility(payload, visible)
	writeJSON(w, http.StatusOK, payload)
}

// GetProjectBudgetAdmin serves the administration-mode read, gated centrally on
// `models.admin.project_budgets.view`. A platform administrator is entitled to
// the cost figures by definition, so it does not redact and carries no
// can_see_amounts field.
func (h *Handler) GetProjectBudgetAdmin(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}
	state, err := h.projectBudget(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read project budget")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (h *Handler) projectBudget(ctx context.Context, projectID int64) (projectBudgetState, error) {
	period := periodFor(h.clock())
	state, err := h.readBudgetState(
		ctx, projectLimitJoin, budgetScopeProject, strconv.FormatInt(projectID, 10), period, projectID,
	)
	if err != nil {
		return projectBudgetState{}, err
	}
	// budget_period is reported, not settable: the gateway derives the period
	// from the calendar month unconditionally (billingPeriodStart), so a stored
	// 'weekly' would be a value nothing honours.
	return projectBudgetState{ProjectID: projectID, BudgetPeriod: "monthly", budgetState: state}, nil
}

/* ── PUT the project's budget ──────────────────────────────────────────── */

// budgetWrite is project_budget.py's and user_budget.py's shared payload.
//
// MonthlyLimit is *json.Number so the exact decimal the operator typed reaches
// PostgreSQL as text and is cast to NUMERIC there; an absent field and an
// explicit null both mean "no ceiling", as they do in the reference.
type budgetWrite struct {
	MonthlyLimit *json.Number `json:"monthly_limit"`
	Enabled      *bool        `json:"enabled"`
	Currency     *string      `json:"currency"`
	SoftAlertPct *int         `json:"soft_alert_pct"`
}

// parsedBudgetWrite is a validated payload, with the defaults the reference
// applies already resolved.
type parsedBudgetWrite struct {
	monthlyLimit *string
	enabled      bool
	softAlertPct *int
}

// decodeBudgetWrite validates a budget payload, answering the request itself on
// rejection.
func decodeBudgetWrite(w http.ResponseWriter, r *http.Request) (parsedBudgetWrite, bool) {
	var body budgetWrite
	decoder := json.NewDecoder(r.Body)
	decoder.UseNumber()
	if err := decoder.Decode(&body); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return parsedBudgetWrite{}, false
	}

	parsed := parsedBudgetWrite{enabled: true}
	if body.Enabled != nil {
		parsed.enabled = *body.Enabled
	}
	if body.MonthlyLimit != nil {
		limit, err := body.MonthlyLimit.Float64()
		if err != nil {
			writeError(w, http.StatusBadRequest, "monthly_limit must be a number")
			return parsedBudgetWrite{}, false
		}
		if limit < 0 {
			writeError(w, http.StatusBadRequest, "monthly_limit must be >= 0")
			return parsedBudgetWrite{}, false
		}
		// The float parse is a RANGE check only. What is stored is the original
		// decimal text, cast to NUMERIC by PostgreSQL, so the float never
		// touches the value that gets enforced.
		text := body.MonthlyLimit.String()
		parsed.monthlyLimit = &text
	}
	// A currency other than USD is refused rather than stored: nothing in the
	// money path converts, so an accepted "EUR" would be a label on a limit the
	// gateway still enforces as dollars.
	if body.Currency != nil && !strings.EqualFold(*body.Currency, defaultCurrency) {
		writeError(w, http.StatusBadRequest, "currency must be USD")
		return parsedBudgetWrite{}, false
	}
	if body.SoftAlertPct != nil {
		if *body.SoftAlertPct < 1 || *body.SoftAlertPct > 100 {
			writeError(w, http.StatusBadRequest, "soft_alert_pct must be between 1 and 100")
			return parsedBudgetWrite{}, false
		}
		parsed.softAlertPct = body.SoftAlertPct
	}
	return parsed, true
}

// projectBudgetUpsert writes the authored limit AND the derived enforcement
// flag in one statement.
//
// An INSERT that supplies no threshold now stores NULL rather than 80, so the
// project inherits whatever platform default is in force at read time (#322).
// The UPDATE branch still COALESCEs to the EXISTING value, not to NULL: a PUT
// that changes only the limit must not silently move a threshold the operator
// chose earlier.
//
// `is_unlimited` is the column the gateway reads; `enabled` and
// `hard_limit_usd` are what the operator authored. Deriving one from the other
// in SQL, in the same statement, is what stops them from drifting — a second
// statement that set is_unlimited separately could be interrupted between the
// two and leave a project with a limit nothing enforces.
const projectBudgetUpsert = `
INSERT INTO gateway.project_budget AS existing
    (project_id, hard_limit_usd, enabled, is_unlimited, soft_alert_pct, budget_period, updated_at)
VALUES ($1, $2::numeric, $3, ($2::numeric IS NULL OR NOT $3), $4::smallint, 'monthly', now())
ON CONFLICT (project_id) DO UPDATE SET
    hard_limit_usd = EXCLUDED.hard_limit_usd,
    enabled        = EXCLUDED.enabled,
    is_unlimited   = EXCLUDED.is_unlimited,
    soft_alert_pct = COALESCE($4::smallint, existing.soft_alert_pct),
    updated_at     = now()`

// PutProjectBudget serves project_budget.py's administration-mode PUT.
//
// It answers with the resulting state rather than the request, which can differ
// from what was sent: a null limit or enabled=false leaves the project
// unlimited, so `effective_limit` and `limit_source` are the fields worth
// reading back.
func (h *Handler) PutProjectBudget(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}
	parsed, ok := decodeBudgetWrite(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	if _, err := h.pool.Exec(ctx, projectBudgetUpsert,
		projectID, parsed.monthlyLimit, parsed.enabled, parsed.softAlertPct,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save project budget")
		return
	}

	state, err := h.projectBudget(ctx, projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read project budget")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

/* ── the admin listing ─────────────────────────────────────────────────── */

// projectBudgetRow is one row of Admin → Budgets.
type projectBudgetRow struct {
	ProjectID   int64  `json:"project_id"`
	Name        string `json:"name"`
	DisplayName string `json:"display_name"`
	OwnerName   string `json:"owner_name"`
	OwnerEmail  string `json:"owner_email"`
	IsPersonal  bool   `json:"is_personal"`
	budgetState
}

type projectBudgetListing struct {
	Rows   []projectBudgetRow `json:"rows"`
	Total  int                `json:"total"`
	Counts map[string]int     `json:"counts"`
}

// personalProjectPredicate classifies a project as personal, the same LIKE the
// admin project listing uses (internal/api/v2/admin/projects.go).
const personalProjectPredicate = `(p.name LIKE 'project_user_%')`

// sortableBudgetColumns is project_budgets.py's SORTABLE_FIELDS, and the reason
// it is only two: limit, spend and utilisation are per-row derivations, so
// ordering by them would sort the page that was already fetched rather than the
// table. An unknown value falls back to name, as the reference's
// `_safe_sort_field` does — silently choosing a different column and reporting
// success is how a sortable header lies.
var sortableBudgetColumns = map[string]string{
	"name": "p.name",
	"id":   "p.id",
}

// projectBudgetPageSQL joins each project on its authored budget and its
// current-period accumulator, so the whole page is one query rather than the
// reference's three fan-out RPCs per page.
const projectBudgetPageSQL = `
SELECT p.id,
       p.name,
       ` + personalProjectPredicate + `                              AS is_personal,
       COALESCE(owner.name, '')                                      AS owner_name,
       COALESCE(owner.email, '')                                     AS owner_email,
       limits.hard_limit_usd::text                                   AS monthly_limit,
       COALESCE(limits.enabled, false)                               AS enabled,
       (NOT COALESCE(limits.is_unlimited, true))                     AS enforced,
       COALESCE(limits.soft_alert_pct, `+globalWarningPctSQL+`, $1::smallint) AS warning_pct,
       COALESCE(accrued.accumulated_cost, 0)::text                   AS spend,
       (accrued.accumulated_cost IS NOT NULL)                        AS spend_available,
       CASE WHEN NOT COALESCE(limits.is_unlimited, true) AND limits.hard_limit_usd IS NOT NULL
            THEN GREATEST(0, limits.hard_limit_usd - COALESCE(accrued.accumulated_cost, 0))::text
       END                                                           AS remaining,
       CASE WHEN NOT COALESCE(limits.is_unlimited, true) AND limits.hard_limit_usd > 0
            THEN round(COALESCE(accrued.accumulated_cost, 0) / limits.hard_limit_usd * 100, 2)::text
       END                                                           AS percent_used
FROM centry.project p
LEFT JOIN public.auth_core__user owner ON owner.id = p.owner_id
LEFT JOIN gateway.project_budget limits ON limits.project_id = p.id
LEFT JOIN gateway.llm_budget_accumulators accrued
       ON accrued.scope = $2
      AND accrued.scope_id = p.id::text
      AND accrued.period_start = $3::timestamptz`

// ListProjectBudgets serves project_budgets.py's administration-mode listing.
func (h *Handler) ListProjectBudgets(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	limit := pageSize(query.Get("limit"), 20)
	offset := positiveQueryInt(query.Get("offset"), 0)

	listing, err := h.listProjectBudgets(r.Context(), projectBudgetListParams{
		limit:       limit,
		offset:      offset,
		search:      strings.TrimSpace(query.Get("search")),
		projectType: query.Get("project_type"),
		sortBy:      query.Get("sort_by"),
		sortOrder:   query.Get("sort_order"),
	})
	if err != nil {
		// Reported as the failure it is. Swallowing it into an empty page
		// renders identically to "this deployment has no projects", which is
		// the shape #130's post-mortem named as worse than an error.
		writeError(w, http.StatusInternalServerError, "failed to list project budgets")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

type projectBudgetListParams struct {
	limit       int
	offset      int
	search      string
	projectType string
	sortBy      string
	sortOrder   string
}

func (h *Handler) listProjectBudgets(
	ctx context.Context, params projectBudgetListParams,
) (*projectBudgetListing, error) {
	period := periodFor(h.clock())

	counts, err := h.projectCounts(ctx)
	if err != nil {
		return nil, err
	}

	// The same filter rendered against two different leading-argument counts:
	// the COUNT takes none, the page takes three before the filter's own. A
	// single rendering shared between them would reference a $n the count query
	// never binds.
	countWhere, countArgs := projectBudgetFilters(params, 1)
	where, filterArgs := projectBudgetFilters(params, 4)

	var total int
	if err := h.pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM centry.project p`+countWhere, countArgs...,
	).Scan(&total); err != nil {
		return nil, fmt.Errorf("budgets: count filtered projects: %w", err)
	}

	sortColumn, ok := sortableBudgetColumns[params.sortBy]
	if !ok {
		sortColumn = sortableBudgetColumns["name"]
	}
	direction := "ASC"
	if strings.EqualFold(params.sortOrder, "desc") {
		direction = "DESC"
	}

	// The `p.id` tiebreaker is not decoration: personal projects are named
	// project_user_<n> and team names are not unique, so ORDER BY name alone is
	// not a total order and rows repeat across pages.
	args := append([]any{DefaultWarningPct, budgetScopeProject, period.start}, filterArgs...)
	limitPlaceholder := "$" + strconv.Itoa(len(args)+1)
	offsetPlaceholder := "$" + strconv.Itoa(len(args)+2)
	args = append(args, params.limit, params.offset)

	rows, err := h.pool.Query(ctx, projectBudgetPageSQL+where+`
ORDER BY `+sortColumn+` `+direction+` NULLS LAST, p.id `+direction+`
LIMIT `+limitPlaceholder+` OFFSET `+offsetPlaceholder, args...)
	if err != nil {
		return nil, fmt.Errorf("budgets: list project budgets: %w", err)
	}
	defer rows.Close()

	page := make([]projectBudgetRow, 0, params.limit)
	for rows.Next() {
		var (
			row            projectBudgetRow
			monthlyLimit   *string
			enabled        bool
			enforced       bool
			warningPct     int
			spend          string
			spendAvailable bool
			remaining      *string
			percentUsed    *string
		)
		if err := rows.Scan(
			&row.ProjectID, &row.Name, &row.IsPersonal, &row.OwnerName, &row.OwnerEmail,
			&monthlyLimit, &enabled, &enforced, &warningPct, &spend, &spendAvailable, &remaining, &percentUsed,
		); err != nil {
			return nil, fmt.Errorf("budgets: scan project budget row: %w", err)
		}
		row.budgetState = budgetState{
			MonthlyLimit:   numeric(monthlyLimit),
			Currency:       defaultCurrency,
			Enabled:        enabled,
			WarningPct:     warningPct,
			Spend:          numeric(&spend),
			Remaining:      numeric(remaining),
			PercentUsed:    numeric(percentUsed),
			SpendAvailable: spendAvailable,
			Period:         period.label(),
			PeriodStart:    period.firstDay(),
			PeriodEnd:      period.lastDay(),
			ResetsAt:       period.resetsAt(),
			LimitSource:    limitSourceUnlimited,
		}
		if enforced && monthlyLimit != nil {
			row.EffectiveLimit = row.MonthlyLimit
			row.LimitSource = limitSourceExplicit
		}
		// A personal project is really its owner's own budget, so it is
		// labelled by identity rather than by the opaque project_user_N name
		// nobody searches for.
		row.DisplayName = row.Name
		if row.IsPersonal {
			if label := firstNonEmpty(row.OwnerEmail, row.OwnerName); label != "" {
				row.DisplayName = label
			}
		}
		if row.OwnerName == "" {
			row.OwnerName = row.OwnerEmail
		}
		page = append(page, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("budgets: read project budget page: %w", err)
	}
	return &projectBudgetListing{Rows: page, Total: total, Counts: counts}, nil
}

// projectCounts labels the two tabs and is deliberately not narrowed by the
// filters: a tab whose count moved with the search box would be reporting how
// many rows the OTHER tab currently shows.
func (h *Handler) projectCounts(ctx context.Context) (map[string]int, error) {
	var all, personal int
	if err := h.pool.QueryRow(ctx, `
SELECT COUNT(*), COUNT(*) FILTER (WHERE `+personalProjectPredicate+`)
FROM centry.project p`).Scan(&all, &personal); err != nil {
		return nil, fmt.Errorf("budgets: count projects: %w", err)
	}
	return map[string]int{"team": all - personal, "personal": personal}, nil
}

// projectBudgetFilters renders project_type and search as SQL. firstPlaceholder
// is the $n the caller has already consumed, so the fragment can be appended to
// two different queries with different leading argument counts.
//
// The search matches the project name, the id as text, and the owner's name or
// email — the reference resolves the third with a separate auth_search_users
// RPC and ORs the ids in, but only for personal projects; asking it in SQL
// costs nothing and makes a team project findable by its owner too.
func projectBudgetFilters(params projectBudgetListParams, firstPlaceholder int) (string, []any) {
	conditions := make([]string, 0, 2)
	args := make([]any, 0, 1)
	switch params.projectType {
	case "personal":
		conditions = append(conditions, personalProjectPredicate)
	case "team":
		conditions = append(conditions, "NOT "+personalProjectPredicate)
	}
	if params.search != "" {
		args = append(args, "%"+params.search+"%")
		placeholder := "$" + strconv.Itoa(firstPlaceholder)
		conditions = append(conditions, fmt.Sprintf(`(
    p.name ILIKE %[1]s
 OR p.id::text ILIKE %[1]s
 OR EXISTS (
        SELECT 1 FROM public.auth_core__user owner
        WHERE owner.id = p.owner_id
          AND (owner.name ILIKE %[1]s OR owner.email ILIKE %[1]s)
    )
)`, placeholder))
	}
	if len(conditions) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(conditions, " AND "), args
}

// maxPageSize bounds `?limit=`, matching the cap the admin project listing this
// query was modelled on already applies (internal/api/v2/admin/handler.go).
//
// It is not politeness: `limit` is also the capacity the result slice is
// preallocated with, so an unbounded value is an unbounded allocation made
// BEFORE a single row is read — `?limit=100000000` reserves tens of gigabytes
// on a deployment with three projects.
const maxPageSize = 100

// pageSize clamps a caller-supplied page size into [0, maxPageSize], falling
// back for anything unparseable or negative.
func pageSize(raw string, fallback int) int {
	value := positiveQueryInt(raw, fallback)
	if value > maxPageSize {
		return maxPageSize
	}
	return value
}

func positiveQueryInt(raw string, fallback int) int {
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return fallback
	}
	return value
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}
