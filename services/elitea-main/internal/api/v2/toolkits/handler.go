package toolkits

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type Tool struct {
	ID          string         `json:"id"`
	Name        string         `json:"name"`
	Type        string         `json:"type"`
	Description string         `json:"description,omitempty"`
	OwnerID     string         `json:"owner_id,omitempty"`
	Settings    map[string]any `json:"settings,omitempty"`
}

type Repository interface {
	ListTypes(ctx context.Context, projectID string) ([]string, error)
	AvailableTools(ctx context.Context, projectID, toolkitID string) ([]Tool, error)
	DiscoverTools(ctx context.Context, projectID, toolkitType string) ([]Tool, error)
	ValidateToolkit(ctx context.Context, projectID, toolkitID string) (bool, error)
	ForkToolkit(ctx context.Context, projectID string, body map[string]any) (Tool, error)

	// CRUD for toolkit instances (/tools/ and /tool/ paths)
	ListToolkits(ctx context.Context, projectID string, page, pageSize int) ([]map[string]any, int, error)
	CreateToolkit(ctx context.Context, projectID string, body map[string]any) (map[string]any, error)
	GetToolkit(ctx context.Context, projectID, toolkitID string) (map[string]any, error)
	UpdateToolkit(ctx context.Context, projectID, toolkitID string, body map[string]any) (map[string]any, error)
	DeleteToolkit(ctx context.Context, projectID, toolkitID string) error
}

// NOTE(#126): a ToolTester interface and a `tester` field stood here, plus
// TestToolRequest/TestToolResponse aliases onto internal/infra/indexersvc. The
// only implementation was that prototype Redis RPC client, which no composition
// root ever assigned, so both tool-testing endpoints have always answered 503.
// The transport was retired (see the IndexerDeps note in
// internal/api/router.go) and the seam went with it. #194 records the gap.

type Handler struct {
	repo Repository
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{repo: &pgRepo{pool: pool}, pool: pool}
}

func NewHandlerWithRepo(repo Repository) *Handler {
	return &Handler{repo: repo}
}

// knownToolkitTypes is the baseline list of toolkit types pylon_indexer supports.
// DB types are merged in at runtime so newly-registered types appear automatically.
var knownToolkitTypes = []string{
	"datasource",
	"file_loader",
	"web_loader",
	"confluence_loader",
	"github_loader",
	"jira_loader",
	"s3_loader",
	"openapi",
	"database",
	"custom",
}

func (h *Handler) ListTypes(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	dbTypes, _ := h.repo.ListTypes(r.Context(), projectID)

	// Merge DB types with known list, deduplicating.
	seen := make(map[string]struct{})
	merged := make([]string, 0, len(knownToolkitTypes)+len(dbTypes))
	for _, t := range knownToolkitTypes {
		if _, ok := seen[t]; !ok {
			seen[t] = struct{}{}
			merged = append(merged, t)
		}
	}
	for _, t := range dbTypes {
		if _, ok := seen[t]; !ok {
			seen[t] = struct{}{}
			merged = append(merged, t)
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"rows": merged, "total": len(merged)})
}

// toolkitTypeSchemas defines the JSON Schema for each toolkit type's settings.
// This matches what pylon_indexer returns at /toolkits/ endpoint.
var toolkitTypeSchemas = map[string]map[string]any{
	"artifact": {
		"type": "object",
		"properties": map[string]any{
			"bucket":                 map[string]any{"type": "string"},
			"pgvector_configuration": map[string]any{"type": "object"},
			"embedding_model":        map[string]any{"type": "string"},
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"index_data":      map[string]any{"type": "object"},
					"search_data":     map[string]any{"type": "object"},
					"list_buckets":    map[string]any{"type": "object"},
					"list_artifacts":  map[string]any{"type": "object"},
					"read_artifact":   map[string]any{"type": "object"},
					"upload_artifact": map[string]any{"type": "object"},
					"delete_artifact": map[string]any{"type": "object"},
				},
			},
		},
	},
	"github": {
		"type": "object",
		"properties": map[string]any{
			"repository":   map[string]any{"type": "string"},
			"access_token": map[string]any{"type": "string"},
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"get_issue":           map[string]any{"type": "object"},
					"list_issues":         map[string]any{"type": "object"},
					"create_issue":        map[string]any{"type": "object"},
					"update_issue":        map[string]any{"type": "object"},
					"comment_on_issue":    map[string]any{"type": "object"},
					"get_pull_request":    map[string]any{"type": "object"},
					"list_pull_requests":  map[string]any{"type": "object"},
					"create_pull_request": map[string]any{"type": "object"},
					"get_file_content":    map[string]any{"type": "object"},
					"list_files":          map[string]any{"type": "object"},
					"search_code":         map[string]any{"type": "object"},
					"create_file":         map[string]any{"type": "object"},
					"update_file":         map[string]any{"type": "object"},
					"delete_file":         map[string]any{"type": "object"},
					"list_branches":       map[string]any{"type": "object"},
					"create_branch":       map[string]any{"type": "object"},
				},
			},
		},
	},
	"jira": {
		"type": "object",
		"properties": map[string]any{
			"url":      map[string]any{"type": "string"},
			"username": map[string]any{"type": "string"},
			"password": map[string]any{"type": "string"},
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"get_issue":    map[string]any{"type": "object"},
					"search_jql":   map[string]any{"type": "object"},
					"create_issue": map[string]any{"type": "object"},
					"update_issue": map[string]any{"type": "object"},
					"add_comment":  map[string]any{"type": "object"},
				},
			},
		},
	},
	"openapi": {
		"type": "object",
		"properties": map[string]any{
			"spec_url": map[string]any{"type": "string"},
			"selected_tools": map[string]any{
				"type":         "object",
				"args_schemas": map[string]any{},
			},
		},
	},
	"database": {
		"type": "object",
		"properties": map[string]any{
			"connection_string": map[string]any{"type": "string"},
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"query":          map[string]any{"type": "object"},
					"list_tables":    map[string]any{"type": "object"},
					"describe_table": map[string]any{"type": "object"},
				},
			},
		},
	},
	"custom": {
		"type": "object",
		"properties": map[string]any{
			"selected_tools": map[string]any{
				"type":         "object",
				"args_schemas": map[string]any{},
			},
		},
	},
	"datasource": {
		"type": "object",
		"properties": map[string]any{
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"search_data": map[string]any{"type": "object"},
					"index_data":  map[string]any{"type": "object"},
				},
			},
		},
	},
	"application": {
		"type": "object",
		"properties": map[string]any{
			"application_id":         map[string]any{"type": "integer"},
			"application_version_id": map[string]any{"type": "integer"},
			"selected_tools": map[string]any{
				"type": "object",
				"args_schemas": map[string]any{
					"ask_agent": map[string]any{"type": "object"},
				},
			},
		},
	},
}

func (h *Handler) ListTypeSchemas(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, toolkitTypeSchemas)
}

func (h *Handler) AvailableTools(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	tools, err := h.repo.AvailableTools(r.Context(), projectID, toolkitID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"tools": []any{}, "total": 0})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools, "total": len(tools)})
}

func (h *Handler) DiscoverTools(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitType := chi.URLParam(r, "toolkitType")
	tools, err := h.repo.DiscoverTools(r.Context(), projectID, toolkitType)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"tools": []any{}, "total": 0})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tools": tools, "total": len(tools)})
}

func (h *Handler) ValidateToolkit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	valid, err := h.repo.ValidateToolkit(r.Context(), projectID, toolkitID)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"valid": false,
			"settings_errors": []map[string]any{
				{"loc": []string{"embedding_model"}, "msg": err.Error(), "type": "value_error"},
			},
		})
		return
	}
	if !valid {
		writeJSON(w, http.StatusBadRequest, map[string]any{"valid": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": true})
}

func (h *Handler) ForkToolkit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	tool, err := h.repo.ForkToolkit(r.Context(), projectID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, tool)
}

// TestTool reports that running a single tool has no backend in this stack.
// See the NOTE(#126) above the Handler declaration; the 503 body is unchanged
// from what every deployment already returned.
func (h *Handler) TestTool(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "indexer service not available"})
}

// TestToolkitTool reports that running a toolkit's tool has no backend in this
// stack. See the NOTE(#126) above the Handler declaration; the 503 body is
// unchanged from what every deployment already returned.
func (h *Handler) TestToolkitTool(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil && err != io.EOF {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "indexer service not available"})
}

func (h *Handler) ExportToolkit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	ctx := r.Context()

	s := fmt.Sprintf("p_%s", projectID)
	var name, toolType, desc string
	var settings, envVars, meta []byte
	err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, type, COALESCE(description, ''), COALESCE(settings::text, '{}'),
			COALESCE(env_vars::text, '[]'), COALESCE(meta::text, '{}')
		FROM %q.elitea_tools WHERE id = $1`, s), toolkitID).Scan(
		&name, &toolType, &desc, &settings, &envVars, &meta)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "toolkit not found"})
		return
	}

	var settingsObj, envVarsObj, metaObj any
	// DB columns are stored as valid JSON; Unmarshal into any cannot fail for well-formed rows.
	_ = json.Unmarshal(settings, &settingsObj)
	_ = json.Unmarshal(envVars, &envVarsObj)
	_ = json.Unmarshal(meta, &metaObj)

	fork := r.URL.Query().Get("fork") == "true"
	result := map[string]any{
		"id":          toolkitID,
		"name":        name,
		"type":        toolType,
		"description": desc,
		"settings":    redactSettings(settingsObj),
		"env_vars":    envVarsObj,
		"meta":        metaObj,
		"forked":      fork,
	}
	writeJSON(w, http.StatusOK, result)
}

func (h *Handler) IndexMeta(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	ctx := r.Context()

	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT id, name, status, progress, created_at FROM %q.index_meta WHERE toolkit_id = $1 ORDER BY created_at DESC`, s)
	rows, err := h.pool.Query(ctx, q, toolkitID)
	if err != nil {
		// Was: `writeJSON(w, http.StatusOK, map[string]any{"items": []any{},
		// "total": 0})`. Two defects in one line, both found while mounting the
		// web client's Indexes tab (#149):
		//
		//  1. It answers a DIFFERENT SHAPE than the success path below, which
		//     writes a bare JSON array. A caller that (correctly) reads this
		//     endpoint as an array got an object instead and crashed —
		//     measured as an `e.map is not a function` error boundary on
		//     /app/toolkits/all/{id}.
		//  2. It reports 200 for a failed query, so a genuinely broken or
		//     missing `index_meta` table looks exactly like "this toolkit has
		//     no indexes yet". That is precisely how the missing table went
		//     unnoticed: `p_1.index_meta` was absent from
		//     `internal/infra/db/migrations/001_initial.sql` (added in the
		//     same change as this one) and every request quietly took this
		//     branch.
		//
		// A read that could not run is an error, not an empty list.
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var id, name, status string
		var progress float64
		var createdAt any
		if err := rows.Scan(&id, &name, &status, &progress, &createdAt); err != nil {
			continue
		}
		items = append(items, map[string]any{"id": id, "name": name, "status": status, "progress": progress, "created_at": createdAt})
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, items)
}

func (h *Handler) IndexMetaGet(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	indexMetaID := chi.URLParam(r, "indexMetaID")
	ctx := r.Context()

	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT id, name, status, progress, created_at FROM %q.index_meta WHERE id = $1`, s)
	var id, name, status string
	var progress float64
	var createdAt any
	err := h.pool.QueryRow(ctx, q, indexMetaID).Scan(&id, &name, &status, &progress, &createdAt)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "name": name, "status": status, "progress": progress, "created_at": createdAt})
}

// IndexMetaUpdate, IndexMetaDelete and IndexCancel live in index_write.go.
// They used to be three one-line stubs here that answered `{"ok":true}`/204
// without touching the database (#180).

func (h *Handler) IndexTypes(w http.ResponseWriter, _ *http.Request) {
	items := []map[string]any{
		{
			"type":                 "file_loader",
			"name":                 "File Loader",
			"description":          "Load documents from uploaded files",
			"supported_extensions": []string{"pdf", "txt", "docx", "xlsx", "csv", "md", "json", "html", "xml", "pptx"},
		},
		{
			"type":                 "web_loader",
			"name":                 "Web Loader",
			"description":          "Load documents from web URLs",
			"supported_extensions": []string{},
		},
		{
			"type":                 "confluence_loader",
			"name":                 "Confluence Loader",
			"description":          "Load documents from Confluence spaces",
			"supported_extensions": []string{},
		},
		{
			"type":                 "github_loader",
			"name":                 "GitHub Loader",
			"description":          "Load documents from GitHub repositories",
			"supported_extensions": []string{},
		},
		{
			"type":                 "jira_loader",
			"name":                 "Jira Loader",
			"description":          "Load documents from Jira projects",
			"supported_extensions": []string{},
		},
		{
			"type":                 "s3_loader",
			"name":                 "S3 Loader",
			"description":          "Load documents from S3 buckets",
			"supported_extensions": []string{},
		},
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": len(items),
	})
}

// List returns all toolkit instances for a project.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	// UI sends limit/offset
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit < 1 || limit > 100 {
		limit = 20
	}
	if offset < 0 {
		offset = 0
	}
	page := (offset / limit) + 1

	items, total, err := h.repo.ListToolkits(r.Context(), projectID, page, limit)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to list toolkits"})
		return
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": items, "total": total})
}

// Create creates a new toolkit instance.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	user, _ := auth.UserFromContext(r.Context())
	userID := user.ID
	if userID == "" {
		userID = "1"
	}
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	if err := validateToolkitCreate(body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": err.Error()})
		return
	}

	body["_author_id"] = userID
	item, err := h.repo.CreateToolkit(r.Context(), projectID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func validateToolkitCreate(body map[string]any) error {
	toolType, _ := body["type"].(string)
	settings, _ := body["settings"].(map[string]any)

	switch toolType {
	case "github":
		if settings == nil {
			return fmt.Errorf("settings is required for github toolkit")
		}
		repo, _ := settings["repository"].(string)
		if repo == "" {
			return fmt.Errorf("settings.repository is required for github toolkit")
		}
		if settings["github_configuration"] == nil {
			return fmt.Errorf("settings.github_configuration is required for github toolkit")
		}
	}
	return nil
}

// Get returns a single toolkit instance.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	item, err := h.repo.GetToolkit(r.Context(), projectID, toolkitID)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not found"})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// Update updates a toolkit instance (handles PUT and PATCH).
// Also handles tool-entity relation changes when body contains has_relation.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}

	// Detect tool-entity relation operation (add_tool_to / remove_tool_from)
	if _, hasRelation := body["has_relation"]; hasRelation {
		h.updateToolRelation(w, r, projectID, toolkitID, body)
		return
	}

	item, err := h.repo.UpdateToolkit(r.Context(), projectID, toolkitID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (h *Handler) updateToolRelation(w http.ResponseWriter, r *http.Request, projectID, toolID string, body map[string]any) {
	ctx := r.Context()
	s := fmt.Sprintf("p_%s", projectID)
	entityVersionID, _ := body["entity_version_id"].(string)
	if entityVersionID == "" {
		if f, ok := body["entity_version_id"].(float64); ok {
			entityVersionID = strconv.Itoa(int(f))
		}
	}
	entityID, _ := body["entity_id"].(string)
	if entityID == "" {
		if f, ok := body["entity_id"].(float64); ok {
			entityID = strconv.Itoa(int(f))
		}
	}
	entityType, _ := body["entity_type"].(string)
	if entityType == "" {
		entityType = "agent"
	}
	hasRelation, _ := body["has_relation"].(bool)

	// Guard: block changes to published/embedded versions
	var verStatus string
	err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT status FROM %q.application_versions WHERE id = $1`, s), entityVersionID).Scan(&verStatus)
	if err == nil && (verStatus == "published" || verStatus == "embedded") {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "Cannot change tools on a published version. Unpublish first.",
		})
		return
	}

	if hasRelation {
		q := fmt.Sprintf(`INSERT INTO %q.entity_tool_mapping (entity_version_id, entity_id, entity_type, tool_id) VALUES ($1, $2, $3, $4) ON CONFLICT (entity_version_id, tool_id, entity_type) DO NOTHING`, s)
		_, err := h.pool.Exec(ctx, q, entityVersionID, entityID, entityType, toolID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
	} else {
		q := fmt.Sprintf(`DELETE FROM %q.entity_tool_mapping WHERE entity_version_id = $1 AND tool_id = $2`, s)
		_, err := h.pool.Exec(ctx, q, entityVersionID, toolID)
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
			return
		}
	}
	writeJSON(w, http.StatusCreated, map[string]any{"message": "ok"})
}

// Delete removes a toolkit instance.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	if err := h.repo.DeleteToolkit(r.Context(), projectID, toolkitID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type pgRepo struct {
	pool *pgxpool.Pool
}

func (r *pgRepo) ListTypes(ctx context.Context, projectID string) ([]string, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT DISTINCT type FROM %q.elitea_tools WHERE type != '' ORDER BY type`, s)
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return []string{}, nil
	}
	defer rows.Close()
	var types []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			continue
		}
		types = append(types, t)
	}
	if types == nil {
		types = []string{}
	}
	return types, nil
}

func (r *pgRepo) AvailableTools(ctx context.Context, projectID, toolkitID string) ([]Tool, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`
		SELECT t.id, t.name, t.type, COALESCE(t.description, '')
		FROM %q.entity_tool_mapping etm
		JOIN %q.elitea_tools t ON t.id = etm.tool_id
		WHERE etm.entity_version_id = $1`, s, s)
	rows, err := r.pool.Query(ctx, q, toolkitID)
	if err != nil {
		return []Tool{}, nil
	}
	defer rows.Close()
	var tools []Tool
	for rows.Next() {
		var t Tool
		if err := rows.Scan(&t.ID, &t.Name, &t.Type, &t.Description); err != nil {
			continue
		}
		tools = append(tools, t)
	}
	if tools == nil {
		tools = []Tool{}
	}
	return tools, nil
}

func (r *pgRepo) DiscoverTools(ctx context.Context, projectID, toolkitType string) ([]Tool, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT id, name, type, COALESCE(description, '') FROM %q.elitea_tools WHERE type = $1 ORDER BY name`, s)
	rows, err := r.pool.Query(ctx, q, toolkitType)
	if err != nil {
		return []Tool{}, nil
	}
	defer rows.Close()
	var tools []Tool
	for rows.Next() {
		var t Tool
		if err := rows.Scan(&t.ID, &t.Name, &t.Type, &t.Description); err != nil {
			continue
		}
		tools = append(tools, t)
	}
	if tools == nil {
		tools = []Tool{}
	}
	return tools, nil
}

func (r *pgRepo) ValidateToolkit(ctx context.Context, projectID, toolkitID string) (bool, error) {
	s := fmt.Sprintf("p_%s", projectID)

	var settingsStr *string
	q := fmt.Sprintf(`SELECT settings::text FROM %q.elitea_tools WHERE id = $1`, s)
	err := r.pool.QueryRow(ctx, q, toolkitID).Scan(&settingsStr)
	if err != nil {
		return false, fmt.Errorf("toolkit not found")
	}
	if settingsStr == nil {
		return true, nil
	}

	var settings map[string]any
	// settingsStr is a DB JSON column; Unmarshal into map cannot fail for well-formed rows.
	_ = json.Unmarshal([]byte(*settingsStr), &settings)

	// Check if referenced embedding_model config still exists
	if embModel, ok := settings["embedding_model"]; ok && embModel != nil {
		embName := fmt.Sprintf("%v", embModel)
		if embName != "" {
			var configExists bool
			cq := fmt.Sprintf(`SELECT EXISTS(
				SELECT 1 FROM %q.configuration
				WHERE type = 'embedding_model' AND data->>'name' = $1
			)`, s)
			if err := r.pool.QueryRow(ctx, cq, embName).Scan(&configExists); err != nil {
				return false, fmt.Errorf("check embedding model: %w", err)
			}
			if !configExists {
				return false, fmt.Errorf("embedding model '%s' not found", embName)
			}
		}
	}

	return true, nil
}

func (r *pgRepo) ForkToolkit(ctx context.Context, projectID string, body map[string]any) (Tool, error) {
	s := fmt.Sprintf("p_%s", projectID)
	sourceID, _ := body["source_id"].(string)
	q := fmt.Sprintf(`
		INSERT INTO %q.elitea_tools (name, type, description, owner_id, settings, env_vars, meta)
		SELECT name || ' (copy)', type, description, owner_id, settings, env_vars, meta
		FROM %q.elitea_tools WHERE id = $1
		RETURNING id, name, type, COALESCE(description, '')`, s, s)
	var t Tool
	err := r.pool.QueryRow(ctx, q, sourceID).Scan(&t.ID, &t.Name, &t.Type, &t.Description)
	if err != nil {
		return Tool{}, fmt.Errorf("fork toolkit: %w", err)
	}
	return t, nil
}

func (r *pgRepo) ListToolkits(ctx context.Context, projectID string, page, pageSize int) ([]map[string]any, int, error) {
	s := fmt.Sprintf("p_%s", projectID)
	offset := (page - 1) * pageSize

	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.elitea_tools`, s)
	if err := r.pool.QueryRow(ctx, countQ).Scan(&total); err != nil {
		return nil, 0, err
	}

	q := fmt.Sprintf(`
		SELECT id, type, name, COALESCE(description,''),
		       COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		       created_at, author_id
		FROM %q.elitea_tools
		ORDER BY name LIMIT $1 OFFSET $2`, s)
	rows, err := r.pool.Query(ctx, q, pageSize, offset)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	var items []map[string]any
	for rows.Next() {
		var id, typ, name, desc string
		var settingsRaw, metaRaw []byte
		var createdAt, authorID any
		if err := rows.Scan(&id, &typ, &name, &desc, &settingsRaw, &metaRaw, &createdAt, &authorID); err != nil {
			continue
		}
		var settings, meta any
		// DB columns are valid JSON; Unmarshal into any cannot fail for well-formed rows.
		_ = json.Unmarshal(settingsRaw, &settings)
		_ = json.Unmarshal(metaRaw, &meta)
		items = append(items, map[string]any{
			"id":          id,
			"type":        typ,
			"name":        name,
			"description": desc,
			"settings":    redactSettings(settings),
			"meta":        meta,
			"created_at":  createdAt,
			"author_id":   authorID,
		})
	}
	return items, total, nil
}

// redactSettings returns a deep copy of settings with credential-like values
// removed. Toolkit configuration is not a secret transport; execution code
// reads the stored JSON directly and must never depend on this API response.
func redactSettings(value any) any {
	switch v := value.(type) {
	case map[string]any:
		out := make(map[string]any, len(v))
		for key, nested := range v {
			if isSensitiveSettingKey(key) {
				continue
			}
			out[key] = redactSettings(nested)
		}
		return out
	case []any:
		out := make([]any, len(v))
		for i, nested := range v {
			out[i] = redactSettings(nested)
		}
		return out
	default:
		return value
	}
}

func isSensitiveSettingKey(key string) bool {
	key = strings.ToLower(key)
	return strings.Contains(key, "secret") || strings.Contains(key, "token") ||
		strings.Contains(key, "password") || strings.Contains(key, "credential") ||
		strings.Contains(key, "api_key") || strings.Contains(key, "apikey")
}

// tenantOwnerID converts a tenant project id into the integer written to the
// tenant tables' owner_id column. The p_<id> schema name is the project id, so
// a schema we can address is by definition a project id we can store.
func tenantOwnerID(projectID string) (int, error) {
	ownerID, err := strconv.Atoi(projectID)
	if err != nil || ownerID <= 0 {
		return 0, fmt.Errorf("create toolkit: %q is not a project id", projectID)
	}
	return ownerID, nil
}

// createToolkitInsertSQL builds the elitea_tools INSERT for one tenant schema.
//
// owner_id is the OWNING PROJECT id, not the creating user. author_id is the
// creating user. The two are different columns because they are different
// things, and copying author_id into owner_id would write a user id into a
// project-id column. Evidence, in order of weight:
//
//   - The legacy runtime's tenant tables that DO have owner_id store the
//     project id there: every row of p_1.applications in the legacy database
//     has owner_id = 1, and legacy elitea_core queries filter with
//     `Skill.owner_id == project_id` and construct rows with
//     `{'owner_id': project_id}` (utils/skill_utils.py:1066,1114;
//     utils/application_utils.py:273).
//   - Publishing writes `{'owner_id': public_project_id, 'shared_owner_id':
//     src['project_id']}` (utils/publish_utils.py:1010-1011) — both halves of
//     the owner_id/shared_owner_id pair are project ids.
//   - elitea_tools' own sibling column shared_owner_id is unambiguously a
//     project id (utils/fork.py:143-146 uses it as parent_project_id), and
//     owner_id is the same name without the "shared" qualifier.
//   - ForkToolkit already carries owner_id across a same-schema copy
//     (handler.go, `SELECT ... owner_id ... FROM %q.elitea_tools`), which is
//     only coherent if the value is a property of the project, not of the
//     user who happens to be forking.
//
// Note that legacy's elitea_tools table has no owner_id column at all (checked
// against the running legacy database: id, created_at, updated_at, type, name,
// description, settings, author_id, shared_owner_id, shared_id, meta). The
// NOT NULL column is an invention of migrations/001_initial.sql. Because that
// migration has already been applied everywhere, the fix is to populate the
// column with the value its name means in this schema family rather than to
// alter the shipped DDL.
func createToolkitInsertSQL(schema string) string {
	return fmt.Sprintf(`
		INSERT INTO %q.elitea_tools (name, type, description, settings, meta, owner_id, author_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id, type, name, COALESCE(description,''),
		          COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		       created_at, author_id`, schema)
}

func (r *pgRepo) CreateToolkit(ctx context.Context, projectID string, body map[string]any) (map[string]any, error) {
	s := fmt.Sprintf("p_%s", projectID)
	name, _ := body["name"].(string)
	typ, _ := body["type"].(string)
	desc, _ := body["description"].(string)
	authorIDStr, _ := body["_author_id"].(string)
	if authorIDStr == "" {
		authorIDStr = "1"
	}

	settingsJSON, _ := json.Marshal(body["settings"])
	if settingsJSON == nil || string(settingsJSON) == "null" {
		settingsJSON = []byte("{}")
	}
	metaJSON, _ := json.Marshal(body["meta"])
	if metaJSON == nil || string(metaJSON) == "null" {
		metaJSON = []byte("{}")
	}
	// owner_id is the OWNING PROJECT, not the creating user — see
	// createToolkitInsertSQL for the evidence. author_id already carries the
	// principal; the project is exactly the tenant schema we are writing into.
	ownerID, err := tenantOwnerID(projectID)
	if err != nil {
		return nil, err
	}

	q := createToolkitInsertSQL(s)
	var id, retType, retName, retDesc string
	var settingsRaw, metaRaw []byte
	var createdAt, authorID any
	err = r.pool.QueryRow(ctx, q, name, typ, desc, string(settingsJSON), string(metaJSON), ownerID, authorIDStr).Scan(
		&id, &retType, &retName, &retDesc, &settingsRaw, &metaRaw,
		&createdAt, &authorID)
	if err != nil {
		return nil, fmt.Errorf("create toolkit: %w", err)
	}
	var settings, meta any
	// DB columns are valid JSON; Unmarshal into any cannot fail for well-formed rows.
	_ = json.Unmarshal(settingsRaw, &settings)
	_ = json.Unmarshal(metaRaw, &meta)
	return map[string]any{
		"id":          id,
		"type":        retType,
		"name":        retName,
		"description": retDesc,
		"settings":    redactSettings(settings),
		"meta":        meta,
		"created_at":  createdAt,
		"author_id":   authorID,
	}, nil
}

func (r *pgRepo) GetToolkit(ctx context.Context, projectID, toolkitID string) (map[string]any, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`
		SELECT t.id, t.type, t.name, COALESCE(t.description,''),
		       COALESCE(t.settings::text,'{}'), COALESCE(t.meta::text,'{}'),
		       t.created_at, t.author_id,
		       COALESCE(u.id, 0), COALESCE(u.email, ''), COALESCE(u.name, '')
		FROM %q.elitea_tools t
		LEFT JOIN public.auth_core__user u ON u.id = t.author_id
		WHERE t.id = $1`, s)
	var id, typ, name, desc string
	var settingsRaw, metaRaw []byte
	var createdAt, authorID any
	var uID int
	var uEmail, uName string
	if err := r.pool.QueryRow(ctx, q, toolkitID).Scan(
		&id, &typ, &name, &desc, &settingsRaw, &metaRaw,
		&createdAt, &authorID,
		&uID, &uEmail, &uName); err != nil {
		return nil, fmt.Errorf("get toolkit: %w", err)
	}
	var settings, meta any
	// DB columns are valid JSON; Unmarshal into any cannot fail for well-formed rows.
	_ = json.Unmarshal(settingsRaw, &settings)
	_ = json.Unmarshal(metaRaw, &meta)

	author := map[string]any{"id": strconv.Itoa(uID), "email": uEmail, "name": uName}

	// toolkit_name is a sanitized version: only alphanumeric chars kept
	sanitizedName := sanitizeToolkitName(name)

	result := map[string]any{
		"id":           id,
		"type":         typ,
		"name":         name,
		"toolkit_name": sanitizedName,
		"description":  desc,
		"settings":     redactSettings(settings),
		"meta":         meta,
		"created_at":   createdAt,
		"author_id":    authorID,
		"author":       author,
		"agent_type":   nil,
		"online":       nil,
	}
	return result, nil
}

func (r *pgRepo) UpdateToolkit(ctx context.Context, projectID, toolkitID string, body map[string]any) (map[string]any, error) {
	s := fmt.Sprintf("p_%s", projectID)
	// Build partial update from provided fields.
	var setClauses []string
	var args []any
	argIdx := 1
	if v, ok := body["name"]; ok {
		setClauses = append(setClauses, fmt.Sprintf("name = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := body["type"]; ok {
		setClauses = append(setClauses, fmt.Sprintf("type = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := body["description"]; ok {
		setClauses = append(setClauses, fmt.Sprintf("description = $%d", argIdx))
		args = append(args, v)
		argIdx++
	}
	if v, ok := body["settings"]; ok {
		b, _ := json.Marshal(v)
		setClauses = append(setClauses, fmt.Sprintf("settings = $%d", argIdx))
		args = append(args, string(b))
		argIdx++
	}
	if v, ok := body["meta"]; ok {
		b, _ := json.Marshal(v)
		setClauses = append(setClauses, fmt.Sprintf("meta = $%d", argIdx))
		args = append(args, string(b))
		argIdx++
	}
	if len(setClauses) == 0 {
		return r.GetToolkit(ctx, projectID, toolkitID)
	}
	args = append(args, toolkitID)
	q := fmt.Sprintf(`
		UPDATE %q.elitea_tools SET %s WHERE id = $%d
		RETURNING id, type, name, COALESCE(description,''),
		          COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		          created_at, author_id`,
		s, strings.Join(setClauses, ", "), argIdx)
	var id, typ, name, desc string
	var settingsRaw, metaRaw []byte
	var createdAt, authorID any
	if err := r.pool.QueryRow(ctx, q, args...).Scan(
		&id, &typ, &name, &desc, &settingsRaw, &metaRaw,
		&createdAt, &authorID); err != nil {
		return nil, fmt.Errorf("update toolkit: %w", err)
	}
	var settings, meta any
	// DB columns are valid JSON; Unmarshal into any cannot fail for well-formed rows.
	_ = json.Unmarshal(settingsRaw, &settings)
	_ = json.Unmarshal(metaRaw, &meta)
	return map[string]any{
		"id":          id,
		"type":        typ,
		"name":        name,
		"description": desc,
		"settings":    redactSettings(settings),
		"meta":        meta,
		"created_at":  createdAt,
		"author_id":   authorID,
	}, nil
}

func (r *pgRepo) DeleteToolkit(ctx context.Context, projectID, toolkitID string) error {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`DELETE FROM %q.elitea_tools WHERE id = $1`, s)
	_, err := r.pool.Exec(ctx, q, toolkitID)
	return err
}

func sanitizeToolkitName(name string) string {
	var b strings.Builder
	for _, c := range name {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') {
			b.WriteRune(c)
		}
	}
	return b.String()
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	// Response is already committed; encoding errors cannot be surfaced to the client.
	_ = json.NewEncoder(w).Encode(v)
}
