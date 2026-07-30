package execution

import (
	"context"
	"errors"
	"fmt"
	"testing"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

type memorySettlementRepository struct {
	ready     bool
	proposals map[string]SettlementProposal
	receipts  map[string]SettlementReceipt
}

func newMemorySettlementRepository() *memorySettlementRepository {
	return &memorySettlementRepository{
		ready:     true,
		proposals: make(map[string]SettlementProposal),
		receipts:  make(map[string]SettlementReceipt),
	}
}

func (r *memorySettlementRepository) PrepareSettlement(_ context.Context, proposal SettlementProposal) (SettlementReceipt, error) {
	if !r.ready {
		return SettlementReceipt{}, ErrTerminalOutputNotReady
	}
	key := fmt.Sprintf("%s:%d:%s", proposal.Fence.ExecutionID, proposal.Fence.Generation, proposal.IdempotencyKey)
	if existing, ok := r.proposals[key]; ok {
		if existing.ProposalDigest != proposal.ProposalDigest {
			return SettlementReceipt{}, ErrSettlementConflict
		}
		return r.receipts[key], nil
	}
	receipt := SettlementReceipt{ID: "receipt-1", Outcome: proposal.Outcome}
	r.proposals[key] = proposal
	r.receipts[key] = receipt
	return receipt, nil
}

func TestSettlementServiceIsGenerationBoundAndDigestIdempotent(t *testing.T) {
	repository := newMemorySettlementRepository()
	service, err := NewSettlementService(repository)
	if err != nil {
		t.Fatal(err)
	}
	proposal := validSettlementProposal()

	first, err := service.PrepareSettlement(context.Background(), proposal)
	if err != nil {
		t.Fatal(err)
	}
	replay, err := service.PrepareSettlement(context.Background(), proposal)
	if err != nil {
		t.Fatal(err)
	}
	if replay != first || len(repository.proposals) != 1 {
		t.Fatalf("identical settlement was not replayed: first=%+v replay=%+v", first, replay)
	}

	conflict := proposal
	conflict.ProposalDigest = runtimedomain.SHA256([]byte("different-proposal"))
	if _, err := service.PrepareSettlement(context.Background(), conflict); !errors.Is(err, ErrSettlementConflict) {
		t.Fatalf("reused idempotency key with different digest was accepted: %v", err)
	}

	nextGeneration := proposal
	nextGeneration.Fence.Generation++
	nextGeneration.ProposalDigest = runtimedomain.SHA256([]byte("next-generation"))
	if _, err := service.PrepareSettlement(context.Background(), nextGeneration); err != nil {
		t.Fatalf("next execution generation was not independently keyed: %v", err)
	}
	if len(repository.proposals) != 2 {
		t.Fatalf("settlement repository was not keyed by generation: %d", len(repository.proposals))
	}
}

func TestSettlementServiceDoesNotPrepareBeforeTerminalOutputIsDurable(t *testing.T) {
	repository := newMemorySettlementRepository()
	repository.ready = false
	service, err := NewSettlementService(repository)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.PrepareSettlement(context.Background(), validSettlementProposal()); !errors.Is(err, ErrTerminalOutputNotReady) {
		t.Fatalf("settlement was prepared before durable terminal output: %v", err)
	}
}

func validSettlementProposal() SettlementProposal {
	return SettlementProposal{
		Fence: runtimedomain.Fence{
			CommandID:         "command-1",
			ExecutionID:       "execution-1",
			Generation:        1,
			WorkloadIdentity:  "spiffe://elitea.test/workload/worker-1",
			WorkloadSessionID: "workload-1",
			ProducerID:        "producer-1",
			ClaimAttempt:      1,
			LeaseEpoch:        1,
			Token:             runtimedomain.FenceToken(runtimedomain.SHA256([]byte("fence-token"))),
		},
		ProposalID:              "proposal-1",
		Outcome:                 SettlementSucceeded,
		TerminalLogicalOutputID: "validation:revision-1",
		TerminalEventID:         "event-1",
		TerminalSequence:        1,
		TerminalPayloadDigest:   runtimedomain.SHA256([]byte("terminal-output")),
		ProposalDigest:          runtimedomain.SHA256([]byte("proposal")),
		IdempotencyKey:          "settlement-key-1",
	}
}
