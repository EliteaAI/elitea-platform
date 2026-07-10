package toolkits

import "time"

type Toolkit struct {
	ID          string         `json:"id"`
	ProjectID   string         `json:"project_id"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Description string         `json:"description,omitempty"`
	Config      map[string]any `json:"config,omitempty"`
	Status      string         `json:"status"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type Tool struct {
	ID          string         `json:"id"`
	ToolkitID   string         `json:"toolkit_id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Schema      map[string]any `json:"schema,omitempty"`
	Enabled     bool           `json:"enabled"`
}

type ToolkitType struct {
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
	Category    string `json:"category,omitempty"`
}

type ListRequest struct {
	ProjectID string `json:"-"`
	Page      int    `json:"page,omitempty"`
	PageSize  int    `json:"page_size,omitempty"`
}

type ListResponse struct {
	Items      []Toolkit `json:"items"`
	Total      int       `json:"total"`
	Page       int       `json:"page"`
	PageSize   int       `json:"page_size"`
	TotalPages int       `json:"total_pages"`
}

type CreateRequest struct {
	ProjectID   string         `json:"-"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Description string         `json:"description,omitempty"`
	Config      map[string]any `json:"config,omitempty"`
}

type UpdateRequest struct {
	ProjectID   string         `json:"-"`
	ToolkitID   string         `json:"-"`
	Name        *string        `json:"name,omitempty"`
	Description *string        `json:"description,omitempty"`
	Config      map[string]any `json:"config,omitempty"`
}

type DiscoverRequest struct {
	ProjectID   string         `json:"-"`
	ToolkitType string         `json:"-"`
	Config      map[string]any `json:"config"`
}

type DiscoverResponse struct {
	Tools []Tool `json:"tools"`
}

type CallToolRequest struct {
	ProjectID string         `json:"-"`
	ToolkitID string         `json:"toolkit_id"`
	ToolName  string         `json:"tool_name"`
	Input     map[string]any `json:"input"`
}

type CallToolResponse struct {
	Output string         `json:"output"`
	Error  string         `json:"error,omitempty"`
	Meta   map[string]any `json:"meta,omitempty"`
}
