package execution

import (
	"context"
	"errors"
	"fmt"
	"time"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

var (
	ErrInvalidClaim               = errors.New("invalid execution claim")
	ErrClaimDependencyUnavailable = errors.New("execution claim dependency is unavailable")
)

type ClaimRequest struct {
	CommandID            string
	OutboxID             string
	ExecutionID          string
	Generation           uint64
	SignedEnvelopeDigest runtimedomain.Digest
	WorkloadIdentity     string
	WorkloadSessionID    string
	ProducerID           string
}

// ClaimAbortDisposition records why a live, fully fenced claim was released
// before any business work could start. Retry is bounded by the control plane;
// permanent and exhausted failures quarantine the durable job for explicit
// reconciliation instead of re-executing it indefinitely.
type ClaimAbortDisposition string

const (
	ClaimAbortInputResolutionRetry     ClaimAbortDisposition = "INPUT_RESOLUTION_RETRY"
	ClaimAbortInputResolutionExhausted ClaimAbortDisposition = "INPUT_RESOLUTION_EXHAUSTED"
	ClaimAbortInputManifestInvalid     ClaimAbortDisposition = "INPUT_MANIFEST_INVALID"
)

func (d ClaimAbortDisposition) valid() bool {
	switch d {
	case ClaimAbortInputResolutionRetry, ClaimAbortInputResolutionExhausted, ClaimAbortInputManifestInvalid:
		return true
	default:
		return false
	}
}

type ClaimDisposition string

const (
	ClaimAccepted           ClaimDisposition = "ACCEPTED"
	ClaimRecoverTerminalACK ClaimDisposition = "RECOVER_TERMINAL_ACK"
	ClaimRecoverSettlement  ClaimDisposition = "RECOVER_SETTLEMENT"
	ClaimSettledACK         ClaimDisposition = "SETTLED_ACK"
	ClaimObsoleteACK        ClaimDisposition = "OBSOLETE_ACK"
	ClaimActiveLeaseNoACK   ClaimDisposition = "ACTIVE_LEASE_NOACK"
	ClaimRetryLaterNoACK    ClaimDisposition = "RETRY_LATER_NOACK"
	ClaimRetiredACK         ClaimDisposition = "RETIRED_ACK"
)

func (d ClaimDisposition) valid() bool {
	switch d {
	case ClaimAccepted, ClaimRecoverTerminalACK, ClaimRecoverSettlement, ClaimSettledACK, ClaimObsoleteACK, ClaimActiveLeaseNoACK, ClaimRetryLaterNoACK, ClaimRetiredACK:
		return true
	default:
		return false
	}
}

type RetirementReason string

const (
	RetirementDeadlineExceeded  RetirementReason = "DEADLINE_EXCEEDED"
	DeadlineExceededSafeMessage                  = "The execution deadline was exceeded before worker authority was granted."
)

func (r RetirementReason) valid() bool {
	return r == RetirementDeadlineExceeded
}

type SettlementRecovery struct {
	Proposal *SettlementProposal
	Receipt  *SettlementReceipt
}

type ClaimDecision struct {
	Lease runtimedomain.ActiveLease
	// DesiredState is populated only for a no-lease disposition. A retry may
	// expose any valid desired state; OBSOLETE_ACK is limited to a durably
	// cancelled execution that never received worker authority. RETIRED_ACK is
	// distinct and requires an exact durable retirement reason.
	DesiredState          runtimedomain.DesiredState
	Disposition           ClaimDisposition
	RetirementReason      RetirementReason
	ClaimHandoffWatermark uint64
	SettlementRecovery    *SettlementRecovery
}

func (d ClaimDecision) validate(now time.Time, request ClaimRequest) error {
	if !d.Disposition.valid() {
		return ErrInvalidClaim
	}
	if d.Lease == (runtimedomain.ActiveLease{}) {
		if d.ClaimHandoffWatermark != 0 || d.SettlementRecovery != nil {
			return ErrInvalidClaim
		}
		switch d.Disposition {
		case ClaimRetryLaterNoACK:
			if d.DesiredState.Valid() && d.RetirementReason == "" {
				return nil
			}
		case ClaimObsoleteACK:
			if d.DesiredState == runtimedomain.DesiredCancelled && d.RetirementReason == "" {
				return nil
			}
		case ClaimRetiredACK:
			if d.DesiredState.Valid() && d.RetirementReason.valid() {
				return nil
			}
		}
		return ErrInvalidClaim
	}
	if d.DesiredState != "" || d.RetirementReason != "" {
		return ErrInvalidClaim
	}
	lease := d.Lease
	if lease.Fence.CommandID != request.CommandID || lease.Fence.ExecutionID != request.ExecutionID || lease.Fence.Generation != request.Generation || lease.Fence.WorkloadIdentity != request.WorkloadIdentity || lease.Fence.WorkloadSessionID != request.WorkloadSessionID || lease.Fence.ProducerID != request.ProducerID {
		return fmt.Errorf("%w: repository returned mismatched lease", ErrInvalidClaim)
	}
	if err := lease.Verify(now, lease.Fence); err != nil {
		return fmt.Errorf("%w: %v", ErrInvalidClaim, err)
	}
	switch d.Disposition {
	case ClaimRecoverTerminalACK:
		if d.SettlementRecovery == nil || d.SettlementRecovery.Proposal == nil || d.SettlementRecovery.Receipt != nil {
			return ErrInvalidClaim
		}
		if err := d.SettlementRecovery.Proposal.Validate(); err != nil || d.SettlementRecovery.Proposal.Fence != lease.Fence {
			return ErrInvalidClaim
		}
	case ClaimRecoverSettlement:
		if d.SettlementRecovery == nil || d.SettlementRecovery.Proposal != nil || d.SettlementRecovery.Receipt == nil || d.SettlementRecovery.Receipt.ID == "" || !d.SettlementRecovery.Receipt.Outcome.valid() {
			return ErrInvalidClaim
		}
	default:
		if d.SettlementRecovery != nil {
			return ErrInvalidClaim
		}
	}
	return nil
}

type ClaimRepository interface {
	ClaimValidation(ctx context.Context, request ClaimRequest, leaseUntil time.Time) (ClaimDecision, error)
	CurrentLease(ctx context.Context, executionID string, generation uint64) (runtimedomain.ActiveLease, error)
	RenewLease(ctx context.Context, fence runtimedomain.Fence, leaseUntil time.Time) (runtimedomain.ActiveLease, error)
	ReleaseClaim(ctx context.Context, fence runtimedomain.Fence) error
	AbortClaim(ctx context.Context, fence runtimedomain.Fence, disposition ClaimAbortDisposition) error
	DesiredState(ctx context.Context, executionID string, generation uint64) (runtimedomain.DesiredState, error)
}

type ClaimService struct {
	repository ClaimRepository
	now        func() time.Time
	leaseTTL   time.Duration
}

func NewClaimService(repository ClaimRepository, now func() time.Time, leaseTTL time.Duration) (*ClaimService, error) {
	if repository == nil {
		return nil, errors.New("claim repository is required")
	}
	if now == nil {
		now = time.Now
	}
	if leaseTTL <= 0 {
		return nil, errors.New("lease TTL must be positive")
	}
	return &ClaimService{repository: repository, now: now, leaseTTL: leaseTTL}, nil
}

func (s *ClaimService) Claim(ctx context.Context, request ClaimRequest) (ClaimDecision, error) {
	if request.CommandID == "" || request.OutboxID == "" || request.ExecutionID == "" || request.Generation == 0 || request.SignedEnvelopeDigest.IsZero() || request.WorkloadIdentity == "" || request.WorkloadSessionID == "" || request.ProducerID == "" {
		return ClaimDecision{}, ErrInvalidClaim
	}
	now := s.now().UTC()
	decision, err := s.repository.ClaimValidation(ctx, request, now.Add(s.leaseTTL))
	if err != nil {
		return ClaimDecision{}, fmt.Errorf("claim validation command: %w", err)
	}
	if err := decision.validate(now, request); err != nil {
		return ClaimDecision{}, err
	}
	return decision, nil
}

func (s *ClaimService) VerifyActive(ctx context.Context, fence runtimedomain.Fence) error {
	if err := fence.Validate(); err != nil {
		return err
	}
	lease, err := s.repository.CurrentLease(ctx, fence.ExecutionID, fence.Generation)
	if err != nil {
		return fmt.Errorf("load current execution lease: %w", err)
	}
	if err := lease.Verify(s.now().UTC(), fence); err != nil {
		return err
	}
	return nil
}

func (s *ClaimService) Renew(ctx context.Context, fence runtimedomain.Fence) (runtimedomain.ActiveLease, error) {
	if err := s.VerifyActive(ctx, fence); err != nil {
		return runtimedomain.ActiveLease{}, err
	}
	now := s.now().UTC()
	renewed, err := s.repository.RenewLease(ctx, fence, now.Add(s.leaseTTL))
	if err != nil {
		return runtimedomain.ActiveLease{}, fmt.Errorf("renew execution lease: %w", err)
	}
	if err := renewed.Verify(now, fence); err != nil {
		return runtimedomain.ActiveLease{}, fmt.Errorf("%w: repository changed renewed fence", ErrInvalidClaim)
	}
	return renewed, nil
}

func (s *ClaimService) Release(ctx context.Context, fence runtimedomain.Fence) error {
	if err := s.VerifyActive(ctx, fence); err != nil {
		return err
	}
	if err := s.repository.ReleaseClaim(ctx, fence); err != nil {
		return fmt.Errorf("release execution claim: %w", err)
	}
	return nil
}

func (s *ClaimService) Abort(ctx context.Context, fence runtimedomain.Fence, disposition ClaimAbortDisposition) error {
	if err := fence.Validate(); err != nil {
		return err
	}
	if !disposition.valid() {
		return ErrInvalidClaim
	}
	if err := s.repository.AbortClaim(ctx, fence, disposition); err != nil {
		return fmt.Errorf("abort execution claim: %w", err)
	}
	return nil
}

func (s *ClaimService) ObserveDesiredState(ctx context.Context, fence runtimedomain.Fence) (runtimedomain.DesiredState, error) {
	if err := s.VerifyActive(ctx, fence); err != nil {
		return "", err
	}
	state, err := s.repository.DesiredState(ctx, fence.ExecutionID, fence.Generation)
	if err != nil {
		return "", fmt.Errorf("observe desired execution state: %w", err)
	}
	if !state.Valid() {
		return "", errors.New("repository returned invalid desired state")
	}
	return state, nil
}
