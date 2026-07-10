package indexersvc

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/pipelines"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
)

const (
	DefaultRPCTimeout = 30 * time.Second
	StreamRPCTimeout  = 120 * time.Second
	requestChannel    = "pylon_indexer:rpc:request"
)

type Client struct {
	redis      redis.UniversalClient
	rpcTimeout time.Duration
}

type Option func(*Client)

func WithRPCTimeout(d time.Duration) Option {
	return func(c *Client) { c.rpcTimeout = d }
}

func New(rdb redis.UniversalClient, opts ...Option) *Client {
	c := &Client{
		redis:      rdb,
		rpcTimeout: DefaultRPCTimeout,
	}
	for _, o := range opts {
		o(c)
	}
	return c
}

type rpcRequest struct {
	RequestID    string      `json:"request_id"`
	Method       string      `json:"method"`
	Payload      interface{} `json:"payload"`
	ReplyChannel string      `json:"reply_channel"`
}

type rpcResponse struct {
	RequestID string          `json:"request_id"`
	Success   bool            `json:"success"`
	Data      json.RawMessage `json:"data"`
	Error     string          `json:"error"`
	Stream    bool            `json:"stream,omitempty"`
	Done      bool            `json:"done,omitempty"`
}

func (c *Client) call(ctx context.Context, method string, payload interface{}, timeout time.Duration) (json.RawMessage, error) {
	reqID := generateRequestID()
	replyChannel := fmt.Sprintf("elitea_main:rpc:reply:%s", reqID)

	sub := c.redis.Subscribe(ctx, replyChannel)
	defer sub.Close()

	if _, err := sub.Receive(ctx); err != nil {
		return nil, fmt.Errorf("indexersvc: subscribe failed: %w", err)
	}

	req := rpcRequest{
		RequestID:    reqID,
		Method:       method,
		Payload:      payload,
		ReplyChannel: replyChannel,
	}

	reqBytes, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("indexersvc: marshal failed: %w", err)
	}

	if err := c.redis.Publish(ctx, requestChannel, reqBytes).Err(); err != nil {
		return nil, fmt.Errorf("indexersvc: publish failed: %w", err)
	}

	ch := sub.Channel()
	timer := time.NewTimer(timeout)
	defer timer.Stop()

	select {
	case msg := <-ch:
		var resp rpcResponse
		if err := json.Unmarshal([]byte(msg.Payload), &resp); err != nil {
			return nil, fmt.Errorf("indexersvc: unmarshal response: %w", err)
		}
		if !resp.Success {
			return nil, errors.New("indexersvc: " + resp.Error)
		}
		return resp.Data, nil
	case <-timer.C:
		return nil, errors.New("indexersvc: rpc timeout")
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (c *Client) callStream(ctx context.Context, method string, payload interface{}, send func(predict.StreamEvent) error) error {
	reqID := generateRequestID()
	replyChannel := fmt.Sprintf("elitea_main:rpc:reply:%s", reqID)

	sub := c.redis.Subscribe(ctx, replyChannel)
	defer sub.Close()

	if _, err := sub.Receive(ctx); err != nil {
		return fmt.Errorf("indexersvc: subscribe failed: %w", err)
	}

	req := rpcRequest{
		RequestID:    reqID,
		Method:       method,
		Payload:      payload,
		ReplyChannel: replyChannel,
	}

	reqBytes, err := json.Marshal(req)
	if err != nil {
		return fmt.Errorf("indexersvc: marshal failed: %w", err)
	}

	if err := c.redis.Publish(ctx, requestChannel, reqBytes).Err(); err != nil {
		return fmt.Errorf("indexersvc: publish failed: %w", err)
	}

	ch := sub.Channel()
	timer := time.NewTimer(StreamRPCTimeout)
	defer timer.Stop()

	for {
		select {
		case msg, ok := <-ch:
			if !ok {
				return errors.New("indexersvc: channel closed")
			}
			var resp rpcResponse
			if err := json.Unmarshal([]byte(msg.Payload), &resp); err != nil {
				return fmt.Errorf("indexersvc: unmarshal stream chunk: %w", err)
			}
			if !resp.Success {
				return errors.New("indexersvc: " + resp.Error)
			}
			var evt predict.StreamEvent
			if err := json.Unmarshal(resp.Data, &evt); err != nil {
				return fmt.Errorf("indexersvc: unmarshal stream event: %w", err)
			}
			if err := send(evt); err != nil {
				return err
			}
			if resp.Done || evt.Done {
				return nil
			}
			timer.Reset(StreamRPCTimeout)
		case <-timer.C:
			return errors.New("indexersvc: stream timeout")
		case <-ctx.Done():
			return ctx.Err()
		}
	}
}

// Predictor interface implementation

func (c *Client) Predict(ctx context.Context, req predict.Request) (predict.Response, error) {
	data, err := c.call(ctx, "predict", req, c.rpcTimeout)
	if err != nil {
		return predict.Response{}, err
	}
	var resp predict.Response
	if err := json.Unmarshal(data, &resp); err != nil {
		return predict.Response{}, fmt.Errorf("indexersvc: unmarshal predict response: %w", err)
	}
	return resp, nil
}

func (c *Client) PredictStream(ctx context.Context, req predict.Request, send func(predict.StreamEvent) error) error {
	return c.callStream(ctx, "predict_stream", req, send)
}

// LLMService interface implementation

func (c *Client) Complete(ctx context.Context, req predict.LLMRequest) (predict.LLMResponse, error) {
	data, err := c.call(ctx, "llm_complete", req, c.rpcTimeout)
	if err != nil {
		return predict.LLMResponse{}, err
	}
	var resp predict.LLMResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return predict.LLMResponse{}, fmt.Errorf("indexersvc: unmarshal llm response: %w", err)
	}
	return resp, nil
}

func (c *Client) CompleteStream(ctx context.Context, req predict.LLMRequest, send func(predict.StreamEvent) error) error {
	return c.callStream(ctx, "llm_complete_stream", req, send)
}

// ChatService interface implementation

func (c *Client) SendMessage(ctx context.Context, req conversations.SendMessageRequest) (conversations.SendMessageResponse, error) {
	data, err := c.call(ctx, "chat_send_message", req, c.rpcTimeout)
	if err != nil {
		return conversations.SendMessageResponse{}, err
	}
	var resp conversations.SendMessageResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return conversations.SendMessageResponse{}, fmt.Errorf("indexersvc: unmarshal chat response: %w", err)
	}
	return resp, nil
}

func (c *Client) SendMessageStream(ctx context.Context, req conversations.SendMessageRequest, send func(predict.StreamEvent) error) error {
	return c.callStream(ctx, "chat_send_message_stream", req, send)
}

// PipelineRunner interface implementation

func (c *Client) Run(ctx context.Context, req predict.PipelineRunRequest) (predict.PipelineRunResponse, error) {
	data, err := c.call(ctx, "pipeline_run", req, c.rpcTimeout)
	if err != nil {
		return predict.PipelineRunResponse{}, err
	}
	var resp predict.PipelineRunResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return predict.PipelineRunResponse{}, fmt.Errorf("indexersvc: unmarshal pipeline response: %w", err)
	}
	return resp, nil
}

func (c *Client) Status(ctx context.Context, projectID, taskID string) (pipelines.PipelineStatus, error) {
	payload := map[string]string{"project_id": projectID, "task_id": taskID}
	data, err := c.call(ctx, "pipeline_status", payload, c.rpcTimeout)
	if err != nil {
		return pipelines.PipelineStatus{}, err
	}
	var resp pipelines.PipelineStatus
	if err := json.Unmarshal(data, &resp); err != nil {
		return pipelines.PipelineStatus{}, fmt.Errorf("indexersvc: unmarshal pipeline status: %w", err)
	}
	return resp, nil
}

func (c *Client) Cancel(ctx context.Context, projectID, taskID string) error {
	payload := map[string]string{"project_id": projectID, "task_id": taskID}
	_, err := c.call(ctx, "pipeline_cancel", payload, c.rpcTimeout)
	return err
}

// ToolTester interface implementation

type TestToolRequest struct {
	ProjectID   string         `json:"project_id"`
	ToolkitID   string         `json:"toolkit_id,omitempty"`
	ToolID      string         `json:"tool_id,omitempty"`
	ToolName    string         `json:"tool_name,omitempty"`
	ToolParams  map[string]any `json:"tool_params,omitempty"`
	UserID      string         `json:"user_id,omitempty"`
}

type TestToolResponse struct {
	OK     bool   `json:"ok"`
	Result any    `json:"result,omitempty"`
	Error  string `json:"error,omitempty"`
}

func (c *Client) TestTool(ctx context.Context, req TestToolRequest) (TestToolResponse, error) {
	data, err := c.call(ctx, "indexer_test_toolkit_tool", req, StreamRPCTimeout)
	if err != nil {
		return TestToolResponse{OK: false, Error: err.Error()}, nil
	}
	var resp TestToolResponse
	if err := json.Unmarshal(data, &resp); err != nil {
		return TestToolResponse{OK: true, Result: string(data)}, nil
	}
	return resp, nil
}

// MCPSyncTools forwards MCP tool discovery to pylon_indexer
func (c *Client) MCPSyncTools(ctx context.Context, payload map[string]any) (json.RawMessage, error) {
	return c.call(ctx, "mcp_sync_tools", payload, StreamRPCTimeout)
}

func generateRequestID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
