package oapiserver

import (
	"net/http"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

func (s *Server) ListTags(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.tagsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	tags, err := s.tagsRepo.List(r.Context(), projectId)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, tags)
}
