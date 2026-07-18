package oapiserver

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
)

func (s *Server) PublishApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}
	schema := fmt.Sprintf("p_%s", projectId)
	q := fmt.Sprintf(`UPDATE %q.application_versions SET status = 'published' WHERE id = $1`, schema)
	s.pool.Exec(r.Context(), q, versionId)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) UnpublishApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}
	schema := fmt.Sprintf("p_%s", projectId)
	q := fmt.Sprintf(`UPDATE %q.application_versions SET status = 'draft' WHERE id = $1`, schema)
	s.pool.Exec(r.Context(), q, versionId)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Server) ValidateForPublish(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}
	schema := fmt.Sprintf("p_%s", projectId)
	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1)`, schema)
	var exists bool
	s.pool.QueryRow(r.Context(), q, versionId).Scan(&exists)
	writeJSON(w, http.StatusOK, map[string]any{"valid": exists})
}

func (s *Server) ForkAgent(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body struct {
		ApplicationID   int    `json:"application_id"`
		TargetProjectID string `json:"target_project_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	ctx := r.Context()
	srcSchema := fmt.Sprintf("p_%s", projectId)
	dstSchema := fmt.Sprintf("p_%s", body.TargetProjectID)

	// Copy application
	var newAppID int
	err := s.pool.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %q.applications (name, description, type, created_at)
		SELECT name || ' (fork)', description, type, NOW()
		FROM %q.applications WHERE id = $1
		RETURNING id`, dstSchema, srcSchema), body.ApplicationID).Scan(&newAppID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to fork application"})
		return
	}

	// Copy versions
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, prompt, status FROM %q.application_versions WHERE application_id = $1 ORDER BY created_at`, srcSchema), body.ApplicationID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var srcVersionID int
			var name, status string
			var prompt []byte
			rows.Scan(&srcVersionID, &name, &prompt, &status)

			var newVersionID int
			s.pool.QueryRow(ctx, fmt.Sprintf(`
				INSERT INTO %q.application_versions (application_id, name, prompt, status, created_at)
				VALUES ($1, $2, $3, 'draft', NOW()) RETURNING id`, dstSchema),
				newAppID, name, prompt).Scan(&newVersionID)

			// Copy skill mappings
			s.pool.Exec(ctx, fmt.Sprintf(`
				INSERT INTO %q.entity_skill_mapping (entity_version_id, skill_id, skill_version_id)
				SELECT $1, skill_id, skill_version_id
				FROM %q.entity_skill_mapping WHERE entity_version_id = $2`, dstSchema, srcSchema),
				newVersionID, srcVersionID)

			// Copy tool mappings
			s.pool.Exec(ctx, fmt.Sprintf(`
				INSERT INTO %q.entity_tool_mapping (entity_version_id, tool_id)
				SELECT $1, tool_id
				FROM %q.entity_tool_mapping WHERE entity_version_id = $2`, dstSchema, srcSchema),
				newVersionID, srcVersionID)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "id": newAppID})
}

func (s *Server) ExportApplication(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, id int, params generated.ExportApplicationParams) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)

	var name, desc, appType string
	err := s.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, ''), COALESCE(type, 'agent')
		FROM %q.applications WHERE id = $1`, schema), id).Scan(&name, &desc, &appType)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "application not found"})
		return
	}

	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, COALESCE(prompt::text, '{}'), status
		FROM %q.application_versions WHERE application_id = $1
		ORDER BY created_at`, schema), id)

	var versions []map[string]any
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var vID int
			var vName, prompt, status string
			rows.Scan(&vID, &vName, &prompt, &status)
			var promptObj any
			json.Unmarshal([]byte(prompt), &promptObj)
			versions = append(versions, map[string]any{
				"id": vID, "name": vName, "prompt": promptObj, "status": status,
			})
		}
	}
	if versions == nil {
		versions = []map[string]any{}
	}

	result := map[string]any{
		"ok": true,
		"applications": []map[string]any{{
			"id": id, "name": name, "description": desc, "type": appType,
			"versions": versions,
		}},
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) ConvertLegacyApplication(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "cannot read body"})
		return
	}
	var payload any
	if json.Unmarshal(body, &payload) != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid JSON"})
		return
	}
	writeJSON(w, http.StatusOK, payload)
}

func (s *Server) ImportWizard(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body struct {
		Applications []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Type        string `json:"type"`
			Versions    []struct {
				Name   string `json:"name"`
				Prompt any    `json:"prompt"`
			} `json:"versions"`
		} `json:"applications"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)

	var imported []map[string]any
	for _, app := range body.Applications {
		appType := app.Type
		if appType == "" {
			appType = "agent"
		}

		var newID int
		err := s.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.applications (name, description, type, created_at)
			VALUES ($1, $2, $3, NOW()) RETURNING id`, schema),
			app.Name, app.Description, appType).Scan(&newID)
		if err != nil {
			continue
		}

		for _, v := range app.Versions {
			promptBytes, _ := json.Marshal(v.Prompt)
			s.pool.Exec(ctx, fmt.Sprintf(`
				INSERT INTO %q.application_versions (application_id, name, prompt, status, created_at)
				VALUES ($1, $2, $3, 'draft', NOW())`, schema),
				newID, v.Name, promptBytes)
		}

		imported = append(imported, map[string]any{"id": newID, "name": app.Name})
	}
	if imported == nil {
		imported = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "imported": imported})
}

func (s *Server) GenerateAgentDraft(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.predictor == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	var body struct {
		Prompt string `json:"prompt"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	resp, err := s.predictor.Predict(r.Context(), predict.Request{
		ProjectID: projectId,
		Input:     body.Prompt,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) GetPublicApplication(w http.ResponseWriter, r *http.Request, applicationId int, versionName string) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	ctx := r.Context()

	// Get project_id from published_apps
	var projectID int
	err := s.pool.QueryRow(ctx,
		`SELECT project_id FROM centry.published_apps WHERE application_id = $1 LIMIT 1`,
		applicationId).Scan(&projectID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "application not found"})
		return
	}

	schema := fmt.Sprintf("p_%s", strconv.Itoa(projectID))

	var appName, appDesc string
	s.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, '') FROM %q.applications WHERE id = $1`, schema),
		applicationId).Scan(&appName, &appDesc)

	var versionID int
	var prompt string
	s.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, COALESCE(prompt::text, '{}')
		FROM %q.application_versions
		WHERE application_id = $1 AND name = $2 AND status = 'published' LIMIT 1`, schema),
		applicationId, versionName).Scan(&versionID, &prompt)

	var promptObj any
	json.Unmarshal([]byte(prompt), &promptObj)

	writeJSON(w, http.StatusOK, map[string]any{
		"id": applicationId, "name": appName, "description": appDesc,
		"version": map[string]any{"id": versionID, "name": versionName, "prompt": promptObj},
	})
}

func (s *Server) ListPublicApplications(w http.ResponseWriter, r *http.Request, params generated.ListPublicApplicationsParams) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	rows, err := s.pool.Query(ctx, `
		SELECT pa.application_id, pa.project_id, p.name as project_name
		FROM centry.published_apps pa
		JOIN centry.project p ON p.id = pa.project_id
		ORDER BY pa.id LIMIT 50`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var appID, projID int
		var projName string
		rows.Scan(&appID, &projID, &projName)
		items = append(items, map[string]any{
			"id": appID, "project_id": projID, "project_name": projName,
		})
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": len(items)})
}

func (s *Server) ListPublicSkills(w http.ResponseWriter, r *http.Request, params generated.ListPublicSkillsParams) {
	writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
}

func (s *Server) CreatePublicSkill(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": false, "error": "public skills not yet supported"})
}
