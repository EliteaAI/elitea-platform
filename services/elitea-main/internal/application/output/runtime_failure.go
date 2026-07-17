package output

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

type RuntimeFailure struct {
	Code        string
	SafeMessage string
	Retryable   bool
}

type RuntimeFailureFrame struct {
	StreamID              string
	TenantID              string
	ResourceProjectID     string
	ProjectionProjectID   string
	WorkloadSessionID     string
	ProducerID            string
	EventID               string
	LogicalOutputID       string
	Sequence              uint64
	ClaimHandoffWatermark uint64
	OccurredAt            time.Time
	Fence                 runtimedomain.Fence
	PayloadDigest         runtimedomain.Digest
	EncodedFailure        []byte
	Settlement            executionapp.SettlementProposal
	EncodedSettlement     []byte
	Failure               RuntimeFailure
}

func (f RuntimeFailureFrame) Validate() error {
	if f.StreamID == "" || f.TenantID == "" || f.ResourceProjectID == "" || f.ProjectionProjectID == "" || f.WorkloadSessionID == "" || f.ProducerID == "" || f.EventID == "" || f.LogicalOutputID == "" || f.Sequence == 0 || f.OccurredAt.IsZero() {
		return ErrInvalidValidationOutput
	}
	if strings.ContainsAny(f.EventID, "\r\n") || strings.ContainsAny(f.LogicalOutputID, "\r\n") || f.WorkloadSessionID != f.Fence.WorkloadSessionID || f.ProducerID != f.Fence.ProducerID {
		return ErrInvalidValidationOutput
	}
	if err := f.Fence.Validate(); err != nil {
		return err
	}
	if !matchesCanonicalTerminalIdentity(
		f.StreamID,
		f.EventID,
		f.LogicalOutputID,
		f.Sequence,
		f.Settlement.ProposalID,
		f.Settlement.IdempotencyKey,
		f.Fence,
		"",
	) {
		return ErrInvalidValidationOutput
	}
	if f.PayloadDigest.IsZero() || len(f.EncodedFailure) == 0 || len(f.EncodedFailure) > MaxConfigurationValidationResultBytes || runtimedomain.SHA256(f.EncodedFailure) != f.PayloadDigest {
		return ErrInvalidValidationOutput
	}
	if f.Failure.Code == "" || f.Failure.SafeMessage == "" || len(f.Failure.Code) > 256 || len(f.Failure.SafeMessage) > 256 {
		return ErrInvalidValidationOutput
	}
	expectedOutcome := executionapp.SettlementFailed
	if f.Failure.Code == "CANCELLED" {
		expectedOutcome = executionapp.SettlementCancelled
	}
	if err := f.Settlement.Validate(); err != nil || f.Settlement.Fence != f.Fence || f.Settlement.Outcome != expectedOutcome || f.Settlement.TerminalLogicalOutputID != f.LogicalOutputID || f.Settlement.TerminalEventID != f.EventID || f.Settlement.TerminalSequence != f.Sequence || f.Settlement.TerminalPayloadDigest != f.PayloadDigest || len(f.EncodedSettlement) == 0 || len(f.EncodedSettlement) > MaxConfigurationValidationResultBytes || runtimedomain.SHA256(f.EncodedSettlement) != f.Settlement.ProposalDigest {
		return ErrInvalidValidationOutput
	}
	return nil
}

type RuntimeFailureProjection struct {
	Frame       RuntimeFailureFrame
	BrowserData json.RawMessage
}

type RuntimeFailureProjector interface {
	ProjectRuntimeFailure(ctx context.Context, projection RuntimeFailureProjection) (ProjectionOutcome, error)
}

type RuntimeFailureService struct {
	bindings  ValidationBindingRepository
	fences    FenceVerifier
	projector RuntimeFailureProjector
}

func NewRuntimeFailureService(bindings ValidationBindingRepository, fences FenceVerifier, projector RuntimeFailureProjector) (*RuntimeFailureService, error) {
	if bindings == nil || fences == nil || projector == nil {
		return nil, errors.New("runtime failure binding, fence and projector dependencies are required")
	}
	return &RuntimeFailureService{bindings: bindings, fences: fences, projector: projector}, nil
}

func (s *RuntimeFailureService) IngestFailure(ctx context.Context, frame RuntimeFailureFrame) (ProjectionOutcome, error) {
	if err := frame.Validate(); err != nil {
		return ProjectionOutcome{}, err
	}
	if err := s.fences.VerifyActive(ctx, frame.Fence); err != nil {
		return ProjectionOutcome{}, fmt.Errorf("verify runtime failure fence: %w", err)
	}
	expected, err := s.bindings.ExpectedValidation(ctx, frame.Fence.ExecutionID, frame.Fence.Generation)
	if err != nil {
		return ProjectionOutcome{}, fmt.Errorf("load admitted runtime failure binding: %w", err)
	}
	if err := expected.Validate(); err != nil {
		return ProjectionOutcome{}, fmt.Errorf("invalid admitted runtime failure binding: %w", err)
	}
	if expected.TenantID != frame.TenantID || expected.ResourceProjectID != frame.ResourceProjectID || expected.ProjectionProjectID != frame.ProjectionProjectID || expected.CommandID != frame.Fence.CommandID || expected.ExecutionID != frame.Fence.ExecutionID || expected.Generation != frame.Fence.Generation {
		return ProjectionOutcome{}, ErrValidationOutputConflict
	}
	if !matchesCanonicalTerminalIdentity(
		frame.StreamID,
		frame.EventID,
		frame.LogicalOutputID,
		frame.Sequence,
		frame.Settlement.ProposalID,
		frame.Settlement.IdempotencyKey,
		frame.Fence,
		expected.Binding.Command.ConfigurationRevisionID,
	) {
		return ProjectionOutcome{}, ErrInvalidValidationOutput
	}
	browserData, err := json.Marshal(struct {
		Code        string `json:"code"`
		SafeMessage string `json:"safe_message"`
		Retryable   bool   `json:"retryable"`
	}{Code: frame.Failure.Code, SafeMessage: frame.Failure.SafeMessage, Retryable: frame.Failure.Retryable})
	if err != nil {
		return ProjectionOutcome{}, err
	}
	frame.EncodedFailure = append([]byte(nil), frame.EncodedFailure...)
	frame.EncodedSettlement = append([]byte(nil), frame.EncodedSettlement...)
	outcome, err := s.projector.ProjectRuntimeFailure(ctx, RuntimeFailureProjection{Frame: frame, BrowserData: browserData})
	if err != nil {
		return ProjectionOutcome{}, fmt.Errorf("project runtime failure: %w", err)
	}
	if outcome.Cursor == 0 || outcome.CommittedSequence != frame.Sequence {
		return ProjectionOutcome{}, errors.New("runtime failure projector returned an empty durable position")
	}
	return outcome, nil
}
