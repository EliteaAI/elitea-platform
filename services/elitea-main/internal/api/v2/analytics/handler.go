package analytics

import (
	"context"
	"encoding/json"
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

func (h *Handler) Usage(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	summary, _ := h.repo.GetUsageSummary(r.Context(), params)

	models := make([]any, 0)
	for _, m := range summary.ByModel {
		models = append(models, m)
	}

	// UI expects: { kpis: {...}, top_ai_users: [], daily_activity: [], models: [] }
	writeJSON(w, http.StatusOK, map[string]any{
		"kpis": map[string]any{
			"unique_users":        0,
			"total_project_users": 0,
			"ai_active_users":     0,
			"adoption_rate":       0,
			"llm_calls":           summary.TotalRuns,
			"tool_runs":           0,
			"chat_msgs":           0,
			"agent_runs":          summary.TotalRuns,
			"total_tokens":        summary.TotalTokens,
			"total_cost":          summary.TotalCost,
		},
		"top_ai_users":   []any{},
		"daily_activity":  []any{},
		"models":          models,
	})
}

func (h *Handler) Agents(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	agents, _ := h.repo.GetAgentAnalytics(r.Context(), params)
	if agents == nil {
		agents = []analytics.AgentAnalytics{}
	}

	// Detail view expects { entity_name, kpis, users, tools, daily_usage }
	// List view expects { items: [...] }
	if r.URL.Query().Get("application_id") != "" || r.URL.Query().Get("agent_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"kpis": map[string]any{
				"unique_users": 0, "total_project_users": 0,
				"ai_active_users": 0, "adoption_rate": 0,
				"llm_calls": 0, "tool_runs": 0, "chat_msgs": 0, "agent_runs": 0,
			},
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
	tools, _ := h.repo.GetToolAnalytics(r.Context(), params)
	if tools == nil {
		tools = []analytics.ToolAnalytics{}
	}

	// Detail view expects { entity_name, kpis, users, agents, daily_usage }
	if r.URL.Query().Get("tool_id") != "" || r.URL.Query().Get("toolkit_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"kpis": map[string]any{
				"unique_users": 0, "total_project_users": 0,
				"ai_active_users": 0, "adoption_rate": 0,
				"llm_calls": 0, "tool_runs": 0, "chat_msgs": 0, "agent_runs": 0,
			},
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
	users, _ := h.repo.GetUserActivity(r.Context(), params)
	if users == nil {
		users = []analytics.UserActivity{}
	}

	// Detail view expects { entity_name, kpis, agents, tools, daily_usage }
	if r.URL.Query().Get("user_id") != "" {
		writeJSON(w, http.StatusOK, map[string]any{
			"entity_name": "",
			"kpis": map[string]any{
				"unique_users": 0, "total_project_users": 0,
				"ai_active_users": 0, "adoption_rate": 0,
				"llm_calls": 0, "tool_runs": 0, "chat_msgs": 0, "agent_runs": 0,
			},
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
