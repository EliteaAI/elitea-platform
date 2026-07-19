package skills

import (
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Skill struct {
	ID          string         `json:"id"`
	ProjectID   string         `json:"project_id"`
	Name        string         `json:"name"`
	Description string         `json:"description,omitempty"`
	Type        string         `json:"type"`
	Config      map[string]any `json:"config,omitempty"`
	IsDefault   bool           `json:"is_default"`
	CreatedAt   time.Time      `json:"created_at"`
	UpdatedAt   time.Time      `json:"updated_at"`
}

type ListResponse struct {
	Items      []Skill `json:"items"`
	Total      int     `json:"total"`
	Page       int     `json:"page"`
	PageSize   int     `json:"page_size"`
	TotalPages int     `json:"total_pages"`
}

type Repository interface {
	List(ctx context.Context, projectID string, page, pageSize int) (ListResponse, error)
	Get(ctx context.Context, projectID, skillID string) (Skill, error)
	Create(ctx context.Context, projectID string, skill Skill) (Skill, error)
	Update(ctx context.Context, projectID, skillID string, skill Skill) (Skill, error)
	Delete(ctx context.Context, projectID, skillID string) error
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
	r.Get("/{skillID}", h.Get)
	r.Put("/{skillID}", h.Update)
	r.Delete("/{skillID}", h.Delete)
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
	skillID := chi.URLParam(r, "skillID")

	skill, err := h.repo.Get(r.Context(), projectID, skillID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, skill)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var skill Skill
	if err := json.NewDecoder(r.Body).Decode(&skill); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, skill)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	var skill Skill
	if err := json.NewDecoder(r.Body).Decode(&skill); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, skillID, skill)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")

	if err := h.repo.Delete(r.Context(), projectID, skillID); err != nil {
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
