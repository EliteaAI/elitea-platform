package output

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

const (
	MaxAgentExecutionResultBytes = 64 * 1024
	AgentResultMediaType         = "application/vnd.elitea.agent-execution-result.v1+json"
	AgentResultClassification    = "tenant-confidential"
)

var (
	ErrInvalidAgentExecutionOutput   = errors.New("invalid agent execution output")
	ErrAgentExecutionBindingMismatch = errors.New("agent execution output does not match admitted input")
	ErrAgentExecutionResultMismatch  = errors.New("agent execution result does not match durable full message")
	ErrAgentExecutionOutputConflict  = errors.New("agent execution output conflicts with durable output")
)

type AgentExecutionArtifactReference struct {
	ArtifactID       string
	ImmutableVersion string
	MediaType        string
	ByteLength       uint64
	Digest           runtimedomain.Digest
	Classification   string
}

func (a AgentExecutionArtifactReference) Validate() error {
	if !validIndexMetadata(a.ArtifactID) || !validIndexMetadata(a.ImmutableVersion) ||
		a.MediaType != AgentResultMediaType || a.Classification != AgentResultClassification ||
		a.ByteLength == 0 || a.ByteLength > MaxNodeEventOutputBytes || a.Digest.IsZero() {
		return ErrInvalidAgentExecutionOutput
	}
	return nil
}

type AgentExecutionResult struct {
	InputBundleID           string
	InputBundleDigest       runtimedomain.Digest
	RequestEntryID          string
	RequestImmutableVersion string
	RequestContentDigest    runtimedomain.Digest
	ResultArtifact          AgentExecutionArtifactReference
}

func (r AgentExecutionResult) Validate() error {
	if !validIndexMetadata(r.InputBundleID) || r.InputBundleDigest.IsZero() ||
		!validIndexMetadata(r.RequestEntryID) || !validIndexMetadata(r.RequestImmutableVersion) ||
		r.RequestContentDigest.IsZero() {
		return ErrInvalidAgentExecutionOutput
	}
	return r.ResultArtifact.Validate()
}

type AgentExecutionFrame struct {
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
	EncodedResult         []byte
	Settlement            executionapp.SettlementProposal
	EncodedSettlement     []byte
	Result                AgentExecutionResult
}

func (f AgentExecutionFrame) Validate() error {
	if f.StreamID == "" || f.TenantID == "" || f.ResourceProjectID == "" ||
		f.ProjectionProjectID == "" || f.WorkloadSessionID == "" || f.ProducerID == "" ||
		f.EventID == "" || f.LogicalOutputID == "" || f.Sequence == 0 || f.OccurredAt.IsZero() ||
		f.ClaimHandoffWatermark >= f.Sequence {
		return ErrInvalidAgentExecutionOutput
	}
	if strings.ContainsAny(f.EventID, "\x00\r\n") || strings.ContainsAny(f.LogicalOutputID, "\x00\r\n") ||
		f.WorkloadSessionID != f.Fence.WorkloadSessionID || f.ProducerID != f.Fence.ProducerID {
		return ErrInvalidAgentExecutionOutput
	}
	if err := f.Fence.Validate(); err != nil {
		return err
	}
	if !matchesCanonicalTerminalIdentity(
		f.StreamID, f.EventID, f.LogicalOutputID, f.Sequence,
		f.Settlement.ProposalID, f.Settlement.IdempotencyKey, f.Fence, "",
	) || f.LogicalOutputID != "agent-execution:"+f.Fence.ExecutionID {
		return ErrInvalidAgentExecutionOutput
	}
	if f.PayloadDigest.IsZero() || len(f.EncodedResult) == 0 ||
		len(f.EncodedResult) > MaxAgentExecutionResultBytes ||
		runtimedomain.SHA256(f.EncodedResult) != f.PayloadDigest {
		return ErrInvalidAgentExecutionOutput
	}
	if err := f.Result.Validate(); err != nil {
		return err
	}
	if err := f.Settlement.Validate(); err != nil || f.Settlement.Fence != f.Fence ||
		f.Settlement.Outcome != executionapp.SettlementSucceeded ||
		f.Settlement.TerminalLogicalOutputID != f.LogicalOutputID ||
		f.Settlement.TerminalEventID != f.EventID || f.Settlement.TerminalSequence != f.Sequence ||
		f.Settlement.TerminalPayloadDigest != f.PayloadDigest || len(f.EncodedSettlement) == 0 ||
		len(f.EncodedSettlement) > MaxAgentExecutionResultBytes ||
		runtimedomain.SHA256(f.EncodedSettlement) != f.Settlement.ProposalDigest {
		return ErrInvalidAgentExecutionOutput
	}
	return nil
}

type ExpectedAgentExecution struct {
	TenantID                  string
	ResourceProjectID         string
	ProjectionProjectID       string
	CapabilityID              string
	CommandID                 string
	ExecutionID               string
	Generation                uint64
	LogicalOutputID           string
	InputBundleID             string
	InputBundleDigest         runtimedomain.Digest
	RequestEntryID            string
	RequestImmutableVersion   string
	RequestContentDigest      runtimedomain.Digest
	ClientStreamID            string
	ClientMessageID           string
	ClientExecutionGeneration string
	SIOEvent                  string
}

func (e ExpectedAgentExecution) Validate() error {
	if e.TenantID == "" || e.ResourceProjectID == "" || e.ProjectionProjectID == "" ||
		(e.CapabilityID != executiondomain.AgentApplicationCapability && e.CapabilityID != executiondomain.AgentAdhocCapability) ||
		e.CommandID == "" || e.ExecutionID == "" || e.Generation == 0 ||
		e.LogicalOutputID != "agent-execution:"+e.ExecutionID || !validIndexMetadata(e.InputBundleID) ||
		e.InputBundleDigest.IsZero() || !validIndexMetadata(e.RequestEntryID) ||
		!validIndexMetadata(e.RequestImmutableVersion) || e.RequestContentDigest.IsZero() ||
		!validIndexMetadata(e.ClientStreamID) || !validIndexMetadata(e.ClientMessageID) ||
		!validIndexMetadata(e.ClientExecutionGeneration) ||
		(e.SIOEvent != "chat_predict" && e.SIOEvent != "chat_continue_predict") {
		return ErrInvalidAgentExecutionOutput
	}
	return nil
}

type AgentExecutionBindingRepository interface {
	ExpectedAgentExecution(context.Context, string, uint64) (ExpectedAgentExecution, error)
}

type AgentExecutionProjection struct {
	Frame    AgentExecutionFrame
	Expected ExpectedAgentExecution
}

type AgentExecutionProjector interface {
	ProjectAgentExecution(context.Context, AgentExecutionProjection) (ProjectionOutcome, error)
}

type AgentExecutionService struct {
	bindings  AgentExecutionBindingRepository
	fences    FenceVerifier
	projector AgentExecutionProjector
}

func NewAgentExecutionService(bindings AgentExecutionBindingRepository, fences FenceVerifier, projector AgentExecutionProjector) (*AgentExecutionService, error) {
	if bindings == nil || fences == nil || projector == nil {
		return nil, errors.New("agent binding, fence and projector dependencies are required")
	}
	return &AgentExecutionService{bindings: bindings, fences: fences, projector: projector}, nil
}

func (s *AgentExecutionService) IngestAgent(ctx context.Context, frame AgentExecutionFrame) (ProjectionOutcome, error) {
	if err := frame.Validate(); err != nil {
		return ProjectionOutcome{}, err
	}
	if err := s.fences.VerifyActive(ctx, frame.Fence); err != nil {
		return ProjectionOutcome{}, fmt.Errorf("verify agent output fence: %w", err)
	}
	expected, err := s.bindings.ExpectedAgentExecution(ctx, frame.Fence.ExecutionID, frame.Fence.Generation)
	if err != nil {
		return ProjectionOutcome{}, fmt.Errorf("load admitted agent binding: %w", err)
	}
	if err := expected.Validate(); err != nil {
		return ProjectionOutcome{}, fmt.Errorf("invalid admitted agent binding: %w", err)
	}
	result := frame.Result
	if expected.TenantID != frame.TenantID || expected.ResourceProjectID != frame.ResourceProjectID ||
		expected.ProjectionProjectID != frame.ProjectionProjectID || expected.CommandID != frame.Fence.CommandID ||
		expected.ExecutionID != frame.Fence.ExecutionID || expected.Generation != frame.Fence.Generation ||
		expected.LogicalOutputID != frame.LogicalOutputID || expected.InputBundleID != result.InputBundleID ||
		expected.InputBundleDigest != result.InputBundleDigest || expected.RequestEntryID != result.RequestEntryID ||
		expected.RequestImmutableVersion != result.RequestImmutableVersion ||
		expected.RequestContentDigest != result.RequestContentDigest {
		return ProjectionOutcome{}, ErrAgentExecutionBindingMismatch
	}
	projection := AgentExecutionProjection{Frame: cloneAgentExecutionFrame(frame), Expected: expected}
	outcome, err := s.projector.ProjectAgentExecution(ctx, projection)
	if err != nil {
		return ProjectionOutcome{}, fmt.Errorf("project agent execution: %w", err)
	}
	if outcome.Cursor == 0 || outcome.CommittedSequence != frame.Sequence {
		return ProjectionOutcome{}, errors.New("agent projector returned an empty durable position")
	}
	return outcome, nil
}

func cloneAgentExecutionFrame(frame AgentExecutionFrame) AgentExecutionFrame {
	frame.EncodedResult = append([]byte(nil), frame.EncodedResult...)
	frame.EncodedSettlement = append([]byte(nil), frame.EncodedSettlement...)
	return frame
}
