// Package indexer provides an adapter wrapping indexersvc.Client (Redis RPC)
// behind domain port interfaces. When the indexer gains gRPC, swap this adapter
// for a gRPC-backed implementation — no handler code changes needed.
package indexer

import (
	"context"
	"encoding/json"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/toolkits"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
)

// Adapter wraps the Redis RPC indexer client and satisfies all domain port
// interfaces that the indexer service provides.
type Adapter struct {
	client *indexersvc.Client
}

func New(client *indexersvc.Client) *Adapter {
	return &Adapter{client: client}
}

// --- predict.Predictor ---

func (a *Adapter) Predict(ctx context.Context, req predict.Request) (predict.Response, error) {
	return a.client.Predict(ctx, req)
}

func (a *Adapter) PredictStream(ctx context.Context, req predict.Request, send func(predict.StreamEvent) error) error {
	return a.client.PredictStream(ctx, req, send)
}

// --- predict.LLMProvider ---

func (a *Adapter) Complete(ctx context.Context, req predict.LLMRequest) (predict.LLMResponse, error) {
	return a.client.Complete(ctx, req)
}

func (a *Adapter) CompleteStream(ctx context.Context, req predict.LLMRequest, send func(predict.StreamEvent) error) error {
	return a.client.CompleteStream(ctx, req, send)
}

// --- conversations.ChatService ---

func (a *Adapter) SendMessage(ctx context.Context, req conversations.SendMessageRequest) (conversations.SendMessageResponse, error) {
	return a.client.SendMessage(ctx, req)
}

func (a *Adapter) SendMessageStream(ctx context.Context, req conversations.SendMessageRequest, send func(predict.StreamEvent) error) error {
	return a.client.SendMessageStream(ctx, req, send)
}

// --- predict.PipelineRunner ---

func (a *Adapter) Run(ctx context.Context, req predict.PipelineRunRequest) (predict.PipelineRunResponse, error) {
	return a.client.Run(ctx, req)
}

func (a *Adapter) Status(ctx context.Context, projectID, taskID string) (predict.PipelineStatus, error) {
	st, err := a.client.Status(ctx, projectID, taskID)
	if err != nil {
		return predict.PipelineStatus{}, err
	}
	return predict.PipelineStatus{
		TaskID:    st.TaskID,
		Status:    st.Status,
		Result:    st.Result,
		Error:     st.Error,
		StartedAt: st.StartedAt,
		EndedAt:   st.EndedAt,
	}, nil
}

func (a *Adapter) Cancel(ctx context.Context, projectID, taskID string) error {
	return a.client.Cancel(ctx, projectID, taskID)
}

// --- toolkits.ToolTester ---

func (a *Adapter) TestTool(ctx context.Context, req toolkits.TestToolRequest) (toolkits.TestToolResponse, error) {
	infraReq := indexersvc.TestToolRequest{
		ProjectID:  req.ProjectID,
		ToolkitID:  req.ToolkitID,
		ToolID:     req.ToolID,
		ToolName:   req.ToolName,
		ToolParams: req.ToolParams,
		UserID:     req.UserID,
	}
	resp, err := a.client.TestTool(ctx, infraReq)
	if err != nil {
		return toolkits.TestToolResponse{}, err
	}
	return toolkits.TestToolResponse{
		OK:     resp.OK,
		Result: resp.Result,
		Error:  resp.Error,
	}, nil
}

// --- toolkits.MCPToolSyncer ---

func (a *Adapter) MCPSyncTools(ctx context.Context, payload map[string]any) (json.RawMessage, error) {
	return a.client.MCPSyncTools(ctx, payload)
}

// Compile-time interface checks.
var (
	_ predict.Predictor          = (*Adapter)(nil)
	_ predict.LLMProvider        = (*Adapter)(nil)
	_ predict.PipelineRunner     = (*Adapter)(nil)
	_ conversations.ChatService  = (*Adapter)(nil)
	_ toolkits.ToolTester        = (*Adapter)(nil)
	_ toolkits.MCPToolSyncer     = (*Adapter)(nil)
)
