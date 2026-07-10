package applications

import "time"

type Application struct {
	ID          string            `json:"id"`
	ProjectID   string            `json:"project_id"`
	Name        string            `json:"name"`
	Description string            `json:"description,omitempty"`
	Type        string            `json:"type"`
	Icon        string            `json:"icon,omitempty"`
	Tags        []string          `json:"tags,omitempty"`
	FolderID    string            `json:"folder_id,omitempty"`
	Status      string            `json:"status"`
	Metadata    map[string]any    `json:"metadata,omitempty"`
	CreatedAt   time.Time         `json:"created_at"`
	UpdatedAt   time.Time         `json:"updated_at"`
	CreatedBy   string            `json:"created_by"`
}

type Version struct {
	ID            string         `json:"id"`
	ApplicationID string         `json:"application_id"`
	Name          string         `json:"name"`
	Description   string         `json:"description,omitempty"`
	Config        VersionConfig  `json:"config"`
	IsDefault     bool           `json:"is_default"`
	Status        string         `json:"status"`
	CreatedAt     time.Time      `json:"created_at"`
	UpdatedAt     time.Time      `json:"updated_at"`
}

type VersionConfig struct {
	Model        string         `json:"model,omitempty"`
	Temperature  float64        `json:"temperature,omitempty"`
	MaxTokens    int            `json:"max_tokens,omitempty"`
	SystemPrompt string         `json:"system_prompt,omitempty"`
	Tools        []ToolRef      `json:"tools,omitempty"`
	Skills       []SkillRef     `json:"skills,omitempty"`
	Datasources  []string       `json:"datasources,omitempty"`
	Guardrails   *GuardrailsCfg `json:"guardrails,omitempty"`
}

type ToolRef struct {
	ToolkitID string `json:"toolkit_id"`
	ToolName  string `json:"tool_name"`
}

type SkillRef struct {
	SkillID   string `json:"skill_id"`
	VersionID string `json:"version_id,omitempty"`
}

type GuardrailsCfg struct {
	Input  []GuardrailRule `json:"input,omitempty"`
	Output []GuardrailRule `json:"output,omitempty"`
}

type GuardrailRule struct {
	Type   string         `json:"type"`
	Config map[string]any `json:"config,omitempty"`
}

type ListRequest struct {
	ProjectID string `json:"-"`
	Page      int    `json:"page,omitempty"`
	PageSize  int    `json:"page_size,omitempty"`
	Search    string `json:"search,omitempty"`
	Tags      string `json:"tags,omitempty"`
	FolderID  string `json:"folder_id,omitempty"`
}

type ListResponse struct {
	Items      []Application `json:"items"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalPages int           `json:"total_pages"`
}

type CreateRequest struct {
	ProjectID   string         `json:"-"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Type        string         `json:"type"`
	Icon        string         `json:"icon,omitempty"`
	Tags        []string       `json:"tags,omitempty"`
	FolderID    string         `json:"folder_id,omitempty"`
	Config      *VersionConfig `json:"config,omitempty"`
}

type UpdateRequest struct {
	ProjectID     string   `json:"-"`
	ApplicationID string   `json:"-"`
	Name          *string  `json:"name,omitempty"`
	Description   *string  `json:"description,omitempty"`
	Icon          *string  `json:"icon,omitempty"`
	Tags          []string `json:"tags,omitempty"`
	FolderID      *string  `json:"folder_id,omitempty"`
}

type PredictRequest struct {
	ProjectID string         `json:"-"`
	VersionID string         `json:"-"`
	Input     string         `json:"input"`
	Variables map[string]any `json:"variables,omitempty"`
	Stream    bool           `json:"stream,omitempty"`
}

type PredictResponse struct {
	MessageGroupUID string `json:"message_group_uid"`
	Content         string `json:"content,omitempty"`
	IsStreaming     bool   `json:"is_streaming"`
}
