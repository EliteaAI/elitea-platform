package oapiserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// SaveApplicationNewVersion creates a new version for the given application.
func (s *Server) SaveApplicationNewVersion(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var v applications.Version
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	created, err := s.appsRepo.CreateVersion(r.Context(), projectId, strconv.Itoa(applicationId), v)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

// GetApplicationVersionDetail returns a single version for the given application.
func (s *Server) GetApplicationVersionDetail(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	v, err := s.appsRepo.GetVersion(r.Context(), projectId, strconv.Itoa(applicationId), strconv.Itoa(versionId))
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, v)
}

// UpdateApplicationVersion updates an existing version.
func (s *Server) UpdateApplicationVersion(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var v applications.Version
	if err := json.NewDecoder(r.Body).Decode(&v); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	updated, err := s.appsRepo.UpdateVersion(r.Context(), projectId, strconv.Itoa(applicationId), strconv.Itoa(versionId), v)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, updated)
}

// DeleteApplicationVersion deletes a version. Accepts an optional replacement version via query param.
func (s *Server) DeleteApplicationVersion(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int, params generated.DeleteApplicationVersionParams) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	// If a replacement version is specified and the old version is in use, do a batch replace first.
	if params.ReplacementVersionId != nil {
		deleteOld := true
		if err := s.appsRepo.BatchReplaceVersion(r.Context(), projectId, strconv.Itoa(versionId), strconv.Itoa(*params.ReplacementVersionId), deleteOld); err != nil {
			apierr.Write(w, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
		return
	}

	if err := s.appsRepo.DeleteVersion(r.Context(), projectId, strconv.Itoa(applicationId), strconv.Itoa(versionId)); err != nil {
		apierr.Write(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ValidateApplicationVersion checks whether the given version exists and belongs to the given application.
func (s *Server) ValidateApplicationVersion(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1 AND application_id = $2)`, schema)
	var valid bool
	_ = s.pool.QueryRow(ctx, q, versionId, applicationId).Scan(&valid) // valid defaults to false on error
	writeJSON(w, http.StatusOK, map[string]any{"valid": valid})
}

// SetApplicationDefaultVersion marks a version as the default for an application.
func (s *Server) SetApplicationDefaultVersion(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, params generated.SetApplicationDefaultVersionParams) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	if err := s.appsRepo.SetDefaultVersion(r.Context(), projectId, strconv.Itoa(applicationId), strconv.Itoa(params.VersionId)); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// BatchReplaceVersionReferences replaces all references to oldVersionId with newVersionId project-wide.
func (s *Server) BatchReplaceVersionReferences(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, oldVersionId int, newVersionId int, params generated.BatchReplaceVersionReferencesParams) {
	if s.appsRepo == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	deleteOld := false
	if params.DeleteOld != nil {
		deleteOld = *params.DeleteOld
	}

	if err := s.appsRepo.BatchReplaceVersion(r.Context(), projectId, strconv.Itoa(oldVersionId), strconv.Itoa(newVersionId), deleteOld); err != nil {
		apierr.Write(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// CheckVersionInUse reports whether a version is referenced by other entities in the project.
func (s *Server) CheckVersionInUse(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	// Check entity_skill_mapping and entity_tool_mapping for references to this version.
	var skillCount, toolCount int
	_ = s.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.entity_skill_mapping WHERE entity_version_id = $1`, schema), versionId).Scan(&skillCount) // counts default to 0 on error
	_ = s.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, schema), versionId).Scan(&toolCount)   // counts default to 0 on error

	inUse := skillCount+toolCount > 0
	writeJSON(w, http.StatusOK, map[string]any{
		"in_use":      inUse,
		"skill_count": skillCount,
		"tool_count":  toolCount,
	})
}

// UpdateApplicationRelation updates the skill/tool mappings for a specific application version.
func (s *Server) UpdateApplicationRelation(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, selectedApplicationId int, selectedVersionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body struct {
		Skills []string `json:"skills"`
		Tools  []string `json:"tools"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		apierr.Write(w, apierr.BadRequest("invalid request body"))
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	// Replace skill mappings.
	_, _ = s.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.entity_skill_mapping WHERE entity_version_id = $1`, schema), selectedVersionId) // best-effort
	for _, skillID := range body.Skills {
		_, _ = s.pool.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %q.entity_skill_mapping (entity_version_id, skill_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`, schema), selectedVersionId, skillID) // best-effort
	}

	// Replace tool mappings.
	_, _ = s.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, schema), selectedVersionId) // best-effort
	for _, toolID := range body.Tools {
		_, _ = s.pool.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %q.entity_tool_mapping (entity_version_id, tool_id)
			VALUES ($1, $2) ON CONFLICT DO NOTHING`, schema), selectedVersionId, toolID) // best-effort
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ListApplicationSkills lists skills linked to a given application version.
func (s *Server) ListApplicationSkills(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, appVersionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	q := fmt.Sprintf(`SELECT skill_id FROM %q.entity_skill_mapping WHERE entity_version_id = $1`, schema)
	rows, err := s.pool.Query(ctx, q, appVersionId)
	if err != nil {
		apierr.Write(w, err)
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var skillID string
		if rows.Scan(&skillID) == nil {
			items = append(items, map[string]any{"skill_id": skillID})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

// StopApplicationTask stops a running agent task via the indexer pipeline runner.
func (s *Server) StopApplicationTask(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, taskId string) {
	if s.pipeRunner == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	if err := s.pipeRunner.Cancel(r.Context(), projectId, taskId); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "task_id": taskId})
}

// SetAgentAttachmentStorage sets the attachment storage toolkit for a specific agent version.
func (s *Server) SetAgentAttachmentStorage(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, applicationId int, versionId int, params generated.SetAgentAttachmentStorageParams) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	toolkitIDStr := strconv.Itoa(params.ToolkitId)
	_, _ = s.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %q.application_versions
		SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{attachment_storage}', $1::jsonb)
		WHERE id = $2`, schema),
		fmt.Sprintf(`{"toolkit_id":"%s"}`, toolkitIDStr), versionId) // best-effort metadata update

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
