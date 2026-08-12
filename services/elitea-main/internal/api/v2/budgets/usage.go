package budgets

// Usage.
//
//	GET /elitea_core/usage/prompt_lib/{project_id}/usage?scope=project|user
//	                                                       ← elitea_core/api/v2/usage.py
//
// Backs Settings → Usage: the current period's spend against whichever budget
// applies, for the whole project or for the calling member alone.
//
// # Amount redaction
//
// A member who is neither a project admin nor the owner of the personal project
// being reported on does not see platform cost figures. They receive the SAME
// payload with the money fields removed and `can_see_amounts: false`;
// percentages, thresholds and the period are still there, so the usage bar
// still renders. This is the reference's rule, kept because it is the one the
// deployment's users have been operating under.
//
// The removal happens on the assembled payload rather than by never fetching
// the numbers, exactly as the reference does — one code path produces the
// figures, one step decides who sees them, so the two cannot disagree about
// what a redacted field is.
//
// # What is NOT here
//
// No per-model table and no per-day series. The write-back path persists one
// accumulated USD figure per (scope, period); there is no ledger behind those
// two views. They are ABSENT rather than empty arrays, because an empty array
// renders as "no calls were made" — see the package doc.

import (
	"context"
	"net/http"
)

const (
	usageScopeProject = "project"
	usageScopeUser    = "user"
)

// amountFields are the cost figures stripped from a redacted payload. The
// percentage and the token-free period metadata survive: a member is allowed to
// know they are near the limit, not what the limit costs.
var amountFields = []string{"monthly_limit", "effective_limit", "spend", "remaining", "currency"}

// GetUsage serves usage.py's prompt_lib GET.
func (h *Handler) GetUsage(w http.ResponseWriter, r *http.Request) {
	projectID, ok := pathID(r, "projectID")
	if !ok {
		writeError(w, http.StatusBadRequest, "project id must be a positive integer")
		return
	}

	scope := r.URL.Query().Get("scope")
	if scope == "" {
		scope = usageScopeProject
	}
	if scope != usageScopeProject && scope != usageScopeUser {
		writeError(w, http.StatusBadRequest, "scope must be 'project' or 'user'")
		return
	}

	caller, authenticated := callerID(r)
	if !authenticated {
		writeError(w, http.StatusUnauthorized, "authentication required")
		return
	}

	ctx := r.Context()
	payload, err := h.usagePayload(w, r, projectID, caller, scope)
	if err != nil {
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

// canSeeAmounts decides whether this caller may see platform cost figures for
// this project: project admins may, and so does the owner of a personal
// project, whose spend is their own and where token-based integrations land.
//
// It is shared with the project-scoped budget read rather than living in this
// file, because the two endpoints serve the SAME numbers behind the SAME gate.
// While only /usage redacted, a member refused the amounts here could read them
// straight off /project_budget/prompt_lib/{id}/budget and the control was
// decorative.
func (h *Handler) canSeeAmounts(ctx context.Context, projectID, userID int64) (bool, error) {
	personal, err := h.isPersonalProject(ctx, projectID, userID)
	if err != nil {
		return false, err
	}
	if personal {
		return true, nil
	}
	return h.isProjectAdmin(ctx, projectID, userID)
}

// applyAmountVisibility stamps can_see_amounts and strips the cost fields when
// it is false.
func applyAmountVisibility(payload map[string]any, visible bool) {
	payload["can_see_amounts"] = visible
	if !visible {
		redactAmounts(payload)
	}
}

// usagePayload assembles the scope's budget state as a mutable map, so
// redaction is a removal rather than a second, parallel struct that could
// disagree with the first about which fields are money.
//
// It answers the request itself on failure and returns the error so the caller
// stops; every response this package writes is written exactly once.
func (h *Handler) usagePayload(
	w http.ResponseWriter, r *http.Request, projectID, userID int64, scope string,
) (map[string]any, error) {
	ctx := r.Context()
	if scope == usageScopeUser {
		state, err := h.userBudget(ctx, projectID, userID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read usage")
			return nil, err
		}
		payload, err := structToMap(state)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "failed to read usage")
			return nil, err
		}
		payload["scope"] = usageScopeUser
		return payload, nil
	}

	state, err := h.projectBudget(ctx, projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read usage")
		return nil, err
	}
	payload, err := structToMap(state)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "failed to read usage")
		return nil, err
	}
	payload["scope"] = usageScopeProject
	// The project scope has no user of its own; the reference reports null
	// rather than omitting the key, so a client can key off one shape.
	payload["user_id"] = nil
	return payload, nil
}

func redactAmounts(payload map[string]any) {
	for _, field := range amountFields {
		delete(payload, field)
	}
}
