package webhook

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Webhook struct {
	ID        string   `json:"id"`
	ProjectID string   `json:"project_id"`
	URL       string   `json:"url"`
	Events    []string `json:"events"`
	Secret    string   `json:"secret,omitempty"`
	Active    bool     `json:"active"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Repository interface {
	List(ctx context.Context, projectID string) ([]Webhook, error)
	Create(ctx context.Context, projectID string, wh Webhook) (Webhook, error)
	Get(ctx context.Context, projectID, webhookID string) (Webhook, error)
	Update(ctx context.Context, projectID, webhookID string, wh Webhook) (Webhook, error)
	Delete(ctx context.Context, projectID, webhookID string) error
	ListByEvent(ctx context.Context, projectID, eventType string) ([]Webhook, error)
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
	r.Get("/{webhookID}", h.Get)
	r.Put("/{webhookID}", h.Update)
	r.Delete("/{webhookID}", h.Delete)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	webhooks, err := h.repo.List(r.Context(), projectID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": webhooks})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	webhookID := chi.URLParam(r, "webhookID")

	wh, err := h.repo.Get(r.Context(), projectID, webhookID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, wh)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var wh Webhook
	if err := json.NewDecoder(r.Body).Decode(&wh); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, wh)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	webhookID := chi.URLParam(r, "webhookID")

	var wh Webhook
	if err := json.NewDecoder(r.Body).Decode(&wh); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, webhookID, wh)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	webhookID := chi.URLParam(r, "webhookID")

	if err := h.repo.Delete(r.Context(), projectID, webhookID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
