package rpc

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/redis/go-redis/v9"
)

const requestChannel = "elitea_rpc"

// Client publishes fire-and-forget RPC messages to pylon-indexer via Redis.
type Client struct {
	rdb *redis.Client
}

// New creates an RPC Client.
func New(rdb *redis.Client) *Client {
	return &Client{rdb: rdb}
}

// PipelineRunPayload is the payload for dispatching a pipeline execution.
type PipelineRunPayload struct {
	ProjectID string `json:"project_id"`
	VersionID int    `json:"version_id"`
}

// DispatchPipelineRun publishes a pipeline_run RPC to pylon-indexer.
// Fire-and-forget: no reply expected.
func (c *Client) DispatchPipelineRun(ctx context.Context, payload PipelineRunPayload) error {
	msg := map[string]any{
		"request_id":    generateRequestID(),
		"method":        "pipeline_run",
		"payload":       payload,
		"reply_channel": "",
	}
	data, err := json.Marshal(msg)
	if err != nil {
		return fmt.Errorf("rpc: marshal: %w", err)
	}
	return c.rdb.Publish(ctx, requestChannel, data).Err()
}

var requestCounter uint64

func generateRequestID() string {
	requestCounter++
	return fmt.Sprintf("sched-%d", requestCounter)
}
