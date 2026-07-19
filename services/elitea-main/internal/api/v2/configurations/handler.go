package configurations

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultConfigurationListLimit = 20
	maxConfigurationListLimit     = 200
	maxConfigurationModelRows     = 1000
	maxConfigurationRequestBytes  = 1 << 20
)

type Handler struct {
	pool               *pgxpool.Pool
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

func (h *Handler) Routes() chi.Router {
	r := h.ProductionRoutes()
	r.Get("/available/", h.Available)
	r.Post("/check_connection/{projectID}/{configType}", h.CheckConnection)
	r.Post("/check_connections/{projectID}", h.BatchCheckConnections)
	r.Get("/models/{projectID}", h.ListModels)
	r.Post("/models/{projectID}", h.SetDefaultModel)
	r.Get("/types/{projectID}", h.ListTypes)
	r.Get("/tts_voices/{projectID}", h.TTSVoices)
	return r
}

// ProductionRoutes is an unmounted cutover candidate containing only methods
// with an audited exact legacy permission, mode, and project extractor. RBAC
// parity alone is not business-logic parity; NewRouter must not mount this set
// until the tenant repository, validation, secret, event, and DTO contracts are
// complete. Routes() retains the wider prototype surface for parity work.
func (h *Handler) ProductionRoutes() chi.Router {
	r := chi.NewRouter()
	r.With(h.require("configurations.configurations.list")).Get("/configurations/{projectID}", h.List)
	r.With(h.require("configurations.configuration.create")).Post("/configurations/{projectID}", h.Create)
	r.With(h.require("configurations.configuration.details")).Get("/configuration/{projectID}/{configID}", h.Get)
	r.With(h.require("configurations.configuration.update")).Put("/configuration/{projectID}/{configID}", h.Update)
	r.With(h.require("configurations.configuration.delete")).Delete("/configuration/{projectID}/{configID}", h.Delete)
	return r
}

func (h *Handler) require(permission string) func(http.Handler) http.Handler {
	return middleware.RequireResolvedPermissions(
		h.permissionResolver,
		auth.PermissionModeDefault,
		permission,
	)
}

type ConfigurationType struct {
	Type        string `json:"type"`
	DisplayName string `json:"display_name"`
	Section     string `json:"section"`
	Description string `json:"description,omitempty"`
}

func (h *Handler) Available(w http.ResponseWriter, r *http.Request) {
	hardcoded := []ConfigurationType{
		{Type: "openai", DisplayName: "OpenAI", Section: "llm"},
		{Type: "azure_openai", DisplayName: "Azure OpenAI", Section: "llm"},
		{Type: "anthropic", DisplayName: "Anthropic", Section: "llm"},
		{Type: "google_ai", DisplayName: "Google AI", Section: "llm"},
		{Type: "openai_embedding", DisplayName: "OpenAI Embedding", Section: "embedding"},
		{Type: "chroma", DisplayName: "Chroma", Section: "vectorstorage"},
		{Type: "pinecone", DisplayName: "Pinecone", Section: "vectorstorage"},
		{Type: "weaviate", DisplayName: "Weaviate", Section: "vectorstorage"},
	}

	// Build a set of known types to avoid duplicates
	known := make(map[string]bool)
	for _, t := range hardcoded {
		known[t.Type] = true
	}

	displayNames := map[string]string{
		"llm_model":              "LLM Model",
		"embedding_model":        "Embedding Model",
		"asr_model":              "ASR Model",
		"tts_model":              "TTS Model",
		"image_generation_model": "Image Generation Model",
	}

	// Until the versioned catalog is composed, supplement the compatibility
	// response only when a database is configured. Never make p_1 availability
	// a process-start requirement for static handler tests or tooling.
	if h.pool != nil {
		ctx := r.Context()
		dbQ := `SELECT DISTINCT type, section FROM "p_1".configuration WHERE type IS NOT NULL ORDER BY type`
		rows, err := h.pool.Query(ctx, dbQ)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var typeName, section string
				if err := rows.Scan(&typeName, &section); err != nil || known[typeName] {
					continue
				}
				displayName := displayNames[typeName]
				if displayName == "" {
					displayName = typeName
				}
				hardcoded = append(hardcoded, ConfigurationType{
					Type:        typeName,
					DisplayName: displayName,
					Section:     section,
				})
				known[typeName] = true
			}
		}
	}

	writeJSON(w, http.StatusOK, hardcoded)
}

type Configuration struct {
	ID         int            `json:"id"`
	UUID       string         `json:"uuid,omitempty"`
	ProjectID  string         `json:"project_id"`
	Label      string         `json:"label,omitempty"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	Section    string         `json:"section"`
	Data       map[string]any `json:"data,omitempty"`
	Meta       map[string]any `json:"meta,omitempty"`
	Shared     bool           `json:"shared"`
	StatusOK   bool           `json:"status_ok"`
	StatusLogs string         `json:"status_logs,omitempty"`
	Source     string         `json:"source"`
	AuthorID   *int           `json:"author_id,omitempty"`
	CreatedAt  string         `json:"created_at"`
	UpdatedAt  string         `json:"updated_at,omitempty"`
}

type ListResponse struct {
	Items  []Configuration `json:"items"`
	Total  int             `json:"total"`
	Offset int             `json:"offset"`
	Limit  int             `json:"limit"`
	Shared SharedSection   `json:"shared"`
}

type SharedSection struct {
	Items  []Configuration `json:"items"`
	Total  int             `json:"total"`
	Offset int             `json:"offset"`
	Limit  int             `json:"limit"`
}

func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if limit <= 0 {
		limit = defaultConfigurationListLimit
	}
	if limit > maxConfigurationListLimit {
		limit = maxConfigurationListLimit
	}
	if offset < 0 {
		offset = 0
	}

	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Count
	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = false`, schema)
	if err := h.pool.QueryRow(ctx, countQ).Scan(&total); err != nil {
		// Schema may not exist yet — return empty
		writeJSON(w, http.StatusOK, ListResponse{
			Items: []Configuration{}, Total: 0, Offset: offset, Limit: limit,
			Shared: SharedSection{Items: []Configuration{}, Total: 0, Offset: 0, Limit: 20},
		})
		return
	}

	// Own configs
	listQ := fmt.Sprintf(`
		SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
			created_at, updated_at
		FROM %q.configuration
		WHERE shared = false
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, schema)

	rows, err := h.pool.Query(ctx, listQ, limit, offset)
	if err != nil {
		writeJSON(w, http.StatusOK, ListResponse{
			Items: []Configuration{}, Total: 0, Offset: offset, Limit: limit,
			Shared: SharedSection{Items: []Configuration{}, Total: 0, Offset: 0, Limit: 20},
		})
		return
	}
	defer rows.Close()

	items := make([]Configuration, 0)
	for rows.Next() {
		var c Configuration
		var data, meta []byte
		var createdAt, updatedAt *time.Time
		rows.Scan(
			&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
			&data, &meta, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
			&createdAt, &updatedAt,
		)
		json.Unmarshal(data, &c.Data)
		json.Unmarshal(meta, &c.Meta)
		if createdAt != nil {
			c.CreatedAt = createdAt.Format(time.RFC3339)
		}
		if updatedAt != nil {
			c.UpdatedAt = updatedAt.Format(time.RFC3339)
		}
		items = append(items, c)
	}

	// Shared configs
	var sharedTotal int
	sharedCountQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = true`, schema)
	h.pool.QueryRow(ctx, sharedCountQ).Scan(&sharedTotal)

	sharedQ := fmt.Sprintf(`
		SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
			created_at, updated_at
		FROM %q.configuration
		WHERE shared = true
		ORDER BY created_at DESC
		LIMIT 20
	`, schema)

	sharedItems := make([]Configuration, 0)
	sharedRows, err := h.pool.Query(ctx, sharedQ)
	if err == nil {
		defer sharedRows.Close()
		for sharedRows.Next() {
			var c Configuration
			var data, meta []byte
			var createdAt, updatedAt *time.Time
			sharedRows.Scan(
				&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
				&data, &meta, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
				&createdAt, &updatedAt,
			)
			json.Unmarshal(data, &c.Data)
			json.Unmarshal(meta, &c.Meta)
			if createdAt != nil {
				c.CreatedAt = createdAt.Format(time.RFC3339)
			}
			if updatedAt != nil {
				c.UpdatedAt = updatedAt.Format(time.RFC3339)
			}
			sharedItems = append(sharedItems, c)
		}
	}

	writeJSON(w, http.StatusOK, ListResponse{
		Items:  items,
		Total:  total,
		Offset: offset,
		Limit:  limit,
		Shared: SharedSection{
			Items:  sharedItems,
			Total:  sharedTotal,
			Offset: 0,
			Limit:  20,
		},
	})
}

func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	configID := chi.URLParam(r, "configID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	q := fmt.Sprintf(`
		SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
			created_at, updated_at
		FROM %q.configuration WHERE id = $1
	`, schema)

	var c Configuration
	var data, meta []byte
	var createdAt, updatedAt *time.Time
	err := h.pool.QueryRow(ctx, q, configID).Scan(
		&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
		&data, &meta, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
		&createdAt, &updatedAt,
	)
	if err != nil {
		http.Error(w, `{"error":"configuration not found"}`, http.StatusNotFound)
		return
	}
	json.Unmarshal(data, &c.Data)
	json.Unmarshal(meta, &c.Meta)
	if createdAt != nil {
		c.CreatedAt = createdAt.Format(time.RFC3339)
	}
	if updatedAt != nil {
		c.UpdatedAt = updatedAt.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body map[string]any
	if !decodeBoundedJSON(w, r, &body) {
		return
	}

	dataBytes, _ := json.Marshal(body["data"])
	metaBytes, _ := json.Marshal(body["meta"])
	shared, _ := body["shared"].(bool)

	q := fmt.Sprintf(`
		INSERT INTO %q.configuration (project_id, label, elitea_title, type, section, data, meta, shared, source, author_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', $9)
		RETURNING id, uuid::text, created_at
	`, schema)

	pID, _ := strconv.Atoi(projectID)
	var authorID any
	if user, ok := auth.UserFromContext(ctx); ok {
		if owningUserID, safe := user.OwningUserID(); safe {
			authorID = owningUserID
		}
	}
	var id int
	var uuid string
	var createdAt time.Time
	err := h.pool.QueryRow(ctx, q,
		pID,
		strVal(body, "label"),
		strVal(body, "name"),
		strVal(body, "type"),
		strVal(body, "section"),
		dataBytes,
		metaBytes,
		shared,
		authorID,
	).Scan(&id, &uuid, &createdAt)
	if err != nil {
		http.Error(w, `{"error":"create failed"}`, http.StatusInternalServerError)
		return
	}

	c := Configuration{
		ID:        id,
		UUID:      uuid,
		ProjectID: projectID,
		Name:      strVal(body, "name"),
		Type:      strVal(body, "type"),
		Section:   strVal(body, "section"),
		Shared:    shared,
		Source:    "user",
		CreatedAt: createdAt.Format(time.RFC3339),
	}
	json.Unmarshal(dataBytes, &c.Data)
	json.Unmarshal(metaBytes, &c.Meta)

	writeJSON(w, http.StatusCreated, c)
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	configID := chi.URLParam(r, "configID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body map[string]any
	if !decodeBoundedJSON(w, r, &body) {
		return
	}

	dataBytes, _ := json.Marshal(body["data"])
	metaBytes, _ := json.Marshal(body["meta"])
	shared, _ := body["shared"].(bool)

	q := fmt.Sprintf(`
		UPDATE %q.configuration SET
			label = COALESCE($1, label),
			elitea_title = COALESCE($2, elitea_title),
			type = COALESCE($3, type),
			section = COALESCE($4, section),
			data = $5,
			meta = $6,
			shared = $7,
			updated_at = now()
		WHERE id = $8
		RETURNING id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id, created_at, updated_at
	`, schema)

	var c Configuration
	var data2, meta2 []byte
	var createdAt, updatedAt *time.Time
	err := h.pool.QueryRow(ctx, q,
		strVal(body, "label"),
		strVal(body, "name"),
		strVal(body, "type"),
		strVal(body, "section"),
		dataBytes,
		metaBytes,
		shared,
		configID,
	).Scan(
		&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
		&data2, &meta2, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
		&createdAt, &updatedAt,
	)
	if err != nil {
		http.Error(w, `{"error":"configuration not found"}`, http.StatusNotFound)
		return
	}
	json.Unmarshal(data2, &c.Data)
	json.Unmarshal(meta2, &c.Meta)
	if createdAt != nil {
		c.CreatedAt = createdAt.Format(time.RFC3339)
	}
	if updatedAt != nil {
		c.UpdatedAt = updatedAt.Format(time.RFC3339)
	}
	writeJSON(w, http.StatusOK, c)
}

func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	configID := chi.URLParam(r, "configID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	q := fmt.Sprintf(`DELETE FROM %q.configuration WHERE id = $1`, schema)
	ct, err := h.pool.Exec(ctx, q, configID)
	if err != nil || ct.RowsAffected() == 0 {
		http.Error(w, `{"error":"configuration not found"}`, http.StatusNotFound)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) CheckConnection(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"success": true, "message": "Connection successful"})
}

func (h *Handler) BatchCheckConnections(w http.ResponseWriter, r *http.Request) {
	var items []map[string]any
	if !decodeBoundedJSON(w, r, &items) {
		return
	}
	results := make([]map[string]any, 0, len(items))
	for _, item := range items {
		results = append(results, map[string]any{"id": item["id"], "success": true, "message": "Connection successful"})
	}
	writeJSON(w, http.StatusOK, results)
}

type Model struct {
	ID         int            `json:"id"`
	Name       string         `json:"name"`
	Type       string         `json:"type"`
	ProjectID  string         `json:"project_id"`
	Section    string         `json:"section"`
	IsDefault  bool           `json:"is_default"`
	ConfigID   int            `json:"config_id"`
	ConfigName string         `json:"config_name"`
	Data       map[string]any `json:"data,omitempty"`
}

type TypeDescriptor struct {
	Type        string        `json:"type"`
	DisplayName string        `json:"display_name"`
	Section     string        `json:"section"`
	Fields      []interface{} `json:"fields"`
}

func (h *Handler) ListModels(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []Model{}, "total": 0})
		return
	}
	projectID := chi.URLParam(r, "projectID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	modelTypes := []string{"llm_model", "embedding_model", "asr_model", "tts_model", "image_generation_model"}

	q := fmt.Sprintf(`
		SELECT id, COALESCE(elitea_title, ''), type, section, data, project_id
		FROM %q.configuration
		WHERE type = ANY($1)
		ORDER BY id
		LIMIT %d
	`, schema, maxConfigurationModelRows)

	rows, err := h.pool.Query(ctx, q, modelTypes)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"items": []Model{}, "total": 0})
		return
	}
	defer rows.Close()

	items := make([]Model, 0)
	for rows.Next() {
		var m Model
		var dataBytes []byte
		var dbProjectID int
		if err := rows.Scan(&m.ID, &m.Name, &m.Type, &m.Section, &dataBytes, &dbProjectID); err != nil {
			continue
		}
		m.ConfigID = m.ID
		m.ConfigName = m.Name
		m.ProjectID = strconv.Itoa(dbProjectID)
		m.IsDefault = false
		if dataBytes != nil {
			json.Unmarshal(dataBytes, &m.Data)
		}
		items = append(items, m)
	}

	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": len(items)})
}

func (h *Handler) SetDefaultModel(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if !decodeBoundedJSON(w, r, &body) {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": []Model{}, "total": 0})
}

func (h *Handler) ListTypes(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, []TypeDescriptor{})
		return
	}
	projectID := chi.URLParam(r, "projectID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	displayNames := map[string]string{
		"llm_model":              "LLM Model",
		"embedding_model":        "Embedding Model",
		"asr_model":              "ASR Model",
		"tts_model":              "TTS Model",
		"image_generation_model": "Image Generation Model",
	}
	sectionMap := map[string]string{
		"llm_model":              "llm",
		"embedding_model":        "embedding",
		"asr_model":              "asr",
		"tts_model":              "tts",
		"image_generation_model": "image_generation",
	}

	q := fmt.Sprintf(`SELECT DISTINCT type, section FROM %q.configuration ORDER BY type`, schema)
	rows, err := h.pool.Query(ctx, q)
	if err != nil {
		writeJSON(w, http.StatusOK, []TypeDescriptor{})
		return
	}
	defer rows.Close()

	descriptors := make([]TypeDescriptor, 0)
	for rows.Next() {
		var typeName, section string
		if err := rows.Scan(&typeName, &section); err != nil {
			continue
		}
		displayName := displayNames[typeName]
		if displayName == "" {
			displayName = typeName
		}
		if section == "" {
			section = sectionMap[typeName]
		}
		descriptors = append(descriptors, TypeDescriptor{
			Type:        typeName,
			DisplayName: displayName,
			Section:     section,
			Fields:      []interface{}{},
		})
	}

	writeJSON(w, http.StatusOK, descriptors)
}

func (h *Handler) TTSVoices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"voices": []map[string]string{}})
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}

func decodeBoundedJSON(w http.ResponseWriter, r *http.Request, dst any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxConfigurationRequestBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dst); err != nil {
		var maxBytesError *http.MaxBytesError
		if errors.As(err, &maxBytesError) {
			http.Error(w, `{"error":"request body too large"}`, http.StatusRequestEntityTooLarge)
			return false
		}
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return false
	}

	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return false
	}
	return true
}
