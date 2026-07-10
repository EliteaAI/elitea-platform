package analytics

import "time"

type UsageSummary struct {
	ProjectID    string        `json:"project_id,omitempty"`
	Period       string        `json:"period"`
	TotalTokens  int64         `json:"total_tokens"`
	TotalCost    float64       `json:"total_cost"`
	TotalRuns    int64         `json:"total_runs"`
	ByModel      []ModelUsage  `json:"by_model,omitempty"`
}

type ModelUsage struct {
	Model            string  `json:"model"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	TotalCost        float64 `json:"total_cost"`
	RunCount         int64   `json:"run_count"`
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
	ToolkitID string  `json:"toolkit_id"`
	ToolName  string  `json:"tool_name"`
	RunCount  int64   `json:"run_count"`
	AvgDuration float64 `json:"avg_duration_ms"`
	ErrorRate float64 `json:"error_rate"`
}

type UserActivity struct {
	UserID       string    `json:"user_id"`
	Email        string    `json:"email"`
	RunCount     int64     `json:"run_count"`
	LastActiveAt time.Time `json:"last_active_at"`
}

type QueryParams struct {
	ProjectID string `json:"-"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
	Period    string `json:"period,omitempty"`
	Page      int    `json:"page,omitempty"`
	PageSize  int    `json:"page_size,omitempty"`
}
