package applications

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type Handler struct {
	repo applications.Repository
}

func NewHandler(repo applications.Repository) *Handler {
	return &Handler{repo: repo}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.List)
	r.Post("/", h.Create)
	r.Get("/{applicationID}", h.Get)
	r.Put("/{applicationID}", h.Update)
	r.Delete("/{applicationID}", h.Delete)
	r.Get("/{applicationID}/versions", h.ListVersions)
	r.Get("/{applicationID}/versions/{versionID}", h.GetVersion)
	return r
}

func (h *Handler) GetDefaultVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	versions, err := h.repo.ListVersions(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	for _, v := range versions {
		if v.IsDefault {
			writeJSON(w, http.StatusOK, v)
			return
		}
	}

	if len(versions) > 0 {
		writeJSON(w, http.StatusOK, versions[0])
		return
	}

	apierr.Write(w, apierr.NotFound("no versions found"))
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

	req := applications.ListRequest{
		ProjectID: projectID,
		Page:      page,
		PageSize:  pageSize,
		Search:    r.URL.Query().Get("search"),
		Tags:      r.URL.Query().Get("tags"),
		FolderID:  r.URL.Query().Get("folder_id"),
	}

	resp, err := h.repo.List(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	app, err := h.repo.Get(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, app)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var req applications.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID

	app, err := h.repo.Create(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, app)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	var req applications.UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectID
	req.ApplicationID = applicationID

	app, err := h.repo.Update(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, app)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	if err := h.repo.Delete(r.Context(), projectID, applicationID); err != nil {
		apierr.Write(w, err)
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ListVersions(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	versions, err := h.repo.ListVersions(r.Context(), projectID, applicationID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": versions})
}

func (h *Handler) GetVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	version, err := h.repo.GetVersion(r.Context(), projectID, applicationID, versionID)
	if err != nil {
		apierr.Write(w, err)
		return
	}

	writeJSON(w, http.StatusOK, version)
}

func (h *Handler) CreateVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	var v applications.Version
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	ver, err := h.repo.CreateVersion(r.Context(), projectID, applicationID, v)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, ver)
}

func (h *Handler) UpdateVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	var v applications.Version
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	ver, err := h.repo.UpdateVersion(r.Context(), projectID, applicationID, versionID, v)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, ver)
}

func (h *Handler) DeleteVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")

	if err := h.repo.DeleteVersion(r.Context(), projectID, applicationID, versionID); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) SetDefaultVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")

	// UI sends PATCH with body {"version_id": 123}; fall back to URL path param for backward compat.
	versionID := chi.URLParam(r, "versionID")
	var body struct {
		VersionID string `json:"version_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err == nil && body.VersionID != "" {
		versionID = body.VersionID
	}

	if versionID == "" {
		apierr.Write(w, apierr.BadRequest("version_id is required"))
		return
	}

	if err := h.repo.SetDefaultVersion(r.Context(), projectID, applicationID, versionID); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) BatchReplaceVersion(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	oldVersionID := chi.URLParam(r, "oldVersionID")
	newVersionID := chi.URLParam(r, "newVersionID")
	deleteOld := r.URL.Query().Get("delete_old") == "true"

	if err := h.repo.BatchReplaceVersion(r.Context(), projectID, oldVersionID, newVersionID, deleteOld); err != nil {
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
