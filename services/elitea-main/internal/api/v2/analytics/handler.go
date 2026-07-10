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
	summary, err := h.repo.GetUsageSummary(r.Context(), params)
	if err != nil {
		writeJSON(w, http.StatusOK, analytics.UsageSummary{ProjectID: params.ProjectID})
		return
	}
	writeJSON(w, http.StatusOK, summary)
}

func (h *Handler) Agents(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	agents, err := h.repo.GetAgentAnalytics(r.Context(), params)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": agents})
}

func (h *Handler) Tools(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	tools, err := h.repo.GetToolAnalytics(r.Context(), params)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": tools})
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	params := parseParams(r)
	users, err := h.repo.GetUserActivity(r.Context(), params)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}})
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
	json.NewEncoder(w).Encode(v)
}
