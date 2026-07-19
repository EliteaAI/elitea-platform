package oapiserver

import (
	"net/http"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	domainanalytics "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/analytics"
)

func parseAnalyticsQueryParams(projectID string, dateFrom *generated.DateFrom, dateTo *generated.DateTo) domainanalytics.QueryParams {
	params := domainanalytics.QueryParams{
		ProjectID: projectID,
	}
	if dateFrom != nil {
		params.StartDate = dateFrom.Format("2006-01-02")
	}
	if dateTo != nil {
		params.EndDate = dateTo.Format("2006-01-02")
	}
	return params
}

// GetProjectAnalytics returns aggregated analytics for a project's prompt library.
func (s *Server) GetProjectAnalytics(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetProjectAnalyticsParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)

	summary, err := s.analyticsRepo.GetUsageSummary(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	models := make([]any, 0, len(summary.ByModel))
	for _, m := range summary.ByModel {
		models = append(models, m)
	}

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
		"daily_activity": []any{},
		"models":         models,
	})
}

// GetAnalyticsAgentDetail returns detailed analytics for a specific agent within a project.
func (s *Server) GetAnalyticsAgentDetail(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetAnalyticsAgentDetailParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)

	_, err := s.analyticsRepo.GetAgentAnalytics(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entity_name": "",
		"kpis": map[string]any{
			"unique_users":        0,
			"total_project_users": 0,
			"ai_active_users":     0,
			"adoption_rate":       0,
			"llm_calls":           0,
			"tool_runs":           0,
			"chat_msgs":           0,
			"agent_runs":          0,
		},
		"users":       []any{},
		"tools":       []any{},
		"daily_usage": []any{},
	})
}

// ListAnalyticsAgents returns paginated agent analytics for a project's prompt library.
func (s *Server) ListAnalyticsAgents(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.ListAnalyticsAgentsParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)
	if params.Limit != nil {
		qp.PageSize = *params.Limit
	}
	if params.Offset != nil && qp.PageSize > 0 {
		qp.Page = (*params.Offset/qp.PageSize) + 1
	}

	agents, err := s.analyticsRepo.GetAgentAnalytics(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if agents == nil {
		agents = []domainanalytics.AgentAnalytics{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": agents})
}

// GetAnalyticsToolDetail returns detailed analytics for a specific tool within a project.
func (s *Server) GetAnalyticsToolDetail(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetAnalyticsToolDetailParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)

	_, err := s.analyticsRepo.GetToolAnalytics(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entity_name": "",
		"kpis": map[string]any{
			"unique_users":        0,
			"total_project_users": 0,
			"ai_active_users":     0,
			"adoption_rate":       0,
			"llm_calls":           0,
			"tool_runs":           0,
			"chat_msgs":           0,
			"agent_runs":          0,
		},
		"users":       []any{},
		"agents":      []any{},
		"daily_usage": []any{},
	})
}

// ListAnalyticsTools returns paginated tool analytics for a project's prompt library.
func (s *Server) ListAnalyticsTools(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.ListAnalyticsToolsParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)
	if params.Limit != nil {
		qp.PageSize = *params.Limit
	}
	if params.Offset != nil && qp.PageSize > 0 {
		qp.Page = (*params.Offset/qp.PageSize) + 1
	}

	tools, err := s.analyticsRepo.GetToolAnalytics(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if tools == nil {
		tools = []domainanalytics.ToolAnalytics{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": tools})
}

// GetAnalyticsUserDetail returns detailed analytics for a specific user within a project.
func (s *Server) GetAnalyticsUserDetail(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetAnalyticsUserDetailParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)

	_, err := s.analyticsRepo.GetUserActivity(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"entity_name": "",
		"kpis": map[string]any{
			"unique_users":        0,
			"total_project_users": 0,
			"ai_active_users":     0,
			"adoption_rate":       0,
			"llm_calls":           0,
			"tool_runs":           0,
			"chat_msgs":           0,
			"agent_runs":          0,
		},
		"agents":      []any{},
		"tools":       []any{},
		"daily_usage": []any{},
	})
}

// ListAnalyticsUsers returns paginated user analytics for a project's prompt library.
func (s *Server) ListAnalyticsUsers(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.ListAnalyticsUsersParams) {
	if s.analyticsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	qp := parseAnalyticsQueryParams(projectId, params.DateFrom, params.DateTo)
	if params.Limit != nil {
		qp.PageSize = *params.Limit
	}
	if params.Offset != nil && qp.PageSize > 0 {
		qp.Page = (*params.Offset/qp.PageSize) + 1
	}

	users, err := s.analyticsRepo.GetUserActivity(r.Context(), qp)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		return
	}
	if users == nil {
		users = []domainanalytics.UserActivity{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": users})
}
