package eliteacore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

func generateID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

type MCPToolSyncer interface {
	MCPSyncTools(ctx context.Context, payload map[string]any) (json.RawMessage, error)
}

type Handler struct {
	pool               *pgxpool.Pool
	mcpSyncer          MCPToolSyncer
	permissionResolver auth.PermissionResolver
}

type Option func(*Handler)

func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(handler *Handler) {
		handler.permissionResolver = resolver
	}
}

func NewHandler(pool *pgxpool.Pool, opts ...Option) *Handler {
	handler := &Handler{pool: pool}
	for _, opt := range opts {
		opt(handler)
	}
	return handler
}

func (h *Handler) SetMCPSyncer(s MCPToolSyncer) {
	h.mcpSyncer = s
}

func (h *Handler) PlatformSettings(w http.ResponseWriter, r *http.Request) {
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

	projectID := chi.URLParam(r, "projectID")
	if h.pool != nil && projectID != "" {
		ctx := r.Context()
		s := fmt.Sprintf("p_%s", projectID)
		q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE type = 'environment_settings' LIMIT 1`, s)
		var data []byte
		if err := h.pool.QueryRow(ctx, q).Scan(&data); err == nil && len(data) > 0 {
			var dbSettings map[string]any
			if json.Unmarshal(data, &dbSettings) == nil {
				for k, v := range dbSettings {
					defaults[k] = v
				}
			}
		}
	}

	writeJSON(w, http.StatusOK, defaults)
}

func (h *Handler) ProjectInfo(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	var name string
	err := h.pool.QueryRow(ctx, `SELECT name FROM centry.project WHERE id = $1`, projectID).Scan(&name)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"name": "", "icon_meta": nil})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "icon_meta": nil})
}

func (h *Handler) UpdateProjectInfo(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	if name, ok := body["name"].(string); ok && name != "" {
		h.pool.Exec(ctx, `UPDATE centry.project SET name = $1 WHERE id = $2`, name, projectID)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ProjectContext(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"content": "", "enabled": false})
		return
	}

	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)

	q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE type = 'project_context' LIMIT 1`, s)
	var data []byte
	err := h.pool.QueryRow(ctx, q).Scan(&data)
	if err != nil || len(data) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"content": "", "enabled": false})
		return
	}
	var cfg map[string]any
	json.Unmarshal(data, &cfg)
	writeJSON(w, http.StatusOK, map[string]any{
		"content": cfg["content"],
		"enabled": cfg["enabled"],
	})
}

func (h *Handler) UpdateProjectContext(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Content string `json:"content"`
		Enabled bool   `json:"enabled"`
	}
	json.NewDecoder(r.Body).Decode(&body)

	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)

	dataBytes, _ := json.Marshal(map[string]any{"content": body.Content, "enabled": body.Enabled})

	q := fmt.Sprintf(`
		INSERT INTO %q.configuration (elitea_title, label, type, data, section, status_ok, created_at)
		VALUES ('project_context_' || $1, 'Project Context', 'project_context', $2, 'project_context', true, NOW())
		ON CONFLICT (elitea_title) WHERE type = 'project_context'
		DO UPDATE SET data = $2`, s)
	_, err := h.pool.Exec(ctx, q, projectID, dataBytes)
	if err != nil {
		q2 := fmt.Sprintf(`UPDATE %q.configuration SET data = $1 WHERE type = 'project_context'`, s)
		h.pool.Exec(ctx, q2, dataBytes)
	}
	writeJSON(w, http.StatusOK, map[string]any{"content": body.Content, "enabled": body.Enabled})
}

func (h *Handler) SearchOptions(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	q := fmt.Sprintf(`SELECT name FROM %q.tags ORDER BY name`, s)
	rows, err := h.pool.Query(ctx, q)

	tags := make([]string, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var name string
			rows.Scan(&name)
			tags = append(tags, name)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"tags": tags, "collections": []any{}})
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	q := `
		SELECT au.id, au.email, COALESCE(au.name, ''),
			COALESCE(pr.name, 'viewer') as role_name
		FROM auth_core__user au
		LEFT JOIN auth_core__project_user_role pur ON pur.user_id = au.id AND pur.project_id = $1
		LEFT JOIN auth_core__project_role pr ON pr.id = pur.role_id
		ORDER BY au.id
		LIMIT 100
	`
	rows, err := h.pool.Query(ctx, q, projectID)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var email, name, role string
			rows.Scan(&id, &email, &name, &role)
			items = append(items, map[string]any{
				"id": fmt.Sprintf("%d", id), "email": email, "name": name, "role": role,
			})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) Roles(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	q := `SELECT id, name FROM auth_core__project_role WHERE project_id = $1 ORDER BY id`
	rows, err := h.pool.Query(ctx, q, projectID)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var name string
			rows.Scan(&id, &name)
			items = append(items, map[string]any{"id": fmt.Sprintf("%d", id), "name": name})
		}
	}

	// If no project-specific roles, return global defaults
	if len(items) == 0 {
		items = []map[string]any{
			{"id": "1", "name": "admin"},
			{"id": "2", "name": "editor"},
			{"id": "3", "name": "viewer"},
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) ChatConfig(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Get configured LLM integrations as available models
	q := fmt.Sprintf(`
		SELECT elitea_title, type, data
		FROM %q.configuration
		WHERE section = 'llm' AND status_ok = true
		ORDER BY created_at`, s)

	rows, err := h.pool.Query(ctx, q)

	models := make([]map[string]any, 0)
	defaultModel := ""
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var title, cType string
			var data []byte
			rows.Scan(&title, &cType, &data)
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

func (h *Handler) Notifications(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"notifications": []any{}, "total": 0})
		return
	}

	rows, err := h.pool.Query(ctx, `
		SELECT id, uuid, is_seen, meta, event_type, created_at
		FROM centry.notifications
		WHERE project_id = $1 AND user_id = $2
		ORDER BY created_at DESC
		LIMIT 50`, projectID, user.ID)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var uuid, eventType string
			var isSeen bool
			var meta []byte
			var createdAt interface{}
			if rows.Scan(&id, &uuid, &isSeen, &meta, &eventType, &createdAt) == nil {
				var metaObj any
				json.Unmarshal(meta, &metaObj)
				items = append(items, map[string]any{
					"id": fmt.Sprintf("%d", id), "uuid": uuid, "is_seen": isSeen,
					"meta": metaObj, "event_type": eventType, "created_at": createdAt,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"notifications": items, "total": len(items)})
}

func (h *Handler) Author(w http.ResponseWriter, r *http.Request) {
	authorID := chi.URLParam(r, "authorID")
	ctx := r.Context()

	var name, email, avatar, desc string
	err := h.pool.QueryRow(ctx, `
		SELECT COALESCE(au.name, ''), COALESCE(au.email, ''), COALESCE(su.avatar, ''), COALESCE(su.description, '')
		FROM auth_core__user au
		LEFT JOIN centry.social_users su ON su.user_id = au.id
		WHERE au.id = $1
	`, authorID).Scan(&name, &email, &avatar, &desc)

	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id": authorID, "name": name, "email": email,
		"avatar": avatar, "description": desc,
	})
}

func (h *Handler) Publish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()
	q := fmt.Sprintf(`UPDATE %q.application_versions SET status = 'published' WHERE id = $1`, s)
	h.pool.Exec(ctx, q, versionID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Unpublish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()
	q := fmt.Sprintf(`UPDATE %q.application_versions SET status = 'draft' WHERE id = $1`, s)
	h.pool.Exec(ctx, q, versionID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) PublishValidate(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()
	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1)`, s)
	var exists bool
	h.pool.QueryRow(ctx, q, versionID).Scan(&exists)
	writeJSON(w, http.StatusOK, map[string]any{"valid": exists})
}

func (h *Handler) VersionValidator(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()
	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1 AND application_id = $2)`, s)
	var valid bool
	h.pool.QueryRow(ctx, q, versionID, applicationID).Scan(&valid)
	writeJSON(w, http.StatusOK, map[string]any{"valid": valid})
}

func (h *Handler) PublicApplications(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	ctx := r.Context()

	rows, err := h.pool.Query(ctx, `
		SELECT p.id as project_id, a.id, a.name, COALESCE(a.description, ''),
			av.id as version_id, av.name as version_name
		FROM centry.project p
		JOIN centry.published_apps pa ON pa.project_id = p.id
		JOIN centry.project_schema_map psm ON psm.project_id = p.id
		CROSS JOIN LATERAL (
			SELECT id, name, description FROM public.applications WHERE id = pa.application_id
		) a
		CROSS JOIN LATERAL (
			SELECT id, name FROM public.application_versions WHERE application_id = a.id AND status = 'published' LIMIT 1
		) av
		LIMIT 50`)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var pID, aID, vID int
			var name, desc, vName string
			if rows.Scan(&pID, &aID, &name, &desc, &vID, &vName) == nil {
				items = append(items, map[string]any{
					"project_id": fmt.Sprintf("%d", pID), "id": fmt.Sprintf("%d", aID),
					"name": name, "description": desc,
					"version_id": fmt.Sprintf("%d", vID), "version_name": vName,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": len(items)})
}

func (h *Handler) TrendingAuthors(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
}

func (h *Handler) ModerationStatus(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "approved"})
}

func (h *Handler) ApplicationRelation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	items := make([]map[string]any, 0)

	// Get skill mappings
	q := fmt.Sprintf(`SELECT skill_id FROM %q.entity_skill_mapping WHERE entity_version_id = $1`, s)
	rows, err := h.pool.Query(ctx, q, versionID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var skillID string
			rows.Scan(&skillID)
			items = append(items, map[string]any{"type": "skill", "id": skillID})
		}
	}

	// Get tool mappings
	q2 := fmt.Sprintf(`SELECT tool_id FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, s)
	rows2, err := h.pool.Query(ctx, q2, versionID)
	if err == nil {
		defer rows2.Close()
		for rows2.Next() {
			var toolID string
			rows2.Scan(&toolID)
			items = append(items, map[string]any{"type": "tool", "id": toolID})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) Recommendations(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	q := fmt.Sprintf(`
		SELECT a.id, a.name, COALESCE(a.description, ''), COUNT(sl.id) as likes
		FROM %q.applications a
		LEFT JOIN %q.social_likes sl ON sl.entity_id = a.id AND sl.entity_name = 'application'
		GROUP BY a.id, a.name, a.description
		ORDER BY likes DESC
		LIMIT 10`, s, s)

	rows, err := h.pool.Query(ctx, q)
	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var name, desc string
			var likes int
			rows.Scan(&id, &name, &desc, &likes)
			items = append(items, map[string]any{
				"id": fmt.Sprintf("%d", id), "name": name, "description": desc, "likes": likes,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) Feedbacks(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	q := fmt.Sprintf(`SELECT id, entity_name, entity_id, user_id, rating, COALESCE(comment, ''), created_at FROM %q.social_feedbacks ORDER BY created_at DESC LIMIT 50`, s)
	rows, err := h.pool.Query(ctx, q)
	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id int
			var entityName, entityID, userID, comment string
			var rating int
			var createdAt interface{}
			rows.Scan(&id, &entityName, &entityID, &userID, &rating, &comment, &createdAt)
			items = append(items, map[string]any{
				"id": fmt.Sprintf("%d", id), "entity_name": entityName, "entity_id": entityID,
				"user_id": userID, "rating": rating, "comment": comment,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) UpdateAttachmentStorage(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	toolkitID, _ := body["toolkit_id"].(string)
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	h.pool.Exec(ctx, fmt.Sprintf(`
		UPDATE %q.application_versions
		SET meta = jsonb_set(COALESCE(meta, '{}')::jsonb, '{attachment_storage}', $1::jsonb)
		WHERE id = $2`, s),
		fmt.Sprintf(`{"toolkit_id":"%s"}`, toolkitID), versionID)

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DefaultIcons(w http.ResponseWriter, _ *http.Request) {
	icons := []map[string]any{
		{"name": "robot", "url": "/icons/robot.svg"},
		{"name": "brain", "url": "/icons/brain.svg"},
		{"name": "chat", "url": "/icons/chat.svg"},
		{"name": "code", "url": "/icons/code.svg"},
		{"name": "data", "url": "/icons/data.svg"},
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": icons, "total": len(icons)})
}

func (h *Handler) UploadIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	r.ParseMultipartForm(512 * 1024)
	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "url": ""})
		return
	}
	defer file.Close()

	iconDir := fmt.Sprintf("/data/icons/%s", projectID)
	os.MkdirAll(iconDir, 0755)

	ext := ".png"
	if strings.Contains(header.Filename, ".") {
		parts := strings.Split(header.Filename, ".")
		ext = "." + parts[len(parts)-1]
	}
	filename := fmt.Sprintf("%s%s", generateID(), ext)
	filepath := fmt.Sprintf("%s/%s", iconDir, filename)

	dst, err := os.Create(filepath)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to save file"})
		return
	}
	defer dst.Close()
	io.Copy(dst, file)

	url := fmt.Sprintf("/icons/%s/%s", projectID, filename)
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":  true,
		"url": url,
		"icon_meta": map[string]any{
			"url":    url,
			"width":  64,
			"height": 64,
		},
	})
}

func (h *Handler) ListUploadedIcons(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
}

func (h *Handler) UpdateIcon(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteIcon(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ExportImportPost(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	apps, _ := body["applications"].([]any)
	if len(apps) == 0 || h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "imported": []any{}})
		return
	}

	ctx := r.Context()

	imported := make([]map[string]any, 0)
	for _, appRaw := range apps {
		app, ok := appRaw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := app["name"].(string)
		desc, _ := app["description"].(string)
		appType, _ := app["type"].(string)
		if appType == "" {
			appType = "agent"
		}

		var appID int
		err := h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.applications (name, description, type, created_at)
			VALUES ($1, $2, $3, NOW()) RETURNING id`, s),
			name, desc, appType).Scan(&appID)
		if err != nil {
			continue
		}

		versions, _ := app["versions"].([]any)
		for _, vRaw := range versions {
			v, ok := vRaw.(map[string]any)
			if !ok {
				continue
			}
			vName, _ := v["name"].(string)
			if vName == "" {
				vName = "latest"
			}
			promptRaw, _ := json.Marshal(v["prompt"])
			h.pool.Exec(ctx, fmt.Sprintf(`
				INSERT INTO %q.application_versions (application_id, name, prompt, status, created_at)
				VALUES ($1, $2, $3, 'draft', NOW())`, s),
				appID, vName, promptRaw)
		}

		imported = append(imported, map[string]any{"id": fmt.Sprintf("%d", appID), "name": name})
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "imported": imported})
}

func (h *Handler) ExportImportGet(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	projectID := chi.URLParam(r, "projectID")
	entityID := chi.URLParam(r, "entityID")
	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)

	var name, desc, appType string
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, ''), COALESCE(type, 'agent')
		FROM %q.applications WHERE id = $1`, s), entityID).Scan(&name, &desc, &appType)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "application not found"})
		return
	}

	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, COALESCE(prompt::text, '{}'), status
		FROM %q.application_versions WHERE application_id = $1
		ORDER BY created_at`, s), entityID)

	versions := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var vID int
			var vName, promptStr, status string
			rows.Scan(&vID, &vName, &promptStr, &status)
			var prompt any
			json.Unmarshal([]byte(promptStr), &prompt)
			versions = append(versions, map[string]any{
				"id": fmt.Sprintf("%d", vID), "name": vName, "prompt": prompt, "status": status,
			})
		}
	}

	result := map[string]any{
		"ok": true,
		"applications": []map[string]any{{
			"id":          entityID,
			"name":        name,
			"description": desc,
			"type":        appType,
			"versions":    versions,
		}},
	}

	if r.URL.Query().Get("as_file") == "true" {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="elitea_export_%s.json"`, entityID))
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		json.NewEncoder(w).Encode(result)
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ExportConverter(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "converted": body})
}

func (h *Handler) UpdateNotification(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	notificationID := chi.URLParam(r, "notificationID")
	ctx := r.Context()

	user, ok := auth.UserFromContext(ctx)
	if !ok {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	switch r.Method {
	case http.MethodPut:
		if notificationID != "" {
			h.pool.Exec(ctx, `UPDATE centry.notifications SET is_seen = true WHERE id = $1 AND user_id = $2`, notificationID, user.ID)
		} else {
			h.pool.Exec(ctx, `UPDATE centry.notifications SET is_seen = true WHERE project_id = $1 AND user_id = $2`, projectID, user.ID)
		}
	case http.MethodDelete:
		if notificationID != "" {
			h.pool.Exec(ctx, `DELETE FROM centry.notifications WHERE id = $1 AND user_id = $2`, notificationID, user.ID)
		} else {
			h.pool.Exec(ctx, `DELETE FROM centry.notifications WHERE project_id = $1 AND user_id = $2`, projectID, user.ID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ListProjectIcons(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
}

func (h *Handler) CreateProjectIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	r.ParseMultipartForm(512 * 1024)
	name := r.FormValue("name")
	if name == "" {
		_, header, err := r.FormFile("file")
		if err == nil && header != nil {
			name = header.Filename
		}
	}
	if name == "" {
		name = generateID()
	}

	url := fmt.Sprintf("/app/project_icon/%s/%s", projectID, name)
	writeJSON(w, http.StatusOK, map[string]any{"name": name, "url": url})
}

func (h *Handler) DeleteProjectIcon(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) MCPOAuthProxy(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	var body struct {
		TokenEndpoint string `json:"token_endpoint"`
		Code          string `json:"code,omitempty"`
		RedirectURI   string `json:"redirect_uri,omitempty"`
		ClientID      string `json:"client_id,omitempty"`
		ClientSecret  string `json:"client_secret,omitempty"`
		CodeVerifier  string `json:"code_verifier,omitempty"`
		GrantType     string `json:"grant_type,omitempty"`
		RefreshToken  string `json:"refresh_token,omitempty"`
		Scope         string `json:"scope,omitempty"`
		ToolkitID     string `json:"toolkit_id,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	if body.TokenEndpoint == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	clientID := body.ClientID
	clientSecret := body.ClientSecret

	if body.ToolkitID != "" && (clientID == "" || clientSecret == "") {
		s := fmt.Sprintf("p_%s", projectID)
		var settings []byte
		h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT settings FROM %q.elitea_tools WHERE id = $1`, s), body.ToolkitID).Scan(&settings)
		if len(settings) > 0 {
			var cfg map[string]any
			json.Unmarshal(settings, &cfg)
			if clientID == "" {
				if v, ok := cfg["client_id"].(string); ok {
					clientID = v
				}
			}
			if clientSecret == "" {
				if v, ok := cfg["client_secret"].(string); ok {
					clientSecret = v
				}
			}
		}
	}

	grantType := body.GrantType
	if grantType == "" {
		grantType = "authorization_code"
	}

	formData := fmt.Sprintf("grant_type=%s&client_id=%s", grantType, clientID)
	if clientSecret != "" {
		formData += "&client_secret=" + clientSecret
	}
	if body.Scope != "" {
		formData += "&scope=" + body.Scope
	}

	if grantType == "refresh_token" {
		formData += "&refresh_token=" + body.RefreshToken
	} else {
		formData += "&code=" + body.Code + "&redirect_uri=" + body.RedirectURI
		if body.CodeVerifier != "" {
			formData += "&code_verifier=" + body.CodeVerifier
		}
	}

	httpReq, _ := http.NewRequestWithContext(ctx, "POST", body.TokenEndpoint, strings.NewReader(formData))
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "token_exchange_failed", "error_description": err.Error()})
		return
	}
	defer resp.Body.Close()

	var tokenResp map[string]any
	json.NewDecoder(resp.Body).Decode(&tokenResp)
	writeJSON(w, resp.StatusCode, tokenResp)
}

func (h *Handler) MCPDCRProxy(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	var body struct {
		RegistrationEndpoint string         `json:"registration_endpoint"`
		ClientName           string         `json:"client_name,omitempty"`
		RedirectURIs         []string       `json:"redirect_uris,omitempty"`
		GrantTypes           []string       `json:"grant_types,omitempty"`
		Metadata             map[string]any `json:"metadata,omitempty"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	if body.RegistrationEndpoint == "" {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}

	regBody := map[string]any{
		"client_name":   body.ClientName,
		"redirect_uris": body.RedirectURIs,
		"grant_types":   body.GrantTypes,
	}
	for k, v := range body.Metadata {
		regBody[k] = v
	}
	reqBytes, _ := json.Marshal(regBody)

	httpReq, _ := http.NewRequestWithContext(ctx, "POST", body.RegistrationEndpoint, bytes.NewReader(reqBytes))
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(httpReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "dcr_failed", "error_description": err.Error()})
		return
	}
	defer resp.Body.Close()

	var dcrResp map[string]any
	json.NewDecoder(resp.Body).Decode(&dcrResp)
	writeJSON(w, resp.StatusCode, dcrResp)
}

func (h *Handler) MCPSyncTools(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request"})
		return
	}
	body["project_id"] = projectID

	if h.mcpSyncer == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "indexer service not available"})
		return
	}

	data, err := h.mcpSyncer.MCPSyncTools(r.Context(), body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	w.Write(data)
}

func (h *Handler) SupportConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"enabled": false})
}

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

func (h *Handler) AgentCategories(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Merge defaults with admin-configured extras from guardrails config
	seen := make(map[string]bool)
	categories := make([]map[string]any, 0, len(defaultAgentCategories))
	for _, name := range defaultAgentCategories {
		seen[name] = true
		categories = append(categories, map[string]any{"name": name, "is_default": true})
	}

	// Check publishing_guardrail config for extra categories
	q := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE section = 'publishing_guardrail' LIMIT 1`, s)
	var data []byte
	if err := h.pool.QueryRow(ctx, q).Scan(&data); err == nil && len(data) > 0 {
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

func (h *Handler) Permissions(w http.ResponseWriter, r *http.Request) {
	user, ok := auth.UserFromContext(r.Context())
	if !ok || h.permissionResolver == nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	resolution, err := h.permissionResolver.ResolvePermissions(
		r.Context(),
		user,
		auth.PermissionModeDefault,
		chi.URLParam(r, "projectID"),
	)
	if err != nil {
		writeJSON(w, http.StatusOK, []any{})
		return
	}
	result := make([]map[string]any, 0, len(resolution.Permissions))
	for _, permission := range resolution.Permissions {
		result = append(result, map[string]any{"name": permission, "enabled": true})
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) Pin(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	user, _ := auth.UserFromContext(ctx)

	q := fmt.Sprintf(`
		INSERT INTO %q.social_pins (entity_name, entity_id, user_id)
		VALUES ($1, $2, $3)
		ON CONFLICT (entity_name, entity_id, user_id) DO NOTHING`, s)
	h.pool.Exec(ctx, q, entityType, entityID, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) Unpin(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	entityType := chi.URLParam(r, "entityType")
	entityID := chi.URLParam(r, "entityID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	user, _ := auth.UserFromContext(ctx)

	q := fmt.Sprintf(`DELETE FROM %q.social_pins WHERE entity_name = $1 AND entity_id = $2 AND user_id = $3`, s)
	h.pool.Exec(ctx, q, entityType, entityID, user.ID)
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) AuditTraces(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"items": []any{},
		"total": 0,
	})
}

func (h *Handler) AuditTraceHeatmap(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"data": []any{},
	})
}

func (h *Handler) ServiceDescriptors(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"rows": []map[string]any{
			{"name": "elitea_core", "status": "active", "version": "2.0.0", "description": "Core platform service"},
			{"name": "auth", "status": "active", "version": "2.0.0", "description": "Authentication service"},
			{"name": "indexer", "status": "active", "version": "2.0.0", "description": "Agent runtime & indexing"},
		},
	})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
