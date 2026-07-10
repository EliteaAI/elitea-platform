package toolkits

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/indexersvc"
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

type ToolTester interface {
	TestTool(ctx context.Context, req TestToolRequest) (TestToolResponse, error)
}

type TestToolRequest = indexersvc.TestToolRequest
type TestToolResponse = indexersvc.TestToolResponse

type Handler struct {
	repo    Repository
	pool    *pgxpool.Pool
	tester  ToolTester
}

func NewHandler(pool *pgxpool.Pool, tester ToolTester) *Handler {
	return &Handler{repo: &pgRepo{pool: pool}, pool: pool, tester: tester}
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

	writeJSON(w, http.StatusOK, map[string]any{"toolkit_types": merged, "total": len(merged)})
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
		writeJSON(w, http.StatusOK, map[string]any{"valid": false})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"valid": valid})
}

func (h *Handler) ForkToolkit(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	tool, err := h.repo.ForkToolkit(r.Context(), projectID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, tool)
}

func (h *Handler) TestTool(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolID := chi.URLParam(r, "toolID")

	user, ok := auth.UserFromContext(r.Context())
	userID := ""
	if ok {
		userID = user.ID
	}

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	toolParams, _ := body["tool_params"].(map[string]any)
	toolName, _ := body["tool_name"].(string)

	if h.tester == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "indexer service not available"})
		return
	}

	resp, err := h.tester.TestTool(r.Context(), indexersvc.TestToolRequest{
		ProjectID:  projectID,
		ToolID:     toolID,
		ToolName:   toolName,
		ToolParams: toolParams,
		UserID:     userID,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
}

func (h *Handler) TestToolkitTool(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")

	user, ok := auth.UserFromContext(r.Context())
	userID := ""
	if ok {
		userID = user.ID
	}

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	toolkitID, _ := body["toolkit_id"].(string)
	toolName, _ := body["tool_name"].(string)
	toolParams, _ := body["tool_params"].(map[string]any)

	if h.tester == nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"ok": false, "error": "indexer service not available"})
		return
	}

	resp, err := h.tester.TestTool(r.Context(), indexersvc.TestToolRequest{
		ProjectID:  projectID,
		ToolkitID:  toolkitID,
		ToolName:   toolName,
		ToolParams: toolParams,
		UserID:     userID,
	})
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, resp)
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
	json.Unmarshal(settings, &settingsObj)
	json.Unmarshal(envVars, &envVarsObj)
	json.Unmarshal(meta, &metaObj)

	fork := r.URL.Query().Get("fork") == "true"
	result := map[string]any{
		"id":          toolkitID,
		"name":        name,
		"type":        toolType,
		"description": desc,
		"settings":    settingsObj,
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
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
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
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
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

func (h *Handler) IndexMetaUpdate(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) IndexMetaDelete(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) IndexCancel(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (h *Handler) IndexTypes(w http.ResponseWriter, _ *http.Request) {
	items := []map[string]any{
		{
			"type":                "file_loader",
			"name":                "File Loader",
			"description":         "Load documents from uploaded files",
			"supported_extensions": []string{"pdf", "txt", "docx", "xlsx", "csv", "md", "json", "html", "xml", "pptx"},
		},
		{
			"type":                "web_loader",
			"name":                "Web Loader",
			"description":         "Load documents from web URLs",
			"supported_extensions": []string{},
		},
		{
			"type":                "confluence_loader",
			"name":                "Confluence Loader",
			"description":         "Load documents from Confluence spaces",
			"supported_extensions": []string{},
		},
		{
			"type":                "github_loader",
			"name":                "GitHub Loader",
			"description":         "Load documents from GitHub repositories",
			"supported_extensions": []string{},
		},
		{
			"type":                "jira_loader",
			"name":                "Jira Loader",
			"description":         "Load documents from Jira projects",
			"supported_extensions": []string{},
		},
		{
			"type":                "s3_loader",
			"name":                "S3 Loader",
			"description":         "Load documents from S3 buckets",
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
	page, _ := strconv.Atoi(r.URL.Query().Get("page"))
	pageSize, _ := strconv.Atoi(r.URL.Query().Get("page_size"))
	if page < 1 {
		page = 1
	}
	if pageSize < 1 || pageSize > 100 {
		pageSize = 20
	}
	items, total, err := h.repo.ListToolkits(r.Context(), projectID, page, pageSize)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []any{}, "total": 0})
		return
	}
	if items == nil {
		items = []map[string]any{}
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// Create creates a new toolkit instance.
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	item, err := h.repo.CreateToolkit(r.Context(), projectID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, item)
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
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	toolkitID := chi.URLParam(r, "toolkitID")
	var body map[string]any
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	item, err := h.repo.UpdateToolkit(r.Context(), projectID, toolkitID, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, item)
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
		rows.Scan(&t)
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
		rows.Scan(&t.ID, &t.Name, &t.Type, &t.Description)
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
		rows.Scan(&t.ID, &t.Name, &t.Type, &t.Description)
		tools = append(tools, t)
	}
	if tools == nil {
		tools = []Tool{}
	}
	return tools, nil
}

func (r *pgRepo) ValidateToolkit(ctx context.Context, projectID, toolkitID string) (bool, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`SELECT EXISTS(SELECT 1 FROM %q.elitea_tools WHERE id = $1)`, s)
	var exists bool
	err := r.pool.QueryRow(ctx, q, toolkitID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
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
		       created_at, updated_at, author_id, shared_id
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
		var createdAt, updatedAt any
		var authorID, sharedID any
		if err := rows.Scan(&id, &typ, &name, &desc, &settingsRaw, &metaRaw, &createdAt, &updatedAt, &authorID, &sharedID); err != nil {
			continue
		}
		var settings, meta any
		json.Unmarshal(settingsRaw, &settings)
		json.Unmarshal(metaRaw, &meta)
		items = append(items, map[string]any{
			"id":          id,
			"type":        typ,
			"name":        name,
			"description": desc,
			"settings":    settings,
			"meta":        meta,
			"created_at":  createdAt,
			"updated_at":  updatedAt,
			"author_id":   authorID,
			"shared_id":   sharedID,
		})
	}
	return items, total, nil
}

func (r *pgRepo) CreateToolkit(ctx context.Context, projectID string, body map[string]any) (map[string]any, error) {
	s := fmt.Sprintf("p_%s", projectID)
	name, _ := body["name"].(string)
	typ, _ := body["type"].(string)
	desc, _ := body["description"].(string)

	settingsJSON, _ := json.Marshal(body["settings"])
	q := fmt.Sprintf(`
		INSERT INTO %q.elitea_tools (name, type, description, settings)
		VALUES ($1, $2, $3, $4)
		RETURNING id, type, name, COALESCE(description,''),
		          COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		          created_at, updated_at, author_id, shared_id`, s)
	var id, retType, retName, retDesc string
	var settingsRaw, metaRaw []byte
	var createdAt, updatedAt any
	var authorID, sharedID any
	err := r.pool.QueryRow(ctx, q, name, typ, desc, string(settingsJSON)).Scan(
		&id, &retType, &retName, &retDesc, &settingsRaw, &metaRaw,
		&createdAt, &updatedAt, &authorID, &sharedID)
	if err != nil {
		return nil, fmt.Errorf("create toolkit: %w", err)
	}
	var settings, meta any
	json.Unmarshal(settingsRaw, &settings)
	json.Unmarshal(metaRaw, &meta)
	return map[string]any{
		"id":          id,
		"type":        retType,
		"name":        retName,
		"description": retDesc,
		"settings":    settings,
		"meta":        meta,
		"created_at":  createdAt,
		"updated_at":  updatedAt,
		"author_id":   authorID,
		"shared_id":   sharedID,
	}, nil
}

func (r *pgRepo) GetToolkit(ctx context.Context, projectID, toolkitID string) (map[string]any, error) {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`
		SELECT id, type, name, COALESCE(description,''),
		       COALESCE(settings::text,'{}'), COALESCE(meta::text,'{}'),
		       created_at, updated_at, author_id, shared_id
		FROM %q.elitea_tools WHERE id = $1`, s)
	var id, typ, name, desc string
	var settingsRaw, metaRaw []byte
	var createdAt, updatedAt any
	var authorID, sharedID any
	if err := r.pool.QueryRow(ctx, q, toolkitID).Scan(
		&id, &typ, &name, &desc, &settingsRaw, &metaRaw,
		&createdAt, &updatedAt, &authorID, &sharedID); err != nil {
		return nil, fmt.Errorf("get toolkit: %w", err)
	}
	var settings, meta any
	json.Unmarshal(settingsRaw, &settings)
	json.Unmarshal(metaRaw, &meta)
	return map[string]any{
		"id":          id,
		"type":        typ,
		"name":        name,
		"description": desc,
		"settings":    settings,
		"meta":        meta,
		"created_at":  createdAt,
		"updated_at":  updatedAt,
		"author_id":   authorID,
		"shared_id":   sharedID,
	}, nil
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
		          created_at, updated_at, author_id, shared_id`,
		s, strings.Join(setClauses, ", "), argIdx)
	var id, typ, name, desc string
	var settingsRaw, metaRaw []byte
	var createdAt, updatedAt any
	var authorID, sharedID any
	if err := r.pool.QueryRow(ctx, q, args...).Scan(
		&id, &typ, &name, &desc, &settingsRaw, &metaRaw,
		&createdAt, &updatedAt, &authorID, &sharedID); err != nil {
		return nil, fmt.Errorf("update toolkit: %w", err)
	}
	var settings, meta any
	json.Unmarshal(settingsRaw, &settings)
	json.Unmarshal(metaRaw, &meta)
	return map[string]any{
		"id":          id,
		"type":        typ,
		"name":        name,
		"description": desc,
		"settings":    settings,
		"meta":        meta,
		"created_at":  createdAt,
		"updated_at":  updatedAt,
		"author_id":   authorID,
		"shared_id":   sharedID,
	}, nil
}

func (r *pgRepo) DeleteToolkit(ctx context.Context, projectID, toolkitID string) error {
	s := fmt.Sprintf("p_%s", projectID)
	q := fmt.Sprintf(`DELETE FROM %q.elitea_tools WHERE id = $1`, s)
	_, err := r.pool.Exec(ctx, q, toolkitID)
	return err
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
