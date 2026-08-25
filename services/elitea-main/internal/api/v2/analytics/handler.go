package analytics

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

type Repository interface {
	GetUsageSummary(ctx context.Context, params analytics.QueryParams) (analytics.UsageSummary, error)
	GetAgentAnalytics(ctx context.Context, params analytics.QueryParams) ([]analytics.AgentAnalytics, error)
	GetToolAnalytics(ctx context.Context, params analytics.QueryParams) ([]analytics.ToolAnalytics, error)
	GetUserActivity(ctx context.Context, params analytics.QueryParams) ([]analytics.UserActivity, error)
}

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.Usage)
	r.Get("/agents", h.Agents)
	r.Get("/tools", h.Tools)
	r.Get("/users", h.Users)
	return r
}

// writeRepoFailure is the one exit these routes take when the repository could
// not answer.
//
// It replaces `summary, _ := h.repo.Get...` followed by 200-and-zeros
// (issue #303). Discarding the error made every failure mode — a table that has
// never existed, a dropped connection, a permission error — arrive at the
// browser as "this project used nothing", which is a claim, not a blank. The
// UI already has the other branch: a non-2xx renders "Failed to load analytics
// data." (apps/elitea-web e2e J24c pins it), and that message is true where the
// zeros were not.
//
// The repository's reason travels in the body rather than only to the log,
// because the operator who sees this endpoint is looking at a browser.
func writeRepoFailure(w http.ResponseWriter, err error) {
	body := map[string]any{"error": "failed to query analytics"}
	if errors.Is(err, analytics.ErrNoSource) {
		// Distinguished from a transient failure on purpose: retrying will not
		// help, and the message says what is missing.
		body["error"] = "analytics is not available on this deployment"
		body["detail"] = err.Error()
	}
	writeJSON(w, http.StatusInternalServerError, body)
}

func (h *Handler) Usage(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	summary, err := h.repo.GetUsageSummary(r.Context(), params)
	if err != nil {
		writeRepoFailure(w, err)
		return
	}

	models := make([]any, 0)
	for _, m := range summary.ByModel {
		models = append(models, m)
	}

	// UI expects: { kpis: {...}, top_ai_users: [], daily_activity: [], models: [] }
	//
	// The six KPI figures that used to be written here as literal 0 —
	// unique_users, total_project_users, ai_active_users, adoption_rate,
	// tool_runs, chat_msgs — are GONE rather than zeroed. Nothing computed them
	// and no query stood behind them; they were the response asserting six
	// counts it had never looked up. An absent key is a claim a client can
	// detect, in the same way /analytics_costs omits the dimensions its data
	// source cannot produce instead of publishing them as empty.
	//
	// What remains is what the repository actually returned. On this deployment
	// that branch is unreachable — GetUsageSummary has no source and the error
	// path above is always taken — and it stays here rather than being deleted
	// because it is what a real summary renders as the day one lands.
	writeJSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{
			"llm_calls":    summary.TotalRuns,
			"agent_runs":   summary.TotalRuns,
			"total_tokens": summary.TotalTokens,
			"total_cost":   summary.TotalCost,
		},
		"top_ai_users":   []any{},
		"daily_activity": []any{},
		"models":         models,
	})
}

// The three detail branches below used to answer before the repository was even
// consulted, with an eight-field all-zero `kpis` block that no query produced.
// That is the purest form of the defect: a response asserting eight counts it
// never attempted to measure. They now go through the repository like every
// other read, and fail with it.
func (h *Handler) Agents(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	agents, err := h.repo.GetAgentAnalytics(r.Context(), params)
	if err != nil {
		writeRepoFailure(w, err)
		return
	}
	if agents == nil {
		agents = []analytics.AgentAnalytics{}
	}

	// Detail view expects { entity_name, kpis, users, tools, daily_usage }
	// List view expects { items: [...] }
	if r.URL.Query().Get("application_id") != "" || r.URL.Query().Get("agent_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"users":       []any{},
			"tools":       []any{},
			"daily_usage": []any{},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": agents})
}

func (h *Handler) Tools(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	tools, err := h.repo.GetToolAnalytics(r.Context(), params)
	if err != nil {
		writeRepoFailure(w, err)
		return
	}
	if tools == nil {
		tools = []analytics.ToolAnalytics{}
	}

	// Detail view expects { entity_name, kpis, users, agents, daily_usage }
	if r.URL.Query().Get("tool_id") != "" || r.URL.Query().Get("toolkit_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"users":       []any{},
			"agents":      []any{},
			"daily_usage": []any{},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": tools})
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	users, err := h.repo.GetUserActivity(r.Context(), params)
	if err != nil {
		writeRepoFailure(w, err)
		return
	}
	if users == nil {
		users = []analytics.UserActivity{}
	}

	// Detail view expects { entity_name, kpis, agents, tools, daily_usage }
	if r.URL.Query().Get("user_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"agents":      []any{},
			"tools":       []any{},
			"daily_usage": []any{},
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}

func parseParams(r *http.Request) analytics.QueryParams {
	startDate := r.URL.Query().Get("start_date")
	if startDate == "" {
		startDate = r.URL.Query().Get("date_from")
	}
	endDate := r.URL.Query().Get("end_date")
	if endDate == "" {
		endDate = r.URL.Query().Get("date_to")
	}
	return analytics.QueryParams{
		ProjectID: chi.URLParam(r, "projectID"),
		StartDate: startDate,
		EndDate:   endDate,
		Period:    r.URL.Query().Get("period"),
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
