package oapiserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

func (s *Server) ListApplications(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.ListApplicationsParams) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	limit := 20
	offset := 0
	if params.Limit != nil {
		limit = *params.Limit
	}
	if params.Offset != nil {
		offset = *params.Offset
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	page := (offset / limit) + 1

	search := r.URL.Query().Get("query")
	if search == "" {
		search = r.URL.Query().Get("search")
	}

	req := applications.ListRequest{
		ProjectID:  projectId,
		Page:       page,
		PageSize:   limit,
		Search:     search,
		Tags:       r.URL.Query().Get("tags"),
		FolderID:   r.URL.Query().Get("folder_id"),
		AgentsType: r.URL.Query().Get("agents_type"),
	}

	resp, err := s.appsRepo.List(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) CreateApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var req applications.CreateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectId

	app, err := s.appsRepo.Create(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, app)
}

func (s *Server) GetApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	app, err := s.appsRepo.Get(r.Context(), projectId, strconv.Itoa(applicationId))
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) EditApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, id int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var req applications.UpdateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}
	req.ProjectID = projectId
	req.ApplicationID = strconv.Itoa(id)

	app, err := s.appsRepo.Update(r.Context(), req)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, app)
}

func (s *Server) DeleteApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	if err := s.appsRepo.Delete(r.Context(), projectId, strconv.Itoa(applicationId)); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
