package agentexecution

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	CurrentApplicationStartPath       = "/api/v2/elitea_core/messages/prompt_lib/{projectID}/{conversationID}"
	CurrentApplicationStartContract   = "agent.execute.application.v1"
	CurrentAdhocStartContract         = "agent.execute.adhoc.v1"
	CurrentApplicationStartMode       = auth.PermissionModeDefault
	CurrentApplicationStartPermission = "models.chat.messages.create"
	maxCurrentApplicationStartBody    = int64(512 * 1024)
)

var ErrInvalidCurrentApplicationStartRoute = errors.New("invalid current application-start route dependencies")

type StartUseCase interface {
	StartCurrentApplication(
		context.Context,
		agentexecutionapp.CurrentApplicationStartRequest,
	) (agentexecutionapp.CurrentApplicationStartOutcome, error)
	StartCurrentAdhoc(
		context.Context,
		agentexecutionapp.CurrentAdhocStartRequest,
	) (agentexecutionapp.CurrentApplicationStartOutcome, error)
}

type CurrentApplicationStartRoute struct {
	handler http.Handler
}

func NewCurrentApplicationStartRoute(
	useCase StartUseCase,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentApplicationStartRoute, error) {
	if useCase == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentApplicationStartRoute
	}
	handler := &currentApplicationStartHandler{useCase: useCase}
	endpoint := http.Handler(http.HandlerFunc(handler.Start))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentApplicationStartMode,
		func(request *http.Request) (string, bool) {
			projectID := chi.URLParam(request, "projectID")
			_, valid := positiveCanonicalID(projectID)
			return projectID, valid
		},
		CurrentApplicationStartPermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)
	router := chi.NewRouter()
	router.Method(http.MethodPost, CurrentApplicationStartPath, endpoint)
	return &CurrentApplicationStartRoute{handler: router}, nil
}

func (route *CurrentApplicationStartRoute) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}

type currentApplicationStartHandler struct {
	useCase StartUseCase
}

type currentApplicationStartBody struct {
	Payload struct {
		UserInput string `json:"user_input"`
	} `json:"payload"`
	ProjectID        int64           `json:"project_id"`
	ParticipantID    int64           `json:"participant_id"`
	ConversationUUID string          `json:"conversation_uuid"`
	QuestionID       string          `json:"question_id"`
	InteractionUUID  string          `json:"interaction_uuid"`
	AttachmentsInfo  json.RawMessage `json:"attachments_info"`
	LLMSettings      json.RawMessage `json:"llm_settings"`
	MCPTokens        json.RawMessage `json:"mcp_tokens"`
	UserIDs          json.RawMessage `json:"user_ids"`
}

func (handler *currentApplicationStartHandler) Start(writer http.ResponseWriter, request *http.Request) {
	projectID, ok := positiveCanonicalID(chi.URLParam(request, "projectID"))
	contract := request.URL.Query().Get("execution_contract")
	if !ok || (contract != CurrentApplicationStartContract && contract != CurrentAdhocStartContract) {
		writeError(writer, http.StatusBadRequest, "Invalid agent execution request")
		return
	}
	conversationID := chi.URLParam(request, "conversationID")
	mediaType, _, err := mime.ParseMediaType(request.Header.Get("Content-Type"))
	if err != nil || mediaType != "application/json" {
		writeError(writer, http.StatusUnsupportedMediaType, "Content-Type must be application/json")
		return
	}
	user, ok := auth.UserFromContext(request.Context())
	if !ok {
		writeError(writer, http.StatusUnauthorized, "authentication required")
		return
	}
	actorUserID, ok := user.OwningUserID()
	if !ok {
		writeError(writer, http.StatusUnauthorized, "authentication required")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, maxCurrentApplicationStartBody)
	var body currentApplicationStartBody
	decoder := json.NewDecoder(request.Body)
	if err := decoder.Decode(&body); err != nil {
		var maxBytes *http.MaxBytesError
		if errors.As(err, &maxBytes) {
			writeError(writer, http.StatusRequestEntityTooLarge, "request body too large")
			return
		}
		writeError(writer, http.StatusBadRequest, "Invalid agent execution request")
		return
	}
	var extra json.RawMessage
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		writeError(writer, http.StatusBadRequest, "Invalid agent execution request")
		return
	}
	if body.ProjectID != projectID || body.ConversationUUID != conversationID ||
		body.Payload.UserInput == "" || !emptyJSONArray(body.AttachmentsInfo) ||
		!emptyJSONObject(body.MCPTokens) || !absentJSON(body.UserIDs) {
		writeUnsupported(writer)
		return
	}

	var outcome agentexecutionapp.CurrentApplicationStartOutcome
	switch contract {
	case CurrentApplicationStartContract:
		if body.ParticipantID <= 0 || !absentJSON(body.LLMSettings) {
			writeUnsupported(writer)
			return
		}
		outcome, err = handler.useCase.StartCurrentApplication(
			request.Context(),
			agentexecutionapp.CurrentApplicationStartRequest{
				ProjectID: projectID, ActorUserID: actorUserID,
				ConversationUUID: conversationID, TargetParticipantID: body.ParticipantID,
				QuestionID: body.QuestionID, UserInput: body.Payload.UserInput,
				InteractionUUID: body.InteractionUUID,
			},
		)
	case CurrentAdhocStartContract:
		if body.ParticipantID < 0 || !currentJSONObject(body.LLMSettings) {
			writeUnsupported(writer)
			return
		}
		outcome, err = handler.useCase.StartCurrentAdhoc(
			request.Context(),
			agentexecutionapp.CurrentAdhocStartRequest{
				ProjectID: projectID, ActorUserID: actorUserID,
				ConversationUUID: conversationID, TargetParticipantID: body.ParticipantID,
				QuestionID: body.QuestionID, UserInput: body.Payload.UserInput,
				InteractionUUID: body.InteractionUUID,
				LLMSettings:     bytes.Clone(body.LLMSettings),
			},
		)
	}
	if err != nil {
		slog.Error("current agent execution start failed", "contract", contract, "err", err)
		writeStartError(writer, err)
		return
	}
	writeJSON(writer, http.StatusOK, map[string]any{
		"task_id":             outcome.ExecutionID,
		"execution_id":        outcome.ExecutionID,
		"command_id":          outcome.CommandID,
		"response_message_id": outcome.ResponseMessageID,
		"events_url":          "/api/v2/executions/" + strconv.FormatInt(projectID, 10) + "/" + outcome.ExecutionID + "/events",
		"created":             outcome.Created,
	})
}

func writeStartError(writer http.ResponseWriter, err error) {
	var capacity *executionapp.AdmissionCapacityError
	switch {
	case errors.Is(err, agentexecutionapp.ErrInvalidCurrentAgentStart),
		errors.Is(err, agentexecutionapp.ErrInvalidAgentAdmission):
		writeError(writer, http.StatusBadRequest, "Invalid agent execution request")
	case errors.Is(err, agentexecutionapp.ErrUnsupportedCurrentAgentStart):
		writeUnsupported(writer)
	case errors.Is(err, executionapp.ErrIdempotencyConflict):
		writeError(writer, http.StatusConflict, "Agent execution request conflicts with an existing turn")
	case errors.As(err, &capacity):
		writer.Header().Set("Retry-After", "1")
		writeError(writer, http.StatusServiceUnavailable, "The service is busy processing other requests. Please try again in a few seconds.")
	default:
		writeError(writer, http.StatusInternalServerError, "Failed to start agent execution")
	}
}

func writeUnsupported(writer http.ResponseWriter) {
	writeJSON(writer, http.StatusUnprocessableEntity, map[string]string{
		"error":   "unsupported_agent_execution",
		"message": "This agent turn requires the current execution path.",
	})
}

func emptyJSONArray(raw json.RawMessage) bool {
	return absentJSON(raw) || bytes.Equal(bytes.TrimSpace(raw), []byte("[]"))
}

func emptyJSONObject(raw json.RawMessage) bool {
	return absentJSON(raw) || bytes.Equal(bytes.TrimSpace(raw), []byte("{}"))
}

func absentJSON(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null"))
}

func currentJSONObject(raw json.RawMessage) bool {
	trimmed := bytes.TrimSpace(raw)
	return json.Valid(trimmed) && len(trimmed) >= 2 && trimmed[0] == '{' && trimmed[len(trimmed)-1] == '}'
}

func positiveCanonicalID(raw string) (int64, bool) {
	id, err := strconv.ParseInt(raw, 10, 64)
	return id, err == nil && id > 0 && strconv.FormatInt(id, 10) == raw
}

func writeError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}

func writeJSON(writer http.ResponseWriter, status int, value any) {
	writer.Header().Set("Content-Type", "application/json")
	writer.Header().Set("Cache-Control", "no-store")
	writer.WriteHeader(status)
	_ = json.NewEncoder(writer).Encode(value)
}
