package conversations

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Conversation struct {
	ID           string    `json:"id"`
	ProjectID    string    `json:"project_id"`
	Name         string    `json:"name"`
	Description  string    `json:"description,omitempty"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
	CreatedBy    string    `json:"created_by"`
	MessageCount int       `json:"message_count"`
}

type Message struct {
	ID             string         `json:"id"`
	ConversationID string         `json:"conversation_id"`
	Role           string         `json:"role"`
	Content        string         `json:"content"`
	ContentType    string         `json:"content_type,omitempty"`
	Metadata       map[string]any `json:"metadata,omitempty"`
	CreatedAt      time.Time      `json:"created_at"`
}

type ListResponse struct {
	Items      []Conversation `json:"items"`
	Total      int            `json:"total"`
	Page       int            `json:"page"`
	PageSize   int            `json:"page_size"`
	TotalPages int            `json:"total_pages"`
}

type MessagesListResponse struct {
	Items      []Message `json:"items"`
	Total      int       `json:"total"`
	Page       int       `json:"page"`
	PageSize   int       `json:"page_size"`
	TotalPages int       `json:"total_pages"`
}

type Repository interface {
	List(ctx context.Context, projectID string, page, pageSize int) (ListResponse, error)
	Get(ctx context.Context, projectID, conversationID string) (Conversation, error)
	Create(ctx context.Context, projectID string, conv Conversation) (Conversation, error)
	Update(ctx context.Context, projectID, conversationID string, conv Conversation) (Conversation, error)
	Delete(ctx context.Context, projectID, conversationID string) error
	ListMessages(ctx context.Context, projectID, conversationID string, page, pageSize int) (MessagesListResponse, error)
	AddParticipant(ctx context.Context, projectID, conversationID string, body map[string]any) error
	RemoveParticipant(ctx context.Context, projectID, conversationID, participantID string) error
	UpdateEntitySettings(ctx context.Context, projectID, conversationID, participantID string, settings map[string]any) error
	BatchUpdateEntitySettings(ctx context.Context, projectID, conversationID string, settings []map[string]any) error
	SelectConversation(ctx context.Context, projectID, conversationID, userID string) error
	DeselectConversation(ctx context.Context, projectID, userID string) error
	CreateCanvas(ctx context.Context, projectID string, body map[string]any) (map[string]any, error)
	GetCanvas(ctx context.Context, projectID, canvasID string) (map[string]any, error)
	UpdateCanvas(ctx context.Context, projectID, canvasID string, body map[string]any) error
	UpdateAttachmentStorage(ctx context.Context, projectID, conversationID string, body map[string]any) error
	AddAttachments(ctx context.Context, projectID, conversationID string, body map[string]any) error
	DeleteAttachments(ctx context.Context, projectID, conversationID string) error
	GetContextAnalytics(ctx context.Context, projectID, conversationID string) (map[string]any, error)
	UpdateContextStrategy(ctx context.Context, projectID, conversationID string, body map[string]any) error
	DeleteMessages(ctx context.Context, projectID, conversationID string) error
	DeleteMessage(ctx context.Context, projectID, groupUID string) error
}

type Handler struct {
	repo Repository
}

func NewHandler(repo Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{conversationID}", h.Get)
	r.Put("/{conversationID}", h.Update)
	r.Delete("/{conversationID}", h.Delete)
	r.Get("/{conversationID}/messages", h.ListMessages)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}

	resp, err := h.repo.List(r.Context(), projectID, page, pageSize)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	conv, err := h.repo.Get(r.Context(), projectID, conversationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, conv)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var conv Conversation
	if err := json.NewDecoder(r.Body).Decode(&conv); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, conv)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	var conv Conversation
	if err := json.NewDecoder(r.Body).Decode(&conv); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, conversationID, conv)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")

	if err := h.repo.Delete(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListMessages(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 50
	}

	resp, err := h.repo.ListMessages(r.Context(), projectID, conversationID, page, pageSize)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) DeleteMessages(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	if err := h.repo.DeleteMessages(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) DeleteMessage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	messageID := chi.URLParam(r, "messageID")
	if err := h.repo.DeleteMessage(r.Context(), projectID, messageID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) AddParticipant(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.AddParticipant(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) RemoveParticipant(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	participantID := chi.URLParam(r, "participantID")
	if err := h.repo.RemoveParticipant(r.Context(), projectID, conversationID, participantID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) UpdateEntitySettings(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	participantID := chi.URLParam(r, "participantID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.UpdateEntitySettings(r.Context(), projectID, conversationID, participantID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) BatchUpdateEntitySettings(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body []map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.BatchUpdateEntitySettings(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) SelectConversation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	user, _ := auth.UserFromContext(r.Context())
	if err := h.repo.SelectConversation(r.Context(), projectID, conversationID, user.ID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeselectConversation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	user, _ := auth.UserFromContext(r.Context())
	if err := h.repo.DeselectConversation(r.Context(), projectID, user.ID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Regenerate(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) CreateCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	canvas, err := h.repo.CreateCanvas(r.Context(), projectID, body)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, canvas)
}

func (h *Handler) GetCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	canvasID := chi.URLParam(r, "canvasID")
	canvas, err := h.repo.GetCanvas(r.Context(), projectID, canvasID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, canvas)
}

func (h *Handler) UpdateCanvas(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	canvasID := chi.URLParam(r, "canvasID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.UpdateCanvas(r.Context(), projectID, canvasID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) UpdateAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.UpdateAttachmentStorage(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) AddAttachments(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.AddAttachments(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteAttachments(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	if err := h.repo.DeleteAttachments(r.Context(), projectID, conversationID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) GetContextAnalytics(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	analytics, err := h.repo.GetContextAnalytics(r.Context(), projectID, conversationID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"token_count": 0, "max_tokens": 128000})
		return
	}
	writeJSON(w, http.StatusOK, analytics)
}

func (h *Handler) UpdateContextStrategy(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	conversationID := chi.URLParam(r, "conversationID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	if err := h.repo.UpdateContextStrategy(r.Context(), projectID, conversationID, body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
