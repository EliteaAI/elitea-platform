package agentexecution

import (
	"context"
	"errors"
	"testing"
)

type currentAgentCancellationStoreStub struct {
	request CurrentAgentCancelRequest
	outcome CurrentAgentCancelOutcome
	err     error
}

func (stub *currentAgentCancellationStoreStub) CancelCurrentAgent(
	_ context.Context,
	request CurrentAgentCancelRequest,
) (CurrentAgentCancelOutcome, error) {
	stub.request = request
	return stub.outcome, stub.err
}

func TestCurrentAgentCancellationServicePreservesOutcomes(t *testing.T) {
	store := &currentAgentCancellationStoreStub{
		outcome: CurrentAgentCancelOutcome{Salvaged: true},
	}
	service, err := NewCurrentAgentCancellationService(store)
	if err != nil {
		t.Fatal(err)
	}
	request := CurrentAgentCancelRequest{
		ProjectID: 2, ActorUserID: 7,
		ResponseMessageID: "10000000-0000-4000-8000-000000000021",
	}
	outcome, err := service.Cancel(t.Context(), request)
	if err != nil {
		t.Fatal(err)
	}
	if outcome != store.outcome || store.request != request {
		t.Fatalf("outcome=%+v request=%+v", outcome, store.request)
	}
}

func TestCurrentAgentCancellationServiceValidatesAndMapsFailures(t *testing.T) {
	store := &currentAgentCancellationStoreStub{}
	service, err := NewCurrentAgentCancellationService(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Cancel(t.Context(), CurrentAgentCancelRequest{}); !errors.Is(err, ErrInvalidCurrentAgentCancel) {
		t.Fatalf("invalid error=%v", err)
	}
	store.err = ErrCurrentAgentCancelNotAllowed
	request := CurrentAgentCancelRequest{
		ProjectID: 2, ActorUserID: 7,
		ResponseMessageID: "10000000-0000-4000-8000-000000000022",
	}
	if _, err := service.Cancel(t.Context(), request); !errors.Is(err, ErrCurrentAgentCancelNotAllowed) {
		t.Fatalf("authorization error=%v", err)
	}
	store.err = errors.New("database unavailable")
	if _, err := service.Cancel(t.Context(), request); !errors.Is(err, ErrCurrentAgentCancelFailed) {
		t.Fatalf("mapped error=%v", err)
	}
}
