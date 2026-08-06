package agentexecution

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"math"
	"slices"
	"strconv"
	"strings"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

const maxCurrentHITLValueBytes = 256 * 1024

var ErrCurrentAgentHITLAlreadyResolved = errors.New("current agent HITL interrupt is already resolved")

type CurrentContinuationResolveRequest struct {
	ProjectID         int64
	ActorUserID       int64
	ConversationUUID  string
	ResponseMessageID string
}

func (request CurrentContinuationResolveRequest) Validate() error {
	if request.ProjectID <= 0 || request.ActorUserID <= 0 ||
		!validUUID(request.ConversationUUID) || !validUUID(request.ResponseMessageID) {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

// CurrentContinuationTarget is reconstructed from the paused response in the
// current project schema. Browser input never selects the graph checkpoint,
// execution generation, participant, question, or interrupt identity.
type CurrentContinuationTarget struct {
	Kind                CurrentRegenerationKind
	TargetParticipantID int64
	QuestionID          string
	UserInput           string
	ThreadID            string
	ExecutionGeneration string
	InterruptID         string
	AvailableActions    []string
}

func (target CurrentContinuationTarget) Validate() error {
	if (target.Kind != CurrentRegenerationApplication && target.Kind != CurrentRegenerationAdhoc) ||
		target.TargetParticipantID <= 0 || !validUUID(target.QuestionID) ||
		!validCurrentAgentText(target.UserInput, maxCurrentAgentUserInputBytes) ||
		target.ThreadID == "" || len(target.ThreadID) > 256 || strings.ContainsRune(target.ThreadID, '\x00') ||
		!validUUID(target.ExecutionGeneration) || target.InterruptID == "" ||
		len(target.InterruptID) > 512 || strings.ContainsRune(target.InterruptID, '\x00') ||
		len(target.AvailableActions) == 0 || len(target.AvailableActions) > 8 {
		return ErrUnsupportedCurrentAgentStart
	}
	for _, action := range target.AvailableActions {
		if !currentRootHITLAction(action) {
			return ErrUnsupportedCurrentAgentStart
		}
	}
	return nil
}

type CurrentContinuationResolver interface {
	ResolveCurrentContinuation(
		context.Context,
		CurrentContinuationResolveRequest,
	) (CurrentContinuationTarget, error)
}

type CurrentContinuationRequest struct {
	ProjectID         int64
	ActorUserID       int64
	ConversationUUID  string
	ResponseMessageID string
	ThreadID          string
	Action            string
	Value             string
}

func (request CurrentContinuationRequest) Validate() error {
	if request.ProjectID <= 0 || request.ActorUserID <= 0 ||
		!validUUID(request.ConversationUUID) || !validUUID(request.ResponseMessageID) ||
		!currentRootHITLAction(request.Action) || len(request.Value) > maxCurrentHITLValueBytes ||
		strings.ContainsRune(request.Value, '\x00') ||
		(request.ThreadID != "" && (len(request.ThreadID) > 256 || strings.ContainsRune(request.ThreadID, '\x00'))) {
		return ErrInvalidCurrentAgentStart
	}
	if (request.Action == "edit" || request.Action == "block_with_comment") && request.Value == "" {
		return ErrInvalidCurrentAgentStart
	}
	if request.Action != "edit" && request.Action != "block_with_comment" && request.Value != "" {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

// CurrentContinueTurn is the immutable current-schema side of one root HITL
// resume. The admission transaction rechecks every field while consuming the
// exact pending card and setting the existing response back to streaming.
type CurrentContinueTurn struct {
	ProjectID            int64
	ActorUserID          int64
	ConversationUUID     string
	TargetParticipantID  int64
	Kind                 CurrentRegenerationKind
	ApplicationID        int64
	ApplicationVersionID int64
	QuestionID           string
	ResponseMessageID    string
	ExecutionGeneration  string
	ThreadID             string
	InterruptID          string
	Action               string
}

func (turn CurrentContinueTurn) Validate() error {
	if turn.ProjectID <= 0 || turn.ActorUserID <= 0 || turn.TargetParticipantID <= 0 ||
		!validUUID(turn.ConversationUUID) || !validUUID(turn.QuestionID) ||
		!validUUID(turn.ResponseMessageID) || !validUUID(turn.ExecutionGeneration) ||
		turn.ThreadID == "" || len(turn.ThreadID) > 256 || strings.ContainsRune(turn.ThreadID, '\x00') ||
		turn.InterruptID == "" || len(turn.InterruptID) > 512 || strings.ContainsRune(turn.InterruptID, '\x00') ||
		!currentRootHITLAction(turn.Action) {
		return ErrInvalidCurrentAgentStart
	}
	switch turn.Kind {
	case CurrentRegenerationApplication:
		if turn.ApplicationID <= 0 || turn.ApplicationVersionID <= 0 {
			return ErrInvalidCurrentAgentStart
		}
	case CurrentRegenerationAdhoc:
		if turn.ApplicationID != 0 || turn.ApplicationVersionID != 0 {
			return ErrInvalidCurrentAgentStart
		}
	default:
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

func (turn *CurrentContinueTurn) Clone() *CurrentContinueTurn {
	if turn == nil {
		return nil
	}
	clone := *turn
	return &clone
}

func (service *CurrentApplicationStartService) ContinueCurrentAgent(
	ctx context.Context,
	request CurrentContinuationRequest,
) (CurrentApplicationStartOutcome, error) {
	if err := request.Validate(); err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	target, err := service.continuationResolver.ResolveCurrentContinuation(
		ctx,
		CurrentContinuationResolveRequest{
			ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
			ConversationUUID:  request.ConversationUUID,
			ResponseMessageID: request.ResponseMessageID,
		},
	)
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	if err := target.Validate(); err != nil ||
		(request.ThreadID != "" && request.ThreadID != target.ThreadID) ||
		!slices.Contains(target.AvailableActions, request.Action) ||
		request.ProjectID > math.MaxInt32 || request.ActorUserID > math.MaxInt32 ||
		target.TargetParticipantID > math.MaxInt32 {
		return CurrentApplicationStartOutcome{}, ErrUnsupportedCurrentAgentStart
	}

	input, turn, capabilityID, err := service.currentContinuationInput(ctx, request, target)
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	projectID := strconv.FormatInt(request.ProjectID, 10)
	actorID := strconv.FormatInt(request.ActorUserID, 10)
	outcome, err := service.admissions.Submit(ctx, SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID: projectID, ResourceProjectID: projectID,
			ProjectionProjectID: projectID, ActorID: actorID,
		},
		IdempotencyKey: currentContinuationIdempotencyKey(request.ResponseMessageID, target.InterruptID, request.Action, request.Value),
		CapabilityID:   capabilityID, ClientStreamID: request.ConversationUUID,
		ClientMessageID: request.ResponseMessageID, SIOEvent: "chat_continue_predict",
		Input: input, CurrentContinueTurn: turn,
	})
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	return CurrentApplicationStartOutcome{
		ExecutionID: outcome.ExecutionID, CommandID: outcome.CommandID,
		ResponseMessageID: request.ResponseMessageID, Created: outcome.Created,
	}, nil
}

func (service *CurrentApplicationStartService) currentContinuationInput(
	ctx context.Context,
	request CurrentContinuationRequest,
	target CurrentContinuationTarget,
) (*runtimev1.AgentExecutionInputV1, *CurrentContinueTurn, string, error) {
	turn := &CurrentContinueTurn{
		ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
		ConversationUUID:    request.ConversationUUID,
		TargetParticipantID: target.TargetParticipantID, Kind: target.Kind,
		QuestionID: target.QuestionID, ResponseMessageID: request.ResponseMessageID,
		ExecutionGeneration: target.ExecutionGeneration, ThreadID: target.ThreadID,
		InterruptID: target.InterruptID, Action: request.Action,
	}
	var input *runtimev1.AgentExecutionInputV1
	var capabilityID string
	switch target.Kind {
	case CurrentRegenerationApplication:
		start := CurrentApplicationStartRequest{
			ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
			ConversationUUID:    request.ConversationUUID,
			TargetParticipantID: target.TargetParticipantID,
			QuestionID:          target.QuestionID, UserInput: target.UserInput,
		}
		resolved, err := service.resolver.ResolveCurrentApplication(ctx, start)
		if err != nil {
			return nil, nil, "", err
		}
		frozen, err := service.freezer.FreezeCurrentApplicationVersion(
			ctx,
			CurrentApplicationVersionFreezeRequest{
				ProjectID: int32(request.ProjectID), ActorUserID: int32(request.ActorUserID),
				VersionDetails: resolved.VersionDetails,
			},
		)
		if err != nil {
			return nil, nil, "", err
		}
		resolved.VersionDetails = frozen
		input, err = currentApplicationInput(start, resolved)
		if err != nil {
			return nil, nil, "", err
		}
		turn.ApplicationID = resolved.ApplicationID
		turn.ApplicationVersionID = resolved.ApplicationVersionID
		capabilityID = executiondomain.AgentApplicationCapability
	case CurrentRegenerationAdhoc:
		start := CurrentAdhocStartRequest{
			ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
			ConversationUUID:    request.ConversationUUID,
			TargetParticipantID: target.TargetParticipantID,
			QuestionID:          target.QuestionID, UserInput: target.UserInput,
			LLMSettings: json.RawMessage(`{}`),
		}
		resolved, err := service.adhocResolver.ResolveCurrentAdhoc(ctx, start)
		if err != nil {
			return nil, nil, "", err
		}
		snapshot, err := currentAdhocSnapshot(start.LLMSettings, resolved)
		if err != nil {
			return nil, nil, "", err
		}
		frozen, err := service.freezer.FreezeCurrentApplicationVersion(
			ctx,
			CurrentApplicationVersionFreezeRequest{
				ProjectID: int32(request.ProjectID), ActorUserID: int32(request.ActorUserID),
				VersionDetails: snapshot,
			},
		)
		if err != nil {
			return nil, nil, "", err
		}
		input, err = currentAdhocInput(start, resolved, frozen)
		if err != nil {
			return nil, nil, "", err
		}
		capabilityID = executiondomain.AgentAdhocCapability
	default:
		return nil, nil, "", ErrUnsupportedCurrentAgentStart
	}

	decisions, err := json.Marshal([]map[string]string{{
		"interrupt_id": target.InterruptID,
		"action":       request.Action,
		"value":        request.Value,
	}})
	if err != nil {
		return nil, nil, "", ErrInvalidCurrentAgentStart
	}
	input.ThreadId = stringPointer(target.ThreadID)
	input.ExecutionGeneration = stringPointer(target.ExecutionGeneration)
	input.ShouldContinue = true
	input.HitlResume = true
	input.HitlAction = stringPointer(request.Action)
	input.HitlValue = stringPointer(request.Value)
	input.HitlDecisions = decisions
	return input, turn, capabilityID, nil
}

func currentRootHITLAction(action string) bool {
	switch action {
	case "approve", "reject", "edit", "block_with_comment":
		return true
	default:
		return false
	}
}

func currentContinuationIdempotencyKey(responseID, interruptID, action, value string) string {
	digest := sha256.Sum256([]byte(action + "\x00" + value))
	interruptDigest := sha256.Sum256([]byte(interruptID))
	return "continue/" + responseID + "/" + hex.EncodeToString(interruptDigest[:8]) + "/" + hex.EncodeToString(digest[:8])
}

func stringPointer(value string) *string {
	return &value
}
