package admin

import "time"

type AuditEntry struct {
	ID        string         `json:"id"`
	UserID    string         `json:"user_id"`
	UserEmail string         `json:"user_email"`
	Action    string         `json:"action"`
	Resource  string         `json:"resource"`
	ProjectID string         `json:"project_id,omitempty"`
	Details   map[string]any `json:"details,omitempty"`
	Timestamp time.Time      `json:"timestamp"`
}

type AuditTrace struct {
	ID        string    `json:"id"`
	TraceID   string    `json:"trace_id"`
	SpanID    string    `json:"span_id"`
	Service   string    `json:"service"`
	Operation string    `json:"operation"`
	Duration  int64     `json:"duration_ms"`
	Status    string    `json:"status"`
	Timestamp time.Time `json:"timestamp"`
}

type AuditListRequest struct {
	Page      int    `json:"page,omitempty"`
	PageSize  int    `json:"page_size,omitempty"`
	UserID    string `json:"user_id,omitempty"`
	Action    string `json:"action,omitempty"`
	StartDate string `json:"start_date,omitempty"`
	EndDate   string `json:"end_date,omitempty"`
}

type AuditListResponse struct {
	Items      []AuditEntry `json:"items"`
	Total      int          `json:"total"`
	Page       int          `json:"page"`
	PageSize   int          `json:"page_size"`
	TotalPages int          `json:"total_pages"`
}

type HeatmapData struct {
	Buckets []HeatmapBucket `json:"buckets"`
}

type HeatmapBucket struct {
	Timestamp time.Time `json:"timestamp"`
	Count     int       `json:"count"`
}

type PlatformSettings struct {
	FeatureFlags map[string]bool `json:"feature_flags"`
	Version      string          `json:"version,omitempty"`
}

type ProviderStatus struct {
	Name    string `json:"name"`
	Status  string `json:"status"`
	Latency int64  `json:"latency_ms,omitempty"`
}
