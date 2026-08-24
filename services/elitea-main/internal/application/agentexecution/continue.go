package agentexecution

import (
	"bytes"
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

const (
	maxCurrentHITLValueBytes = 256 * 1024
	maxCurrentHITLDecisions  = 16
)

var (
	ErrCurrentAgentHITLAlreadyResolved          = errors.New("current agent HITL interrupt is already resolved")
	ErrCurrentAgentAuthorizationAlreadyResolved = errors.New("current agent authorization request is already resolved")
)

type CurrentContinuationKind string

const (
	CurrentContinuationHITL          CurrentContinuationKind = "hitl"
	CurrentContinuationAuthorization CurrentContinuationKind = "authorization"
)

type CurrentContinuationResolveRequest struct {
	ProjectID         int64
	ActorUserID       int64
	ConversationUUID  string
	ResponseMessageID string
	Kind              CurrentContinuationKind
	AuthorizationID   string
}

func (request CurrentContinuationResolveRequest) Validate() error {
	if request.ProjectID <= 0 || request.ActorUserID <= 0 ||
		!validUUID(request.ConversationUUID) || !validUUID(request.ResponseMessageID) {
		return ErrInvalidCurrentAgentStart
	}
	if request.normalizedKind() != CurrentContinuationHITL &&
		request.normalizedKind() != CurrentContinuationAuthorization {
		return ErrInvalidCurrentAgentStart
	}
	if request.normalizedKind() == CurrentContinuationAuthorization &&
		(request.AuthorizationID == "" || len(request.AuthorizationID) > 512 ||
			strings.ContainsRune(request.AuthorizationID, '\x00')) {
		return ErrInvalidCurrentAgentStart
	}
	if request.normalizedKind() == CurrentContinuationHITL && request.AuthorizationID != "" {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

func (request CurrentContinuationResolveRequest) normalizedKind() CurrentContinuationKind {
	if request.Kind == "" {
		return CurrentContinuationHITL
	}
	return request.Kind
}

// CurrentContinuationTarget is reconstructed from the paused response in the
// current project schema. Browser input never selects the graph checkpoint,
// execution generation, participant, question, or interrupt identity.
type CurrentContinuationTarget struct {
	ContinuationKind    CurrentContinuationKind
	Kind                CurrentRegenerationKind
	TargetParticipantID int64
	QuestionID          string
	UserInput           string
	ThreadID            string
	ExecutionGeneration string
	InterruptID         string
	AvailableActions    []string
	HITLInterrupts      []CurrentHITLInterrupt
}

type CurrentHITLInterrupt struct {
	InterruptID      string
	AvailableActions []string
}

type CurrentHITLDecision struct {
	InterruptID string `json:"interrupt_id"`
	ToolCallID  string `json:"tool_call_id,omitempty"`
	Action      string `json:"action"`
	Value       string `json:"value,omitempty"`
}

func (target CurrentContinuationTarget) Validate() error {
	kind := target.ContinuationKind
	if kind == "" {
		kind = CurrentContinuationHITL
	}
	if (target.Kind != CurrentRegenerationApplication && target.Kind != CurrentRegenerationAdhoc) ||
		target.TargetParticipantID <= 0 || !validUUID(target.QuestionID) ||
		!validCurrentAgentText(target.UserInput, maxCurrentAgentUserInputBytes) ||
		target.ThreadID == "" || len(target.ThreadID) > 256 || strings.ContainsRune(target.ThreadID, '\x00') ||
		!validUUID(target.ExecutionGeneration) ||
		(kind != CurrentContinuationHITL && kind != CurrentContinuationAuthorization) {
		return ErrUnsupportedCurrentAgentStart
	}
	if kind == CurrentContinuationHITL {
		if len(target.HITLInterrupts) == 0 || len(target.HITLInterrupts) > maxCurrentHITLDecisions {
			return ErrUnsupportedCurrentAgentStart
		}
		seen := make(map[string]struct{}, len(target.HITLInterrupts))
		for _, interrupt := range target.HITLInterrupts {
			if interrupt.InterruptID == "" || len(interrupt.InterruptID) > 512 ||
				strings.ContainsRune(interrupt.InterruptID, '\x00') ||
				len(interrupt.AvailableActions) == 0 || len(interrupt.AvailableActions) > 8 {
				return ErrUnsupportedCurrentAgentStart
			}
			if _, duplicate := seen[interrupt.InterruptID]; duplicate {
				return ErrUnsupportedCurrentAgentStart
			}
			seen[interrupt.InterruptID] = struct{}{}
			for _, action := range interrupt.AvailableActions {
				if !currentRootHITLAction(action) {
					return ErrUnsupportedCurrentAgentStart
				}
			}
		}
		return nil
	}
	if target.InterruptID == "" || len(target.InterruptID) > 512 ||
		strings.ContainsRune(target.InterruptID, '\x00') || len(target.AvailableActions) == 0 ||
		len(target.AvailableActions) > 8 || len(target.HITLInterrupts) != 0 {
		return ErrUnsupportedCurrentAgentStart
	}
	for _, action := range target.AvailableActions {
		if !currentAuthorizationAction(action) {
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
	ProjectID          int64
	ActorUserID        int64
	ConversationUUID   string
	ResponseMessageID  string
	ThreadID           string
	Action             string
	Value              string
	Kind               CurrentContinuationKind
	AuthorizationID    string
	MCPTokens          json.RawMessage
	IgnoredMCPServers  json.RawMessage
	DeclinedMCPServers json.RawMessage
	HITLDecisions      []CurrentHITLDecision
}

func (request CurrentContinuationRequest) Validate() error {
	kind := request.normalizedKind()
	if request.ProjectID <= 0 || request.ActorUserID <= 0 ||
		!validUUID(request.ConversationUUID) || !validUUID(request.ResponseMessageID) ||
		len(request.Value) > maxCurrentHITLValueBytes ||
		strings.ContainsRune(request.Value, '\x00') ||
		(request.ThreadID != "" && (len(request.ThreadID) > 256 || strings.ContainsRune(request.ThreadID, '\x00'))) {
		return ErrInvalidCurrentAgentStart
	}
	if kind == CurrentContinuationHITL {
		if _, err := request.normalizedHITLDecisions(); err != nil ||
			request.AuthorizationID != "" || len(request.MCPTokens) != 0 ||
			len(request.IgnoredMCPServers) != 0 || len(request.DeclinedMCPServers) != 0 {
			return ErrInvalidCurrentAgentStart
		}
		return nil
	}
	if kind != CurrentContinuationAuthorization || !currentAuthorizationAction(request.Action) ||
		request.Value != "" || request.AuthorizationID == "" || len(request.AuthorizationID) > 512 ||
		strings.ContainsRune(request.AuthorizationID, '\x00') || !validJSONObject(request.MCPTokens) ||
		!validJSONArray(request.IgnoredMCPServers) || !validJSONArray(request.DeclinedMCPServers) {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

func (request CurrentContinuationRequest) normalizedHITLDecisions() ([]CurrentHITLDecision, error) {
	if len(request.HITLDecisions) == 0 {
		decision := CurrentHITLDecision{Action: request.Action, Value: request.Value}
		if !validCurrentHITLDecision(decision, false) {
			return nil, ErrInvalidCurrentAgentStart
		}
		return []CurrentHITLDecision{decision}, nil
	}
	if request.Action != "" || request.Value != "" || len(request.HITLDecisions) > maxCurrentHITLDecisions {
		return nil, ErrInvalidCurrentAgentStart
	}
	seen := make(map[string]struct{}, len(request.HITLDecisions))
	decisions := append([]CurrentHITLDecision(nil), request.HITLDecisions...)
	for _, decision := range decisions {
		if !validCurrentHITLDecision(decision, true) {
			return nil, ErrInvalidCurrentAgentStart
		}
		if _, duplicate := seen[decision.InterruptID]; duplicate {
			return nil, ErrInvalidCurrentAgentStart
		}
		seen[decision.InterruptID] = struct{}{}
	}
	return decisions, nil
}

func validCurrentHITLDecision(decision CurrentHITLDecision, requireIdentity bool) bool {
	if !currentRootHITLAction(decision.Action) || len(decision.Value) > maxCurrentHITLValueBytes ||
		strings.ContainsRune(decision.Value, '\x00') ||
		((decision.Action == "edit" || decision.Action == "block_with_comment") && decision.Value == "") ||
		(decision.Action != "edit" && decision.Action != "block_with_comment" && decision.Value != "") {
		return false
	}
	if !requireIdentity {
		return decision.InterruptID == "" && decision.ToolCallID == ""
	}
	return decision.InterruptID != "" && len(decision.InterruptID) <= 512 &&
		!strings.ContainsRune(decision.InterruptID, '\x00') &&
		(decision.ToolCallID == "" || (len(decision.ToolCallID) <= 512 && !strings.ContainsRune(decision.ToolCallID, '\x00')))
}

func decisionsMatchCurrentHITLInterrupts(
	decisions []CurrentHITLDecision,
	interrupts []CurrentHITLInterrupt,
) bool {
	if len(decisions) != len(interrupts) || len(decisions) == 0 {
		return false
	}
	remaining := make(map[string]CurrentHITLInterrupt, len(interrupts))
	for _, interrupt := range interrupts {
		remaining[interrupt.InterruptID] = interrupt
	}
	for _, decision := range decisions {
		interruptID := decision.InterruptID
		if interruptID == "" && len(decisions) == 1 {
			interruptID = interrupts[0].InterruptID
		}
		interrupt, exists := remaining[interruptID]
		if !exists || !slices.Contains(interrupt.AvailableActions, decision.Action) {
			return false
		}
		delete(remaining, interruptID)
	}
	return len(remaining) == 0
}

func (request CurrentContinuationRequest) normalizedKind() CurrentContinuationKind {
	if request.Kind == "" {
		return CurrentContinuationHITL
	}
	return request.Kind
}

// CurrentContinueTurn is the immutable current-schema side of one bounded
// in-process HITL resume. The admission transaction rechecks every field while
// atomically consuming the exact pending card set and resuming the response.
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
	ContinuationKind     CurrentContinuationKind
	HITLDecisions        json.RawMessage
}

func (turn CurrentContinueTurn) Validate() error {
	if turn.ProjectID <= 0 || turn.ActorUserID <= 0 || turn.TargetParticipantID <= 0 ||
		!validUUID(turn.ConversationUUID) || !validUUID(turn.QuestionID) ||
		!validUUID(turn.ResponseMessageID) || !validUUID(turn.ExecutionGeneration) ||
		turn.ThreadID == "" || len(turn.ThreadID) > 256 || strings.ContainsRune(turn.ThreadID, '\x00') {
		return ErrInvalidCurrentAgentStart
	}
	kind := turn.ContinuationKind
	if kind == "" {
		kind = CurrentContinuationHITL
	}
	if kind != CurrentContinuationHITL && kind != CurrentContinuationAuthorization {
		return ErrInvalidCurrentAgentStart
	}
	if kind == CurrentContinuationHITL && !validCurrentHITLDecisionsJSON(turn.HITLDecisions) {
		return ErrInvalidCurrentAgentStart
	}
	if kind == CurrentContinuationAuthorization &&
		(len(turn.HITLDecisions) != 0 || !currentAuthorizationAction(turn.Action) ||
			turn.InterruptID == "" || len(turn.InterruptID) > 512 || strings.ContainsRune(turn.InterruptID, '\x00')) {
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

func validCurrentHITLDecisionsJSON(raw json.RawMessage) bool {
	var decisions []CurrentHITLDecision
	if json.Unmarshal(raw, &decisions) != nil || len(decisions) == 0 || len(decisions) > maxCurrentHITLDecisions {
		return false
	}
	seen := make(map[string]struct{}, len(decisions))
	for _, decision := range decisions {
		if !validCurrentHITLDecision(decision, true) {
			return false
		}
		if _, duplicate := seen[decision.InterruptID]; duplicate {
			return false
		}
		seen[decision.InterruptID] = struct{}{}
	}
	return true
}

func (turn *CurrentContinueTurn) Clone() *CurrentContinueTurn {
	if turn == nil {
		return nil
	}
	clone := *turn
	clone.HITLDecisions = bytes.Clone(turn.HITLDecisions)
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
			Kind:              request.normalizedKind(),
			AuthorizationID:   request.AuthorizationID,
		},
	)
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	targetKind := target.ContinuationKind
	if targetKind == "" {
		targetKind = CurrentContinuationHITL
	}
	if err := target.Validate(); err != nil || targetKind != request.normalizedKind() ||
		(request.normalizedKind() == CurrentContinuationAuthorization && target.InterruptID != request.AuthorizationID) ||
		(request.ThreadID != "" && request.ThreadID != target.ThreadID) ||
		request.ProjectID > math.MaxInt32 || request.ActorUserID > math.MaxInt32 ||
		target.TargetParticipantID > math.MaxInt32 {
		return CurrentApplicationStartOutcome{}, ErrUnsupportedCurrentAgentStart
	}
	decisions, err := request.normalizedHITLDecisions()
	if request.normalizedKind() == CurrentContinuationHITL {
		if err != nil || !decisionsMatchCurrentHITLInterrupts(decisions, target.HITLInterrupts) {
			return CurrentApplicationStartOutcome{}, ErrUnsupportedCurrentAgentStart
		}
	} else if !slices.Contains(target.AvailableActions, request.Action) {
		return CurrentApplicationStartOutcome{}, ErrUnsupportedCurrentAgentStart
	}

	input, turn, capabilityID, err := service.currentContinuationInput(ctx, request, target, decisions)
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
		IdempotencyKey: currentContinuationIdempotencyKey(request.ResponseMessageID, input.HitlDecisions, request.AuthorizationID, request.Action),
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
	decisions []CurrentHITLDecision,
) (*runtimev1.AgentExecutionInputV1, *CurrentContinueTurn, string, error) {
	projectID, projectIDValid := currentContinuationDatabaseID(request.ProjectID)
	actorUserID, actorUserIDValid := currentContinuationDatabaseID(request.ActorUserID)
	if !projectIDValid || !actorUserIDValid {
		return nil, nil, "", ErrUnsupportedCurrentAgentStart
	}
	turn := &CurrentContinueTurn{
		ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
		ConversationUUID:    request.ConversationUUID,
		TargetParticipantID: target.TargetParticipantID, Kind: target.Kind,
		QuestionID: target.QuestionID, ResponseMessageID: request.ResponseMessageID,
		ExecutionGeneration: target.ExecutionGeneration, ThreadID: target.ThreadID,
		ContinuationKind: request.normalizedKind(),
	}
	var input *runtimev1.AgentExecutionInputV1
	var capabilityID string
	suggestionPolicy := service.resolveNextInputSuggestionPolicy(
		ctx,
		request.ProjectID,
		request.ActorUserID,
	)
	// Resolved once for the whole branch below. A resume and a regenerate are
	// executions like any other: the sensitive-tool policy governs what the
	// agent may do WITHOUT asking, and a resumed turn that arrived without one
	// would run the rest of its tool calls unguarded — on the very path a user
	// reached by answering an authorization prompt.
	toolkitGuardrails, err := service.resolveToolkitGuardrails(ctx)
	if err != nil {
		return nil, nil, "", err
	}
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
				ProjectID: projectID, ActorUserID: actorUserID,
				VersionDetails: resolved.VersionDetails,
			},
		)
		if err != nil {
			return nil, nil, "", err
		}
		resolved.VersionDetails = frozen
		input, err = currentApplicationInput(start, resolved, suggestionPolicy, toolkitGuardrails)
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
				ProjectID: projectID, ActorUserID: actorUserID,
				VersionDetails: snapshot,
			},
		)
		if err != nil {
			return nil, nil, "", err
		}
		input, err = currentAdhocInput(start, resolved, frozen, suggestionPolicy, toolkitGuardrails)
		if err != nil {
			return nil, nil, "", err
		}
		capabilityID = executiondomain.AgentAdhocCapability
	default:
		return nil, nil, "", ErrUnsupportedCurrentAgentStart
	}

	input.ThreadId = stringPointer(target.ThreadID)
	input.ExecutionGeneration = stringPointer(target.ExecutionGeneration)
	input.ShouldContinue = true
	if request.normalizedKind() == CurrentContinuationAuthorization {
		turn.InterruptID = target.InterruptID
		turn.Action = request.Action
		input.HitlResume = false
		input.HitlAction = nil
		input.HitlValue = nil
		// The authoritative wire contract represents collection-valued fields as
		// JSON arrays even when they are empty. Clearing the field to nil makes a
		// valid authorization continuation fail admission before dispatch.
		input.HitlDecisions = []byte(`[]`)
		input.McpTokens = bytes.Clone(request.MCPTokens)
		input.IgnoredMcpServers = bytes.Clone(request.IgnoredMCPServers)
		input.UserDeclinedMcpServers = bytes.Clone(request.DeclinedMCPServers)
	} else {
		for index := range decisions {
			if decisions[index].InterruptID == "" && len(target.HITLInterrupts) == 1 {
				decisions[index].InterruptID = target.HITLInterrupts[0].InterruptID
			}
		}
		// One logical decision set must produce one durable idempotency input even
		// when a browser reconstructs the visible cards in a different order.
		slices.SortFunc(decisions, func(left, right CurrentHITLDecision) int {
			return strings.Compare(left.InterruptID, right.InterruptID)
		})
		encodedDecisions, err := json.Marshal(decisions)
		if err != nil {
			return nil, nil, "", ErrInvalidCurrentAgentStart
		}
		input.HitlResume = true
		if len(decisions) == 1 {
			input.HitlAction = stringPointer(decisions[0].Action)
			input.HitlValue = stringPointer(decisions[0].Value)
			turn.Action = decisions[0].Action
			turn.InterruptID = decisions[0].InterruptID
		}
		input.HitlDecisions = encodedDecisions
		turn.HITLDecisions = bytes.Clone(encodedDecisions)
	}
	return input, turn, capabilityID, nil
}

func currentContinuationDatabaseID(value int64) (int32, bool) {
	if value <= 0 || value > math.MaxInt32 {
		return 0, false
	}
	return int32(value), true
}

func currentRootHITLAction(action string) bool {
	switch action {
	case "approve", "reject", "edit", "block_with_comment":
		return true
	default:
		return false
	}
}

func currentAuthorizationAction(action string) bool {
	return action == "authorize" || action == "skip"
}

func currentContinuationIdempotencyKey(
	responseID string,
	decisions json.RawMessage,
	authorizationID string,
	authorizationAction string,
) string {
	digest := sha256.New()
	_, _ = digest.Write(decisions)
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(authorizationID))
	_, _ = digest.Write([]byte{0})
	_, _ = digest.Write([]byte(authorizationAction))
	sum := digest.Sum(nil)
	return "continue/" + responseID + "/" + hex.EncodeToString(sum[:16])
}

func stringPointer(value string) *string {
	return &value
}
