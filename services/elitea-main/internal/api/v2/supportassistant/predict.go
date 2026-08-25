package supportassistant

// `POST /api/v2/support_assistant/predict/{conversationUUID}` — one support turn.
//
// This is the port of `sio/support.py`'s `support_predict`, and it is the only
// route in the package whose SHAPE differs from the reference rather than just
// its implementation. The reference is a socket.io event: the widget emits
// `support_predict`, the server pushes `chat_predict` frames back over the same
// socket, and the client folds them into the transcript. This service has no
// socket.io server — it streams over SSE (`internal/api/v2/executions`, and the
// #93 chat-transport port that moved the chat surface onto it) — so the turn is
// started over REST and answered with the `events_url` the client subscribes to.
//
// EVERYTHING ELSE IS THE SAME SEQUENCE, in the same order:
//
//  1. refuse unless the assistant is configured  (`module.is_enabled`, `agent_id`)
//  2. resolve the conversation, and prove it is the caller's
//  3. attach the configured agent to it as a participant
//  4. start the run against that participant
//
// Step 3 is the one that is easy to mistake for bookkeeping. A message group is
// addressed to a PARTICIPANT, not to an agent id, so a conversation with no agent
// participant has nothing for the turn to be sent to. The reference calls
// `chat_add_application_participant_rpc` on EVERY message for the same reason
// this does: the participant is idempotent, and an operator who repoints the
// assistant at a different agent must have the new one attached to conversations
// that already exist.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/platformconfig"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// maxPredictBody matches the agent-execution route's own ceiling, so a body this
// route accepts is one the use case behind it will accept too.
const maxPredictBody = int64(512 * 1024)

// applicationEntityName is the `chat_participants.entity_name` an agent
// participant carries, matching what the chat surface writes.
const applicationEntityName = "application"

// PredictRequest is one question.
//
// It carries NO project, NO agent and NO LLM settings, and that is the
// difference between this route and the generic agent-execution one it delegates
// to. The support assistant answers with the agent the OPERATOR chose; a client
// that could name the agent or supply LLM settings could run any application in
// the support project against the platform's credentials.
type PredictRequest struct {
	// Content is the user's message.
	Content string `json:"content"`
	// QuestionID identifies THIS TURN, as a lowercase UUID the client
	// generates.
	//
	// It is REQUIRED, and it is required rather than generated server-side on
	// purpose. The execution pipeline derives the turn's message identifiers
	// from it deterministically (`currentTurnUUID`), which is what makes a
	// retried POST resume the same turn instead of starting a second one.
	// Minting one here would turn every double-submit — a flaky connection, an
	// impatient second click — into a second agent run against the platform's
	// credentials, billed twice and answered twice.
	//
	// The reference's field is an integer message id and carries no such
	// property; this is the shape THIS service's start contract defines.
	QuestionID string `json:"question_id"`
	// Context is the page context the widget collects — which screen the user is
	// on, which project and entity they are looking at, which model is selected.
	// It is `SupportAssistantContext` in `models/pd/support.py`.
	Context *AssistantContext `json:"support_assistant_context,omitempty"`
}

// AssistantContext is `models/pd/support.py`'s `SupportAssistantContext`,
// field for field.
type AssistantContext struct {
	AssistantName     string         `json:"assistant_name,omitempty"`
	AssistantVersion  string         `json:"assistant_version,omitempty"`
	ProjectID         int64          `json:"project_id,omitempty"`
	ProjectName       string         `json:"project_name,omitempty"`
	CurrentPage       string         `json:"current_page,omitempty"`
	CurrentEntityType string         `json:"current_entity_type,omitempty"`
	CurrentEntityID   int64          `json:"current_entity_id,omitempty"`
	CurrentEntityName string         `json:"current_entity_name,omitempty"`
	SelectedProvider  string         `json:"selected_provider,omitempty"`
	SelectedModel     string         `json:"selected_model,omitempty"`
	Meta              map[string]any `json:"meta,omitempty"`
}

// PredictResponse mirrors the agent-execution start route's body exactly,
// `events_url` included, so the ported widget can reuse this app's existing
// execution-stream client rather than a second one written for support.
type PredictResponse struct {
	TaskID            string `json:"task_id"`
	ExecutionID       string `json:"execution_id"`
	CommandID         string `json:"command_id"`
	ResponseMessageID string `json:"response_message_id"`
	EventsURL         string `json:"events_url"`
	Created           bool   `json:"created"`
}

// Predict starts one support turn.
func (h *Handler) Predict(w http.ResponseWriter, r *http.Request) {
	settings, ok := settingsFromContext(r.Context())
	if !ok {
		apierr.WriteStatus(w, http.StatusInternalServerError, "support assistant is misconfigured")
		return
	}
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}
	if h.startCase == nil || h.chat == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, unavailableMessage)
		return
	}

	var body PredictRequest
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxPredictBody))
	if err != nil {
		apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if err := json.Unmarshal(raw, &body); err != nil {
		apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if body.Content == "" {
		// `SupportPredictPayload.content` is `min_length=1`.
		apierr.WriteStatus(w, http.StatusBadRequest, "content is required")
		return
	}
	if !validTurnUUID(body.QuestionID) {
		apierr.WriteStatus(w, http.StatusBadRequest, "question_id must be a lowercase UUID")
		return
	}

	conversationUUID := chi.URLParam(r, "conversationUUID")
	conversationID, err := h.store.conversationOwnedByCaller(r.Context(), projectID, userID, conversationUUID)
	if err != nil {
		h.writeConversationError(w, err, "resolve conversation")
		return
	}

	participantID, err := h.ensureAgentParticipant(r.Context(), settings, conversationID)
	if err != nil {
		h.logger.Error("support assistant: attach agent participant",
			"agent_id", settings.AgentID, "err", err)
		apierr.WriteStatus(w, http.StatusServiceUnavailable, "failed to prepare the support agent")
		return
	}

	outcome, err := h.startCase.StartCurrentApplication(r.Context(),
		agentexecutionapp.CurrentApplicationStartRequest{
			ProjectID:           projectID,
			ActorUserID:         userID,
			ConversationUUID:    conversationUUID,
			TargetParticipantID: participantID,
			QuestionID:          body.QuestionID,
			UserInput:           h.composeUserInput(body),
		})
	if err != nil {
		h.logger.Error("support assistant: start turn", "err", err)
		apierr.WriteStatus(w, http.StatusBadGateway, "failed to start the support agent")
		return
	}

	writeJSON(w, http.StatusOK, PredictResponse{
		TaskID:            outcome.ExecutionID,
		ExecutionID:       outcome.ExecutionID,
		CommandID:         outcome.CommandID,
		ResponseMessageID: outcome.ResponseMessageID,
		EventsURL: "/api/v2/executions/" + strconv.FormatInt(projectID, 10) +
			"/" + outcome.ExecutionID + "/events",
		Created: outcome.Created,
	})
}

// composeUserInput appends the page context to the question.
//
// The reference passes it as a separate `runtime_context` field on the socket
// payload, which its LangGraph worker merges into the agent's state. THIS
// SERVICE'S start request has no such field — `CurrentApplicationStartRequest`
// carries `UserInput` and nothing else free-form — so the context travels as a
// clearly fenced block appended to the message.
//
// That is a REAL DIFFERENCE from the reference and worth knowing about: the
// agent sees the context as text rather than as structured state, so an agent
// prompt written against the reference's `runtime_context` variable will not
// find it. Extending the start contract with a structured context field is the
// better answer and belongs in `libs/proto` with the rest of the cross-language
// contract; this keeps the feature working without inventing an unversioned
// field in the meantime.
func (h *Handler) composeUserInput(body PredictRequest) string {
	if body.Context == nil {
		return body.Content
	}
	encoded, err := json.Marshal(body.Context)
	if err != nil || len(encoded) == 0 || string(encoded) == "{}" {
		return body.Content
	}
	return body.Content + "\n\n<support_assistant_context>\n" + string(encoded) + "\n</support_assistant_context>"
}

// ensureAgentParticipant attaches the configured agent to the conversation and
// returns its participant id, creating the row only when it is missing.
func (h *Handler) ensureAgentParticipant(
	ctx context.Context, settings platformconfig.SupportAssistant, conversationID int64,
) (int64, error) {
	projectKey := strconv.FormatInt(settings.ProjectID, 10)
	conversationKey := strconv.FormatInt(conversationID, 10)
	agentProject := settings.AgentProject()

	if participantID, found, err := h.findAgentParticipant(
		ctx, projectKey, conversationKey, settings.AgentID, agentProject,
	); err != nil {
		return 0, err
	} else if found {
		return participantID, nil
	}

	if err := h.chat.AddParticipant(ctx, projectKey, conversationKey, map[string]any{
		"entity_name": applicationEntityName,
		"entity_meta": map[string]any{
			"id":         settings.AgentID,
			"project_id": agentProject,
		},
	}); err != nil {
		return 0, err
	}

	participantID, found, err := h.findAgentParticipant(
		ctx, projectKey, conversationKey, settings.AgentID, agentProject)
	if err != nil {
		return 0, err
	}
	if !found {
		// The insert reported success and the row is not there. Rather than
		// starting a turn addressed to participant 0, refuse.
		return 0, fmt.Errorf("support assistant: agent participant not found after attach")
	}
	return participantID, nil
}

// findAgentParticipant looks for the agent among the conversation's participants.
//
// The match is on ENTITY IDENTITY (`application` + agent id + agent project),
// not on position or on name, because a conversation legitimately holds several
// participants — the user, the agent, and whatever an operator's repointing has
// left behind — and picking the wrong one sends the question to a different
// agent. The comparison goes through `json.Number`-tolerant reads because
// `entity_meta` is a JSON document whose numbers arrive as float64.
func (h *Handler) findAgentParticipant(
	ctx context.Context, projectKey, conversationKey string, agentID, agentProjectID int64,
) (int64, bool, error) {
	participants, err := h.chat.ListParticipants(ctx, projectKey, conversationKey)
	if err != nil {
		return 0, false, err
	}
	for _, participant := range participants {
		if participant.EntityName != applicationEntityName {
			continue
		}
		if metaInt(participant.EntityMeta, "id") != agentID {
			continue
		}
		// A participant written before an operator set `agent_project_id`
		// carries no project. It still identifies the same agent in the same
		// project, so an ABSENT project matches; a DIFFERENT one does not.
		if project, present := metaIntPresent(participant.EntityMeta, "project_id"); present && project != agentProjectID {
			continue
		}
		return int64(participant.ID), true, nil
	}
	return 0, false, nil
}

func metaInt(meta map[string]any, key string) int64 {
	value, _ := metaIntPresent(meta, key)
	return value
}

func metaIntPresent(meta map[string]any, key string) (int64, bool) {
	raw, ok := meta[key]
	if !ok || raw == nil {
		return 0, false
	}
	switch typed := raw.(type) {
	case float64:
		return int64(typed), true
	case int64:
		return typed, true
	case int:
		return int64(typed), true
	case json.Number:
		value, err := typed.Int64()
		return value, err == nil
	case string:
		value, err := strconv.ParseInt(typed, 10, 64)
		return value, err == nil
	}
	return 0, false
}

// validTurnUUID applies the same rule `agentexecution`'s own Validate does —
// parseable AND already lowercase.
//
// It is restated here rather than deferred to the use case because the use case
// answers one undifferentiated `ErrInvalidCurrentAgentStart` for nine distinct
// problems, which this route would have to render as a single unhelpful 400.
// Checking the one field a client actually gets wrong lets the message name it.
func validTurnUUID(value string) bool {
	parsed, err := uuid.Parse(value)
	return err == nil && parsed.String() == value
}
