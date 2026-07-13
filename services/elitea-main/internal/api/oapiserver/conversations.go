package oapiserver

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// PatchEntitySettings handles PATCH /elitea_core/entity_settings/prompt_lib/{project_id}/{conversation_id}
// It performs a partial (patch) update of entity settings for a conversation.
func (s *Server) PatchEntitySettings(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, conversationId int) {
	if s.convsRepo == nil {
		// TODO: wire ConvsRepo in Config to enable this endpoint
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body []map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	if err := s.convsRepo.BatchUpdateEntitySettings(r.Context(), projectId, strconv.Itoa(conversationId), body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ReplaceEntitySettings handles PUT /elitea_core/entity_settings/prompt_lib/{project_id}/{conversation_id}
// It performs a full replacement of entity settings for a conversation.
func (s *Server) ReplaceEntitySettings(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, conversationId int) {
	if s.convsRepo == nil {
		// TODO: wire ConvsRepo in Config to enable this endpoint
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body []map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	if err := s.convsRepo.BatchUpdateEntitySettings(r.Context(), projectId, strconv.Itoa(conversationId), body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// PatchParticipantSettings handles PATCH /elitea_core/entity_settings/prompt_lib/{project_id}/{conversation_id}/{participant_id}
// It performs a partial (patch) update of settings for a specific participant in a conversation.
func (s *Server) PatchParticipantSettings(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, conversationId int, participantId int) {
	if s.convsRepo == nil {
		// TODO: wire ConvsRepo in Config to enable this endpoint
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	if err := s.convsRepo.UpdateEntitySettings(r.Context(), projectId, strconv.Itoa(conversationId), strconv.Itoa(participantId), body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ReplaceParticipantSettings handles PUT /elitea_core/entity_settings/prompt_lib/{project_id}/{conversation_id}/{participant_id}
// It performs a full replacement of settings for a specific participant in a conversation.
func (s *Server) ReplaceParticipantSettings(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, conversationId int, participantId int) {
	if s.convsRepo == nil {
		// TODO: wire ConvsRepo in Config to enable this endpoint
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	if err := s.convsRepo.UpdateEntitySettings(r.Context(), projectId, strconv.Itoa(conversationId), strconv.Itoa(participantId), body); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
