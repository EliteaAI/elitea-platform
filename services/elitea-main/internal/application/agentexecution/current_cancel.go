package agentexecution

import (
	"context"
	"errors"
	"math"
)

var (
	ErrInvalidCurrentAgentCancel    = errors.New("invalid current agent cancel request")
	ErrCurrentAgentCancelNotAllowed = errors.New("current agent response cannot be stopped by this actor")
	ErrCurrentAgentCancelFailed     = errors.New("current agent cancellation is unavailable")
)

// CurrentAgentCancelRequest identifies the response projection and actor at
// the current UI compatibility boundary. The repository resolves the exact
// durable execution from the response instead of trusting a client task ID.
type CurrentAgentCancelRequest struct {
	ProjectID         int64
	ActorUserID       int64
	ResponseMessageID string
}

func (request CurrentAgentCancelRequest) Validate() error {
	if request.ProjectID <= 0 || request.ProjectID > math.MaxInt32 ||
		request.ActorUserID <= 0 || !validUUID(request.ResponseMessageID) {
		return ErrInvalidCurrentAgentCancel
	}
	return nil
}

type CurrentAgentCancelOutcome struct {
	Deleted  bool
	Salvaged bool
	Replay   bool
}

type CurrentAgentCancellationStore interface {
	CancelCurrentAgent(
		context.Context,
		CurrentAgentCancelRequest,
	) (CurrentAgentCancelOutcome, error)
}

type CurrentAgentCancellationService struct {
	store CurrentAgentCancellationStore
}

func NewCurrentAgentCancellationService(
	store CurrentAgentCancellationStore,
) (*CurrentAgentCancellationService, error) {
	if store == nil {
		return nil, errors.New("current agent cancellation store is required")
	}
	return &CurrentAgentCancellationService{store: store}, nil
}

func (service *CurrentAgentCancellationService) Cancel(
	ctx context.Context,
	request CurrentAgentCancelRequest,
) (CurrentAgentCancelOutcome, error) {
	if service == nil || service.store == nil || ctx == nil {
		return CurrentAgentCancelOutcome{}, ErrInvalidCurrentAgentCancel
	}
	if err := request.Validate(); err != nil {
		return CurrentAgentCancelOutcome{}, err
	}
	if err := ctx.Err(); err != nil {
		return CurrentAgentCancelOutcome{}, err
	}

	outcome, err := service.store.CancelCurrentAgent(ctx, request)
	if err == nil {
		return outcome, nil
	}
	if contextError := ctx.Err(); contextError != nil {
		return CurrentAgentCancelOutcome{}, contextError
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, ErrCurrentAgentCancelNotAllowed) {
		return CurrentAgentCancelOutcome{}, err
	}
	return CurrentAgentCancelOutcome{}, ErrCurrentAgentCancelFailed
}
