package mcp

// `internal_mcp_pat_status` — pylon `elitea_core/api/v2/internal_mcp_pat_status.py`.
//
//	GET /api/v2/elitea_core/internal_mcp_pat_status/prompt_lib/{projectID}/{toolkitType}
//
// An INTERNAL Elitea MCP toolkit is one whose server URL points back at this
// platform's own MCP endpoint (`…/app/{project_id}/mcp/<suffix>`). Those
// toolkits authenticate with the executing user's personal access token, which
// is stamped into the settings at dispatch time and is never stored. If the
// user has no PAT, or every PAT they have has expired, the toolkit does not
// fail loudly — it fails at connect time, inside an agent run, as an
// authentication error against a URL the user never typed.
//
// This endpoint exists so the toolkit UI can say so first. It reports the
// caller's OWN token state and never returns a token value.
//
// # How "internal" is decided here, and why it differs from pylon
//
// pylon asks `is_internal_mcp_toolkit({'type': toolkit_type, 'settings': {}})`.
// With empty settings that reduces to: does the type start with `mcp_`, and
// does the PREBUILT CONFIGURATION registered for that type carry a URL with the
// `/app/{project_id}/mcp/` template in it. That registry
// (`mcp_prebuilt_configs`) is a dict on the pylon module object, filled by an
// event the indexer_worker emits at startup. This service has no such registry
// and no event that would fill one.
//
// The evidence this stack does have for the same question is the project's own
// toolkit rows: a toolkit type only exists here because `elitea_tools` holds
// rows of that type (that is also how `ListCurrentToolkitTypes` enumerates
// types at all). So a type is internal when the project has at least one
// toolkit of that type whose settings URL carries the template.
//
// The template — `/app/{project_id}/mcp/`, with the literal marker unresolved —
// is pylon's narrower `_INTERNAL_MCP_TEMPLATE_RE`, not the broader
// `_INTERNAL_MCP_ENDPOINT_RE` that also accepts a resolved integer id. That is
// deliberate in pylon and preserved here: PAT injection fires only for the
// unresolved template, so a URL already carrying a concrete project id is never
// re-stamped with the caller's token and cannot borrow another user's identity.
// A status endpoint that answered "internal" for the resolved form would be
// promising a gate that the dispatch path does not apply.
//
// A type that is not internal answers `{"internal": false, "state": "VALID"}` —
// pylon's answer, and the right one: there is no PAT requirement to report on,
// and the UI reads `state` to decide whether to block.

import (
	"context"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// Token states, spelled as pylon spells them because the toolkit UI switches on
// the literal string.
const (
	patStateValid   = "VALID"
	patStateExpired = "EXPIRED"
	patStateMissing = "MISSING"
)

// internalMCPTemplate is pylon's `_INTERNAL_MCP_TEMPLATE_RE`
// (`legacy/plugins/elitea_core/utils/internal_tools.py:508`).
var internalMCPTemplate = regexp.MustCompile(`/app/\{project_id\}/mcp/`)

// InternalMCPPATStatus serves the endpoint described in this file's header.
func (h *Handler) InternalMCPPATStatus(w http.ResponseWriter, r *http.Request) {
	if !h.requireMCPEnabled(w, r) {
		return
	}
	schema, ok := projectSchema(chi.URLParam(r, "projectID"))
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}
	toolkitType := chi.URLParam(r, "toolkitType")

	user, authenticated := auth.UserFromContext(r.Context())
	if !authenticated {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
		return
	}
	userID, resolved := user.OwningUserID()
	if !resolved {
		// A principal with no owning user (a bare token id that never resolved)
		// has no token list to report on, and answering VALID would tell the UI
		// to let the toolkit through.
		writeJSON(w, http.StatusForbidden, map[string]any{"error": "forbidden"})
		return
	}

	internal, err := h.typeIsInternalMCP(r.Context(), schema, toolkitType)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "toolkit lookup unavailable"})
		return
	}
	if !internal {
		writeJSON(w, http.StatusOK, map[string]any{"internal": false, "state": patStateValid})
		return
	}

	state, err := h.personalTokenState(r.Context(), userID)
	if err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "token lookup unavailable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"internal": true, "state": state})
}

// typeIsInternalMCP answers the question this file's header describes.
//
// The `mcp_` prefix test is pylon's first condition and is applied before any
// query: it is what separates a prebuilt internal toolkit type from an
// arbitrary toolkit that happens to store a URL.
func (h *Handler) typeIsInternalMCP(ctx context.Context, schema, toolkitType string) (bool, error) {
	if !strings.HasPrefix(toolkitType, "mcp_") {
		return false, nil
	}
	if h.pool == nil {
		return false, errNoPool
	}
	rows, err := h.pool.Query(ctx, fmt.Sprintf(
		`SELECT COALESCE(settings ->> 'url', '') FROM %q.elitea_tools WHERE type = $1`, schema), toolkitType)
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var url string
		if err := rows.Scan(&url); err != nil {
			return false, err
		}
		if internalMCPTemplate.MatchString(url) {
			return true, nil
		}
	}
	return false, rows.Err()
}

// personalTokenState reproduces pylon's `resolve_user_token_state`: no tokens at
// all is MISSING, at least one unexpired token is VALID, otherwise EXPIRED. A
// token with no `expires` never expires.
//
// The token VALUE is not selected. pylon returns the encoded token to its
// internal callers and strips it here; this query cannot leak it because it
// never reads it.
func (h *Handler) personalTokenState(ctx context.Context, userID int64) (string, error) {
	if h.pool == nil {
		return "", errNoPool
	}
	var total, active int64
	err := h.pool.QueryRow(ctx, `
		SELECT
			COUNT(*),
			COUNT(*) FILTER (
				WHERE expires IS NULL OR expires > (clock_timestamp() AT TIME ZONE 'UTC')
			)
		FROM public.auth_core__token
		WHERE user_id = $1`, userID).Scan(&total, &active)
	if err != nil {
		return "", err
	}
	switch {
	case total == 0:
		return patStateMissing, nil
	case active > 0:
		return patStateValid, nil
	default:
		return patStateExpired, nil
	}
}
