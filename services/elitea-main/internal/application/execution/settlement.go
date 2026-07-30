package execution

import (
	"context"
	"errors"
	"fmt"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

var (
	ErrInvalidSettlement      = errors.New("invalid execution settlement")
	ErrSettlementConflict     = errors.New("settlement idempotency conflict")
	ErrTerminalOutputNotReady = errors.New("terminal output is not durably ready for settlement")
)

type SettlementOutcome string

const (
	SettlementSucceeded      SettlementOutcome = "SUCCEEDED"
	SettlementFailed         SettlementOutcome = "FAILED"
	SettlementCancelled      SettlementOutcome = "CANCELLED"
	SettlementOutcomeUnknown SettlementOutcome = "OUTCOME_UNKNOWN"
)

func (o SettlementOutcome) valid() bool {
	return o == SettlementSucceeded || o == SettlementFailed || o == SettlementCancelled || o == SettlementOutcomeUnknown
}

type SettlementProposal struct {
	Fence                   runtimedomain.Fence
	ProposalID              string
	Outcome                 SettlementOutcome
	TerminalLogicalOutputID string
	TerminalEventID         string
	TerminalSequence        uint64
	TerminalPayloadDigest   runtimedomain.Digest
	ProposalDigest          runtimedomain.Digest
	IdempotencyKey          string
}

func (p SettlementProposal) Validate() error {
	if err := p.Fence.Validate(); err != nil {
		return err
	}
	if p.ProposalID == "" || !p.Outcome.valid() || p.TerminalLogicalOutputID == "" || p.TerminalEventID == "" || p.TerminalSequence == 0 || p.TerminalPayloadDigest.IsZero() || p.ProposalDigest.IsZero() || p.IdempotencyKey == "" {
		return ErrInvalidSettlement
	}
	return nil
}

type SettlementReceipt struct {
	ID      string
	Outcome SettlementOutcome
}

// SettlementRepository atomically verifies the live fence and matching
// durably ACKed terminal projection before insertion. Idempotent replay is
// authorized only by the exact persisted fence of the SETTLED claim; a reused
// key with a different digest returns ErrSettlementConflict.
type SettlementRepository interface {
	PrepareSettlement(ctx context.Context, proposal SettlementProposal) (SettlementReceipt, error)
}

type SettlementService struct {
	repository SettlementRepository
}

func NewSettlementService(repository SettlementRepository) (*SettlementService, error) {
	if repository == nil {
		return nil, errors.New("settlement repository is required")
	}
	return &SettlementService{repository: repository}, nil
}

func (s *SettlementService) PrepareSettlement(ctx context.Context, proposal SettlementProposal) (SettlementReceipt, error) {
	if err := proposal.Validate(); err != nil {
		return SettlementReceipt{}, err
	}
	receipt, err := s.repository.PrepareSettlement(ctx, proposal)
	if err != nil {
		return SettlementReceipt{}, fmt.Errorf("prepare execution settlement: %w", err)
	}
	if receipt.ID == "" || !receipt.Outcome.valid() || receipt.Outcome != proposal.Outcome {
		return SettlementReceipt{}, errors.New("settlement repository returned an invalid receipt")
	}
	return receipt, nil
}
