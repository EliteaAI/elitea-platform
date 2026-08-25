package supportassistant

// The conversation routes — the port of `api/v2/conversations.py`,
// `api/v2/conversation.py`, `api/v2/messages.py` and `api/v2/attachments.py`.
//
// Every one of them resolves the conversation through
// `store.conversationOwnedByCaller`, which is where the "yours, and a support
// one" predicate lives. None of them takes a project from the request.

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// ChatStore is the slice of the chat repository this package REUSES rather than
// reimplements — message-group reads, conversation and message deletion, and
// participant management. It is satisfied by
// `internal/infra/db/repos.ConversationsRepo`.
//
// Reuse is the point: a support transcript and a chat transcript are the same
// rows in the same tables, and a second implementation of "read a conversation's
// message groups" would be a second thing to keep in step with every future
// change to the message model.
type ChatStore interface {
	ListMessageGroups(ctx context.Context, projectID, conversationID string, limit int, sortOrder string) ([]map[string]any, error)
	Delete(ctx context.Context, projectID, conversationID string) error
	DeleteMessages(ctx context.Context, projectID, conversationID string) error
	AddParticipant(ctx context.Context, projectID, conversationID string, body map[string]any) error
	ListParticipants(ctx context.Context, projectID, conversationID string) ([]conversations.Participant, error)
}

// AttachmentRoute is the chat handler's multipart attachment endpoint, reused
// verbatim — see UploadAttachments for how the identifiers reach it.
type AttachmentRoute interface {
	AddAttachments(http.ResponseWriter, *http.Request)
}

// WithChatStore supplies the reused chat repository. Without it the routes that
// need it answer 503 rather than panicking on a nil interface.
func WithChatStore(chat ChatStore) Option {
	return func(h *Handler) { h.chat = chat }
}

// WithAttachmentRoute supplies the chat attachment endpoint. Without it the
// support attachment route answers 503: a deployment with no object store
// cannot accept a file, and saying so beats accepting bytes that go nowhere.
func WithAttachmentRoute(route AttachmentRoute) Option {
	return func(h *Handler) { h.attachments = route }
}

// defaultConversationName is `conversations.py`'s `"New conversation"`.
const defaultConversationName = "New conversation"

// maxConversationNameLength is `ConversationCreateRequest`'s `max_length=255`.
const maxConversationNameLength = 255

// listLimits bound the history request. The reference defaults to 20 with no
// ceiling at all, so a client asking for `limit=100000` made the server build
// that page. The default is kept; the ceiling is added.
const (
	defaultListLimit = 20
	maxListLimit     = 100
)

// requestContext is the tuple every gated handler starts by unpacking: the
// resolved settings and the caller. Both are guaranteed present by `resolve`,
// so a failure here is a programming error in the middleware chain rather than
// anything a request can cause — which is why it answers 500 and not 401.
func (h *Handler) requestContext(w http.ResponseWriter, r *http.Request) (int64, int64, bool) {
	settings, ok := settingsFromContext(r.Context())
	if !ok {
		h.logger.Error("support assistant: settings missing from request context")
		apierr.WriteStatus(w, http.StatusInternalServerError, "support assistant is misconfigured")
		return 0, 0, false
	}
	user, ok := auth.UserFromContext(r.Context())
	if !ok {
		apierr.WriteStatus(w, http.StatusUnauthorized, "authentication required")
		return 0, 0, false
	}
	userID, ok := user.OwningUserID()
	if !ok {
		apierr.WriteStatus(w, http.StatusUnauthorized, "authentication required")
		return 0, 0, false
	}
	return settings.ProjectID, userID, true
}

// ListResponse is the widget's `TConversationsResponse`, plus the pagination
// fields the reference's listing returns.
type ListResponse struct {
	Items   []Conversation `json:"items"`
	Total   int            `json:"total"`
	Limit   int            `json:"limit"`
	Offset  int            `json:"offset"`
	HasMore bool           `json:"has_more"`
}

// ListConversations serves the widget's history drawer.
func (h *Handler) ListConversations(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}

	limit := boundedQueryInt(r, "limit", defaultListLimit, 1, maxListLimit)
	offset := boundedQueryInt(r, "offset", 0, 0, 1<<30)
	query := r.URL.Query().Get("q")

	items, total, err := h.store.listConversations(r.Context(), projectID, userID, limit, offset, query)
	if err != nil {
		h.logger.Error("support assistant: list conversations", "err", err)
		apierr.WriteStatus(w, http.StatusInternalServerError, "failed to list conversations")
		return
	}
	writeJSON(w, http.StatusOK, ListResponse{
		Items:   items,
		Total:   total,
		Limit:   limit,
		Offset:  offset,
		HasMore: offset+len(items) < total,
	})
}

type createConversationRequest struct {
	Name string `json:"name"`
}

// CreateConversation opens a new support conversation for the caller.
func (h *Handler) CreateConversation(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}

	// The widget POSTs `{}`. An absent, empty or whitespace body is the normal
	// case, not an error.
	var body createConversationRequest
	if raw, err := io.ReadAll(io.LimitReader(r.Body, 8<<10)); err == nil && len(raw) > 0 {
		if err := json.Unmarshal(raw, &body); err != nil {
			apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
			return
		}
	}
	name := body.Name
	if name == "" {
		name = defaultConversationName
	}
	if len(name) > maxConversationNameLength {
		apierr.WriteStatus(w, http.StatusBadRequest, "name is too long")
		return
	}

	conversation, err := h.store.createConversation(r.Context(), projectID, userID, name)
	if err != nil {
		h.logger.Error("support assistant: create conversation", "err", err)
		apierr.WriteStatus(w, http.StatusInternalServerError, "failed to create conversation")
		return
	}
	writeJSON(w, http.StatusCreated, conversation)
}

// ConversationDetails is the widget's `TRawConversation`: the conversation plus
// its transcript, in the same message-group shape the chat surface renders.
type ConversationDetails struct {
	Conversation
	MessageGroups []map[string]any            `json:"message_groups"`
	Participants  []conversations.Participant `json:"participants"`
}

// maxTranscriptGroups bounds one transcript read. The reference passes no limit
// at all to `chat_get_conversation_details`.
const maxTranscriptGroups = 200

// GetConversation returns one support conversation with its transcript.
func (h *Handler) GetConversation(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}
	conversationUUID := chi.URLParam(r, "conversationUUID")
	conversationID, err := h.store.conversationOwnedByCaller(r.Context(), projectID, userID, conversationUUID)
	if err != nil {
		h.writeConversationError(w, err, "resolve conversation")
		return
	}
	if h.chat == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, unavailableMessage)
		return
	}

	conversation, err := h.store.conversationByID(r.Context(), projectID, conversationID)
	if err != nil {
		h.writeConversationError(w, err, "read conversation")
		return
	}

	projectKey := strconv.FormatInt(projectID, 10)
	conversationKey := strconv.FormatInt(conversationID, 10)
	groups, err := h.chat.ListMessageGroups(r.Context(), projectKey, conversationKey, maxTranscriptGroups, "asc")
	if err != nil {
		h.logger.Error("support assistant: read transcript", "err", err)
		apierr.WriteStatus(w, http.StatusInternalServerError, "failed to read conversation")
		return
	}
	if groups == nil {
		groups = []map[string]any{}
	}
	participants, err := h.chat.ListParticipants(r.Context(), projectKey, conversationKey)
	if err != nil || participants == nil {
		participants = []conversations.Participant{}
	}

	writeJSON(w, http.StatusOK, ConversationDetails{
		Conversation:  conversation,
		MessageGroups: groups,
		Participants:  participants,
	})
}

// DeleteConversation removes one of the caller's support conversations.
func (h *Handler) DeleteConversation(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}
	conversationUUID := chi.URLParam(r, "conversationUUID")
	conversationID, err := h.store.conversationOwnedByCaller(r.Context(), projectID, userID, conversationUUID)
	if err != nil {
		h.writeConversationError(w, err, "resolve conversation")
		return
	}
	if h.chat == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, unavailableMessage)
		return
	}
	if err := h.chat.Delete(r.Context(),
		strconv.FormatInt(projectID, 10), strconv.FormatInt(conversationID, 10)); err != nil {
		h.logger.Error("support assistant: delete conversation", "err", err)
		apierr.WriteStatus(w, http.StatusInternalServerError, "failed to delete conversation")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// ClearMessages empties a conversation without deleting it — `messages.py`'s
// DELETE, which the widget's "clear chat" control calls.
func (h *Handler) ClearMessages(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}
	conversationUUID := chi.URLParam(r, "conversationUUID")
	conversationID, err := h.store.conversationOwnedByCaller(r.Context(), projectID, userID, conversationUUID)
	if err != nil {
		h.writeConversationError(w, err, "resolve conversation")
		return
	}
	if h.chat == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, unavailableMessage)
		return
	}
	if err := h.chat.DeleteMessages(r.Context(),
		strconv.FormatInt(projectID, 10), strconv.FormatInt(conversationID, 10)); err != nil {
		h.logger.Error("support assistant: clear messages", "err", err)
		apierr.WriteStatus(w, http.StatusInternalServerError, "failed to clear messages")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"success": true})
}

// UploadAttachments delegates to the chat surface's own multipart handler.
//
// THE DELEGATION IS THE SECURITY PROPERTY, not a shortcut. That handler reads
// its project and conversation from the chi route parameters, so this route
// resolves both server-side — the project from configuration, the conversation
// through the ownership predicate — and REWRITES the route parameters with the
// resolved values before calling it. The delegate therefore cannot see anything
// the caller sent, and every size limit, MIME check, filename sanitiser,
// chunked-upload path and retention rule in `conversations/attachments.go`
// applies to a support upload without being restated here, where it would
// eventually drift.
func (h *Handler) UploadAttachments(w http.ResponseWriter, r *http.Request) {
	projectID, userID, ok := h.requestContext(w, r)
	if !ok {
		return
	}
	conversationUUID := chi.URLParam(r, "conversationUUID")
	conversationID, err := h.store.conversationOwnedByCaller(r.Context(), projectID, userID, conversationUUID)
	if err != nil {
		h.writeConversationError(w, err, "resolve conversation")
		return
	}
	if h.attachments == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, unavailableMessage)
		return
	}

	routeContext := chi.NewRouteContext()
	routeContext.URLParams.Add("projectID", strconv.FormatInt(projectID, 10))
	routeContext.URLParams.Add("conversationID", strconv.FormatInt(conversationID, 10))
	h.attachments.AddAttachments(w, r.WithContext(
		context.WithValue(r.Context(), chi.RouteCtxKey, routeContext)))
}

// writeConversationError maps a store error to a status. "Not yours" and "does
// not exist" are ONE answer — see conversationOwnedByCaller.
func (h *Handler) writeConversationError(w http.ResponseWriter, err error, operation string) {
	if errors.Is(err, errConversationNotFound) {
		apierr.WriteStatus(w, http.StatusNotFound, "conversation not found")
		return
	}
	h.logger.Error("support assistant: "+operation, "err", err)
	apierr.WriteStatus(w, http.StatusInternalServerError, "failed to read conversation")
}

// boundedQueryInt reads a query integer, clamping it into range. An unparseable
// value takes the default rather than 400ing: these are pagination hints from a
// widget, not instructions.
func boundedQueryInt(r *http.Request, name string, fallback, minimum, maximum int) int {
	raw := r.URL.Query().Get(name)
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	if value < minimum {
		return minimum
	}
	if value > maximum {
		return maximum
	}
	return value
}
