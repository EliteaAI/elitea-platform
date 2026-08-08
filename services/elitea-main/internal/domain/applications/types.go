package applications

import "time"

type Author struct {
	ID    string `json:"id"`
	Email string `json:"email"`
	Name  string `json:"name"`
}

type Application struct {
	ID string `json:"id"`
	// UUID is the applications.uuid column. It is a second, stable identity
	// for the row; ID is the SERIAL primary key every other endpoint and the
	// UI's /agents/$tab/$agentId route address the application by.
	UUID         string         `json:"uuid,omitempty"`
	ProjectID    string         `json:"project_id,omitempty"`
	Name         string         `json:"name"`
	Description  string         `json:"description,omitempty"`
	Type         string         `json:"type,omitempty"`
	Icon         string         `json:"icon,omitempty"`
	Tags         []string       `json:"tags,omitempty"`
	FolderID     string         `json:"folder_id,omitempty"`
	Status       string         `json:"status,omitempty"`
	Metadata     map[string]any `json:"metadata,omitempty"`
	CreatedAt    time.Time      `json:"created_at"`
	UpdatedAt    time.Time      `json:"updated_at,omitempty"`
	CreatedBy    string         `json:"created_by,omitempty"`
	OwnerID      string         `json:"owner_id"`
	Authors      []Author       `json:"authors,omitempty"`
	IsForked     bool           `json:"is_forked"`
	Meta         map[string]any `json:"meta"`
	HasInterrupt bool           `json:"has_interrupt"`
	AgentType    string         `json:"agent_type,omitempty"`
	// Versions carries the versions created alongside the application by
	// Create (CreateRequest.InitialVersion). Read paths populate versions
	// through ListVersions/GetVersion instead.
	Versions []Version `json:"versions,omitempty"`
}

type Version struct {
	ID            string `json:"id"`
	ApplicationID string `json:"application_id"`
	Name          string `json:"name"`
	Description   string `json:"description,omitempty"`
	// Config is a DERIVED, READ-ONLY projection of the columns that actually
	// exist (see VersionConfig). Repository writes reject a non-zero Config;
	// set the column-backed fields below instead.
	Config    VersionConfig `json:"config"`
	IsDefault bool          `json:"is_default"`
	Status    string        `json:"status"`
	CreatedAt time.Time     `json:"created_at"`
	UpdatedAt time.Time     `json:"updated_at"`

	// Column-backed fields — these are the write surface, one per
	// application_versions column (migrations/001_initial.sql).
	AuthorID             int64          `json:"author_id,omitempty"`
	AgentType            string         `json:"agent_type,omitempty"`
	Instructions         string         `json:"instructions,omitempty"`
	WelcomeMessage       string         `json:"welcome_message,omitempty"`
	LLMSettings          map[string]any `json:"llm_settings,omitempty"`
	ConversationStarters []any          `json:"conversation_starters,omitempty"`
	Meta                 map[string]any `json:"meta,omitempty"`
}

// VersionConfig is a derived projection over the application_versions columns
// that can carry it, not a storage shape of its own:
//
//	Model        <-> llm_settings->>'model_name'
//	Temperature  <-> llm_settings->'temperature'
//	MaxTokens    <-> llm_settings->'max_tokens'
//	SystemPrompt <-> instructions
//
// Tools, Skills, Datasources and Guardrails have NO storage: tools and skills
// live in the entity_tool_mapping / entity_skill_mapping association tables
// this repository does not own, and datasources/guardrails have no column and
// no table anywhere in the tenant schema. Rather than accept and silently drop
// them, the repository rejects a write that sets any field of this struct.
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
	ProjectID  string `json:"-"`
	Page       int    `json:"page,omitempty"`
	PageSize   int    `json:"page_size,omitempty"`
	Search     string `json:"search,omitempty"`
	Tags       string `json:"tags,omitempty"`
	FolderID   string `json:"folder_id,omitempty"`
	AgentsType string `json:"-"`
}

type ListResponse struct {
	Rows       []Application `json:"rows"`
	Total      int           `json:"total"`
	Page       int           `json:"page"`
	PageSize   int           `json:"page_size"`
	TotalPages int           `json:"total_pages"`
}

type CreateRequest struct {
	ProjectID   string   `json:"-"`
	Name        string   `json:"name"`
	Description string   `json:"description,omitempty"`
	Type        string   `json:"type"`
	Icon        string   `json:"icon,omitempty"`
	Tags        []string `json:"tags,omitempty"`
	FolderID    string   `json:"folder_id,omitempty"`
	// OwnerID is the authenticated principal's owning auth_core__user id. It
	// is never decoded from the request body — the transport layer sets it
	// from the request context (auth.User.OwningUserID).
	OwnerID int64 `json:"-"`
	// InitialVersion, when set, is created in the SAME transaction as the
	// application row. An application with no version row is invisible to
	// List (which INNER JOINs application_versions), so a create that only
	// inserts the parent row does not round-trip.
	InitialVersion *Version       `json:"-"`
	Config         *VersionConfig `json:"config,omitempty"`
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
