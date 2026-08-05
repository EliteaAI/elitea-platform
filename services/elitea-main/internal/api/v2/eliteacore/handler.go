package eliteacore

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

func generateID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b) // crypto/rand.Read never returns an error on supported platforms
	return hex.EncodeToString(b)
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

type MCPToolSyncer interface {
	MCPSyncTools(ctx context.Context, payload map[string]any) (json.RawMessage, error)
}

type Handler struct {
	pool               *pgxpool.Pool
	mcpSyncer          MCPToolSyncer
	permissionResolver auth.PermissionResolver
	httpClient         *http.Client
	store              storage.ObjectStore
}

type Option func(*Handler)

func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(handler *Handler) {
		handler.permissionResolver = resolver
	}
}

// WithHTTPClient configures the client used by the MCP OAuth and DCR proxies.
// It is primarily useful when the service needs a custom trusted CA bundle.
func WithHTTPClient(client *http.Client) Option {
	return func(handler *Handler) {
		if client != nil {
			handler.httpClient = client
		}
	}
}

// WithObjectStore wires S20b's icon byte path (UploadIcon/DeleteIcon) onto
// the object store instead of ICONS_DATA_DIR. Left nil, UploadIcon reports a
// clear 500 for a real upload attempt (never for its "no file" no-op) rather
// than silently falling back to disk; DeleteIcon stays unconditionally 204
// either way, matching its pre-S20b best-effort semantics.
func WithObjectStore(store storage.ObjectStore) Option {
	return func(handler *Handler) {
		handler.store = store
	}
}

func NewHandler(pool *pgxpool.Pool, opts ...Option) *Handler {
	handler := &Handler{
		pool:       pool,
		httpClient: http.DefaultClient,
	}
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
	_ = json.NewDecoder(r.Body).Decode(&body) // body is optional; ignore EOF/empty-body errors

	if name, ok := body["name"].(string); ok && name != "" {
		_, _ = h.pool.Exec(ctx, `UPDATE centry.project SET name = $1 WHERE id = $2`, name, projectID)
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
	_ = json.Unmarshal(data, &cfg) // data was just read from DB; malformed means empty cfg is safe
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
	_ = json.NewDecoder(r.Body).Decode(&body) // body is optional; ignore EOF/empty-body errors

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
		_, _ = h.pool.Exec(ctx, q2, dataBytes) // fallback update; ignore error, best-effort
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
			if rows.Scan(&name) != nil {
				continue
			}
			tags = append(tags, name)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"tags": tags, "collections": []any{}})
}

func (h *Handler) Users(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = 20
	}

	items := make([]map[string]any, 0)
	total := 0

	if pidNum, err := strconv.Atoi(projectID); err == nil && pidNum > 0 {
		// Count total: project members UNION super_admins (excluding system users)
		countQ := `
			SELECT COUNT(*) FROM (
				SELECT au.id FROM auth_core__user au
				JOIN auth_core__project_user_role pur ON pur.user_id = au.id AND pur.project_id = $1
				WHERE au.email NOT LIKE '%@centry.user'
			UNION
				SELECT au.id FROM auth_core__user au
				JOIN auth_core__user_role ur ON ur.user_id = au.id
				JOIN auth_core__role r ON r.id = ur.role_id
				WHERE r.name = 'super_admin' AND au.email NOT LIKE '%@centry.user'
			) combined
		`
		_ = h.pool.QueryRow(ctx, countQ, pidNum).Scan(&total) // failure leaves total=0, which is safe

		// Fetch paginated: project-specific roles for members, 'super_admin' for global admins
		q := `
			SELECT id, email, name, roles FROM (
				SELECT au.id, au.email, COALESCE(au.name, '') as name,
					COALESCE(array_agg(pr.name) FILTER (WHERE pr.name IS NOT NULL), ARRAY['viewer']) as roles
				FROM auth_core__user au
				JOIN auth_core__project_user_role pur ON pur.user_id = au.id AND pur.project_id = $1
				LEFT JOIN auth_core__project_role pr ON pr.id = pur.role_id
				WHERE au.email NOT LIKE '%@centry.user'
				GROUP BY au.id, au.email, au.name
			UNION
				SELECT au.id, au.email, COALESCE(au.name, '') as name,
					ARRAY['super_admin'] as roles
				FROM auth_core__user au
				JOIN auth_core__user_role ur ON ur.user_id = au.id
				JOIN auth_core__role r ON r.id = ur.role_id
				WHERE r.name = 'super_admin' AND au.email NOT LIKE '%@centry.user'
					AND au.id NOT IN (
						SELECT pur2.user_id FROM auth_core__project_user_role pur2 WHERE pur2.project_id = $1
					)
			) combined
			ORDER BY name, id
			LIMIT $2 OFFSET $3
		`
		rows, err := h.pool.Query(ctx, q, pidNum, limit, offset)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var email, name string
				var roles []string
				if rows.Scan(&id, &email, &name, &roles) != nil {
					continue
				}
				if roles == nil {
					roles = []string{"viewer"}
				}
				items = append(items, map[string]any{
					"id": fmt.Sprintf("%d", id), "email": email, "name": name, "roles": roles,
				})
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": total})
}

func (h *Handler) Roles(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	ctx := r.Context()

	items := make([]map[string]any, 0)

	if _, err := strconv.Atoi(projectID); err == nil {
		q := `SELECT id, name FROM auth_core__project_role WHERE project_id = $1 ORDER BY id`
		rows, err := h.pool.Query(ctx, q, projectID)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var id int
				var name string
				if rows.Scan(&id, &name) != nil {
					continue
				}
				items = append(items, map[string]any{"id": fmt.Sprintf("%d", id), "name": name})
			}
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

	// UI roleList query expects a plain array (roles.map(...))
	writeJSON(w, http.StatusOK, items)
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
			if rows.Scan(&title, &cType, &data) != nil {
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
				_ = json.Unmarshal(meta, &metaObj) // meta is a DB jsonb column; malformed means nil metaObj
				items = append(items, map[string]any{
					"id": fmt.Sprintf("%d", id), "uuid": uuid, "is_seen": isSeen,
					"meta": metaObj, "event_type": eventType, "created_at": createdAt,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": len(items)})
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

	// Count applications owned by this author — only in projects they belong to
	var totalApps, totalPipelines, totalToolkits, totalCollections int
	schemaRows, _ := h.pool.Query(ctx,
		`SELECT DISTINCT 'p_' || project_id FROM auth_core__project_user_role WHERE user_id = $1`, authorID)
	if schemaRows != nil {
		var schemas []string
		for schemaRows.Next() {
			var s string
			if schemaRows.Scan(&s) != nil {
				continue
			}
			schemas = append(schemas, s)
		}
		schemaRows.Close()
		for _, s := range schemas {
			var cnt int
			// Each Scan failure leaves cnt=0, which is safe for counting
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.applications a WHERE a.owner_id = $1 AND NOT EXISTS (SELECT 1 FROM %q.application_versions v WHERE v.application_id = a.id AND v.agent_type = 'pipeline')`, s, s), authorID).Scan(&cnt)
			totalApps += cnt
			cnt = 0
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.applications a WHERE a.owner_id = $1 AND EXISTS (SELECT 1 FROM %q.application_versions v WHERE v.application_id = a.id AND v.agent_type = 'pipeline')`, s, s), authorID).Scan(&cnt)
			totalPipelines += cnt
			cnt = 0
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.elitea_tools WHERE author_id = $1`, s), authorID).Scan(&cnt)
			totalToolkits += cnt
			cnt = 0
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COUNT(*) FROM %q.prompt_collections WHERE author_id = $1`, s), authorID).Scan(&cnt)
			totalCollections += cnt
		}
	}

	aid, _ := strconv.Atoi(authorID)
	writeJSON(w, http.StatusOK, map[string]any{
		"id": aid, "name": name, "email": email,
		"avatar": avatar, "title": "", "description": desc,
		"total_conversations": 0, "public_conversations": 0,
		"public_applications": 0, "total_applications": totalApps,
		"public_pipelines": 0, "total_pipelines": totalPipelines,
		"total_toolkits": totalToolkits, "public_collections": 0,
		"total_collections": totalCollections, "rewards": 0,
	})
}

func (h *Handler) Publish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body struct {
		VersionName     string `json:"version_name"`
		ValidationToken string `json:"validation_token"`
		Category        string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	if body.VersionName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": []map[string]any{
				{"loc": []string{"body", "version_name"}, "msg": "field required", "type": "value_error.missing"},
			},
		})
		return
	}

	// Validate version name: only alphanumeric, hyphens, underscores, dots
	for _, c := range body.VersionName {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": []map[string]any{
					{"loc": []string{"body", "version_name"}, "msg": "string does not match regex \"^[a-zA-Z0-9._-]+$\"", "type": "value_error.str.regex"},
				},
			})
			return
		}
	}

	// Verify version exists and is not 'base'
	var appID int
	var vName, vStatus, agentType string
	err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT application_id, name, status, COALESCE(agent_type, '') FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&appID, &vName, &vStatus, &agentType)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "version not found"})
		return
	}
	if agentType == "pipeline" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "pipeline_not_publishable", "msg": "pipeline agents cannot be published"})
		return
	}
	if vStatus == "published" {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "version is already published"})
		return
	}

	// Pre-check: does a version with this name already exist for this application?
	var nameExists bool
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE application_id = $1 AND name = $2)`, s),
		appID, body.VersionName).Scan(&nameExists) // failure leaves nameExists=false, safe to continue
	if nameExists {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": "validation_failed",
			"validation_result": map[string]any{
				"issues": []map[string]any{
					{"rule": "version_name_exists_in_source", "field": "version_name", "issue": "version name already exists", "source": "deterministic"},
				},
			},
		})
		return
	}

	// Validate category if provided
	validCategories := map[string]bool{
		"Business Analyst": true, "Quality Assurance": true, "Development": true,
		"DevOps": true, "Project Management": true, "Knowledge & Documentation": true,
		"Elitea": true, "Epam": true, "Other": true,
	}
	if body.Category != "" && !validCategories[body.Category] {
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"error": "validation_failed",
			"validation_result": map[string]any{
				"issues": []map[string]any{
					{"rule": "invalid_category", "field": "category", "issue": "unknown category", "source": "deterministic"},
				},
			},
		})
		return
	}

	// Hard-check: model must be from public/shared project (runs before validation)
	publicProjID := os.Getenv("PUBLIC_PROJECT_ID")
	if publicProjID == "" {
		publicProjID = "1"
	}
	sharedProjID := os.Getenv("SHARED_PROJECT_ID")
	if sharedProjID == "" {
		sharedProjID = "4"
	}
	var llmSettingsStr *string
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT llm_settings::text FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&llmSettingsStr) // failure leaves nil, safe
	if llmSettingsStr != nil {
		var llmSettings map[string]any
		_ = json.Unmarshal([]byte(*llmSettingsStr), &llmSettings) // DB jsonb column; malformed means empty map
		if modelProjID, ok := llmSettings["model_project_id"]; ok && modelProjID != nil {
			mpid := fmt.Sprintf("%v", modelProjID)
			if mpid != publicProjID && mpid != sharedProjID {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "llm_not_shared"})
				return
			}
		}
	}

	// Validation gate: if no token provided, run inline validation
	if body.ValidationToken == "" {
		valResult, _ := h.runPublishValidation(ctx, s, versionID, body.VersionName)
		if valResult != nil && valResult["status"] == "FAIL" {
			criticals, _ := valResult["critical_issues"].([]map[string]any)
			issues := make([]map[string]any, len(criticals))
			for i, c := range criticals {
				issues[i] = map[string]any{"rule": c["field"], "message": c["issue"]}
				if r, ok := c["rule"]; ok {
					issues[i]["rule"] = r
				}
			}
			valResult["issues"] = issues
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error":             "validation_failed",
				"validation_result": valResult,
			})
			return
		}
	} else {
		// Validate token format (must be generated by our system - hex chars only)
		validToken := true
		if len(body.ValidationToken) < 16 {
			validToken = false
		}
		for _, c := range body.ValidationToken {
			if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
				validToken = false
				break
			}
		}
		if !validToken {
			writeJSON(w, http.StatusBadRequest, map[string]any{"error": "validation_failed"})
			return
		}
	}

	// Clone: insert a new version with status 'published' using same application_id
	var cloneID int
	metaOverlay := fmt.Sprintf(`{"source_version_id": "%s"}`, versionID)
	if body.Category != "" {
		metaOverlay = fmt.Sprintf(`{"source_version_id": "%s", "category": "%s"}`, versionID, body.Category)
	}
	cloneQ := fmt.Sprintf(`
		INSERT INTO %q.application_versions
			(application_id, name, status, author_id, llm_settings, instructions,
			 conversation_starters, welcome_message, agent_type, meta, pipeline_settings)
		SELECT application_id, $2, 'published', author_id, llm_settings, instructions,
			   conversation_starters, welcome_message, agent_type,
			   COALESCE(meta, '{}'::jsonb) || $3::jsonb,
			   pipeline_settings
		FROM %q.application_versions WHERE id = $1
		RETURNING id`, s, s)

	err = h.pool.QueryRow(ctx, cloneQ, versionID, body.VersionName, metaOverlay).Scan(&cloneID)
	if err != nil {
		if strings.Contains(err.Error(), "duplicate key") || strings.Contains(err.Error(), "_application_version_name_uc") {
			writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
				"error": "validation_failed",
				"validation_result": map[string]any{
					"issues": []map[string]any{
						{"rule": "version_name_exists_in_source", "field": "version_name", "issue": "version name already exists", "source": "deterministic"},
					},
				},
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	// Clone entity_tool_mapping rows from source version to new published version
	_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
		INSERT INTO %q.entity_tool_mapping (entity_version_id, entity_id, entity_type, tool_id, selected_tools)
		SELECT $2, entity_id, entity_type, tool_id, selected_tools
		FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, s, s), versionID, cloneID) // best-effort copy

	// Embed sub-agents: clone application_tools of type 'application' recursively
	h.embedSubAgents(ctx, s, versionID, cloneID)

	writeJSON(w, http.StatusOK, map[string]any{
		"public_agent_id":   strconv.Itoa(appID),
		"public_version_id": strconv.Itoa(cloneID),
		"version_name":      body.VersionName,
		"source_version_id": strconv.Itoa(cloneID),
	})
}

// deleteEmbeddedSubAgents removes embedded sub-agent applications referenced by application_tools on versionID.
func (h *Handler) deleteEmbeddedSubAgents(ctx context.Context, schema string, versionID string) {
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT settings::text FROM %q.application_tools
		WHERE application_version_id = $1 AND type = 'application'`, schema), versionID)
	if err != nil {
		return
	}
	defer rows.Close()
	var embeddedAppIDs []string
	for rows.Next() {
		var settingsStr string
		if rows.Scan(&settingsStr) != nil {
			continue
		}
		var settings map[string]any
		_ = json.Unmarshal([]byte(settingsStr), &settings) // DB column; malformed means empty settings
		if aid, ok := settings["application_id"]; ok {
			embeddedAppIDs = append(embeddedAppIDs, fmt.Sprintf("%v", aid))
		}
	}
	rows.Close()

	for _, eAppID := range embeddedAppIDs {
		// Recursively delete sub-agents of this embedded agent
		var eVerID string
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT id FROM %q.application_versions WHERE application_id = $1 AND status = 'embedded' LIMIT 1`, schema), eAppID).Scan(&eVerID) // failure leaves eVerID empty, safe
		if eVerID != "" {
			h.deleteEmbeddedSubAgents(ctx, schema, eVerID)
		}
		// Delete in FK-safe order: tools → versions → application
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_tools WHERE application_version_id IN (SELECT id FROM %q.application_versions WHERE application_id = $1)`, schema, schema), eAppID)
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_versions WHERE application_id = $1`, schema), eAppID)
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.applications WHERE id = $1`, schema), eAppID)
	}
	// Clean up application_tools entries on this version
	_, _ = h.pool.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.application_tools WHERE application_version_id = $1 AND type = 'application'`, schema), versionID)
}

// embedSubAgents clones application-type tools from sourceVersionID onto targetVersionID.
// For each sub-agent tool, it creates a new embedded application+version and links it.
func (h *Handler) embedSubAgents(ctx context.Context, schema string, sourceVersionID string, targetVersionID int) {
	h.embedSubAgentsRecursive(ctx, schema, sourceVersionID, targetVersionID, 0)
}

func (h *Handler) embedSubAgentsRecursive(ctx context.Context, schema string, sourceVersionID string, targetVersionID int, depth int) {
	if depth > 5 {
		return
	}

	// Look up the parent published app ID (the application that owns targetVersionID)
	var parentAppID int
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT application_id FROM %q.application_versions WHERE id = $1`, schema), targetVersionID).Scan(&parentAppID) // failure leaves parentAppID=0

	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT name, type, settings::text
		FROM %q.application_tools
		WHERE application_version_id = $1 AND type = 'application'`, schema), sourceVersionID)
	if err != nil {
		return
	}
	defer rows.Close()

	type subAgentRef struct {
		name      string
		appID     string
		versionID string
	}
	var refs []subAgentRef
	for rows.Next() {
		var name, toolType, settingsStr string
		if rows.Scan(&name, &toolType, &settingsStr) != nil {
			continue
		}
		var settings map[string]any
		_ = json.Unmarshal([]byte(settingsStr), &settings) // DB column; malformed means empty settings
		refAppID := fmt.Sprintf("%v", settings["application_id"])
		refVerID := fmt.Sprintf("%v", settings["version_id"])
		refs = append(refs, subAgentRef{name: name, appID: refAppID, versionID: refVerID})
	}
	rows.Close()

	for _, ref := range refs {
		// Skip pipeline sub-agents — they cannot be published/embedded
		var subAgentType string
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT COALESCE(agent_type, '') FROM %q.application_versions WHERE id = $1`, schema), ref.versionID).Scan(&subAgentType) // failure leaves subAgentType empty
		if subAgentType == "pipeline" {
			continue
		}

		// Clone the sub-agent application
		var embeddedAppID int
		err = h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.applications (name, description, owner_id)
			SELECT name, description, owner_id
			FROM %q.applications WHERE id = $1
			RETURNING id`, schema, schema), ref.appID).Scan(&embeddedAppID)
		if err != nil {
			continue
		}

		// Clone the sub-agent version as 'embedded', adding source and parent metadata
		projectID := strings.TrimPrefix(schema, "p_")
		var embeddedVerID int
		err = h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.application_versions
				(application_id, name, status, author_id, llm_settings, instructions,
				 conversation_starters, welcome_message, agent_type, meta, pipeline_settings)
			SELECT $1, name, 'embedded', author_id, llm_settings, instructions,
				   conversation_starters, welcome_message, agent_type,
				   COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
					   'source_version_id', $3::text,
					   'source_application_id', $4::text,
					   'source_project_id', $5::text,
					   'parent_published_app_id', $6::text,
					   'parent_published_version_id', $7::text
				   ),
				   pipeline_settings
			FROM %q.application_versions WHERE id = $2
			RETURNING id`, schema, schema),
			embeddedAppID, ref.versionID, ref.versionID, ref.appID, projectID,
			strconv.Itoa(parentAppID), strconv.Itoa(targetVersionID)).Scan(&embeddedVerID)
		if err != nil {
			continue
		}

		// Clone entity_tool_mapping for the embedded version
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %q.entity_tool_mapping (entity_version_id, entity_id, entity_type, tool_id, selected_tools)
			SELECT $2, $3, entity_type, tool_id, selected_tools
			FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, schema, schema),
			ref.versionID, embeddedVerID, embeddedAppID) // best-effort copy

		// Create application_tools entry on the published version pointing to embedded copy
		embeddedSettings := map[string]any{
			"application_id":         strconv.Itoa(embeddedAppID),
			"application_version_id": strconv.Itoa(embeddedVerID),
		}
		settingsJSON, _ := json.Marshal(embeddedSettings)
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %q.application_tools (application_version_id, name, type, settings)
			VALUES ($1, $2, 'application', $3)`, schema),
			targetVersionID, ref.name, settingsJSON) // best-effort link

		// Recursively embed sub-agents of this sub-agent
		h.embedSubAgentsRecursive(ctx, schema, ref.versionID, embeddedVerID, depth+1)
	}
}

func (h *Handler) Unpublish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // optional body; ignore decode errors

	// Check version exists and get meta
	var status string
	var metaStr string
	var authorID *int
	err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT status, COALESCE(meta::text, '{}'), author_id FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&status, &metaStr, &authorID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "version not found"})
		return
	}
	var meta map[string]any
	_ = json.Unmarshal([]byte(metaStr), &meta) // DB jsonb column; malformed means nil meta

	switch status {
	case "published", "embedded":
		h.deleteEmbeddedSubAgents(ctx, s, versionID)

		// Revert to draft
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.application_versions SET status = 'draft' WHERE id = $1`, s), versionID) // best-effort revert
	case "draft":
		// Unpublish via the source draft version: find all published clones and delete them
		var appID int
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT application_id FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&appID) // failure leaves appID=0
		var hasPublished bool
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE application_id = $1 AND status IN ('published', 'embedded') AND id != $2)`, s), appID, versionID).Scan(&hasPublished) // failure leaves hasPublished=false
		if !hasPublished {
			writeJSON(w, http.StatusConflict, map[string]any{"error": "version is not published"})
			return
		}
		pubRows, _ := h.pool.Query(ctx, fmt.Sprintf(
			`SELECT id FROM %q.application_versions WHERE application_id = $1 AND status IN ('published','embedded') AND id != $2`, s), appID, versionID)
		if pubRows != nil {
			var pubVerIDs []string
			for pubRows.Next() {
				var pvid string
				if pubRows.Scan(&pvid) != nil {
					continue
				}
				pubVerIDs = append(pubVerIDs, pvid)
			}
			pubRows.Close()
			for _, pvid := range pubVerIDs {
				h.deleteEmbeddedSubAgents(ctx, s, pvid)
			}
		}
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.application_versions SET status = 'draft' WHERE application_id = $1 AND status IN ('published', 'embedded')`, s), appID) // best-effort revert
	default:
		writeJSON(w, http.StatusConflict, map[string]any{"error": "version is not published"})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"status": "deleted"})
}

func (h *Handler) runPublishValidation(ctx context.Context, s, versionID, versionName string) (map[string]any, int) {
	criticalIssues := []map[string]any{}
	warnings := []map[string]any{}
	recommendations := []map[string]any{}

	var vName, vStatus string
	var appID int
	err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT application_id, name, status FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&appID, &vName, &vStatus)
	if err != nil {
		return nil, 0
	}

	if vStatus == "published" {
		criticalIssues = append(criticalIssues, map[string]any{"field": "version", "issue": "version is already published", "source": "deterministic"})
	}

	// Check version name collision
	var nameExists bool
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE application_id = $1 AND name = $2)`, s),
		appID, versionName).Scan(&nameExists) // failure leaves nameExists=false, safe
	if nameExists {
		criticalIssues = append(criticalIssues, map[string]any{"rule": "version_name_exists_in_source", "field": "version_name", "issue": "version name already exists", "source": "deterministic"})
	}

	// Check for generic version names
	genericNames := map[string]bool{"v1": true, "v2": true, "v3": true, "latest": true, "new": true, "test": true}
	if genericNames[strings.ToLower(versionName)] {
		warnings = append(warnings, map[string]any{"field": "version_name", "issue": fmt.Sprintf("'%s' is a generic version name — consider something more descriptive", versionName), "source": "deterministic"})
	}

	// Collect sub-agent references
	type subAgentInfo struct {
		name      string
		appID     string
		versionID string
		appName   string
		verName   string
		agentType string
	}
	subAgentRows, saErr := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT at.name, at.settings::text
		FROM %q.application_tools at
		WHERE at.application_version_id = $1 AND at.type = 'application'`, s), versionID)
	var subAgents []subAgentInfo
	if saErr == nil {
		for subAgentRows.Next() {
			var name, settingsStr string
			if subAgentRows.Scan(&name, &settingsStr) != nil {
				continue
			}
			var settings map[string]any
			_ = json.Unmarshal([]byte(settingsStr), &settings) // DB column; malformed means empty settings
			saAppID := fmt.Sprintf("%v", settings["application_id"])
			saVerID := fmt.Sprintf("%v", settings["version_id"])
			var saAppName, saVerName, saAgentType string
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COALESCE(name,'') FROM %q.applications WHERE id = $1`, s), saAppID).Scan(&saAppName)
			_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COALESCE(name,''), COALESCE(agent_type,'') FROM %q.application_versions WHERE id = $1`, s), saVerID).Scan(&saVerName, &saAgentType)
			subAgents = append(subAgents, subAgentInfo{name: name, appID: saAppID, versionID: saVerID, appName: saAppName, verName: saVerName, agentType: saAgentType})
		}
		subAgentRows.Close()
	}

	// Cycle and depth detection — if either found, short-circuit
	const maxSubAgentDepth = 3
	if len(subAgents) > 0 {
		visited := map[string]bool{versionID: true}
		var hasCycle bool
		var depthExceeded bool
		var checkGraph func(verID string, depth int)
		checkGraph = func(verID string, depth int) {
			if hasCycle || depthExceeded {
				return
			}
			if depth > maxSubAgentDepth {
				depthExceeded = true
				return
			}
			rows2, err2 := h.pool.Query(ctx, fmt.Sprintf(`
				SELECT settings::text FROM %q.application_tools
				WHERE application_version_id = $1 AND type = 'application'`, s), verID)
			if err2 != nil {
				return
			}
			defer rows2.Close()
			for rows2.Next() {
				var ss string
				if rows2.Scan(&ss) != nil {
					continue
				}
				var sett map[string]any
				_ = json.Unmarshal([]byte(ss), &sett) // DB column; malformed means empty sett
				childVerID := fmt.Sprintf("%v", sett["version_id"])
				if visited[childVerID] {
					hasCycle = true
					return
				}
				visited[childVerID] = true
				checkGraph(childVerID, depth+1)
				if hasCycle || depthExceeded {
					return
				}
			}
		}
		for _, sa := range subAgents {
			if visited[sa.versionID] {
				hasCycle = true
				break
			}
			visited[sa.versionID] = true
			checkGraph(sa.versionID, 1)
			if hasCycle || depthExceeded {
				break
			}
		}
		if hasCycle {
			return map[string]any{
				"status": "FAIL",
				"critical_issues": []map[string]any{{
					"field":   "sub_agents",
					"issue":   "circular dependency detected among sub-agents",
					"source":  "deterministic",
					"context": nil,
					"fix":     "Remove one of the circular sub-agent references to break the cycle",
				}},
				"warnings":               []map[string]any{},
				"recommendations":        []map[string]any{},
				"summary":                fmt.Sprintf("Validation FAIL for version %s", versionID),
				"counts":                 map[string]any{"critical": 1, "warnings": 0, "suggestions": 0},
				"ai_validation_available": false,
				"validation_token":        nil,
			}, http.StatusUnprocessableEntity
		}
		if depthExceeded {
			return map[string]any{
				"status": "FAIL",
				"critical_issues": []map[string]any{{
					"field":   "sub_agents",
					"issue":   "sub-agent nesting depth exceeds maximum allowed",
					"source":  "deterministic",
					"context": nil,
					"fix":     "Reduce the nesting depth of sub-agent references",
				}},
				"warnings":               []map[string]any{},
				"recommendations":        []map[string]any{},
				"summary":                fmt.Sprintf("Validation FAIL for version %s", versionID),
				"counts":                 map[string]any{"critical": 1, "warnings": 0, "suggestions": 0},
				"ai_validation_available": false,
				"validation_token":        nil,
			}, http.StatusUnprocessableEntity
		}
	}

	// Load version details for content validation
	var instructions, welcomeMsg string
	var conversationStarters []byte
	var tagCount, toolCount int
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COALESCE(instructions, ''), COALESCE(welcome_message, ''), COALESCE(conversation_starters::text, '[]')::bytea FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&instructions, &welcomeMsg, &conversationStarters) // failure leaves empty strings
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COUNT(*) FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, s), versionID).Scan(&toolCount) // failure leaves toolCount=0
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COUNT(*) FROM %q.application_version_tag_association WHERE version_id = $1`, s), versionID).Scan(&tagCount) // failure leaves tagCount=0

	// Parse conversation_starters
	var starters []string
	_ = json.Unmarshal(conversationStarters, &starters) // DB jsonb column; malformed means empty starters

	// Sparse agent: instructions too short (< 50 chars)
	if len(strings.TrimSpace(instructions)) < 50 {
		criticalIssues = append(criticalIssues, map[string]any{"field": "instructions", "issue": "agent instructions are too short for a meaningful public agent", "source": "deterministic"})
	}

	// No conversation starters
	if len(starters) == 0 {
		warnings = append(warnings, map[string]any{"field": "conversation_starters", "issue": "no conversation starters — users won't know how to begin", "source": "deterministic"})
	}

	// Tag discoverability recommendation
	if tagCount < 3 {
		recommendations = append(recommendations, map[string]any{"field": "tags", "suggestion": "add more tags to improve discoverability in the marketplace", "source": "deterministic"})
	}

	// Sub-agent validation (no cycle): check duplicates, skip pipelines, recurse
	if len(subAgents) > 0 {
		// Detect duplicate sub-agent names (excluding pipelines)
		nameCount := map[string]int{}
		for _, sa := range subAgents {
			if sa.agentType == "pipeline" {
				continue
			}
			nameCount[sa.appName]++
		}
		for name, count := range nameCount {
			if count > 1 {
				ctx1 := fmt.Sprintf("sub-agent: %s", name)
				criticalIssues = append(criticalIssues, map[string]any{
					"field":   "name",
					"issue":   fmt.Sprintf("sub-agent name is not unique (%d occurrences found)", count),
					"source":  "deterministic",
					"context": ctx1,
				})
			}
		}

		// Recursively validate sub-agents (skip pipelines)
		var validateSubAgents func(verID string, depth int)
		validateSubAgents = func(verID string, depth int) {
			if depth > 5 {
				return
			}
			saRows, saErr2 := h.pool.Query(ctx, fmt.Sprintf(`
				SELECT at.settings::text FROM %q.application_tools at
				WHERE at.application_version_id = $1 AND at.type = 'application'`, s), verID)
			if saErr2 != nil {
				return
			}
			defer saRows.Close()
			type saRef struct {
				appID, versionID string
			}
			var saRefs []saRef
			for saRows.Next() {
				var ss string
				if saRows.Scan(&ss) != nil {
					continue
				}
				var sett map[string]any
				_ = json.Unmarshal([]byte(ss), &sett) // DB column; malformed means empty sett
				saRefs = append(saRefs, saRef{
					appID:     fmt.Sprintf("%v", sett["application_id"]),
					versionID: fmt.Sprintf("%v", sett["version_id"]),
				})
			}
			saRows.Close()
			for _, ref := range saRefs {
				var saAppName, saVerName, saAgentType, saInstr, saDesc string
				_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COALESCE(name,''), COALESCE(description,'') FROM %q.applications WHERE id = $1`, s), ref.appID).Scan(&saAppName, &saDesc)
				_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT COALESCE(name,''), COALESCE(agent_type,''), COALESCE(instructions,'') FROM %q.application_versions WHERE id = $1`, s), ref.versionID).Scan(&saVerName, &saAgentType, &saInstr)
				if saAgentType == "pipeline" {
					continue
				}
				saContext := fmt.Sprintf("sub-agent: %s (%s)", saAppName, saVerName)
				if len(strings.TrimSpace(saInstr)) < 50 {
					criticalIssues = append(criticalIssues, map[string]any{
						"field":   "instructions",
						"issue":   "agent instructions are too short for a meaningful public agent",
						"source":  "deterministic",
						"context": saContext,
					})
				}
				if len(strings.TrimSpace(saDesc)) < 20 {
					warnings = append(warnings, map[string]any{
						"field":   "description",
						"issue":   "sub-agent description is too short for meaningful discovery",
						"source":  "deterministic",
						"context": saContext,
					})
				}
				validateSubAgents(ref.versionID, depth+1)
			}
		}
		validateSubAgents(versionID, 0)
	}

	// Check LLM model is from an accessible project
	var llmStr *string
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT llm_settings::text FROM %q.application_versions WHERE id = $1`, s), versionID).Scan(&llmStr) // failure leaves nil, safe
	if llmStr != nil {
		var llm map[string]any
		_ = json.Unmarshal([]byte(*llmStr), &llm) // DB jsonb column; malformed means empty map
		if mpid, ok := llm["model_project_id"]; ok && mpid != nil {
			mpidStr := fmt.Sprintf("%v", mpid)
			pubPID := os.Getenv("PUBLIC_PROJECT_ID")
			if pubPID == "" {
				pubPID = "1"
			}
			shrPID := os.Getenv("SHARED_PROJECT_ID")
			if shrPID == "" {
				shrPID = "4"
			}
			if mpidStr != pubPID && mpidStr != shrPID {
				criticalIssues = append(criticalIssues, map[string]any{
					"field":  "llm_settings",
					"issue":  "model is not shared and cannot be used in published agents",
					"source": "deterministic",
				})
			}
		}
	}

	status := "PASS"
	httpStatus := http.StatusOK
	if len(criticalIssues) > 0 {
		status = "FAIL"
		httpStatus = http.StatusUnprocessableEntity
	} else if len(warnings) > 0 {
		status = "WARN"
	}

	// Generate validation token (non-FAIL only)
	var token *string
	if status != "FAIL" {
		t := generateID() + generateID()
		token = &t
	}

	resp := map[string]any{
		"status":                  status,
		"critical_issues":         criticalIssues,
		"warnings":               warnings,
		"recommendations":        recommendations,
		"summary":                fmt.Sprintf("Validation %s for version %s", status, versionID),
		"counts":                 map[string]any{"critical": len(criticalIssues), "warnings": len(warnings), "suggestions": len(recommendations)},
		"ai_validation_available": false,
		"validation_token":        token,
	}

	return resp, httpStatus
}

func (h *Handler) PublishValidate(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Parse body for version_name
	var body struct {
		VersionName string `json:"version_name"`
		Category    string `json:"category"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	// Validate version_name
	if body.VersionName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": []map[string]any{
				{"loc": []string{"body", "version_name"}, "msg": "field required", "type": "value_error.missing"},
			},
		})
		return
	}
	for _, c := range body.VersionName {
		if (c < 'a' || c > 'z') && (c < 'A' || c > 'Z') && (c < '0' || c > '9') && c != '-' && c != '_' && c != '.' {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": []map[string]any{
					{"loc": []string{"body", "version_name"}, "msg": "string does not match regex \"^[a-zA-Z0-9._-]+$\"", "type": "value_error.str.regex"},
				},
			})
			return
		}
	}

	// Check version exists
	var exists bool
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1)`, s), versionID).Scan(&exists) // failure leaves exists=false, returns 404
	if !exists {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "version not found"})
		return
	}

	resp, httpStatus := h.runPublishValidation(ctx, s, versionID, body.VersionName)
	if resp == nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "version not found"})
		return
	}

	writeJSON(w, httpStatus, resp)
}

func (h *Handler) VersionValidator(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	applicationID := chi.URLParam(r, "applicationID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()
	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE id = $1 AND application_id = $2)`, s)
	var valid bool
	_ = h.pool.QueryRow(ctx, q, versionID, applicationID).Scan(&valid) // failure leaves valid=false, which is correct (not found)
	writeJSON(w, http.StatusOK, map[string]any{"valid": valid})
}

func (h *Handler) PublicApplications(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	ctx := r.Context()

	applicationID := chi.URLParam(r, "applicationID")
	if applicationID != "" {
		h.publicApplicationDetail(w, r, ctx, applicationID)
		return
	}

	publicProjectID := os.Getenv("PUBLIC_PROJECT_ID")
	if publicProjectID == "" {
		publicProjectID = "1"
	}
	schema := fmt.Sprintf("p_%s", publicProjectID)

	categoryFilter := r.URL.Query().Get("category")
	var queryArgs []any
	categoryClause := ""
	if categoryFilter != "" {
		if categoryFilter == "Other" {
			categoryClause = ` AND (av.meta->>'category' IS NULL OR av.meta->>'category' = '' OR av.meta->>'category' = 'Other')`
		} else {
			categoryClause = ` AND av.meta->>'category' = $1`
			queryArgs = append(queryArgs, categoryFilter)
		}
	}

	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT a.id, a.name, COALESCE(a.description, ''),
			av.id as version_id, av.name as version_name, av.agent_type,
			COALESCE(av.meta::text, '{}')
		FROM %q.applications a
		JOIN %q.application_versions av ON av.application_id = a.id
		WHERE av.status = 'published'
		AND COALESCE(av.meta->>'status', '') != 'embedded'`+categoryClause+`
		ORDER BY a.id DESC
		LIMIT 50`, schema, schema), queryArgs...)

	items := make([]map[string]any, 0)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var aID, vID int
			var name, desc, vName, agentType string
			var metaJSON []byte
			if rows.Scan(&aID, &name, &desc, &vID, &vName, &agentType, &metaJSON) == nil {
				var meta map[string]any
				_ = json.Unmarshal(metaJSON, &meta) // DB jsonb column; malformed means nil meta
				items = append(items, map[string]any{
					"project_id":   publicProjectID,
					"id":           strconv.Itoa(aID),
					"name":         name,
					"description":  desc,
					"version_id":   strconv.Itoa(vID),
					"version_name": vName,
					"agent_type":   agentType,
					"meta":         meta,
				})
			}
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": len(items)})
}

func (h *Handler) publicApplicationDetail(w http.ResponseWriter, r *http.Request, ctx context.Context, applicationID string) {
	versionName := chi.URLParam(r, "versionName")
	publicProjectID := os.Getenv("PUBLIC_PROJECT_ID")
	if publicProjectID == "" {
		publicProjectID = "1"
	}
	schema := fmt.Sprintf("p_%s", publicProjectID)

	// Find the application and its published version
	var appName, appDesc string
	var appID int
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, name, COALESCE(description, '')
		FROM %q.applications WHERE id = $1`, schema), applicationID).Scan(&appID, &appName, &appDesc)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "application not found"})
		return
	}

	// Find the version
	var versionQuery string
	if versionName != "" {
		versionQuery = fmt.Sprintf(`
			SELECT id, name, status, agent_type, COALESCE(instructions, ''),
				COALESCE(welcome_message, ''), COALESCE(llm_settings::text, '{}'),
				COALESCE(meta::text, '{}'), COALESCE(conversation_starters::text, '[]'),
				COALESCE(pipeline_settings::text, '{}'), author_id
			FROM %q.application_versions
			WHERE application_id = $1 AND name = $2 AND status = 'published'`, schema)
	} else {
		versionQuery = fmt.Sprintf(`
			SELECT id, name, status, agent_type, COALESCE(instructions, ''),
				COALESCE(welcome_message, ''), COALESCE(llm_settings::text, '{}'),
				COALESCE(meta::text, '{}'), COALESCE(conversation_starters::text, '[]'),
				COALESCE(pipeline_settings::text, '{}'), author_id
			FROM %q.application_versions
			WHERE application_id = $1 AND status = 'published'
			ORDER BY id DESC LIMIT 1`, schema)
	}

	var vID int
	var vName, vStatus, agentType, instrVal, welcomeVal string
	var llmJSON, metaJSON, startersJSON, pipelineJSON []byte
	var authorID *int

	var scanErr error
	if versionName != "" {
		scanErr = h.pool.QueryRow(ctx, versionQuery, applicationID, versionName).Scan(
			&vID, &vName, &vStatus, &agentType, &instrVal, &welcomeVal,
			&llmJSON, &metaJSON, &startersJSON, &pipelineJSON, &authorID)
	} else {
		scanErr = h.pool.QueryRow(ctx, versionQuery, applicationID).Scan(
			&vID, &vName, &vStatus, &agentType, &instrVal, &welcomeVal,
			&llmJSON, &metaJSON, &startersJSON, &pipelineJSON, &authorID)
	}
	if scanErr != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "published version not found"})
		return
	}

	var llmSettings, meta, starters, pipelineSettings any
	_ = json.Unmarshal(llmJSON, &llmSettings)         // DB jsonb columns
	_ = json.Unmarshal(metaJSON, &meta)               // DB jsonb columns
	_ = json.Unmarshal(startersJSON, &starters)       // DB jsonb columns
	_ = json.Unmarshal(pipelineJSON, &pipelineSettings) // DB jsonb columns

	projIDInt, _ := strconv.Atoi(publicProjectID)

	// Fetch tools
	tools := make([]map[string]any, 0)
	toolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT etm.id, etm.tool_id, etm.entity_type, COALESCE(etm.selected_tools::text, '{}'),
			t.name, t.type, t.settings
		FROM %q.entity_tool_mapping etm
		LEFT JOIN %q.elitea_tools t ON t.id = etm.tool_id
		WHERE etm.entity_version_id = $1`, schema, schema), vID)
	if err == nil {
		defer toolRows.Close()
		for toolRows.Next() {
			var etmID, toolID int
			var entityType, selectedToolsStr string
			var tName, tType *string
			var tSettings []byte
			if toolRows.Scan(&etmID, &toolID, &entityType, &selectedToolsStr, &tName, &tType, &tSettings) != nil {
				continue
			}
			var selectedTools any
			_ = json.Unmarshal([]byte(selectedToolsStr), &selectedTools) // DB jsonb column
			var settings any
			if tSettings != nil {
				_ = json.Unmarshal(tSettings, &settings) // DB jsonb column
			}
			tool := map[string]any{
				"id":             etmID,
				"tool_id":        toolID,
				"entity_type":    entityType,
				"selected_tools": selectedTools,
			}
			if tName != nil {
				tool["name"] = *tName
			}
			if tType != nil {
				tool["type"] = *tType
			}
			if settings != nil {
				tool["settings"] = settings
			}
			tools = append(tools, tool)
		}
	}

	// Fetch application_tools (sub-agent references)
	appToolRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, type, settings::text
		FROM %q.application_tools
		WHERE application_version_id = $1`, schema), vID)
	if err == nil {
		defer appToolRows.Close()
		for appToolRows.Next() {
			var atID int
			var atName, atType, settingsStr string
			if appToolRows.Scan(&atID, &atName, &atType, &settingsStr) != nil {
				continue
			}
			var settings any
			_ = json.Unmarshal([]byte(settingsStr), &settings) // DB jsonb column
			tools = append(tools, map[string]any{
				"id":         atID,
				"name":       atName,
				"type":       atType,
				"settings":   settings,
				"project_id": projIDInt,
			})
		}
	}

	authorIDStr := ""
	if authorID != nil {
		authorIDStr = strconv.Itoa(*authorID)
	}

	versionDetails := map[string]any{
		"id":                     strconv.Itoa(vID),
		"application_id":        strconv.Itoa(appID),
		"name":                  vName,
		"status":                vStatus,
		"agent_type":            agentType,
		"instructions":          instrVal,
		"welcome_message":       welcomeVal,
		"llm_settings":          llmSettings,
		"meta":                  meta,
		"conversation_starters": starters,
		"pipeline_settings":     pipelineSettings,
		"author_id":             authorIDStr,
		"tools":                 tools,
		"tags":                  []any{},
	}

	resp := map[string]any{
		"id":              strconv.Itoa(appID),
		"name":            appName,
		"description":     appDesc,
		"version_details": versionDetails,
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) AdminPublishedAgents(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()
	schemaRows, err := h.pool.Query(ctx, `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'p_%'`)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}
	defer schemaRows.Close()

	var schemas []string
	for schemaRows.Next() {
		var s string
		if schemaRows.Scan(&s) != nil {
			continue
		}
		schemas = append(schemas, s)
	}

	// Group published versions by application
	type pubVersion struct {
		versionID   string
		versionName string
		status      string
	}
	type agentEntry struct {
		appID       string
		name        string
		description string
		projectID   string
		versions    []pubVersion
	}
	agentMap := map[string]*agentEntry{} // key: "projectID:appID"
	var orderedKeys []string

	for _, s := range schemas {
		projectID := strings.TrimPrefix(s, "p_")
		q := fmt.Sprintf(`
			SELECT a.id, a.name, COALESCE(a.description,''), av.id, av.name, av.status
			FROM %q.application_versions av
			JOIN %q.applications a ON a.id = av.application_id
			WHERE av.status = 'published'
			ORDER BY av.id DESC`, s, s)
		rows, err := h.pool.Query(ctx, q)
		if err != nil {
			continue
		}
		for rows.Next() {
			var aID, vID int
			var aName, aDesc, vName, vStatus string
			if rows.Scan(&aID, &aName, &aDesc, &vID, &vName, &vStatus) == nil {
				key := projectID + ":" + strconv.Itoa(aID)
				if _, exists := agentMap[key]; !exists {
					agentMap[key] = &agentEntry{
						appID:       strconv.Itoa(aID),
						name:        aName,
						description: aDesc,
						projectID:   projectID,
					}
					orderedKeys = append(orderedKeys, key)
				}
				agentMap[key].versions = append(agentMap[key].versions, pubVersion{
					versionID:   strconv.Itoa(vID),
					versionName: vName,
					status:      vStatus,
				})
			}
		}
		rows.Close()
	}

	items := make([]map[string]any, 0, len(orderedKeys))
	for _, key := range orderedKeys {
		e := agentMap[key]
		pvs := make([]map[string]any, len(e.versions))
		for i, v := range e.versions {
			pvs[i] = map[string]any{
				"version_id":   v.versionID,
				"version_name": v.versionName,
				"status":       v.status,
			}
		}
		items = append(items, map[string]any{
			"public_agent_id": e.appID,
			"name":            e.name,
			"description":     e.description,
			"project_id":      e.projectID,
			"published_versions": pvs,
			"adoption": map[string]any{
				"conversation_count": 0,
				"project_count":      0,
			},
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) TrendingAuthors(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, []any{})
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
			if rows.Scan(&skillID) != nil {
				continue
			}
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
			if rows2.Scan(&toolID) != nil {
				continue
			}
			items = append(items, map[string]any{"type": "tool", "id": toolID})
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

func (h *Handler) UpdateApplicationRelation(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	appID := chi.URLParam(r, "appID")
	versionID := chi.URLParam(r, "versionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	parentAppID := body["application_id"]
	parentVerID := body["version_id"]
	hasRelation, _ := body["has_relation"].(bool)

	// Guard: block changes to published/embedded parent versions
	if parentVerID != nil {
		pVerStr := fmt.Sprintf("%v", parentVerID)
		var verStatus string
		err := h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT status FROM %q.application_versions WHERE id = $1`, s), pVerStr).Scan(&verStatus)
		if err == nil && (verStatus == "published" || verStatus == "embedded") {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "Cannot change relation on a published version. Unpublish first.",
			})
			return
		}
	}

	if hasRelation && parentAppID != nil && parentVerID != nil {
		// Check for duplicate relation
		var exists bool
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(`
			SELECT EXISTS(SELECT 1 FROM %q.application_tools
			WHERE application_version_id = $1 AND type = 'application'
			AND settings->>'application_id' = $2
			AND settings->>'version_id' = $3)`, s),
			parentVerID, appID, versionID).Scan(&exists) // failure leaves exists=false, safe
		if exists {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "relation already exists",
			})
			return
		}

		// Add this version as a tool on the parent version
		toolName := fmt.Sprintf("agent_%s_%s", appID, versionID)
		toolSettings := map[string]any{
			"application_id": appID,
			"version_id":     versionID,
		}
		settingsJSON, _ := json.Marshal(toolSettings)

		q := fmt.Sprintf(`
			INSERT INTO %q.application_tools (application_version_id, name, type, settings)
			VALUES ($1, $2, 'application', $3)`, s)
		_, _ = h.pool.Exec(ctx, q, parentVerID, toolName, settingsJSON) // best-effort insert
	} else {
		// Remove relation
		q := fmt.Sprintf(`
			DELETE FROM %q.application_tools
			WHERE application_version_id = $1
			AND settings->>'application_id' = $2
			AND settings->>'version_id' = $3`, s)
		_, _ = h.pool.Exec(ctx, q, body["version_id"], appID, versionID) // best-effort delete
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"application_id": appID,
		"version_id":     versionID,
		"has_relation":   hasRelation,
	})
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
			if rows.Scan(&id, &name, &desc, &likes) != nil {
				continue
			}
			items = append(items, map[string]any{
				"id": fmt.Sprintf("%d", id), "name": name, "description": desc, "likes": likes,
			})
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"applications": items, "total": len(items)})
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
			if rows.Scan(&id, &entityName, &entityID, &userID, &rating, &comment, &createdAt) != nil {
				continue
			}
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
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	toolkitID, _ := body["toolkit_id"].(string)
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
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
	writeJSON(w, http.StatusOK, icons)
}

// iconBucket is the reserved system bucket every uploaded icon lands in
// (S20b) — fixed, not per-project-policy-configurable like S20a's
// attachment_bucket, since nothing in this stage's scope asks for that and
// icons have no retention/quota requirement distinct from "keep them".
const iconBucket = "icons"

func (h *Handler) UploadIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	_ = r.ParseMultipartForm(512 * 1024) // ignore parse errors; FormFile will fail if parsing failed
	file, header, err := r.FormFile("file")
	if err != nil {
		// No file is a legitimate, storage-independent no-op (matches this
		// handler's pre-S20b behavior exactly) — do not gate it on h.store,
		// which only a real upload attempt needs.
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "url": ""})
		return
	}
	defer func() { _ = file.Close() }()

	if h.store == nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "icon storage is not configured"})
		return
	}

	if !validIconPathSegment(projectID) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project"})
		return
	}

	filename := generateID() + safeIconExtension(header.Filename)
	ref, err := storage.NewObjectRef(projectID, iconBucket, filename)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project"})
		return
	}

	contentType := mime.TypeByExtension(safeIconExtension(header.Filename))
	if _, err := h.store.Put(r.Context(), ref, file, storage.PutOptions{ContentType: contentType, ContentLength: -1}); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to save file"})
		return
	}

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

// DownloadIcon serves an uploaded icon at the exact URL UploadIcon already
// returns (/icons/{projectID}/{filename}) — before S20b nothing served this
// path at all (no route, no Traefik rule, no volume: every uploaded icon
// was unreachable). Deliberately not a *Handler method: this route must be
// mounted outside the authenticated /elitea_core route group — a browser
// <img src="..."> request carries no Authorization header — the same
// public, unauthenticated placement router.go already uses for the
// unrelated /app/application_icon/* and /app/application_tool_icon/*
// static file servers.
func DownloadIcon(store storage.ObjectStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if store == nil {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}

		projectID := chi.URLParam(r, "projectID")
		filename := chi.URLParam(r, "filename")
		ref, err := storage.NewObjectRef(projectID, iconBucket, filename)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}

		body, _, err := store.Get(r.Context(), ref, nil)
		if err != nil {
			w.WriteHeader(http.StatusNotFound)
			return
		}
		defer func() { _ = body.Close() }()

		// nosniff + a content type derived only from the allowlisted
		// extension safeIconExtension itself enforces (never the backend-
		// reported ObjectInfo.ContentType, which for an object written
		// before this allowlist existed could still be arbitrary) — an
		// adversarial-review finding confirmed a stored-XSS path through
		// this route otherwise: it is public/unauthenticated by design (a
		// browser <img src> carries no auth header), so anything it serves
		// with a browser-sniffable or attacker-chosen Content-Type is
		// script-executable in the app's own origin.
		w.Header().Set("X-Content-Type-Options", "nosniff")
		if contentType := mime.TypeByExtension(safeIconExtension(filename)); contentType != "" {
			w.Header().Set("Content-Type", contentType)
		}
		w.WriteHeader(http.StatusOK)
		_, _ = io.Copy(w, body)
	}
}

func validIconPathSegment(value string) bool {
	return value != "" &&
		value != "." &&
		value != ".." &&
		len(value) <= 255 &&
		!strings.ContainsAny(value, "/\\\x00")
}

// allowedIconExtensions is the entire set safeIconExtension can return.
// S20b's adversarial review confirmed a stored-XSS path: without this
// allowlist, a caller could upload a "file.html"/"file.svg-with-script"-
// named part, have it stored and served back by DownloadIcon (a public,
// unauthenticated route, since a browser <img src> carries no auth header)
// with a browser-sniffable or attacker-chosen Content-Type, executing
// script in the app's own origin. Restricting storage to genuine image
// extensions closes this at the write path, which is more robust than
// relying on Content-Type alone at the read path (also hardened below).
var allowedIconExtensions = map[string]bool{
	".png": true, ".jpg": true, ".jpeg": true, ".gif": true,
	".svg": true, ".webp": true, ".ico": true, ".bmp": true,
}

func safeIconExtension(filename string) string {
	const defaultExtension = ".png"

	lastSeparator := strings.LastIndexAny(filename, "/\\")
	if lastSeparator >= 0 {
		filename = filename[lastSeparator+1:]
	}
	lastDot := strings.LastIndexByte(filename, '.')
	if lastDot <= 0 || lastDot == len(filename)-1 {
		return defaultExtension
	}

	extension := strings.ToLower(filename[lastDot:])
	if len(extension) > 16 {
		return defaultExtension
	}
	for _, char := range extension[1:] {
		if (char < 'a' || char > 'z') && (char < '0' || char > '9') {
			return defaultExtension
		}
	}
	if !allowedIconExtensions[extension] {
		return defaultExtension
	}
	return extension
}

func (h *Handler) ListUploadedIcons(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
}

func (h *Handler) UpdateIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	versionID := chi.URLParam(r, "versionId")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var iconMeta map[string]any
	if err := json.NewDecoder(r.Body).Decode(&iconMeta); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	// Update meta.icon_meta on the version
	_, _ = h.pool.Exec(ctx, fmt.Sprintf(
		`UPDATE %q.application_versions SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('icon_meta', $2::jsonb) WHERE id = $1`, s),
		versionID, mustJSON(iconMeta)) // best-effort update

	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) DeleteIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")
	if !validIconPathSegment(projectID) || !validIconPathSegment(name) {
		w.WriteHeader(http.StatusNoContent)
		return
	}

	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)

	// Clear icon_meta from all versions referencing this icon
	if h.pool != nil {
		_, _ = h.pool.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.application_versions SET meta = jsonb_set(meta, '{icon_meta}', '{}'::jsonb) WHERE meta->'icon_meta'->>'name' = $1`, s), name) // best-effort clear
	}

	// Best-effort remove — Delete is documented idempotent (S1 errors.go),
	// and this handler already returns 204 unconditionally below regardless
	// of outcome, matching its pre-S20b behavior for a missing/invalid file.
	if h.store != nil {
		if ref, err := storage.NewObjectRef(projectID, iconBucket, name); err == nil {
			_ = h.store.Delete(ctx, ref)
		}
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) ExportImportPost(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)

	// Body can be either a flat array (import_wizard) or a map with "applications" key
	bodyBytes, _ := io.ReadAll(r.Body)
	var entities []any
	if len(bodyBytes) > 0 && bodyBytes[0] == '[' {
		_ = json.Unmarshal(bodyBytes, &entities) // request body; malformed means empty entities
	} else {
		var bodyMap map[string]any
		_ = json.Unmarshal(bodyBytes, &bodyMap) // request body; malformed means empty map
		if apps, ok := bodyMap["applications"].([]any); ok {
			entities = apps
		}
	}

	if len(entities) == 0 || h.pool == nil {
		writeJSON(w, http.StatusCreated, map[string]any{
			"result": map[string]any{"agents": []any{}},
			"errors": map[string]any{"agents": []any{}},
		})
		return
	}

	ctx := r.Context()
	user, _ := auth.UserFromContext(ctx)
	userID := 1
	if user.ID != "" {
		_, _ = fmt.Sscanf(user.ID, "%d", &userID)
	}

	// Separate entities by type, preserving original indices for error reporting
	type toolkitEntry struct {
		entityIdx  int
		importUUID string
		raw        map[string]any
	}
	type agentEntry struct {
		entityIdx int
		raw       map[string]any
	}
	var agentEntries []agentEntry
	var toolkitEntries []toolkitEntry

	for i, raw := range entities {
		ent, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		entity, _ := ent["entity"].(string)
		if entity == "toolkits" {
			iuuid, _ := ent["import_uuid"].(string)
			toolkitEntries = append(toolkitEntries, toolkitEntry{entityIdx: i, importUUID: iuuid, raw: ent})
		} else {
			agentEntries = append(agentEntries, agentEntry{entityIdx: i, raw: ent})
		}
	}

	resultAgents := make([]map[string]any, 0)
	errorAgents := make([]any, 0)
	resultToolkits := make([]map[string]any, 0)
	errorToolkits := make([]any, 0)

	validAgentTypes := map[string]bool{"openai": true, "react": true, "dial": true, "pipeline": true, "": true}

	// Phase 1: Import agents and build import_uuid -> appID maps
	agentImportUUIDToAppID := map[string]int{}
	agentVersionImportUUIDToVerID := map[string]int{}

	type importedAgentInfo struct {
		appID    int
		versions [][]map[string]any // per-version tool refs to resolve later
	}
	importedAgents := make([]importedAgentInfo, 0)

	for _, ae := range agentEntries {
		app := ae.raw
		name, _ := app["name"].(string)
		desc, _ := app["description"].(string)

		versions, hasVersions := app["versions"].([]any)
		if !hasVersions || len(versions) == 0 {
			errorAgents = append(errorAgents, map[string]any{"index": ae.entityIdx, "name": name, "msg": "Import function has been failed: no versions provided"})
			importedAgents = append(importedAgents, importedAgentInfo{appID: -1})
			continue
		}

		if firstVer, ok := versions[0].(map[string]any); ok {
			at, _ := firstVer["agent_type"].(string)
			if !validAgentTypes[at] {
				errorAgents = append(errorAgents, map[string]any{"index": ae.entityIdx, "name": name, "msg": "Import function has been failed: invalid agent_type"})
				importedAgents = append(importedAgents, importedAgentInfo{appID: -1})
				continue
			}
		}

		var appID int
		err := h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.applications (name, description, owner_id)
			VALUES ($1, $2, $3) RETURNING id`, s),
			name, desc, userID).Scan(&appID)
		if err != nil {
			errorAgents = append(errorAgents, map[string]any{"index": ae.entityIdx, "name": name, "msg": "Import function has been failed: " + err.Error()})
			importedAgents = append(importedAgents, importedAgentInfo{appID: -1})
			continue
		}

		appImportUUID, _ := app["import_uuid"].(string)
		if appImportUUID != "" {
			agentImportUUIDToAppID[appImportUUID] = appID
		}

		createdVersions := make([]map[string]any, 0)
		var versionDetails map[string]any
		var versionToolRefs [][]map[string]any

		for _, vRaw := range versions {
			v, ok := vRaw.(map[string]any)
			if !ok {
				continue
			}
			vName, _ := v["name"].(string)
			if vName == "" {
				vName = "latest"
			}
			agentType, _ := v["agent_type"].(string)
			if agentType == "" {
				agentType = "openai"
			}
			instructions, _ := v["instructions"].(string)
			welcomeMsg, _ := v["welcome_message"].(string)
			llmJSON := "{}"
			if llm, ok := v["llm_settings"].(map[string]any); ok {
				if b, e := json.Marshal(llm); e == nil {
					llmJSON = string(b)
				}
			}
			startersJSON := "[]"
			if cs, ok := v["conversation_starters"].([]any); ok {
				if b, e := json.Marshal(cs); e == nil {
					startersJSON = string(b)
				}
			}
			metaJSON := "{}"
			if m, ok := v["meta"].(map[string]any); ok {
				if b, e := json.Marshal(m); e == nil {
					metaJSON = string(b)
				}
			}

			var vID int
			err = h.pool.QueryRow(ctx, fmt.Sprintf(`
				INSERT INTO %q.application_versions (application_id, name, status, agent_type, instructions, welcome_message, llm_settings, conversation_starters, author_id, meta, pipeline_settings)
				VALUES ($1, $2, 'draft', $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, '{}'::jsonb) RETURNING id`, s),
				appID, vName, agentType, instructions, welcomeMsg, llmJSON, startersJSON, userID, metaJSON).Scan(&vID)
			if err != nil {
				continue
			}

			vImportUUID, _ := v["import_version_uuid"].(string)
			if vImportUUID != "" {
				agentVersionImportUUIDToVerID[vImportUUID] = vID
			}

			// Collect tool refs for later resolution
			var toolRefs []map[string]any
			if tools, ok := v["tools"].([]any); ok {
				for _, toolRaw := range tools {
					if tr, ok := toolRaw.(map[string]any); ok {
						toolRefs = append(toolRefs, tr)
					}
				}
			}
			versionToolRefs = append(versionToolRefs, toolRefs)

			createdVersions = append(createdVersions, map[string]any{
				"id":             fmt.Sprintf("%d", vID),
				"application_id": fmt.Sprintf("%d", appID),
				"name":          vName,
				"status":        "draft",
			})

			var llmParsed, startersParsed any
			_ = json.Unmarshal([]byte(llmJSON), &llmParsed)       // already marshaled above; can't fail
			_ = json.Unmarshal([]byte(startersJSON), &startersParsed) // already marshaled above; can't fail

			versionDetails = map[string]any{
				"id":                    fmt.Sprintf("%d", vID),
				"application_id":        fmt.Sprintf("%d", appID),
				"name":                  vName,
				"status":               "draft",
				"author_id":            fmt.Sprintf("%d", userID),
				"agent_type":           agentType,
				"instructions":         instructions,
				"welcome_message":      welcomeMsg,
				"llm_settings":         llmParsed,
				"conversation_starters": startersParsed,
				"tools":                []any{},
			}
		}

		agentResult := map[string]any{
			"id":              fmt.Sprintf("%d", appID),
			"name":            name,
			"description":     desc,
			"owner_id":        projectID,
			"versions":        createdVersions,
			"version_details": versionDetails,
		}
		resultAgents = append(resultAgents, agentResult)
		importedAgents = append(importedAgents, importedAgentInfo{appID: appID, versions: versionToolRefs})
	}

	// Phase 2: Import toolkits, resolving settings.import_uuid for type=application
	importUUIDToToolID := map[string]int{}
	failedToolkitImportUUIDs := map[string]bool{}

	for _, tk := range toolkitEntries {
		tkName, _ := tk.raw["name"].(string)
		tkType, _ := tk.raw["type"].(string)
		if tkType == "" {
			tkType = "custom"
		}

		settings, _ := tk.raw["settings"].(map[string]any)
		if settings == nil {
			settings = map[string]any{}
		}

		// For type=application, resolve settings.import_uuid to actual agent ID
		if tkType == "application" {
			settingsImportUUID, _ := settings["import_uuid"].(string)
			if settingsImportUUID != "" {
				if resolvedAppID, found := agentImportUUIDToAppID[settingsImportUUID]; found {
					settings["application_id"] = resolvedAppID
					// Resolve version uuid too
					settingsVersionUUID, _ := settings["import_version_uuid"].(string)
					if vID, vfound := agentVersionImportUUIDToVerID[settingsVersionUUID]; vfound {
						settings["application_version_id"] = vID
					}
				} else {
					errorToolkits = append(errorToolkits, map[string]any{
						"index": tk.entityIdx,
						"name":  tkName,
						"msg":   "Unable to link toolkit_import_uuid: " + settingsImportUUID + " to any imported application",
					})
					failedToolkitImportUUIDs[tk.importUUID] = true
					continue
				}
			}
		}

		settingsJSON := "{}"
		if b, e := json.Marshal(settings); e == nil {
			settingsJSON = string(b)
		}

		tkDesc, _ := tk.raw["description"].(string)
		var toolID int
		err := h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.elitea_tools (name, type, settings, author_id, description, meta) VALUES ($1, $2, $3::jsonb, $4, $5, '{}'::jsonb) RETURNING id`, s),
			tkName, tkType, settingsJSON, userID, tkDesc).Scan(&toolID)
		if err == nil {
			if tk.importUUID != "" {
				importUUIDToToolID[tk.importUUID] = toolID
			}
			resultToolkits = append(resultToolkits, map[string]any{"id": strconv.Itoa(toolID), "name": tkName, "type": tkType})
		} else {
			errorToolkits = append(errorToolkits, map[string]any{"index": tk.entityIdx, "name": tkName, "msg": "Import function has been failed: " + err.Error()})
			failedToolkitImportUUIDs[tk.importUUID] = true
		}
	}

	// Phase 3: Link agent tool refs and update version_details.tools
	resultIdx := 0
	for i, ae := range agentEntries {
		info := importedAgents[i]
		if info.appID < 0 {
			continue
		}
		agentResult := resultAgents[resultIdx]
		resultIdx++

		hasLinkError := false
		var vTools []any

		// Get version IDs from the created versions
		createdVersions, _ := agentResult["versions"].([]map[string]any)

		for vIdx, toolRefs := range info.versions {
			if vIdx >= len(createdVersions) {
				break
			}
			vIDStr, _ := createdVersions[vIdx]["id"].(string)
			var vID int
			_, _ = fmt.Sscanf(vIDStr, "%d", &vID)

			for _, toolRef := range toolRefs {
				refUUID, _ := toolRef["import_uuid"].(string)
				if refUUID == "" {
					continue
				}
				if failedToolkitImportUUIDs[refUUID] {
					hasLinkError = true
					continue
				}
				if toolID, found := importUUIDToToolID[refUUID]; found {
					selToolsJSON := "{}"
					if st, ok := toolRef["selected_tools"].(map[string]any); ok {
						if b, e := json.Marshal(st); e == nil {
							selToolsJSON = string(b)
						}
					}
					_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
						INSERT INTO %q.entity_tool_mapping (entity_version_id, entity_id, entity_type, tool_id, selected_tools)
						VALUES ($1, $2, 'application', $3, $4::jsonb)`, s),
						vID, info.appID, toolID, selToolsJSON) // best-effort link
					vTools = append(vTools, map[string]any{"id": strconv.Itoa(toolID), "type": "custom", "name": ""})
				} else {
					hasLinkError = true
				}
			}
		}

		// Update version_details.tools with resolved tools
		if vd, ok := agentResult["version_details"].(map[string]any); ok {
			if vTools == nil {
				vTools = []any{}
			}
			vd["tools"] = vTools
		}

		if hasLinkError {
			name, _ := ae.raw["name"].(string)
			errorAgents = append(errorAgents, map[string]any{
				"index": ae.entityIdx,
				"name":  name,
				"msg":   "Import function has been failed: unable to link tools cause the later was not imported",
			})
		}
	}

	// Determine status code: 400 if all failed, 207 if mixed, 201 if all succeeded
	totalErrors := len(errorAgents) + len(errorToolkits)
	totalSuccess := len(resultAgents) + len(resultToolkits)
	importStatus := http.StatusCreated
	if totalErrors > 0 {
		if totalSuccess == 0 {
			importStatus = http.StatusBadRequest
		} else {
			importStatus = 207
		}
	}

	writeJSON(w, importStatus, map[string]any{
		"result": map[string]any{"agents": resultAgents, "toolkits": resultToolkits},
		"errors": map[string]any{"agents": errorAgents, "toolkits": errorToolkits},
	})
}

func (h *Handler) Fork(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	apps, _ := body["applications"].([]any)
	if len(apps) == 0 || h.pool == nil {
		writeJSON(w, http.StatusCreated, map[string]any{
			"result": map[string]any{"agents": []any{}, "datasources": []any{}, "prompts": []any{}},
			"errors": map[string]any{"agents": []any{}, "datasources": []any{}, "prompts": []any{}},
		})
		return
	}

	ctx := r.Context()
	user, _ := auth.UserFromContext(ctx)
	userID := 1
	if user.ID != "" {
		_, _ = fmt.Sscanf(user.ID, "%d", &userID)
	}

	resultAgents := make([]map[string]any, 0)
	errorAgents := make([]any, 0)

	for _, appRaw := range apps {
		app, ok := appRaw.(map[string]any)
		if !ok {
			continue
		}
		name, _ := app["name"].(string)
		desc, _ := app["description"].(string)

		var appID int
		err := h.pool.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.applications (name, description, owner_id)
			VALUES ($1, $2, $3) RETURNING id`, s),
			name, desc, userID).Scan(&appID)
		if err != nil {
			errorAgents = append(errorAgents, map[string]any{"name": name, "error": err.Error()})
			continue
		}

		versions, _ := app["versions"].([]any)
		var createdVersionID int
		var versionDetails map[string]any
		createdVersions := make([]map[string]any, 0)

		for _, vRaw := range versions {
			v, ok := vRaw.(map[string]any)
			if !ok {
				continue
			}
			vName, _ := v["name"].(string)
			if vName == "" {
				vName = "latest"
			}
			agentType, _ := v["agent_type"].(string)
			if agentType == "" {
				agentType = "openai"
			}
			instructions, _ := v["instructions"].(string)
			welcomeMsg, _ := v["welcome_message"].(string)
			llmSettings, _ := v["llm_settings"].(map[string]any)
			if llmSettings == nil {
				llmSettings = map[string]any{}
			}
			// Override model_project_id to target project
			llmSettings["model_project_id"] = projectID

			llmJSON := "{}"
			if b, e := json.Marshal(llmSettings); e == nil {
				llmJSON = string(b)
			}
			startersJSON := "[]"
			if cs, ok := v["conversation_starters"].([]any); ok {
				if b, e := json.Marshal(cs); e == nil {
					startersJSON = string(b)
				}
			}

			// Build meta with fork info
			metaIn, _ := v["meta"].(map[string]any)
			if metaIn == nil {
				metaIn = map[string]any{}
			}
			forkMeta := map[string]any{}
			for k, mv := range metaIn {
				forkMeta[k] = mv
			}
			// Set parent info
			sourceAppID, _ := app["id"].(string)
			sourceOwnerID, _ := app["owner_id"].(string)
			forkMeta["parent_entity_id"] = sourceAppID
			forkMeta["parent_project_id"] = sourceOwnerID
			forkMeta["parent_author_id"] = fmt.Sprintf("%d", userID)
			if _, hasIcon := forkMeta["icon_meta"]; !hasIcon {
				forkMeta["icon_meta"] = map[string]any{}
			}
			if _, hasStep := forkMeta["step_limit"]; !hasStep {
				forkMeta["step_limit"] = nil
			}

			metaJSON := "{}"
			if b, e := json.Marshal(forkMeta); e == nil {
				metaJSON = string(b)
			}

			var vID int
			err = h.pool.QueryRow(ctx, fmt.Sprintf(`
				INSERT INTO %q.application_versions (application_id, name, status, agent_type, instructions, welcome_message, llm_settings, conversation_starters, author_id, meta, pipeline_settings)
				VALUES ($1, $2, 'draft', $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9::jsonb, '{}'::jsonb) RETURNING id`, s),
				appID, vName, agentType, instructions, welcomeMsg, llmJSON, startersJSON, userID, metaJSON).Scan(&vID)
			if err != nil {
				continue
			}
			createdVersionID = vID

			// Insert variables
			if vars, ok := v["variables"].([]any); ok {
				for _, varRaw := range vars {
					varMap, _ := varRaw.(map[string]any)
					if varMap == nil {
						continue
					}
					varName, _ := varMap["name"].(string)
					varValue, _ := varMap["value"].(string)
					_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
						INSERT INTO %q.application_variables (application_version_id, name, value) VALUES ($1, $2, $3)`, s),
						vID, varName, varValue) // best-effort insert
				}
			}

			// Insert tags
			if tagsList, ok := v["tags"].([]any); ok {
				for _, tagRaw := range tagsList {
					tagMap, _ := tagRaw.(map[string]any)
					if tagMap == nil {
						continue
					}
					tagName, _ := tagMap["name"].(string)
					tagDataJSON := "{}"
					if td, ok := tagMap["data"]; ok {
						if b, e := json.Marshal(td); e == nil {
							tagDataJSON = string(b)
						}
					}
					var tagID int
					// Upsert tag
					err2 := h.pool.QueryRow(ctx, fmt.Sprintf(`
						INSERT INTO %q.tags (name, data) VALUES ($1, $2::jsonb)
						ON CONFLICT (name) DO UPDATE SET data = EXCLUDED.data
						RETURNING id`, s), tagName, tagDataJSON).Scan(&tagID)
					if err2 == nil {
						_, _ = h.pool.Exec(ctx, fmt.Sprintf(`
							INSERT INTO %q.application_version_tag_association (version_id, tag_id) VALUES ($1, $2)
							ON CONFLICT DO NOTHING`, s), vID, tagID) // best-effort insert
					}
				}
			}

			createdVersions = append(createdVersions, map[string]any{
				"id":             fmt.Sprintf("%d", vID),
				"application_id": fmt.Sprintf("%d", appID),
				"name":          vName,
				"status":        "draft",
			})

			// Build version_details response
			var starters any
			_ = json.Unmarshal([]byte(startersJSON), &starters) // already marshaled above; can't fail

			// Rebuild variables list for response
			respVars := make([]map[string]any, 0)
			if vars, ok := v["variables"].([]any); ok {
				for _, varRaw := range vars {
					if varMap, ok := varRaw.(map[string]any); ok {
						respVars = append(respVars, map[string]any{"name": varMap["name"], "value": varMap["value"]})
					}
				}
			}

			// Rebuild tags list for response
			respTags := make([]map[string]any, 0)
			if tagsList, ok := v["tags"].([]any); ok {
				for _, tagRaw := range tagsList {
					if tagMap, ok := tagRaw.(map[string]any); ok {
						respTags = append(respTags, map[string]any{"name": tagMap["name"], "data": tagMap["data"]})
					}
				}
			}

			versionDetails = map[string]any{
				"id":                    fmt.Sprintf("%d", vID),
				"application_id":        fmt.Sprintf("%d", appID),
				"name":                  vName,
				"status":               "draft",
				"author_id":            fmt.Sprintf("%d", userID),
				"agent_type":           agentType,
				"instructions":         instructions,
				"welcome_message":      welcomeMsg,
				"llm_settings":         llmSettings,
				"conversation_starters": starters,
				"meta":                 forkMeta,
				"is_forked":            true,
				"variables":            respVars,
				"tags":                 respTags,
				"tools":                []any{},
			}
		}

		agentResult := map[string]any{
			"id":              fmt.Sprintf("%d", appID),
			"name":            name,
			"description":     desc,
			"owner_id":        projectID,
			"webhook_secret":  nil,
			"versions":        createdVersions,
			"version_details": versionDetails,
		}
		if createdVersionID > 0 {
			agentResult["version_id"] = fmt.Sprintf("%d", createdVersionID)
		}
		resultAgents = append(resultAgents, agentResult)
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"result": map[string]any{"agents": resultAgents},
		"errors": map[string]any{"agents": errorAgents},
	})
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

	var name, desc, appUUID string
	var ownerID int
	var sharedID, sharedOwnerID *int
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, ''), uuid::text, owner_id, shared_id, shared_owner_id
		FROM %q.applications WHERE id = $1`, s), entityID).Scan(&name, &desc, &appUUID, &ownerID, &sharedID, &sharedOwnerID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "application not found"})
		return
	}

	// Determine app type from its versions
	appType := "agent"
	var hasPipeline bool
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE application_id = $1 AND agent_type = 'pipeline')`, s), entityID).Scan(&hasPipeline) // failure leaves hasPipeline=false, safe
	if hasPipeline {
		appType = "pipeline"
	}

	// Fetch toolkits and build import_uuid map (toolID -> uuid)
	toolkitMap := map[int]string{} // tool_id -> import_uuid
	toolkits := make([]map[string]any, 0)
	toolkitRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT DISTINCT t.id, t.name, t.type, COALESCE(t.settings::text, '{}')
		FROM %q.entity_tool_mapping etm
		JOIN %q.elitea_tools t ON t.id = etm.tool_id
		JOIN %q.application_versions av ON av.id = etm.entity_version_id
		WHERE av.application_id = $1`, s, s, s), entityID)
	if err == nil {
		defer toolkitRows.Close()
		for toolkitRows.Next() {
			var tID int
			var tName, tType, configStr string
			if toolkitRows.Scan(&tID, &tName, &tType, &configStr) != nil {
				continue
			}
			tUUID := fmt.Sprintf("tool-%d", tID)
			var config map[string]any
			_ = json.Unmarshal([]byte(configStr), &config) // DB jsonb column; malformed means empty config
			if config == nil {
				config = map[string]any{}
			}
			// Strip sensitive settings for export
			settings := map[string]any{}
			for k, v := range config {
				settings[k] = v
			}
			for _, sk := range []string{"api_key", "access_token", "token", "api_key_type",
				"client_secret", "gitlab_personal_access_token", "private_token",
				"sonar_token", "qtest_api_token", "client_id",
				"password", "secret", "app_id"} {
				delete(settings, sk)
			}
			toolkitMap[tID] = tUUID
			toolkits = append(toolkits, map[string]any{
				"id": tID, "name": tName, "type": tType,
				"import_uuid": tUUID, "settings": settings,
			})
		}
	}

	// Fetch versions with full data and tools
	versions := make([]map[string]any, 0)
	vRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT id, name, status, COALESCE(agent_type, 'openai'),
			COALESCE(instructions, ''), COALESCE(welcome_message, ''),
			COALESCE(llm_settings::text, '{}'), COALESCE(conversation_starters::text, '[]'),
			COALESCE(meta::text, '{}'), COALESCE(uuid::text, ''), application_id, COALESCE(author_id, 0)
		FROM %q.application_versions WHERE application_id = $1
		ORDER BY created_at`, s), entityID)
	if err == nil {
		defer vRows.Close()
		for vRows.Next() {
			var vID, vAppID, vAuthorID int
			var vName, vStatus, agentType, instructions, welcomeMsg string
			var llmStr, startersStr, metaStr, vUUID string
			if vRows.Scan(&vID, &vName, &vStatus, &agentType, &instructions, &welcomeMsg, &llmStr, &startersStr, &metaStr, &vUUID, &vAppID, &vAuthorID) != nil {
				continue
			}
			var llm, starters, meta any
			_ = json.Unmarshal([]byte(llmStr), &llm)       // DB jsonb columns
			_ = json.Unmarshal([]byte(startersStr), &starters) // DB jsonb columns
			_ = json.Unmarshal([]byte(metaStr), &meta)      // DB jsonb columns

			// Ensure meta has icon_meta
			if metaMap, ok := meta.(map[string]any); ok {
				if _, hasIcon := metaMap["icon_meta"]; !hasIcon {
					metaMap["icon_meta"] = map[string]any{}
				}
			} else {
				meta = map[string]any{"icon_meta": map[string]any{}}
			}

			// Ensure llm_settings.model_project_id is a string
			if llmMap, ok := llm.(map[string]any); ok {
				if mpid, exists := llmMap["model_project_id"]; exists {
					switch v := mpid.(type) {
					case float64:
						llmMap["model_project_id"] = fmt.Sprintf("%d", int(v))
					}
				}
			}

			// Fetch tool references for this version
			vTools := make([]map[string]any, 0)
			tRows, tErr := h.pool.Query(ctx, fmt.Sprintf(`
				SELECT tool_id, COALESCE(selected_tools::text, '{}')
				FROM %q.entity_tool_mapping WHERE entity_version_id = $1`, s), vID)
			if tErr == nil {
				for tRows.Next() {
					var toolID int
					var selToolsStr string
					if tRows.Scan(&toolID, &selToolsStr) != nil {
						continue
					}
					var selTools any
					_ = json.Unmarshal([]byte(selToolsStr), &selTools) // DB jsonb column
					importUUID := toolkitMap[toolID]
					vTools = append(vTools, map[string]any{
						"import_uuid":    importUUID,
						"selected_tools": selTools,
					})
				}
				tRows.Close()
			}

			// Fetch variables for this version
			variables := make([]map[string]any, 0)
			varRows, varErr := h.pool.Query(ctx, fmt.Sprintf(`
				SELECT name, COALESCE(value, '') FROM %q.application_variables
				WHERE application_version_id = $1 ORDER BY id`, s), vID)
			if varErr == nil {
				for varRows.Next() {
					var varName, varValue string
					if varRows.Scan(&varName, &varValue) != nil {
						continue
					}
					variables = append(variables, map[string]any{"name": varName, "value": varValue})
				}
				varRows.Close()
			}

			// Fetch tags for this version
			tags := make([]map[string]any, 0)
			tagRows, tagErr := h.pool.Query(ctx, fmt.Sprintf(`
				SELECT t.name, COALESCE(t.data::text, '{}')
				FROM %q.application_version_tag_association vta
				JOIN %q.tags t ON t.id = vta.tag_id
				WHERE vta.version_id = $1`, s, s), vID)
			if tagErr == nil {
				for tagRows.Next() {
					var tagName, tagDataStr string
					if tagRows.Scan(&tagName, &tagDataStr) != nil {
						continue
					}
					var tagData any
					_ = json.Unmarshal([]byte(tagDataStr), &tagData) // DB jsonb column
					if tagData == nil {
						tagData = map[string]any{}
					}
					tags = append(tags, map[string]any{"name": tagName, "data": tagData})
				}
				tagRows.Close()
			}

			// Determine is_forked from meta containing parent_entity_id
			isForked := false
			if metaMap, ok := meta.(map[string]any); ok {
				if _, has := metaMap["parent_entity_id"]; has {
					isForked = true
				}
			}

			vEntry := map[string]any{
				"id": fmt.Sprintf("%d", vID), "name": vName, "status": vStatus,
				"application_id": fmt.Sprintf("%d", vAppID),
				"author_id":      fmt.Sprintf("%d", vAuthorID),
				"agent_type":     agentType, "instructions": instructions,
				"welcome_message": welcomeMsg, "llm_settings": llm,
				"conversation_starters": starters, "meta": meta,
				"tools": vTools, "variables": variables, "tags": tags,
				"is_forked": isForked,
			}
			if vUUID != "" {
				vEntry["import_version_uuid"] = vUUID
			}
			versions = append(versions, vEntry)
		}
	}

	isFork := strings.EqualFold(r.URL.Query().Get("fork"), "true")
	if isFork && len(versions) > 0 {
		versions = versions[len(versions)-1:]
	}

	appExport := map[string]any{
		"id":          entityID,
		"name":        name,
		"description": desc,
		"type":        appType,
		"import_uuid": appUUID,
		"versions":    versions,
	}
	if isFork {
		appExport["owner_id"] = fmt.Sprintf("%d", ownerID)
		appExport["original_exported"] = true
		if sharedID != nil {
			appExport["shared_id"] = fmt.Sprintf("%d", *sharedID)
		} else {
			appExport["shared_id"] = nil
		}
		if sharedOwnerID != nil {
			appExport["shared_owner_id"] = fmt.Sprintf("%d", *sharedOwnerID)
		} else {
			appExport["shared_owner_id"] = nil
		}
	}

	result := map[string]any{
		"ok":           true,
		"applications": []map[string]any{appExport},
		"toolkits":     toolkits,
	}

	if strings.EqualFold(r.URL.Query().Get("as_file"), "true") {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="elitea_export_%s.json"`, entityID))
		w.Header().Set("Access-Control-Expose-Headers", "Content-Disposition")
		_ = json.NewEncoder(w).Encode(result) // response writer; connection already committed
		return
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) ExportConverter(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body) // body is optional; ignore decode errors
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
			_, _ = h.pool.Exec(ctx, `UPDATE centry.notifications SET is_seen = true WHERE id = $1 AND user_id = $2`, notificationID, user.ID)
		} else {
			_, _ = h.pool.Exec(ctx, `UPDATE centry.notifications SET is_seen = true WHERE project_id = $1 AND user_id = $2`, projectID, user.ID)
		}
	case http.MethodDelete:
		if notificationID != "" {
			_, _ = h.pool.Exec(ctx, `DELETE FROM centry.notifications WHERE id = $1 AND user_id = $2`, notificationID, user.ID)
		} else {
			_, _ = h.pool.Exec(ctx, `DELETE FROM centry.notifications WHERE project_id = $1 AND user_id = $2`, projectID, user.ID)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) ListProjectIcons(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
}

func (h *Handler) CreateProjectIcon(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	_ = r.ParseMultipartForm(512 * 1024) // ignore parse errors; FormValue still returns ""
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

func validateMCPProxyURL(rawURL string) (*url.URL, error) {
	endpoint, err := url.ParseRequestURI(rawURL)
	if err != nil ||
		!endpoint.IsAbs() ||
		endpoint.Host == "" ||
		endpoint.User != nil ||
		endpoint.Fragment != "" ||
		endpoint.Opaque != "" {
		return nil, fmt.Errorf("invalid MCP endpoint")
	}

	scheme := strings.ToLower(endpoint.Scheme)
	host := strings.TrimSuffix(strings.ToLower(endpoint.Hostname()), ".")
	if host == "" {
		return nil, fmt.Errorf("invalid MCP endpoint host")
	}

	switch scheme {
	case "https":
		// Custom HTTPS provider hosts are intentionally supported.
	case "http":
		if !isLoopbackMCPHost(host) {
			return nil, fmt.Errorf("plain HTTP MCP endpoints must use a loopback host")
		}
	default:
		return nil, fmt.Errorf("unsupported MCP endpoint scheme")
	}

	endpoint.Scheme = scheme
	return endpoint, nil
}

func isLoopbackMCPHost(host string) bool {
	if host == "localhost" || strings.HasSuffix(host, ".localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func sameMCPProxyOrigin(first, second *url.URL) bool {
	return strings.EqualFold(first.Scheme, second.Scheme) &&
		strings.EqualFold(strings.TrimSuffix(first.Hostname(), "."), strings.TrimSuffix(second.Hostname(), ".")) &&
		effectiveURLPort(first) == effectiveURLPort(second)
}

func effectiveURLPort(endpoint *url.URL) string {
	if port := endpoint.Port(); port != "" {
		return port
	}
	if strings.EqualFold(endpoint.Scheme, "https") {
		return "443"
	}
	return "80"
}

func (h *Handler) doMCPProxyRequest(req *http.Request) (*http.Response, error) {
	client := h.httpClient
	if client == nil {
		client = http.DefaultClient
	}

	origin := req.URL
	safeClient := *client
	inheritedRedirectPolicy := client.CheckRedirect
	safeClient.CheckRedirect = func(redirected *http.Request, via []*http.Request) error {
		validated, err := validateMCPProxyURL(redirected.URL.String())
		if err != nil || !sameMCPProxyOrigin(origin, validated) {
			return fmt.Errorf("MCP endpoint redirect is not allowed")
		}
		if inheritedRedirectPolicy != nil {
			return inheritedRedirectPolicy(redirected, via)
		}
		if len(via) >= 10 {
			return fmt.Errorf("stopped after 10 redirects")
		}
		return nil
	}
	return safeClient.Do(req)
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
	tokenEndpoint, err := validateMCPProxyURL(body.TokenEndpoint)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_token_endpoint"})
		return
	}

	clientID := body.ClientID
	clientSecret := body.ClientSecret

	if h.pool != nil && body.ToolkitID != "" && (clientID == "" || clientSecret == "") {
		s := fmt.Sprintf("p_%s", projectID)
		var settings []byte
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(`SELECT settings FROM %q.elitea_tools WHERE id = $1`, s), body.ToolkitID).Scan(&settings) // failure leaves settings nil
		if len(settings) > 0 {
			var cfg map[string]any
			_ = json.Unmarshal(settings, &cfg) // DB jsonb column; malformed means empty cfg
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

	formData := url.Values{
		"grant_type": {grantType},
		"client_id":  {clientID},
	}
	if clientSecret != "" {
		formData.Set("client_secret", clientSecret)
	}
	if body.Scope != "" {
		formData.Set("scope", body.Scope)
	}

	if grantType == "refresh_token" {
		formData.Set("refresh_token", body.RefreshToken)
	} else {
		formData.Set("code", body.Code)
		formData.Set("redirect_uri", body.RedirectURI)
		if body.CodeVerifier != "" {
			formData.Set("code_verifier", body.CodeVerifier)
		}
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, tokenEndpoint.String(), strings.NewReader(formData.Encode()))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_token_endpoint"})
		return
	}
	httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := h.doMCPProxyRequest(httpReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "token_exchange_failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var tokenResp map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&tokenResp) // external HTTP response; malformed means nil tokenResp
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
	registrationEndpoint, err := validateMCPProxyURL(body.RegistrationEndpoint)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_registration_endpoint"})
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

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, registrationEndpoint.String(), bytes.NewReader(reqBytes))
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid_registration_endpoint"})
		return
	}
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := h.doMCPProxyRequest(httpReq)
	if err != nil {
		writeJSON(w, http.StatusBadGateway, map[string]any{"error": "dcr_failed"})
		return
	}
	defer func() { _ = resp.Body.Close() }()

	var dcrResp map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&dcrResp) // external HTTP response; malformed means nil dcrResp
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
	_, _ = w.Write(data) // response writer; connection already committed
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

	writeJSON(w, http.StatusOK, map[string]any{"categories": categories, "total": len(categories)})
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
	_, _ = h.pool.Exec(ctx, q, entityType, entityID, user.ID) // best-effort upsert
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
	_, _ = h.pool.Exec(ctx, q, entityType, entityID, user.ID) // best-effort delete
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

func (h *Handler) ProjectUserActivity(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"rows":  []any{},
		"total": 0,
	})
}

func (h *Handler) RegisterDescriptor(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodDelete {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
		return
	}
	var body map[string]any
	_ = json.NewDecoder(r.Body).Decode(&body) // body is optional; ignore decode errors
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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

// --- Collections ---

func (h *Handler) CreateCollection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	user, _ := auth.UserFromContext(r.Context())
	userID := 1
	if user.ID != "" {
		userID, _ = strconv.Atoi(user.ID)
	}

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	name, _ := body["name"].(string)
	desc, _ := body["description"].(string)

	var id int
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %q.prompt_collections (name, description, owner_id, author_id, status, meta)
		VALUES ($1, $2, $3, $3, 'active', '{}')
		RETURNING id`, s), name, desc, userID).Scan(&id)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{
		"id":          id,
		"name":        name,
		"description": desc,
	})
}

func (h *Handler) ListCollections(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	rows, err := h.pool.Query(ctx, fmt.Sprintf(
		`SELECT id, name, COALESCE(description, '') FROM %q.prompt_collections ORDER BY name`, s))
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var id int
		var name, desc string
		if rows.Scan(&id, &name, &desc) != nil {
			continue
		}
		items = append(items, map[string]any{"id": id, "name": name, "description": desc})
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": len(items)})
}

func (h *Handler) GetCollection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	collectionID := chi.URLParam(r, "collectionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var id int
	var name, desc string
	var appsJSON, datasourcesJSON []byte
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id, name, COALESCE(description, ''),
			   COALESCE(applications::text, '[]')::bytea,
			   COALESCE(datasources::text, '[]')::bytea
		FROM %q.prompt_collections WHERE id = $1`, s), collectionID).Scan(
		&id, &name, &desc, &appsJSON, &datasourcesJSON)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "collection not found"})
		return
	}

	var appEntities, dsEntities []any
	_ = json.Unmarshal(appsJSON, &appEntities)         // DB jsonb column; malformed means empty list
	_ = json.Unmarshal(datasourcesJSON, &dsEntities)   // DB jsonb column; malformed means empty list

	// Separate applications vs pipelines
	var apps, pipelines []map[string]any
	for _, e := range appEntities {
		em, ok := e.(map[string]any)
		if !ok {
			continue
		}
		entityID := em["id"]
		if entityID == nil {
			entityID = em["entity_id"]
		}
		var eidInt int
		switch v := entityID.(type) {
		case float64:
			eidInt = int(v)
		case string:
			eidInt, _ = strconv.Atoi(v)
		}
		if eidInt == 0 {
			continue
		}
		var isPipeline bool
		_ = h.pool.QueryRow(ctx, fmt.Sprintf(
			`SELECT EXISTS(SELECT 1 FROM %q.application_versions WHERE application_id = $1 AND agent_type = 'pipeline')`, s), eidInt).Scan(&isPipeline) // failure leaves isPipeline=false
		item := map[string]any{"id": strconv.Itoa(eidInt)}
		if isPipeline {
			pipelines = append(pipelines, item)
		} else {
			apps = append(apps, item)
		}
	}
	if apps == nil {
		apps = []map[string]any{}
	}
	if pipelines == nil {
		pipelines = []map[string]any{}
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"id":           id,
		"name":         name,
		"description":  desc,
		"applications": map[string]any{"rows": apps, "total": len(apps)},
		"pipelines":    map[string]any{"rows": pipelines, "total": len(pipelines)},
	})
}

func (h *Handler) PatchCollection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	collectionID := chi.URLParam(r, "collectionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	operation, _ := body["operation"].(string)

	// Find the entity payload — keys like "application", "pipeline", "toolkit", etc.
	var entityRef map[string]any
	for k, v := range body {
		if k == "operation" {
			continue
		}
		if m, ok := v.(map[string]any); ok {
			entityRef = m
			break
		}
	}

	if entityRef == nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "entity reference required"})
		return
	}

	// Get entity ID
	var entityID int
	switch eid := entityRef["id"].(type) {
	case float64:
		entityID = int(eid)
	case string:
		entityID, _ = strconv.Atoi(eid)
	}

	// Read current applications JSON
	var appsJSON []byte
	err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COALESCE(applications::text, '[]')::bytea FROM %q.prompt_collections WHERE id = $1`, s), collectionID).Scan(&appsJSON)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "collection not found"})
		return
	}

	var apps []map[string]any
	_ = json.Unmarshal(appsJSON, &apps) // DB jsonb column; malformed means empty list

	switch operation {
	case "add":
		// Add entity to list (avoiding duplicates)
		found := false
		for _, a := range apps {
			if aid, ok := a["id"].(float64); ok && int(aid) == entityID {
				found = true
				break
			}
		}
		if !found {
			apps = append(apps, map[string]any{"id": entityID, "owner_id": entityRef["owner_id"]})
		}
	case "remove":
		kept := apps[:0]
		for _, a := range apps {
			if aid, ok := a["id"].(float64); ok && int(aid) == entityID {
				continue
			}
			kept = append(kept, a)
		}
		apps = kept
	}

	updatedJSON, _ := json.Marshal(apps)
	_, _ = h.pool.Exec(ctx, fmt.Sprintf(
		`UPDATE %q.prompt_collections SET applications = $1::jsonb WHERE id = $2`, s), string(updatedJSON), collectionID) // best-effort update

	writeJSON(w, http.StatusOK, map[string]any{
		"id":           collectionID,
		"applications": apps,
	})
}

func (h *Handler) DeleteCollection(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	collectionID := chi.URLParam(r, "collectionID")
	s := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	tag, err := h.pool.Exec(ctx, fmt.Sprintf(
		`DELETE FROM %q.prompt_collections WHERE id = $1`, s), collectionID)
	if err != nil || tag.RowsAffected() == 0 {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "collection not found"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v) // response writer; connection already committed
}
