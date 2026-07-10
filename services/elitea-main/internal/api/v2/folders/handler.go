package folders

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Folder struct {
	ID        string    `json:"id"`
	ProjectID string    `json:"project_id"`
	Name      string    `json:"name"`
	ParentID  string    `json:"parent_id,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

type Repository interface {
	List(ctx context.Context, projectID string) ([]Folder, error)
	Create(ctx context.Context, projectID string, folder Folder) (Folder, error)
	Update(ctx context.Context, projectID, folderID string, folder Folder) (Folder, error)
	Delete(ctx context.Context, projectID, folderID string) error
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
	r.Put("/{folderID}", h.Update)
	r.Patch("/{folderID}", h.Update)
	r.Delete("/{folderID}", h.Delete)
	return r
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	folders, err := h.repo.List(r.Context(), projectID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": folders})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folders, err := h.repo.List(r.Context(), projectID)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	folderID := chi.URLParam(r, "folderID")
	for _, f := range folders {
		if f.ID == folderID {
			writeJSON(w, http.StatusOK, f)
			return
		}
	}
	apierr.Write(w, apierr.NotFound("folder not found"))
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var folder Folder
	if err := json.NewDecoder(r.Body).Decode(&folder); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := h.repo.Create(r.Context(), projectID, folder)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folderID := chi.URLParam(r, "folderID")

	// PATCH: partial merge — fetch existing folder, apply only provided fields.
	if r.Method == http.MethodPatch {
		folders, err := h.repo.List(r.Context(), projectID)
		if err != nil {
			apierr.Write(w, err)
			return
		}
		var existing *Folder
		for i := range folders {
			if folders[i].ID == folderID {
				existing = &folders[i]
				break
			}
		}
		if existing == nil {
			apierr.Write(w, apierr.NotFound("folder not found"))
			return
		}

		var patch map[string]any
		if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
			apierr.Write(w, apierr.BadRequest("invalid request body"))
			return
		}
		if name, ok := patch["name"].(string); ok {
			existing.Name = name
		}
		if parentID, ok := patch["parent_id"].(string); ok {
			existing.ParentID = parentID
		}

		updated, err := h.repo.Update(r.Context(), projectID, folderID, *existing)
		if err != nil {
			apierr.Write(w, err)
			return
		}
		writeJSON(w, http.StatusOK, updated)
		return
	}

	// PUT: full replacement.
	var folder Folder
	if err := json.NewDecoder(r.Body).Decode(&folder); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := h.repo.Update(r.Context(), projectID, folderID, folder)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	folderID := chi.URLParam(r, "folderID")

	if err := h.repo.Delete(r.Context(), projectID, folderID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
