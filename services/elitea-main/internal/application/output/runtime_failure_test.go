package output

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"google.golang.org/protobuf/proto"
)

type runtimeFailureBindingStub struct {
	expected ExpectedRuntimeFailure
	lookups  int
}

func (s *runtimeFailureBindingStub) ExpectedRuntimeFailure(_ context.Context, executionID string, generation uint64) (ExpectedRuntimeFailure, error) {
	s.lookups++
	if executionID != s.expected.ExecutionID || generation != s.expected.Generation {
		return ExpectedRuntimeFailure{}, runtimedomain.ErrStaleFence
	}
	return s.expected, nil
}

type runtimeFailureProjectorStub struct {
	projections []RuntimeFailureProjection
}

func (s *runtimeFailureProjectorStub) ProjectRuntimeFailure(_ context.Context, projection RuntimeFailureProjection) (ProjectionOutcome, error) {
	s.projections = append(s.projections, projection)
	return ProjectionOutcome{Inserted: true, Cursor: uint64(len(s.projections)), CommittedSequence: projection.Frame.Sequence}, nil
}

func TestRuntimeFailureServiceAcceptsOnlyExactAdmittedCapabilityIdentity(t *testing.T) {
	for _, capabilityID := range []string{
		executiondomain.ConfigurationValidationCapability,
		executiondomain.IndexIngestCapability,
	} {
		t.Run(capabilityID, func(t *testing.T) {
			frame, expected := validRuntimeFailureOutput(t, capabilityID)
			bindings := &runtimeFailureBindingStub{expected: expected}
			projector := &runtimeFailureProjectorStub{}
			service, err := NewRuntimeFailureService(bindings, fenceVerifierStub{expected: &frame.Fence}, projector)
			if err != nil {
				t.Fatal(err)
			}

			outcome, err := service.IngestFailure(context.Background(), frame)
			if err != nil || !outcome.Inserted || outcome.Cursor != 1 || outcome.CommittedSequence != 1 {
				t.Fatalf("project capability-bound failure: outcome=%+v err=%v", outcome, err)
			}
			if bindings.lookups != 1 || len(projector.projections) != 1 {
				t.Fatalf("unexpected binding/projector calls: bindings=%d projections=%d", bindings.lookups, len(projector.projections))
			}
			projection := projector.projections[0]
			var replay struct {
				Code        string `json:"code"`
				SafeMessage string `json:"safe_message"`
				Retryable   bool   `json:"retryable"`
			}
			if err := json.Unmarshal(projection.BrowserData, &replay); err != nil {
				t.Fatal(err)
			}
			if replay.Code != "INTERNAL" || replay.SafeMessage != "The runtime operation failed." || replay.Retryable {
				t.Fatalf("unsafe or changed browser failure: %s", projection.BrowserData)
			}
			if strings.Contains(string(projection.BrowserData), frame.WorkloadSessionID) {
				t.Fatalf("failure replay leaked worker-only data: %s", projection.BrowserData)
			}
		})
	}
}

func TestRuntimeFailureServiceRejectsCrossCapabilityLogicalOutput(t *testing.T) {
	frame, expected := validRuntimeFailureOutput(t, executiondomain.IndexIngestCapability)
	expected.CapabilityID = executiondomain.ConfigurationValidationCapability
	expected.LogicalOutputID = "configuration-validation:revision-1"
	projector := &runtimeFailureProjectorStub{}
	service, err := NewRuntimeFailureService(&runtimeFailureBindingStub{expected: expected}, fenceVerifierStub{}, projector)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.IngestFailure(context.Background(), frame); !errors.Is(err, ErrValidationOutputConflict) {
		t.Fatalf("cross-capability logical output error = %v", err)
	}
	if len(projector.projections) != 0 {
		t.Fatal("cross-capability failure reached projector")
	}
}

func TestExpectedRuntimeFailureRejectsUnknownOrMalformedCapabilityBindings(t *testing.T) {
	_, valid := validRuntimeFailureOutput(t, executiondomain.IndexIngestCapability)
	tests := []ExpectedRuntimeFailure{
		func() ExpectedRuntimeFailure { value := valid; value.CapabilityID = "unknown.v1"; return value }(),
		func() ExpectedRuntimeFailure {
			value := valid
			value.LogicalOutputID = "index-ingest:other"
			return value
		}(),
		func() ExpectedRuntimeFailure {
			value := valid
			value.CapabilityID = executiondomain.ConfigurationValidationCapability
			value.LogicalOutputID = "configuration-validation:"
			return value
		}(),
	}
	for index, binding := range tests {
		if err := binding.Validate(); !errors.Is(err, ErrInvalidValidationOutput) {
			t.Fatalf("binding %d error = %v", index, err)
		}
	}
}

func validRuntimeFailureOutput(t *testing.T, capabilityID string) (RuntimeFailureFrame, ExpectedRuntimeFailure) {
	t.Helper()
	source, _ := validValidationOutput()
	logicalOutputID := source.LogicalOutputID
	if capabilityID == executiondomain.IndexIngestCapability {
		logicalOutputID = "index-ingest:" + source.Fence.ExecutionID
	}
	payload, err := proto.MarshalOptions{Deterministic: true}.Marshal(&runtimev1.RuntimeErrorV1{
		Code:        runtimev1.RuntimeErrorCodeV1_RUNTIME_ERROR_CODE_V1_INTERNAL,
		SafeMessage: "The runtime operation failed.",
		Retryable:   false,
	})
	if err != nil {
		t.Fatal(err)
	}
	payloadDigest := runtimedomain.SHA256(payload)
	encodedSettlement := []byte("deterministic-runtime-failure-settlement")
	settlement := source.Settlement
	settlement.Outcome = executionapp.SettlementFailed
	settlement.TerminalLogicalOutputID = logicalOutputID
	settlement.TerminalPayloadDigest = payloadDigest
	settlement.ProposalDigest = runtimedomain.SHA256(encodedSettlement)
	frame := RuntimeFailureFrame{
		StreamID:            source.StreamID,
		TenantID:            source.TenantID,
		ResourceProjectID:   source.ResourceProjectID,
		ProjectionProjectID: source.ProjectionProjectID,
		WorkloadSessionID:   source.WorkloadSessionID,
		ProducerID:          source.ProducerID,
		EventID:             source.EventID,
		LogicalOutputID:     logicalOutputID,
		Sequence:            source.Sequence,
		OccurredAt:          source.OccurredAt,
		Fence:               source.Fence,
		PayloadDigest:       payloadDigest,
		EncodedFailure:      payload,
		Settlement:          settlement,
		EncodedSettlement:   encodedSettlement,
		Failure: RuntimeFailure{
			Code:        "INTERNAL",
			SafeMessage: "The runtime operation failed.",
		},
	}
	if err := frame.Validate(); err != nil {
		t.Fatalf("build valid runtime failure: %v", err)
	}
	return frame, ExpectedRuntimeFailure{
		TenantID:            frame.TenantID,
		ResourceProjectID:   frame.ResourceProjectID,
		ProjectionProjectID: frame.ProjectionProjectID,
		CapabilityID:        capabilityID,
		CommandID:           frame.Fence.CommandID,
		ExecutionID:         frame.Fence.ExecutionID,
		Generation:          frame.Fence.Generation,
		LogicalOutputID:     frame.LogicalOutputID,
	}
}
