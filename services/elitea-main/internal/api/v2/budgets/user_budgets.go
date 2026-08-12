package budgets

// Per-member budgets.
//
//	GET  /elitea_core/user_budget/{mode}/{project_id}/user_budget/{user_id}  ← user_budget.py
//	PUT  /elitea_core/user_budget/administration/{project_id}/user_budget/{user_id}
//	GET  /elitea_core/user_budgets/{mode}/{project_id}                       ← user_budgets.py
//
// # These limits are NOT enforced, and every response says so
//
// The gateway's admission check is project-scoped: internal/llmproxy/
// budget_gate.go declares a single `budgetScopeProject = "project"` and there
// is no user-scoped path through CheckBudget. Issue #246's scope boundary
// forbids changing that here. So a per-member limit written through this API is
// an authored intention that nothing currently stops a call on.
//
// That is exactly the shape #218 exists about — a surface that persists a
// policy and returns success while nothing enforces it — so the disclosure is
// not a comment. Every read carries `"enforced": false`, and
// TestUserBudgetReportsThatItIsNotEnforced pins it. When gateway per-user
// enforcement lands, that test fails and the field has to be updated
// deliberately; a doc comment would have gone quietly stale instead, which is
// what #135 is a record of.
//
// The rows are still worth storing and reading back: the admin surface needs
// somewhere to author them, and the alternative — dropping the endpoints — was
// rejected because it would leave the Settings → Usage members table with
// nothing at all.

import (
	"context"
	"fmt"
	"net/http"
)

// userLimitJoin is readBudgetState's per-member limit table. $5/$6 are the
// project and user ids; see projectLimitJoin for the project counterpart.
const userLimitJoin = `LEFT JOIN gateway.user_budget AS limits
       ON limits.project_id = $5::integer AND limits.user_id = $6::integer`

// userBudgetState is one member's budget within a project.
type userBudgetState struct {
	ProjectID int64 `json:"project_id"`
	UserID    int64 `json:"user_id"`
	// Enforced is false for as long as the gateway bills and admits by project
	// scope alone. It is a field rather than a comment so a client can render
	// the limit as authored-but-inactive instead of implying it blocks calls.
	Enforced bool `json:"enforced"`
	budgetState
}

// userBudgetRow is one row of the members listing.
type userBudgetRow struct {
	ProjectID int64    `json:"project_id"`
	UserID    int64    `json:"user_id"`
	Name      string   `json:"name"`
	Email     string   `json:"email"`
	Roles     []string `json:"roles"`
	Enforced  bool     `json:"enforced"`
	budgetState
}

type userBudgetListing struct {
	Rows       []userBudgetRow `json:"rows"`
	Total      int             `json:"total"`
	WarningPct int             `json:"warning_pct"`
}

/* ── GET one member's budget ───────────────────────────────────────────── */

// GetUserBudget serves the PROJECT-SCOPED (prompt_lib) read.
//
// The gate router.go applies to it is a project-membership permission, so it
// admits every member of the project — which is not the same as "may read this
// row". A member may read only their OWN, unless they are an admin of the
// project; without this check any member could read a colleague's spend by
// editing the URL.
//
// The mode is fixed by WHICH HANDLER is registered, not read from a `{mode}`
// path parameter: a handler that trusted the URL would let any member ask for
// `administration` and skip the check outright.
func (h *Handler) GetUserBudget(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.memberPath(w, r)
	if !ok {
		return
	}

	caller, authenticated := callerID(r)
	if !authenticated {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}
	if caller != userID {
		admin, err := h.isProjectAdmin(r.Context(), projectID, caller)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to resolve project role")
			return
		}
		if !admin {
			writeError(w, http.StatusForbidden, "Forbidden")
			return
		}
	}

	h.writeUserBudget(w, r, projectID, userID)
}

// GetUserBudgetAdmin serves the administration-mode read, which is centrally
// gated on `models.admin.project_budgets.view` and therefore carries no
// membership check — a platform administrator is not a member of the projects
// they administer.
func (h *Handler) GetUserBudgetAdmin(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.memberPath(w, r)
	if !ok {
		return
	}
	h.writeUserBudget(w, r, projectID, userID)
}

func (h *Handler) memberPath(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return 0, 0, false
	}
	userID, ok := pathID(r, "userID")
	if !ok {
		writeError(w, http.StatusBadRequest, "user id must be a positive integer")
		return 0, 0, false
	}
	return projectID, userID, true
}

func (h *Handler) writeUserBudget(w http.ResponseWriter, r *http.Request, projectID, userID int64) {
	state, err := h.userBudget(r.Context(), projectID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read member budget")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

func (h *Handler) userBudget(ctx context.Context, projectID, userID int64) (userBudgetState, error) {
	period := periodFor(h.clock())
	state, err := h.readBudgetState(
		ctx, userLimitJoin, budgetScopeUser, userBudgetScopeID(projectID, userID), period,
		projectID, userID,
	)
	if err != nil {
		return userBudgetState{}, err
	}
	return userBudgetState{
		ProjectID:   projectID,
		UserID:      userID,
		Enforced:    false,
		budgetState: state,
	}, nil
}

/* ── PUT one member's budget ───────────────────────────────────────────── */

// userBudgetUpsert mirrors projectBudgetUpsert minus is_unlimited: there is no
// enforcement flag to derive, because nothing enforces this row.
var userBudgetUpsert = fmt.Sprintf(`
INSERT INTO gateway.user_budget AS existing
    (project_id, user_id, hard_limit_usd, enabled, soft_alert_pct, updated_at)
VALUES ($1, $2, $3::numeric, $4, COALESCE($5::smallint, %d), now())
ON CONFLICT (project_id, user_id) DO UPDATE SET
    hard_limit_usd = EXCLUDED.hard_limit_usd,
    enabled        = EXCLUDED.enabled,
    soft_alert_pct = COALESCE($5::smallint, existing.soft_alert_pct),
    updated_at     = now()`, DefaultWarningPct)

// PutUserBudget serves user_budget.py's administration-mode PUT.
func (h *Handler) PutUserBudget(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}
	userID, ok := pathID(r, "userID")
	if !ok {
		writeError(w, http.StatusBadRequest, "user id must be a positive integer")
		return
	}
	parsed, ok := decodeBudgetWrite(w, r)
	if !ok {
		return
	}

	ctx := r.Context()
	if _, err := h.pool.Exec(ctx, userBudgetUpsert,
		projectID, userID, parsed.monthlyLimit, parsed.enabled, parsed.softAlertPct,
	); err != nil {
		writeError(w, http.StatusInternalServerError, "failed to save member budget")
		return
	}

	state, err := h.userBudget(ctx, projectID, userID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read member budget")
		return
	}
	writeJSON(w, http.StatusOK, state)
}

/* ── the members listing ───────────────────────────────────────────────── */

// userBudgetPageSQL lists every member of a project with their authored limit
// and current-period spend.
//
// The member set and the role aggregation are the ones the project member
// listing already uses (internal/api/v2/eliteacore/handler.go): project role
// assignments, with each project's own service account excluded — the
// `filter_system_user=True` the reference passes.
//
// The roles aggregate is a FILTERed array_agg inside the row, not a JOIN that
// multiplies the member out once per role. A plain join here is what made the
// pre-A14 admin user listing report a two-role user twice while its separate
// COUNT disagreed.
const userBudgetPageSQL = `
SELECT member.id,
       COALESCE(member.name, '')                                     AS name,
       COALESCE(member.email, '')                                    AS email,
       COALESCE(roles.names, '{}')                                   AS roles,
       limits.hard_limit_usd::text                                   AS monthly_limit,
       COALESCE(limits.enabled, false)                               AS enabled,
       COALESCE(limits.soft_alert_pct, $2::smallint)                 AS warning_pct,
       COALESCE(accrued.accumulated_cost, 0)::text                   AS spend,
       (accrued.accumulated_cost IS NOT NULL)                        AS spend_available,
       CASE WHEN COALESCE(limits.enabled, false) AND limits.hard_limit_usd IS NOT NULL
            THEN GREATEST(0, limits.hard_limit_usd - COALESCE(accrued.accumulated_cost, 0))::text
       END                                                           AS remaining,
       CASE WHEN COALESCE(limits.enabled, false) AND limits.hard_limit_usd > 0
            THEN round(COALESCE(accrued.accumulated_cost, 0) / limits.hard_limit_usd * 100, 2)::text
       END                                                           AS percent_used
FROM public.auth_core__user member
JOIN LATERAL (
    SELECT array_agg(DISTINCT project_role.name) AS names
    FROM public.auth_core__project_user_role AS assignment
    JOIN public.auth_core__project_role AS project_role
      ON project_role.id = assignment.role_id
     AND project_role.project_id = assignment.project_id
    WHERE assignment.project_id = $1 AND assignment.user_id = member.id
) AS roles ON roles.names IS NOT NULL
LEFT JOIN gateway.user_budget limits
       ON limits.project_id = $1 AND limits.user_id = member.id
LEFT JOIN gateway.llm_budget_accumulators accrued
       ON accrued.scope = $3
      AND accrued.scope_id = $1::text || ':' || member.id::text
      AND accrued.period_start = $4::timestamptz
WHERE member.email NOT LIKE '%@centry.user'
ORDER BY name, member.id`

// ListUserBudgets serves the project-scoped members listing. It is restricted
// to admins OF THAT PROJECT: an ordinary member may see their own usage and not
// their colleagues', so the whole table is admin-only.
func (h *Handler) ListUserBudgets(w http.ResponseWriter, r *http.Request) {
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
	admin, err := h.isProjectAdmin(r.Context(), projectID, caller)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to resolve project role")
		return
	}
	if !admin {
		writeError(w, http.StatusForbidden, "Forbidden")
		return
	}

	h.writeUserBudgetListing(w, r, projectID)
}

// ListUserBudgetsAdmin serves the administration-mode members listing, gated
// centrally rather than on project membership.
func (h *Handler) ListUserBudgetsAdmin(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}
	h.writeUserBudgetListing(w, r, projectID)
}

func (h *Handler) writeUserBudgetListing(w http.ResponseWriter, r *http.Request, projectID int64) {
	listing, err := h.listUserBudgets(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to list member budgets")
		return
	}
	writeJSON(w, http.StatusOK, listing)
}

func (h *Handler) listUserBudgets(ctx context.Context, projectID int64) (*userBudgetListing, error) {
	period := periodFor(h.clock())

	rows, err := h.pool.Query(ctx, userBudgetPageSQL,
		projectID, DefaultWarningPct, budgetScopeUser, period.start)
	if err != nil {
		return nil, fmt.Errorf("budgets: list member budgets: %w", err)
	}
	defer rows.Close()

	page := make([]userBudgetRow, 0)
	for rows.Next() {
		var (
			row            userBudgetRow
			monthlyLimit   *string
			enabled        bool
			warningPct     int
			spend          string
			spendAvailable bool
			remaining      *string
			percentUsed    *string
		)
		if err := rows.Scan(
			&row.UserID, &row.Name, &row.Email, &row.Roles,
			&monthlyLimit, &enabled, &warningPct, &spend, &spendAvailable, &remaining, &percentUsed,
		); err != nil {
			return nil, fmt.Errorf("budgets: scan member budget row: %w", err)
		}
		row.ProjectID = projectID
		row.Enforced = false
		if row.Name == "" {
			row.Name = row.Email
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
		if enabled && monthlyLimit != nil {
			row.EffectiveLimit = row.MonthlyLimit
			row.LimitSource = limitSourceExplicit
		}
		page = append(page, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("budgets: read member budget page: %w", err)
	}

	// The listing's own warning threshold is the PROJECT's, not a member's:
	// it labels the table, and each row already carries its own.
	warningPct, err := h.projectWarningPct(ctx, projectID)
	if err != nil {
		return nil, err
	}
	return &userBudgetListing{Rows: page, Total: len(page), WarningPct: warningPct}, nil
}

func (h *Handler) projectWarningPct(ctx context.Context, projectID int64) (int, error) {
	var pct int
	err := h.pool.QueryRow(ctx, `
SELECT COALESCE(
    (SELECT soft_alert_pct FROM gateway.project_budget WHERE project_id = $1),
    $2::smallint
)`, projectID, DefaultWarningPct).Scan(&pct)
	if err != nil {
		return 0, fmt.Errorf("budgets: read project warning threshold: %w", err)
	}
	return pct, nil
}
