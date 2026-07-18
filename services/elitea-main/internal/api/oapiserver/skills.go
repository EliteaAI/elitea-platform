package oapiserver

import (
	"encoding/json"
	"net/http"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

func (s *Server) ListSkills(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.ListSkillsParams) {
	if s.skillsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	page := 1
	pageSize := 20
	if params.Limit != nil && *params.Limit > 0 {
		pageSize = *params.Limit
	}
	if params.Offset != nil && *params.Offset > 0 && pageSize > 0 {
		page = (*params.Offset / pageSize) + 1
	}
	if pageSize > 100 {
		pageSize = 100
	}

	resp, err := s.skillsRepo.List(r.Context(), projectId, page, pageSize)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) CreateSkill(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.skillsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var skill skills.Skill
	if err := json.NewDecoder(r.Body).Decode(&skill); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := s.skillsRepo.Create(r.Context(), projectId, skill)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}
