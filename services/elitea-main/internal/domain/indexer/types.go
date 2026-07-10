package indexer

import "time"

type Task struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	Type      string    `json:"type"`
	Status    string    `json:"status"`
	Progress  float64   `json:"progress,omitempty"`
	Error     string    `json:"error,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type IndexMeta struct {
	ID        string         `json:"id"`
	ToolkitID string         `json:"toolkit_id"`
	Name      string         `json:"name"`
	Type      string         `json:"type"`
	Status    string         `json:"status"`
	Config    map[string]any `json:"config,omitempty"`
	CreatedAt time.Time      `json:"created_at"`
	UpdatedAt time.Time      `json:"updated_at"`
}

type IndexType struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category,omitempty"`
}

type CancelTaskRequest struct {
	ProjectID string `json:"-"`
	ToolkitID string `json:"-"`
	IndexName string `json:"-"`
	TaskID    string `json:"-"`
}

type ProjectContext struct {
	ProjectID string         `json:"project_id"`
	Config    map[string]any `json:"config"`
}
