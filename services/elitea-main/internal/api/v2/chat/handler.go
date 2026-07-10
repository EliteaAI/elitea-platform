package chat

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/conversations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/ssewriter"
)

type ChatService interface {
	SendMessage(ctx context.Context, req conversations.SendMessageRequest) (conversations.SendMessageResponse, error)
	SendMessageStream(ctx context.Context, req conversations.SendMessageRequest, send func(predict.StreamEvent) error) error
}

type Handler struct {
	chat ChatService
}

func NewHandler(chat ChatService) *Handler {
	return &Handler{chat: chat}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Post("/{conversationID}/messages", h.Send)
	return r
}

func (h *Handler) Send(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	var req conversations.SendMessageRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID
	req.ConversationID = conversationID

	if req.Stream {
		h.streamSend(w, r, req)
		return
	}

	resp, err := h.chat.SendMessage(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) streamSend(w http.ResponseWriter, r *http.Request, req conversations.SendMessageRequest) {
	sse, err := ssewriter.New(w)
	if err != nil {
		apierr.Write(w, apierr.Internal("streaming not supported"))
		return
	}

	send := func(evt predict.StreamEvent) error {
		data, _ := json.Marshal(evt)
		return sse.Event(evt.Type, string(data))
	}

	if err := h.chat.SendMessageStream(r.Context(), req, send); err != nil {
		errData, _ := json.Marshal(map[string]string{"error": err.Error()})
		sse.Event("error", string(errData))
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
