package toolkits

import (
	"context"
	"encoding/json"
)

type ToolTester interface {
	TestTool(ctx context.Context, req TestToolRequest) (TestToolResponse, error)
}

type TestToolRequest struct {
	ProjectID  string         `json:"project_id"`
	ToolkitID  string         `json:"toolkit_id,omitempty"`
	ToolID     string         `json:"tool_id,omitempty"`
	ToolName   string         `json:"tool_name,omitempty"`
	ToolParams map[string]any `json:"tool_params,omitempty"`
	UserID     string         `json:"user_id,omitempty"`
}

type TestToolResponse struct {
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

type MCPToolSyncer interface {
	MCPSyncTools(ctx context.Context, payload map[string]any) (json.RawMessage, error)
}
