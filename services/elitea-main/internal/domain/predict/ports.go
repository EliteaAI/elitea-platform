package predict

import "context"

type Predictor interface {
	Predict(ctx context.Context, req Request) (Response, error)
	PredictStream(ctx context.Context, req Request, send func(StreamEvent) error) error
}

type LLMProvider interface {
	Complete(ctx context.Context, req LLMRequest) (LLMResponse, error)
	CompleteStream(ctx context.Context, req LLMRequest, send func(StreamEvent) error) error
}

type PipelineRunner interface {
	Run(ctx context.Context, req PipelineRunRequest) (PipelineRunResponse, error)
	Status(ctx context.Context, projectID, taskID string) (PipelineStatus, error)
	Cancel(ctx context.Context, projectID, taskID string) error
}
