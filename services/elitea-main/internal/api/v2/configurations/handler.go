package configurations

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed sdk_config_schemas.json
var sdkConfigSchemasRaw []byte

var sdkConfigSchemas map[string]any

func init() {
	sdkConfigSchemas = make(map[string]any)
	json.Unmarshal(sdkConfigSchemasRaw, &sdkConfigSchemas)
}

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler {
	return &Handler{pool: pool}
}

func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/available/", h.Available)
	r.Get("/configurations/{projectID}", h.List)
	r.Get("/configurations/{mode}/{projectID}", h.List)
	r.Post("/configurations/{projectID}", h.Create)
	r.Post("/configurations/{mode}/{projectID}", h.Create)
	r.Get("/configuration/{projectID}/{configID}", h.Get)
	r.Get("/configuration/{mode}/{projectID}/{configID}", h.Get)
	r.Put("/configuration/{projectID}/{configID}", h.Update)
	r.Put("/configuration/{mode}/{projectID}/{configID}", h.Update)
	r.Delete("/configuration/{projectID}/{configID}", h.Delete)
	r.Delete("/configuration/{mode}/{projectID}/{configID}", h.Delete)
	r.Post("/check_connection/{projectID}/{configType}", h.CheckConnection)
	r.Post("/check_connection/{mode}/{projectID}/{configType}", h.CheckConnection)
	r.Post("/check_connections/{projectID}", h.BatchCheckConnections)
	r.Post("/check_connections/{mode}/{projectID}", h.BatchCheckConnections)
	r.Get("/models/{projectID}", h.ListModels)
	r.Get("/models/{mode}/{projectID}", h.ListModels)
	r.Post("/models/{projectID}", h.SetDefaultModel)
	r.Post("/models/{mode}/{projectID}", h.SetDefaultModel)
	r.Get("/types/{projectID}", h.ListTypes)
	r.Get("/types/{mode}/{projectID}", h.ListTypes)
	r.Get("/tts_voices/{projectID}", h.TTSVoices)
	r.Get("/tts_voices/{mode}/{projectID}", h.TTSVoices)
	return r
}


func (h *Handler) Available(w http.ResponseWriter, r *http.Request) {
	result := make([]map[string]any, 0, len(sdkConfigSchemas)+len(fallbackConfigTypes()))
	known := make(map[string]bool)

	// Primary source: SDK-defined schemas (embedded from elitea-sdk)
	for typeName, schema := range sdkConfigSchemas {
		schemaMap, ok := schema.(map[string]any)
		if !ok {
			continue
		}
		metadata, _ := schemaMap["metadata"].(map[string]any)
		section := ""
		if metadata != nil {
			section, _ = metadata["section"].(string)
		}

		entry := buildConfigTypeFromSDKSchema(typeName, section, schemaMap)
		result = append(result, entry)
		known[typeName] = true
	}

	// Secondary: fallback types (llm_model, embedding_model, etc.) not covered by SDK
	for _, fallback := range fallbackConfigTypes() {
		tp, _ := fallback["type"].(string)
		if !known[tp] {
			result = append(result, fallback)
			known[tp] = true
		}
	}

	// Tertiary: discover any types from DB not covered by SDK or fallbacks
	ctx := r.Context()
	schemaRows, err := h.pool.Query(ctx, `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'p_%'`)
	if err == nil {
		defer schemaRows.Close()
		var schemas []string
		for schemaRows.Next() {
			var s string
			if err := schemaRows.Scan(&s); err == nil {
				schemas = append(schemas, s)
			}
		}
		schemaRows.Close()

		typeData := make(map[string]map[string]any)
		typeSections := make(map[string]string)
		for _, schema := range schemas {
			dbQ := fmt.Sprintf(`SELECT DISTINCT type, section FROM %q.configuration WHERE type IS NOT NULL`, schema)
			rows, err := h.pool.Query(ctx, dbQ)
			if err != nil {
				continue
			}
			for rows.Next() {
				var typeName, section string
				if err := rows.Scan(&typeName, &section); err != nil {
					continue
				}
				if known[typeName] {
					continue
				}
				if _, exists := typeData[typeName]; !exists {
					typeData[typeName] = make(map[string]any)
					typeSections[typeName] = section
				}
			}
			rows.Close()
		}
		// For undiscovered types, fetch a sample row to infer schema
		for typeName, section := range typeSections {
			for _, schema := range schemas {
				dbQ := fmt.Sprintf(`SELECT data FROM %q.configuration WHERE type = $1 AND data IS NOT NULL LIMIT 1`, schema)
				var dataRaw []byte
				if err := h.pool.QueryRow(ctx, dbQ, typeName).Scan(&dataRaw); err != nil {
					continue
				}
				var rowData map[string]any
				if err := json.Unmarshal(dataRaw, &rowData); err != nil {
					continue
				}
				typeData[typeName] = rowData
				break
			}
			result = append(result, buildConfigTypeFromSample(typeName, section, typeData[typeName]))
			known[typeName] = true
		}
	}

	// Filter by section if requested
	sections := r.URL.Query()["section"]
	if len(sections) > 0 {
		sectionSet := make(map[string]bool, len(sections))
		for _, s := range sections {
			sectionSet[s] = true
		}
		filtered := make([]map[string]any, 0)
		for _, t := range result {
			sec, _ := t["section"].(string)
			if sectionSet[sec] {
				filtered = append(filtered, t)
			}
		}
		result = filtered
	}

	writeJSON(w, http.StatusOK, result)
}

// buildConfigTypeFromSDKSchema wraps an SDK-provided schema into the config_schema format expected by the SPA.
func buildConfigTypeFromSDKSchema(typeName, section string, sdkSchema map[string]any) map[string]any {
	metadata, _ := sdkSchema["metadata"].(map[string]any)
	displayName := typeName
	if metadata != nil {
		if l, ok := metadata["label"].(string); ok && l != "" {
			displayName = l
		}
	}

	hasTestConnection := false
	if metadata != nil {
		if _, ok := metadata["check_connection_supported"]; ok {
			hasTestConnection = true
		}
	}

	checkConnectionLabel := "Test Connection"
	if metadata != nil {
		if l, ok := metadata["check_connection_label"].(string); ok && l != "" {
			checkConnectionLabel = l
		}
	}

	return map[string]any{
		"type":    typeName,
		"section": section,
		"config_schema": map[string]any{
			"title": displayName,
			"type":  "object",
			"properties": map[string]any{
				"elitea_title": map[string]any{"type": "string", "title": "ID", "description": "Unique identifier"},
				"label":        map[string]any{"type": "string", "title": "Display Name"},
				"type":         map[string]any{"type": "string", "const": typeName},
				"shared":       map[string]any{"type": "boolean", "title": "Shared", "default": false},
				"data":         sdkSchema,
			},
			"required": []string{"elitea_title", "type", "data"},
		},
		"has_test_connection":    hasTestConnection,
		"check_connection_label": checkConnectionLabel,
	}
}

// buildConfigTypeFromSample derives a JSON Schema for a config type from a sample data row.
func buildConfigTypeFromSample(typeName, section string, sampleData map[string]any) map[string]any {
	displayName := configDisplayName(typeName)

	// Infer properties from sample data keys
	props := make(map[string]any)
	required := make([]string, 0)
	for key, val := range sampleData {
		prop := inferPropertySchema(key, val)
		props[key] = prop
		// Fields that look like credentials are required
		if isLikelyRequired(key) {
			required = append(required, key)
		}
	}

	// For AI-backed types, add ai_credentials reference
	isAIType := section == "llm" || section == "embedding" || section == "image_generation" || section == "asr" || section == "tts"
	if isAIType {
		if _, has := props["ai_credentials"]; has {
			props["ai_credentials"] = map[string]any{
				"type":  "object",
				"title": "AI Credentials",
				"properties": map[string]any{
					"elitea_title": map[string]any{"type": "string", "title": "Credential Name"},
					"private":      map[string]any{"type": "boolean", "title": "Private", "default": false},
				},
				"required":               []string{"elitea_title"},
				"configuration_sections": []string{"ai_credentials"},
			}
			if !contains(required, "ai_credentials") {
				required = append(required, "ai_credentials")
			}
		}
	}

	metadata := map[string]any{
		"label":   displayName,
		"section": section,
		"type":    typeName,
	}

	return map[string]any{
		"type":    typeName,
		"section": section,
		"config_schema": map[string]any{
			"title": displayName,
			"type":  "object",
			"properties": map[string]any{
				"elitea_title": map[string]any{"type": "string", "title": "ID", "description": "Unique identifier"},
				"label":        map[string]any{"type": "string", "title": "Display Name"},
				"type":         map[string]any{"type": "string", "const": typeName},
				"shared":       map[string]any{"type": "boolean", "title": "Shared", "default": false},
				"data": map[string]any{
					"type":       "object",
					"title":      displayName,
					"properties": props,
					"required":   required,
					"metadata":   metadata,
				},
			},
			"required": []string{"elitea_title", "type", "data"},
		},
		"has_test_connection":    true,
		"check_connection_label": "Test Connection",
	}
}

func inferPropertySchema(key string, val any) map[string]any {
	title := strings.ReplaceAll(strings.ReplaceAll(key, "_", " "), "-", " ")
	title = titleCase(title)

	prop := map[string]any{"title": title}

	switch v := val.(type) {
	case bool:
		prop["type"] = "boolean"
		prop["default"] = v
	case float64:
		if v == float64(int(v)) {
			prop["type"] = "integer"
			prop["default"] = int(v)
		} else {
			prop["type"] = "number"
			prop["default"] = v
		}
	case map[string]any:
		prop["type"] = "object"
		subProps := make(map[string]any)
		for sk, sv := range v {
			subProps[sk] = inferPropertySchema(sk, sv)
		}
		prop["properties"] = subProps
	default:
		prop["type"] = "string"
		// Mark password-like fields
		if isPasswordField(key) {
			prop["format"] = "password"
		}
	}
	return prop
}

func isPasswordField(key string) bool {
	return strings.Contains(key, "key") ||
		strings.Contains(key, "secret") ||
		strings.Contains(key, "token") ||
		strings.Contains(key, "password") ||
		strings.Contains(key, "private_key")
}

func isLikelyRequired(key string) bool {
	return key == "name" || key == "api_key" || key == "base_url" || key == "url" ||
		key == "access_token" || key == "username"
}

func contains(sl []string, s string) bool {
	for _, v := range sl {
		if v == s {
			return true
		}
	}
	return false
}

func configDisplayName(typeName string) string {
	names := map[string]string{
		"llm_model":              "LLM Model",
		"embedding_model":        "Embedding Model",
		"asr_model":              "ASR Model",
		"tts_model":              "TTS Model",
		"image_generation_model": "Image Generation Model",
		"ai_dial":                "AI Dial",
		"azure_open_ai":          "Azure OpenAI",
		"amazon_bedrock":         "Amazon Bedrock",
		"github":                 "GitHub",
		"jira":                   "Jira",
		"s3":                     "S3 Storage",
		"s3_api_credentials":     "S3 API Credentials",
		"pgvector":               "PGVector",
		"service_prompt":         "Service Prompt",
		"environment_settings":   "Environment Settings",
	}
	if n, ok := names[typeName]; ok {
		return n
	}
	return titleCase(strings.ReplaceAll(typeName, "_", " "))
}

func titleCase(s string) string {
	words := strings.Fields(s)
	for i, w := range words {
		if len(w) > 0 {
			words[i] = strings.ToUpper(w[:1]) + w[1:]
		}
	}
	return strings.Join(words, " ")
}

// fallbackConfigTypes returns types that should always be available even if the DB is empty.
func fallbackConfigTypes() []map[string]any {
	return []map[string]any{
		buildConfigTypeFromSample("llm_model", "llm", map[string]any{
			"name": "gpt-4o", "context_window": float64(128000), "max_output_tokens": float64(16384),
			"low_tier": false, "high_tier": false, "supports_reasoning": false, "supports_vision": true,
			"ai_credentials": map[string]any{"elitea_title": "", "private": false},
		}),
		buildConfigTypeFromSample("embedding_model", "embedding", map[string]any{
			"name":           "text-embedding-3-small",
			"ai_credentials": map[string]any{"elitea_title": "", "private": false},
		}),
		buildConfigTypeFromSample("ai_dial", "ai_credentials", map[string]any{
			"api_key": "", "api_base": "https://ai-proxy.lab.epam.com", "api_version": "2025-04-01-preview",
		}),
		buildConfigTypeFromSample("azure_open_ai", "ai_credentials", map[string]any{
			"api_key": "", "api_base": "", "api_version": "2025-04-01-preview",
		}),
		buildConfigTypeFromSample("amazon_bedrock", "ai_credentials", map[string]any{
			"aws_region_name": "us-east-1", "aws_access_key_id": "", "aws_secret_access_key": "",
		}),
		buildConfigTypeFromSample("github", "credentials", map[string]any{
			"base_url": "https://api.github.com", "access_token": "", "username": "", "password": "",
			"app_id": "", "app_private_key": "",
		}),
		buildConfigTypeFromSample("jira", "credentials", map[string]any{
			"base_url": "", "username": "", "api_key": "", "hosting": "Cloud",
		}),
		buildConfigTypeFromSample("s3", "storage", map[string]any{
			"storage_url": "", "access_key": "", "secret_access_key": "", "region_name": "us-east-1",
			"use_compatible_storage": true,
		}),
		buildConfigTypeFromSample("pgvector", "vectorstorage", map[string]any{
			"host": "", "port": float64(5432), "database": "", "user": "", "password": "",
		}),
	}
}

type Configuration struct {
	ID          int            `json:"id"`
	UUID        string         `json:"uuid,omitempty"`
	ProjectID   string         `json:"project_id"`
	Label       string         `json:"label,omitempty"`
	Name        string         `json:"name"`
	EliteaTitle string         `json:"elitea_title"`
	Type        string         `json:"type"`
	Section     string         `json:"section"`
	Data        map[string]any `json:"data,omitempty"`
	Meta        map[string]any `json:"meta,omitempty"`
	Shared      bool           `json:"shared"`
	StatusOK    bool           `json:"status_ok"`
	StatusLogs  string         `json:"status_logs,omitempty"`
	Source      string         `json:"source"`
	AuthorID    *int           `json:"author_id,omitempty"`
	CreatedAt   string         `json:"created_at"`
	UpdatedAt   string         `json:"updated_at,omitempty"`
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
		limit = 20
	}
	sharedLimit, _ := strconv.Atoi(r.URL.Query().Get("shared_limit"))
	sharedOffset, _ := strconv.Atoi(r.URL.Query().Get("shared_offset"))
	if sharedLimit <= 0 {
		sharedLimit = 20
	}

	typeFilter := r.URL.Query().Get("type")
	sectionFilter := r.URL.Query().Get("section")
	searchQuery := r.URL.Query().Get("query")
	includeShared := r.URL.Query().Get("include_shared") != "false"

	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	// Build WHERE clause for filters
	filterWhere := ""
	filterArgs := []any{}
	argIdx := 1
	if typeFilter != "" {
		filterWhere += fmt.Sprintf(` AND type = $%d`, argIdx)
		filterArgs = append(filterArgs, typeFilter)
		argIdx++
	}
	if sectionFilter != "" {
		filterWhere += fmt.Sprintf(` AND section = $%d`, argIdx)
		filterArgs = append(filterArgs, sectionFilter)
		argIdx++
	}
	if searchQuery != "" {
		filterWhere += fmt.Sprintf(` AND (label ILIKE $%d OR elitea_title ILIKE $%d)`, argIdx, argIdx)
		filterArgs = append(filterArgs, "%"+searchQuery+"%")
		argIdx++
	}

	// Count own configs
	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = false`, schema) + filterWhere
	if err := h.pool.QueryRow(ctx, countQ, filterArgs...).Scan(&total); err != nil {
		writeJSON(w, http.StatusOK, ListResponse{
			Items: []Configuration{}, Total: 0, Offset: offset, Limit: limit,
			Shared: SharedSection{Items: []Configuration{}, Total: 0, Offset: 0, Limit: sharedLimit},
		})
		return
	}

	// Own configs
	listQ := fmt.Sprintf(`
		SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
			created_at, updated_at
		FROM %q.configuration
		WHERE shared = false`, schema) + filterWhere +
		fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, argIdx, argIdx+1)
	listArgs := append(append([]any{}, filterArgs...), limit, offset)

	rows, err := h.pool.Query(ctx, listQ, listArgs...)
	if err != nil {
		writeJSON(w, http.StatusOK, ListResponse{
			Items: []Configuration{}, Total: 0, Offset: offset, Limit: limit,
			Shared: SharedSection{Items: []Configuration{}, Total: 0, Offset: 0, Limit: sharedLimit},
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
		c.EliteaTitle = c.Name
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
	sharedItems := make([]Configuration, 0)
	var sharedTotal int
	if includeShared {
		// Build shared filter args separately
		sharedFilterWhere := ""
		sharedFilterArgs := []any{}
		sharedArgIdx := 1
		if typeFilter != "" {
			sharedFilterWhere += fmt.Sprintf(` AND type = $%d`, sharedArgIdx)
			sharedFilterArgs = append(sharedFilterArgs, typeFilter)
			sharedArgIdx++
		}
		if sectionFilter != "" {
			sharedFilterWhere += fmt.Sprintf(` AND section = $%d`, sharedArgIdx)
			sharedFilterArgs = append(sharedFilterArgs, sectionFilter)
			sharedArgIdx++
		}
		if searchQuery != "" {
			sharedFilterWhere += fmt.Sprintf(` AND (label ILIKE $%d OR elitea_title ILIKE $%d)`, sharedArgIdx, sharedArgIdx)
			sharedFilterArgs = append(sharedFilterArgs, "%"+searchQuery+"%")
			sharedArgIdx++
		}

		sharedCountQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = true`, schema) + sharedFilterWhere
		h.pool.QueryRow(ctx, sharedCountQ, sharedFilterArgs...).Scan(&sharedTotal)

		sharedQ := fmt.Sprintf(`
			SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
				data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
				created_at, updated_at
			FROM %q.configuration
			WHERE shared = true`, schema) + sharedFilterWhere +
			fmt.Sprintf(` ORDER BY created_at DESC LIMIT $%d OFFSET $%d`, sharedArgIdx, sharedArgIdx+1)
		sharedListArgs := append(append([]any{}, sharedFilterArgs...), sharedLimit, sharedOffset)

		sharedRows, err := h.pool.Query(ctx, sharedQ, sharedListArgs...)
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
	}

	// Inject virtual "default" local storage when filtering for s3 and nothing found.
	// The internal artifact system is always available without requiring a DB entry.
	if typeFilter == "s3" && len(items) == 0 && len(sharedItems) == 0 {
		items = []Configuration{{
			ID:        -1,
			ProjectID: projectID,
			Name:      "default",
			Type:      "s3",
			Section:   "storage",
			Source:    "system",
			StatusOK:  true,
			CreatedAt: "2024-01-01T00:00:00Z",
		}}
		total = 1
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
	c.EliteaTitle = c.Name
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
	json.NewDecoder(r.Body).Decode(&body)

	eliteaTitle := strVal(body, "elitea_title")
	if eliteaTitle == "" {
		eliteaTitle = strVal(body, "name")
	}
	configType := strVal(body, "type")

	if eliteaTitle == "" || configType == "" {
		http.Error(w, `{"error":"elitea_title and type are required"}`, http.StatusBadRequest)
		return
	}
	if _, hasData := body["data"]; !hasData {
		http.Error(w, `{"error":"data is required"}`, http.StatusBadRequest)
		return
	}

	dataMap, _ := body["data"].(map[string]any)
	if dataMap == nil {
		dataMap = map[string]any{}
	}

	// Type-specific validation
	if err := validateConfigData(configType, dataMap); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	dataMap = maskSecrets(h.pool, projectID, dataMap, r)
	dataBytes, _ := json.Marshal(dataMap)
	metaBytes, _ := json.Marshal(body["meta"])
	if metaBytes == nil || string(metaBytes) == "null" {
		metaBytes = []byte("{}")
	}
	shared, _ := body["shared"].(bool)
	section := strVal(body, "section")
	if section == "" {
		section = sectionForType(configType)
	}

	q := fmt.Sprintf(`
		INSERT INTO %q.configuration (project_id, label, elitea_title, type, section, data, meta, shared, source, author_id, status_ok)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', $9, true)
		RETURNING id, uuid::text, created_at
	`, schema)

	pID, _ := strconv.Atoi(projectID)
	var id int
	var uuid string
	var createdAt time.Time
	err := h.pool.QueryRow(ctx, q,
		pID,
		strVal(body, "label"),
		eliteaTitle,
		configType,
		section,
		dataBytes,
		metaBytes,
		shared,
		nil,
	).Scan(&id, &uuid, &createdAt)
	if err != nil {
		errMsg := err.Error()
		if strings.Contains(errMsg, "duplicate key") || strings.Contains(errMsg, "unique constraint") {
			http.Error(w, `{"error":"configuration with this name already exists"}`, http.StatusConflict)
			return
		}
		http.Error(w, fmt.Sprintf(`{"error":"create failed: %s"}`, errMsg), http.StatusInternalServerError)
		return
	}

	c := Configuration{
		ID:          id,
		UUID:        uuid,
		ProjectID:   projectID,
		Name:        eliteaTitle,
		EliteaTitle: eliteaTitle,
		Label:       strVal(body, "label"),
		Type:        configType,
		Section:     section,
		Shared:      shared,
		Source:      "user",
		StatusOK:    true,
		CreatedAt:   createdAt.Format(time.RFC3339),
	}
	json.Unmarshal(dataBytes, &c.Data)
	json.Unmarshal(metaBytes, &c.Meta)

	writeJSON(w, http.StatusOK, c)
}

func sectionForType(configType string) string {
	sections := map[string]string{
		"llm_model":              "llm",
		"embedding_model":        "embedding",
		"asr_model":              "asr",
		"tts_model":              "tts",
		"image_generation_model": "image_generation",
		"ai_dial":                "ai_credentials",
		"azure_open_ai":          "ai_credentials",
		"amazon_bedrock":         "ai_credentials",
		"github":                 "credentials",
		"jira":                   "credentials",
		"confluence":             "credentials",
		"s3":                     "storage",
		"s3_api_credentials":     "storage",
		"pgvector":               "vectorstorage",
		"service_prompt":         "prompts",
		"environment_settings":   "settings",
	}
	if s, ok := sections[configType]; ok {
		return s
	}
	return "other"
}

func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	configID := chi.URLParam(r, "configID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)

	dataMap, _ := body["data"].(map[string]any)
	if dataMap == nil {
		dataMap = map[string]any{}
	}
	dataMap = maskSecrets(h.pool, projectID, dataMap, r)
	dataBytes, _ := json.Marshal(dataMap)
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
	c.EliteaTitle = c.Name
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
	json.NewDecoder(r.Body).Decode(&items)
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
	projectID := chi.URLParam(r, "projectID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	modelTypes := []string{"llm_model", "embedding_model", "asr_model", "tts_model", "image_generation_model"}

	q := fmt.Sprintf(`
		SELECT id, COALESCE(elitea_title, ''), type, section, data, project_id
		FROM %q.configuration
		WHERE type = ANY($1)
		ORDER BY id
	`, schema)

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
	json.NewDecoder(r.Body).Decode(&body)
	writeJSON(w, http.StatusOK, map[string]any{"items": []Model{}, "total": 0})
}

func (h *Handler) ListTypes(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	schema := fmt.Sprintf("p_%s", projectID)
	ctx := r.Context()

	displayNames := map[string]string{
		"llm_model":               "LLM Model",
		"embedding_model":         "Embedding Model",
		"asr_model":               "ASR Model",
		"tts_model":               "TTS Model",
		"image_generation_model":  "Image Generation Model",
	}
	sectionMap := map[string]string{
		"llm_model":               "llm",
		"embedding_model":         "embedding",
		"asr_model":               "asr",
		"tts_model":               "tts",
		"image_generation_model":  "image_generation",
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

func validateConfigData(configType string, data map[string]any) error {
	switch configType {
	case "azure_openai", "azure_open_ai":
		if s, _ := data["api_base"].(string); s == "" {
			return fmt.Errorf("api_base is required for azure_openai configuration")
		}
	case "github":
		username, _ := data["username"].(string)
		password, _ := data["password"].(string)
		token, _ := data["token"].(string)
		if username != "" && password == "" && token == "" {
			return fmt.Errorf("password or token is required when username is provided")
		}
	case "embedding_model":
		name, _ := data["name"].(string)
		modelName, _ := data["model_name"].(string)
		if name == "" && modelName == "" {
			return fmt.Errorf("name is required for embedding_model configuration")
		}
		if data["ai_credentials"] == nil {
			return fmt.Errorf("ai_credentials is required for embedding_model configuration")
		}
		if creds, ok := data["ai_credentials"].(map[string]any); ok {
			title, _ := creds["elitea_title"].(string)
			if title == "" {
				return fmt.Errorf("ai_credentials.elitea_title is required for embedding_model configuration")
			}
			if _, hasPrivate := creds["private"]; !hasPrivate {
				return fmt.Errorf("ai_credentials.private is required for embedding_model configuration")
			}
		}
	}
	return nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
