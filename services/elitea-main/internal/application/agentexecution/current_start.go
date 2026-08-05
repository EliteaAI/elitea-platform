package agentexecution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf8"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"github.com/google/uuid"
)

const maxCurrentAgentUserInputBytes = 256 * 1024

var (
	ErrInvalidCurrentAgentStart                = errors.New("invalid current agent start")
	ErrUnsupportedCurrentAgentStart            = errors.New("current agent start is not supported by the admitted parity slice")
	ErrCurrentAgentRegenerationStillFinalizing = errors.New("current agent response is still being finalized")
)

// CurrentApplicationTurn is the immutable current-chat side of one durable
// application execution admission. The repository rechecks these identities
// and writes the user and streaming response groups in the same transaction as
// elitea_runtime execution/outbox state.
type CurrentApplicationTurn struct {
	ProjectID            int64
	ActorUserID          int64
	ConversationUUID     string
	TargetParticipantID  int64
	ApplicationID        int64
	ApplicationVersionID int64
	QuestionID           string
	QuestionItemID       string
	ResponseMessageID    string
	QuestionMeta         json.RawMessage
	UserInput            string
}

func (turn CurrentApplicationTurn) Validate() error {
	if turn.ProjectID <= 0 || turn.ActorUserID <= 0 || turn.TargetParticipantID <= 0 ||
		turn.ApplicationID <= 0 || turn.ApplicationVersionID <= 0 ||
		!validUUID(turn.ConversationUUID) || !validUUID(turn.QuestionID) ||
		!validUUID(turn.QuestionItemID) || !validUUID(turn.ResponseMessageID) ||
		!validCurrentAgentText(turn.UserInput, maxCurrentAgentUserInputBytes) ||
		!validJSONObject(turn.QuestionMeta) {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

func (turn *CurrentApplicationTurn) Clone() *CurrentApplicationTurn {
	if turn == nil {
		return nil
	}
	clone := *turn
	clone.QuestionMeta = bytes.Clone(turn.QuestionMeta)
	return &clone
}

type CurrentApplicationTarget struct {
	ApplicationID        int64
	ApplicationVersionID int64
	Variables            json.RawMessage
	VersionDetails       json.RawMessage
	ChatHistory          json.RawMessage
}

type CurrentApplicationResolver interface {
	ResolveCurrentApplication(
		context.Context,
		CurrentApplicationStartRequest,
	) (CurrentApplicationTarget, error)
}

type admissionSubmitter interface {
	Submit(context.Context, SubmitRequest) (executionapp.AdmissionOutcome, error)
}

type CurrentApplicationStartRequest struct {
	ProjectID           int64
	ActorUserID         int64
	ConversationUUID    string
	TargetParticipantID int64
	QuestionID          string
	UserInput           string
	InteractionUUID     string
}

func (request CurrentApplicationStartRequest) Validate() error {
	if request.ProjectID <= 0 || request.ActorUserID <= 0 || request.TargetParticipantID <= 0 ||
		!validUUID(request.ConversationUUID) || !validUUID(request.QuestionID) ||
		!validCurrentAgentText(request.UserInput, maxCurrentAgentUserInputBytes) ||
		(request.InteractionUUID != "" && !validUUID(request.InteractionUUID)) {
		return ErrInvalidCurrentAgentStart
	}
	return nil
}

type CurrentApplicationStartOutcome struct {
	ExecutionID       string
	CommandID         string
	ResponseMessageID string
	Created           bool
}

type CurrentApplicationStartService struct {
	resolver             CurrentApplicationResolver
	adhocResolver        CurrentAdhocResolver
	regenerationResolver CurrentRegenerationResolver
	freezer              CurrentApplicationVersionFreezer
	admissions           admissionSubmitter
}

func NewCurrentApplicationStartService(
	resolver CurrentApplicationResolver,
	adhocResolver CurrentAdhocResolver,
	regenerationResolver CurrentRegenerationResolver,
	freezer CurrentApplicationVersionFreezer,
	admissions admissionSubmitter,
) (*CurrentApplicationStartService, error) {
	if resolver == nil || adhocResolver == nil || regenerationResolver == nil ||
		freezer == nil || admissions == nil {
		return nil, errors.New("current application start dependencies are required")
	}
	return &CurrentApplicationStartService{
		resolver: resolver, adhocResolver: adhocResolver,
		regenerationResolver: regenerationResolver,
		freezer:              freezer, admissions: admissions,
	}, nil
}

func (service *CurrentApplicationStartService) StartCurrentApplication(
	ctx context.Context,
	request CurrentApplicationStartRequest,
) (CurrentApplicationStartOutcome, error) {
	if err := request.Validate(); err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	target, err := service.resolver.ResolveCurrentApplication(ctx, request)
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	if request.ProjectID > math.MaxInt32 || request.ActorUserID > math.MaxInt32 ||
		target.ApplicationID <= 0 || target.ApplicationVersionID <= 0 ||
		!validJSONArray(target.Variables) || !validJSONObject(target.VersionDetails) ||
		!validJSONArray(target.ChatHistory) {
		return CurrentApplicationStartOutcome{}, ErrUnsupportedCurrentAgentStart
	}
	frozenVersion, err := service.freezer.FreezeCurrentApplicationVersion(
		ctx,
		CurrentApplicationVersionFreezeRequest{
			ProjectID:      int32(request.ProjectID),
			ActorUserID:    int32(request.ActorUserID),
			VersionDetails: target.VersionDetails,
		},
	)
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	target.VersionDetails = frozenVersion
	questionItemID := currentTurnUUID(request.QuestionID, "question-item")
	responseMessageID := currentTurnUUID(request.QuestionID, "response-message")
	questionMeta := json.RawMessage(`{}`)
	if request.InteractionUUID != "" {
		questionMeta, _ = json.Marshal(map[string]string{"interaction_uuid": request.InteractionUUID})
	}
	input, err := currentApplicationInput(request, target)
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
		IdempotencyKey:  request.QuestionID,
		CapabilityID:    executiondomain.AgentApplicationCapability,
		ClientStreamID:  request.ConversationUUID,
		ClientMessageID: responseMessageID,
		SIOEvent:        "chat_predict",
		Input:           input,
		CurrentTurn: &CurrentApplicationTurn{
			ProjectID: request.ProjectID, ActorUserID: request.ActorUserID,
			ConversationUUID:     request.ConversationUUID,
			TargetParticipantID:  request.TargetParticipantID,
			ApplicationID:        target.ApplicationID,
			ApplicationVersionID: target.ApplicationVersionID,
			QuestionID:           request.QuestionID, QuestionItemID: questionItemID,
			ResponseMessageID: responseMessageID, QuestionMeta: questionMeta,
			UserInput: request.UserInput,
		},
	})
	if err != nil {
		return CurrentApplicationStartOutcome{}, err
	}
	return CurrentApplicationStartOutcome{
		ExecutionID: outcome.ExecutionID, CommandID: outcome.CommandID,
		ResponseMessageID: responseMessageID, Created: outcome.Created,
	}, nil
}

func currentApplicationInput(
	request CurrentApplicationStartRequest,
	target CurrentApplicationTarget,
) (*runtimev1.AgentExecutionInputV1, error) {
	userInput, err := json.Marshal(request.UserInput)
	if err != nil {
		return nil, ErrInvalidCurrentAgentStart
	}
	application, err := json.Marshal(map[string]any{
		"id":              target.ApplicationID,
		"version_id":      target.ApplicationVersionID,
		"variables":       json.RawMessage(target.Variables),
		"version_details": json.RawMessage(target.VersionDetails),
	})
	if err != nil {
		return nil, ErrInvalidCurrentAgentStart
	}
	llm, err := currentApplicationRuntimeLLM(target.VersionDetails)
	if err != nil {
		return nil, err
	}
	threadID := request.ConversationUUID
	conversationID := request.ConversationUUID
	executionGeneration := request.QuestionID
	return &runtimev1.AgentExecutionInputV1{
		SchemaRevision: "elitea.runtime.agent-execution-input.v1",
		// Current chat history remains authoritative for ordinary turns. The
		// shared LangGraph checkpoint stores resumable graph state for this stable
		// thread; it does not replace the current chat-history projection.
		Llm: llm, ChatHistory: bytes.Clone(target.ChatHistory),
		UserInput: userInput, ThreadId: &threadID, Tools: []byte(`[]`),
		Application: application, InternalTools: []byte(`[]`),
		McpTokens: []byte(`{}`), IgnoredMcpServers: []byte(`[]`),
		UserDeclinedMcpServers: []byte(`[]`), HitlDecisions: []byte(`[]`),
		ExecutionGeneration: &executionGeneration, Meta: []byte(`{}`),
		ConversationId: &conversationID, ContextSettings: []byte(`{}`),
		InvokedSkills: []byte(`[]`), AppliedSkills: []byte(`[]`),
		AttachedSkills: []byte(`[]`), InputAttachments: []byte(`[]`),
		ParallelReconcile: []byte(`null`), ParallelTerminalErrors: []byte(`[]`),
	}, nil
}

func currentApplicationRuntimeLLM(versionDetails json.RawMessage) ([]byte, error) {
	version, err := decodeCurrentApplicationVersion(versionDetails)
	if err != nil {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	settings, ok := version["llm_settings"].(map[string]any)
	if !ok || settings == nil {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	compatible, ok := settings["openai_compatible"].(bool)
	if !ok {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	result, err := json.Marshal(map[string]any{
		"kwargs": map[string]any{"openai_compatible": compatible},
	})
	if err != nil {
		return nil, ErrUnsupportedCurrentAgentStart
	}
	return result, nil
}

func validUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed.String() == strings.ToLower(value)
}

var currentTurnNamespace = uuid.MustParse("71581f1e-fb1b-4d50-a9db-8ebd4b47db76")

func currentTurnUUID(questionID, role string) string {
	return uuid.NewSHA1(currentTurnNamespace, []byte(questionID+"\x00"+role)).String()
}

func validCurrentAgentText(value string, limit int) bool {
	return value != "" && len(value) <= limit && utf8.ValidString(value) &&
		!strings.ContainsRune(value, '\x00')
}

func validJSONObject(value []byte) bool {
	trimmed := bytes.TrimSpace(value)
	return json.Valid(trimmed) && len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}'
}

func validJSONArray(value []byte) bool {
	trimmed := bytes.TrimSpace(value)
	return json.Valid(trimmed) && len(trimmed) >= 2 && trimmed[0] == '[' && trimmed[len(trimmed)-1] == ']'
}
