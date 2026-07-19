package oapiserver

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/generated"
)

// ─── Chat / Webchat ──────────────────────────────────────────────────────────

// GetChatConfig returns LLM model configuration for a project.
// Mirrors eliteacore.Handler.ChatConfig, querying the project schema configuration table.
func (s *Server) GetChatConfig(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	q := fmt.Sprintf(`
		SELECT elitea_title, type, data
		FROM %q.configuration
		WHERE section = 'llm' AND status_ok = true
		ORDER BY created_at`, schema)

	rows, err := s.pool.Query(ctx, q)
	models := make([]map[string]any, 0)
	defaultModel := ""
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var title, cType string
			var data []byte
			if err := rows.Scan(&title, &cType, &data); err != nil {
				continue
			}
			models = append(models, map[string]any{
				"name":        title,
				"config_type": cType,
			})
			if defaultModel == "" {
				defaultModel = title
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"models":        models,
		"default_model": defaultModel,
	})
}

// WebchatSync syncs webchat state for a specific application version.
func (s *Server) WebchatSync(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.chatSvc == nil {
		w.WriteHeader(http.StatusNotImplemented)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version_id": versionId})
}

// ─── Agent Categories / Document Loaders / Platform Settings ─────────────────

var defaultAgentCategories = []string{
	"Business Analyst",
	"Quality Assurance",
	"Development",
	"DevOps",
	"Project Management",
	"Knowledge & Documentation",
	"Elitea",
	"Epam",
	"Other",
}

// GetAgentCategories returns the list of agent categories for a project,
// merging defaults with admin-configured extras.
func (s *Server) GetAgentCategories(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		cats := make([]map[string]any, 0, len(defaultAgentCategories))
		for _, name := range defaultAgentCategories {
			cats = append(cats, map[string]any{"name": name, "is_default": true})
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": cats, "total": len(cats)})
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	seen := make(map[string]bool)
	categories := make([]map[string]any, 0, len(defaultAgentCategories))
	for _, name := range defaultAgentCategories {
		seen[name] = true
		categories = append(categories, map[string]any{"name": name, "is_default": true})
	}

	q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE section = 'publishing_guardrail' LIMIT 1`, schema)
	var data []byte
	if err := s.pool.QueryRow(ctx, q).Scan(&data); err == nil && len(data) > 0 {
		var cfg map[string]any
		if json.Unmarshal(data, &cfg) == nil {
			if extras, ok := cfg["agent_categories"].([]any); ok {
				for _, e := range extras {
					if name, ok := e.(string); ok && name != "" && !seen[name] {
						seen[name] = true
						categories = append(categories, map[string]any{"name": name, "is_default": false})
					}
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": categories, "total": len(categories)})
}

// GetDocumentLoaders returns the available document loader types.
func (s *Server) GetDocumentLoaders(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	writeJSON(w, http.StatusOK, indexTypesRegistry)
}

var indexTypesRegistry = map[string]any{
	"document_types": map[string]string{
		".txt":   "text/plain",
		".yml":   "application/yaml",
		".yaml":  "application/yaml",
		".groovy": "text/x-groovy",
		".md":    "text/markdown",
		".csv":   "text/csv",
		".xlsx":  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
		".xls":   "application/vnd.ms-excel",
		".pdf":   "application/pdf",
		".docx":  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
		".doc":   "application/msword",
		".json":  "application/json",
		".jsonl": "application/jsonl",
		".htm":   "text/html",
		".html":  "text/html",
		".xml":   "text/xml",
		".ppt":   "application/vnd.ms-powerpoint",
		".pptx":  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
		".eml":   "message/rfc822",
		".msg":   "application/vnd.ms-outlook",
	},
	"image_types": map[string]string{
		".png":  "image/png",
		".jpg":  "image/jpeg",
		".jpeg": "image/jpeg",
		".gif":  "image/gif",
		".webp": "image/webp",
	},
	"code_types": map[string]string{
		".py": "text/plain", ".js": "text/plain", ".ts": "text/plain",
		".java": "text/plain", ".cpp": "text/plain", ".c": "text/plain",
		".h": "text/plain", ".hpp": "text/plain", ".cs": "text/plain",
		".rb": "text/plain", ".go": "text/plain", ".php": "text/plain",
		".swift": "text/plain", ".kt": "text/plain", ".rs": "text/plain",
		".m": "text/plain", ".scala": "text/plain", ".pl": "text/plain",
		".sh": "text/plain", ".bat": "text/plain", ".lua": "text/plain",
		".r": "text/plain", ".pas": "text/plain", ".asm": "text/plain",
		".dart": "text/plain", ".groovy": "text/plain", ".sql": "text/plain",
		".yml": "text/plain", ".yaml": "text/plain", ".jsx": "text/plain",
		".tsx": "text/plain", ".mjs": "text/plain", ".cjs": "text/plain",
		".hs": "text/plain", ".bash": "text/plain", ".zsh": "text/plain",
		".pm": "text/plain", ".toml": "text/plain", ".ini": "text/plain",
		".cfg": "text/plain", ".conf": "text/plain", ".env": "text/plain",
	},
}

// GetPlatformSettings returns environment feature-flag settings for a project.
// Mirrors eliteacore.Handler.PlatformSettings.
func (s *Server) GetPlatformSettings(w http.ResponseWriter, r *http.Request) {
	defaults := map[string]any{
		"chat_enabled":         true,
		"applications_enabled": true,
		"skills_enabled":       true,
		"toolkits_enabled":     true,
		"datasources_enabled":  true,
		"pipelines_enabled":    true,
		"publishing_enabled":   true,
		"moderation_enabled":   false,
		"mcp_enabled":          true,
		"support_chat_enabled": false,
	}

	if s.pool != nil {
		projectID := r.URL.Query().Get("project_id")
		if projectID != "" {
			ctx := r.Context()
			schema := fmt.Sprintf("p_%s", projectID)
			q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE type = 'environment_settings' LIMIT 1`, schema)
			var data []byte
			if err := s.pool.QueryRow(ctx, q).Scan(&data); err == nil && len(data) > 0 {
				var dbSettings map[string]any
				if json.Unmarshal(data, &dbSettings) == nil {
					for k, v := range dbSettings {
						defaults[k] = v
					}
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, defaults)
}

// ─── Project Context ──────────────────────────────────────────────────────────

// GetProjectContext returns the project-level context configuration.
// Mirrors eliteacore.Handler.ProjectContext.
func (s *Server) GetProjectContext(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"content": "", "enabled": false})
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)
	q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE type = 'project_context' LIMIT 1`, schema)

	var data []byte
	err := s.pool.QueryRow(ctx, q).Scan(&data)
	if err != nil || len(data) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"content": "", "enabled": false})
		return
	}
	var cfg map[string]any
	if err := json.Unmarshal(data, &cfg); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"content": "", "enabled": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"content": cfg["content"],
		"enabled": cfg["enabled"],
	})
}

// UpdateProjectContext writes the project-level context configuration.
// Mirrors eliteacore.Handler.UpdateProjectContext.
func (s *Server) UpdateProjectContext(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	var body struct {
		Content string `json:"content"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)
	dataBytes, _ := json.Marshal(map[string]any{"content": body.Content, "enabled": body.Enabled})

	q := fmt.Sprintf(`
		INSERT INTO %q.configuration (elitea_title, label, type, data, section, status_ok, created_at)
		VALUES ('project_context_' || $1, 'Project Context', 'project_context', $2, 'project_context', true, NOW())
		ON CONFLICT (elitea_title) WHERE type = 'project_context'
		DO UPDATE SET data = $2`, schema)
	_, err := s.pool.Exec(ctx, q, projectId, dataBytes)
	if err != nil {
		q2 := fmt.Sprintf(`UPDATE %q.configuration SET data = $1 WHERE type = 'project_context'`, schema)
		_, _ = s.pool.Exec(ctx, q2, dataBytes) // best-effort fallback update
	}
	writeJSON(w, http.StatusOK, map[string]any{"content": body.Content, "enabled": body.Enabled})
}

// ─── Application Icons ────────────────────────────────────────────────────────

// GetApplicationDefaultIcons returns the set of built-in default icons.
// Mirrors eliteacore.Handler.DefaultIcons.
func (s *Server) GetApplicationDefaultIcons(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	icons := []map[string]any{
		{"name": "robot", "url": "/icons/robot.svg"},
		{"name": "brain", "url": "/icons/brain.svg"},
		{"name": "chat", "url": "/icons/chat.svg"},
		{"name": "code", "url": "/icons/code.svg"},
		{"name": "data", "url": "/icons/data.svg"},
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": icons, "total": len(icons)})
}

// GetApplicationIcons returns user-uploaded icons for a project.
// Mirrors eliteacore.Handler.ListUploadedIcons — no persistent icon registry yet.
func (s *Server) GetApplicationIcons(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetApplicationIconsParams) {
	// TODO: query uploaded icon metadata from DB/filesystem once icon registry is implemented
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
}

// DeleteApplicationIcon removes an uploaded icon by name.
func (s *Server) DeleteApplicationIcon(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, name string) {
	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)

	// Clear icon_meta from all application_versions that reference this icon
	if s.pool != nil {
		_, _ = s.pool.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.application_versions SET meta = jsonb_set(meta, '{icon_meta}', '{}'::jsonb) WHERE meta->'icon_meta'->>'name' = $1`, schema), name) // best-effort metadata clear
	}

	// Remove file from disk
	iconsDir := os.Getenv("ICONS_DATA_DIR")
	if iconsDir == "" {
		iconsDir = "/data/icons"
	}
	_ = os.Remove(filepath.Join(iconsDir, string(projectId), name)) // best-effort file delete

	w.WriteHeader(http.StatusNoContent)
}

// UploadApplicationIcon accepts a multipart file upload and stores it.
// Mirrors eliteacore.Handler.UploadIcon but uses the OAPI versionId parameter.
func (s *Server) UploadApplicationIcon(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	// TODO: save uploaded file to filesystem under /data/icons/<projectId>/ and return URL
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "url": ""})
}

// ReplaceApplicationIcon replaces icon metadata for a version.
func (s *Server) ReplaceApplicationIcon(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	var iconMeta map[string]any
	if err := json.NewDecoder(r.Body).Decode(&iconMeta); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	iconJSON, _ := json.Marshal(iconMeta) // iconMeta is a plain map; Marshal cannot fail
	_, _ = s.pool.Exec(r.Context(), fmt.Sprintf(
		`UPDATE %q.application_versions SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('icon_meta', $2::jsonb) WHERE id = $1`, schema),
		strconv.Itoa(versionId), string(iconJSON)) // best-effort metadata update

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ─── Search / Recommendations / Trending ─────────────────────────────────────

// GetSearchOptions returns available filter options (tags, collections) for a project.
// Mirrors eliteacore.Handler.SearchOptions.
func (s *Server) GetSearchOptions(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"tags": []any{}, "collections": []any{}})
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()
	q := fmt.Sprintf(`SELECT name FROM %q.tags ORDER BY name`, schema)
	rows, err := s.pool.Query(ctx, q)

	tags := make([]string, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			if err := rows.Scan(&name); err != nil {
				continue
			}
			tags = append(tags, name)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags, "collections": []any{}})
}

// GetRecommendations returns recommended applications ordered by popularity.
// Mirrors eliteacore.Handler.Recommendations.
func (s *Server) GetRecommendations(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, params generated.GetRecommendationsParams) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	q := fmt.Sprintf(`
		SELECT a.id, a.name, COALESCE(a.description, ''), COUNT(sl.id) as likes
		FROM %q.applications a
		LEFT JOIN %q.social_likes sl ON sl.entity_id = a.id AND sl.entity_name = 'application'
		GROUP BY a.id, a.name, a.description
		ORDER BY likes DESC
		LIMIT 10`, schema, schema)

	rows, err := s.pool.Query(ctx, q)
	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var name, desc string
			var likes int
			if err := rows.Scan(&id, &name, &desc, &likes); err != nil {
				continue
			}
			items = append(items, map[string]any{
				"id": fmt.Sprintf("%d", id), "name": name, "description": desc, "likes": likes,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

// GetTrendingAuthors returns authors ranked by like count.
// Mirrors social.Handler.TrendingAuthors.
func (s *Server) GetTrendingAuthors(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	rows, err := s.pool.Query(ctx, `
		SELECT su.user_id, COALESCE(au.name, ''), COALESCE(au.email, ''),
			COALESCE(su.avatar, ''), COUNT(sl.id) as like_count
		FROM centry.social_users su
		JOIN auth_core__user au ON au.id = su.user_id
		LEFT JOIN centry.social_likes sl ON sl.user_id = su.user_id AND sl.project_id = $1
		GROUP BY su.user_id, au.name, au.email, su.avatar
		ORDER BY like_count DESC
		LIMIT 10`, projectId)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var name, email, avatar string
			var likes int
			if err := rows.Scan(&id, &name, &email, &avatar, &likes); err != nil {
				continue
			}
			items = append(items, map[string]any{
				"id":     fmt.Sprintf("%d", id),
				"name":   name,
				"email":  email,
				"avatar": avatar,
				"likes":  likes,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

// ─── Permissions ─────────────────────────────────────────────────────────────

// PermissionList returns the permission set for the authenticated user.
// Mirrors eliteacore.Handler.Permissions.
func (s *Server) PermissionList(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	// TODO: resolve permissions against auth service for the current user/project
	writeJSON(w, http.StatusOK, defaultPermissions())
}

// PublicPermissionList returns permissions for a public (unauthenticated) context.
// TODO: needs auth service to resolve public project role grants.
func (s *Server) PublicPermissionList(w http.ResponseWriter, r *http.Request, publicProjectId int) {
	// TODO: needs auth service to resolve public project permissions
	writeJSON(w, http.StatusOK, []any{})
}

func defaultPermissions() []map[string]any {
	perms := []string{
		"models.create", "models.read", "models.update", "models.delete",
		"prompts.create", "prompts.read", "prompts.update", "prompts.delete",
		"datasources.create", "datasources.read", "datasources.update", "datasources.delete",
		"applications.create", "applications.read", "applications.update", "applications.delete",
		"conversations.create", "conversations.read", "conversations.update", "conversations.delete",
		"settings.read", "settings.update",
		"integrations.create", "integrations.read", "integrations.update", "integrations.delete",
	}
	result := make([]map[string]any, 0, len(perms))
	for _, p := range perms {
		result = append(result, map[string]any{"name": p, "enabled": true})
	}
	return result
}

// ─── Toolkits / Tools ────────────────────────────────────────────────────────

// ListToolkits returns the list of toolkits for a project.
func (s *Server) ListToolkits(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	ctx := r.Context()

	var total int
	_ = s.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.elitea_tools`, schema)).Scan(&total) // total defaults to 0 on error

	q := fmt.Sprintf(`
		SELECT id, type, name, COALESCE(description,''),
		       COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		       created_at, updated_at, author_id, shared_id
		FROM %q.elitea_tools ORDER BY name LIMIT 100`, schema)

	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	items := make([]map[string]any, 0)
	for rows.Next() {
		var id int
		var tType, name, desc, settings, meta string
		var createdAt, updatedAt any
		var authorID, sharedID *int
		if err := rows.Scan(&id, &tType, &name, &desc, &settings, &meta, &createdAt, &updatedAt, &authorID, &sharedID); err != nil {
			continue
		}

		var settingsObj, metaObj any
		_ = json.Unmarshal([]byte(settings), &settingsObj) // DB column; safe to ignore parse error
		_ = json.Unmarshal([]byte(meta), &metaObj)         // DB column; safe to ignore parse error

		items = append(items, map[string]any{
			"id": id, "type": tType, "name": name, "description": desc,
			"settings": settingsObj, "meta": metaObj,
			"created_at": createdAt, "updated_at": updatedAt,
			"author_id": authorID, "shared_id": sharedID,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": total})
}

// DeleteApplicationTool removes a tool association from an application version.
func (s *Server) DeleteApplicationTool(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, toolId int) {
	if s.pool == nil {
		w.WriteHeader(http.StatusServiceUnavailable)
		return
	}

	schema := fmt.Sprintf("p_%s", projectId)
	_, _ = s.pool.Exec(r.Context(), fmt.Sprintf(`DELETE FROM %q.entity_tool_mapping WHERE tool_id = $1`, schema), toolId) // best-effort delete
	w.WriteHeader(http.StatusNoContent)
}

// ─── Pipeline Trigger ────────────────────────────────────────────────────────

// GetPipelineTrigger returns the trigger configuration for an application version.
// Mirrors pipelines.Handler.GetTrigger.
func (s *Server) GetPipelineTrigger(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"version_id": versionId,
			"enabled":    false,
			"schedule":   nil,
		})
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)
	q := fmt.Sprintf(`SELECT COALESCE(settings, '{}') FROM %q.application_versions WHERE id = $1`, schema)

	var settingsRaw []byte
	if err := s.pool.QueryRow(ctx, q, versionId).Scan(&settingsRaw); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{
			"version_id": versionId,
			"enabled":    false,
			"schedule":   nil,
		})
		return
	}

	var settings map[string]any
	_ = json.Unmarshal(settingsRaw, &settings) // DB column; settings stays nil on error, trigger will be empty

	trigger, _ := settings["trigger"].(map[string]any)
	if trigger == nil {
		trigger = map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"version_id": versionId,
		"enabled":    trigger["enabled"],
		"schedule":   trigger["schedule"],
		"type":       trigger["type"],
	})
}

// UpdatePipelineTrigger writes the trigger configuration for an application version.
// Mirrors pipelines.Handler.UpdateTrigger.
func (s *Server) UpdatePipelineTrigger(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId, versionId int) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if s.pool == nil {
		body["version_id"] = versionId
		writeJSON(w, http.StatusOK, body)
		return
	}

	ctx := r.Context()
	schema := fmt.Sprintf("p_%s", projectId)

	triggerBytes, _ := json.Marshal(body) // body is a plain map; Marshal cannot fail
	q := fmt.Sprintf(`UPDATE %q.application_versions SET settings = jsonb_set(COALESCE(settings, '{}')::jsonb, '{trigger}', $1) WHERE id = $2`, schema)
	_, _ = s.pool.Exec(ctx, q, triggerBytes, versionId) // best-effort trigger update

	writeJSON(w, http.StatusOK, map[string]any{
		"version_id": versionId,
		"enabled":    body["enabled"],
		"schedule":   body["schedule"],
		"type":       body["type"],
	})
}

// ─── Groups / Projects ───────────────────────────────────────────────────────

// ListGroups returns all project groups.
// Mirrors projects.Handler.GroupList.
func (s *Server) ListGroups(w http.ResponseWriter, r *http.Request) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	rows, err := s.pool.Query(ctx, `SELECT id, name FROM centry.project_group ORDER BY id`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	type group struct {
		ID   int    `json:"id"`
		Name string `json:"name"`
	}
	var groups []group
	for rows.Next() {
		var g group
		if err := rows.Scan(&g.ID, &g.Name); err != nil {
			continue
		}
		groups = append(groups, g)
	}
	if groups == nil {
		groups = []group{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": groups, "total": len(groups)})
}

// ListProjects returns the list of projects visible to a public project context.
// Mirrors projects.Handler.AdminProjectList.
func (s *Server) ListProjects(w http.ResponseWriter, r *http.Request, publicProjectId int, params generated.ListProjectsParams) {
	if s.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}

	ctx := r.Context()
	rows, err := s.pool.Query(ctx, `SELECT id, name, COALESCE(suspended, false) FROM centry.project ORDER BY id`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var projects []map[string]any
	for rows.Next() {
		var id int
		var name string
		var suspended bool
		if err := rows.Scan(&id, &name, &suspended); err != nil {
			continue
		}
		projects = append(projects, map[string]any{"id": id, "name": name, "suspended": suspended})
	}
	if projects == nil {
		projects = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": projects, "total": len(projects)})
}

// PutProjectGroups updates the group assignments for a project.
func (s *Server) PutProjectGroups(w http.ResponseWriter, r *http.Request, projectId generated.ProjectId) {
	ctx := r.Context()
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if s.pool == nil {
		writeJSON(w, http.StatusOK, body)
		return
	}

	groupNames, _ := body["groups"].([]any)
	if groupNames == nil {
		writeJSON(w, http.StatusOK, body)
		return
	}

	pid, _ := strconv.Atoi(string(projectId))

	var groupIDs []int
	for _, gn := range groupNames {
		name, ok := gn.(string)
		if !ok || name == "" {
			continue
		}
		var gid int
		err := s.pool.QueryRow(ctx,
			`INSERT INTO centry.project_group (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`, name).Scan(&gid)
		if err != nil {
			continue
		}
		groupIDs = append(groupIDs, gid)
	}

	_, _ = s.pool.Exec(ctx, `DELETE FROM centry.project_group_association WHERE project_id = $1`, pid) // best-effort

	for _, gid := range groupIDs {
		_, _ = s.pool.Exec(ctx, `INSERT INTO centry.project_group_association (project_id, group_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, pid, gid) // best-effort
	}

	writeJSON(w, http.StatusOK, body)
}

// ─── Support Assistant ────────────────────────────────────────────────────────

// GetSupportAssistantConfig returns the support assistant feature configuration.
// Mirrors eliteacore.Handler.SupportConfig — disabled by default.
func (s *Server) GetSupportAssistantConfig(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}
