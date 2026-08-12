package configurations

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
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
	// catalog is the same pinned, embedded registry snapshot that
	// CurrentAvailableRoute serves. It is a static, global, credential-free
	// artifact — no pool, no vault, no feature flag — so this router serves
	// it unconditionally rather than behind ELITEA_CONFIGURATIONS_ENABLED
	// (#131: that flag gates the *production* router, which this compatibility
	// router is not, so no environment ever reached the real catalogue).
	catalog *configurationapp.CurrentAvailableCatalog
}

type Option func(*Handler)

func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(handler *Handler) {
		handler.permissionResolver = resolver
	}
}

func NewHandler(pool *pgxpool.Pool, opts ...Option) *Handler {
	handler := &Handler{pool: pool}
	// A malformed embedded snapshot must not stop the process: every other
	// route in this handler is independent of the catalogue. Available alone
	// reports the failure, as an explicit "catalog is unavailable" error
	// rather than as a silently degraded list.
	if catalog, err := configurationapp.LoadPinnedCurrentAvailableCatalog(); err == nil {
		handler.catalog = catalog
	} else {
		slog.Error("failed to load pinned configuration catalog", "err", err)
	}
	for _, opt := range opts {
		opt(handler)
	}
	return handler
}

func (h *Handler) Routes() chi.Router {
	// Routes is the broad current-main compatibility surface used by parity
	// tests and the default-off prototype router. Production composition uses
	// ProductionRoutes or the typed current handlers instead.
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

// Available serves the pinned registry snapshot — the same entries, with the
// same `config_schema`, that CurrentAvailableRoute serves. It replaces a
// hardcoded eight-row list of `{type, display_name, section}` that carried no
// schema at all, which the credential type picker cannot render a form from
// (#131). Section filtering follows Flask request.args.getlist semantics, as
// on the production route.
func (h *Handler) Available(w http.ResponseWriter, r *http.Request) {
	entries, err := h.catalog.CompleteEntries(r.URL.Query()["section"]...)
	if err != nil {
		status := http.StatusInternalServerError
		if errors.Is(err, configurationapp.ErrCurrentAvailableCatalogPartial) {
			status = http.StatusServiceUnavailable
		}
		writeCurrentConfigurationError(w, status, "configuration catalog is unavailable")
		return
	}
	writeJSON(w, http.StatusOK, newCurrentAvailableConfigurationTypesDTO(entries))
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
	limit := 0
	if rawLimit := r.URL.Query().Get("limit"); rawLimit != "" {
		if parsed, err := strconv.Atoi(rawLimit); err == nil {
			limit = parsed
		}
	}
	offset := 0
	if rawOffset := r.URL.Query().Get("offset"); rawOffset != "" {
		if parsed, err := strconv.Atoi(rawOffset); err == nil {
			offset = parsed
		}
	}
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

	// The client always sends ?section= (it fires one request per section),
	// and this handler ignored it: every section received the whole table, so
	// one credential rendered under all seven headings — LLM, Embedding, TTS
	// and the rest alike (#131, measured: 7 copies of a single row).
	sections := r.URL.Query()["section"]
	countFilter, countArgs := configurationSectionFilter(sections, 1)
	listFilter, listArgs := configurationSectionFilter(sections, 3)

	// Count
	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = false%s`, schema, countFilter)
	if err := h.pool.QueryRow(ctx, countQ, countArgs...).Scan(&total); err != nil {
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
		WHERE shared = false%s
		ORDER BY created_at DESC
		LIMIT $1 OFFSET $2
	`, schema, listFilter)

	rows, err := h.pool.Query(ctx, listQ, append([]any{limit, offset}, listArgs...)...)
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
		if err := rows.Scan(
			&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
			&data, &meta, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
			&createdAt, &updatedAt,
		); err != nil {
			http.Error(w, `{"error":"list failed"}`, http.StatusInternalServerError)
			return
		}
		if err := json.Unmarshal(data, &c.Data); err != nil {
			http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
			return
		}
		if err := json.Unmarshal(meta, &c.Meta); err != nil {
			http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
			return
		}
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
	sharedCountQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.configuration WHERE shared = true%s`, schema, countFilter)
	if err := h.pool.QueryRow(ctx, sharedCountQ, countArgs...).Scan(&sharedTotal); err != nil {
		http.Error(w, `{"error":"list failed"}`, http.StatusInternalServerError)
		return
	}

	sharedQ := fmt.Sprintf(`
		SELECT id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id,
			created_at, updated_at
		FROM %q.configuration
		WHERE shared = true%s
		ORDER BY created_at DESC
		LIMIT 20
	`, schema, countFilter)

	sharedItems := make([]Configuration, 0)
	sharedRows, err := h.pool.Query(ctx, sharedQ, countArgs...)
	if err == nil {
		defer sharedRows.Close()
		for sharedRows.Next() {
			var c Configuration
			var data, meta []byte
			var createdAt, updatedAt *time.Time
			if err := sharedRows.Scan(
				&c.ID, &c.UUID, &c.ProjectID, &c.Label, &c.Name, &c.Type, &c.Section,
				&data, &meta, &c.Shared, &c.StatusOK, &c.StatusLogs, &c.Source, &c.AuthorID,
				&createdAt, &updatedAt,
			); err != nil {
				http.Error(w, `{"error":"list failed"}`, http.StatusInternalServerError)
				return
			}
			if err := json.Unmarshal(data, &c.Data); err != nil {
				http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
				return
			}
			if err := json.Unmarshal(meta, &c.Meta); err != nil {
				http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
				return
			}
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
		FROM %q.configuration WHERE %s = $1
	`, schema, configurationIDColumn(configID))

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
	if err := json.Unmarshal(data, &c.Data); err != nil {
		http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
		return
	}
	if err := json.Unmarshal(meta, &c.Meta); err != nil {
		http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
		return
	}
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

	dataMap, _ := body["data"].(map[string]any)
	if dataMap == nil {
		dataMap = map[string]any{}
	}
	if err := validateNotSelfReferential(dataMap, selfLLMOrigins()); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
		return
	}

	dataBytes, err := json.Marshal(dataMap)
	if err != nil {
		http.Error(w, `{"error":"invalid configuration data"}`, http.StatusBadRequest)
		return
	}
	metaBytes, err := json.Marshal(body["meta"])
	if err != nil {
		http.Error(w, `{"error":"invalid configuration metadata"}`, http.StatusBadRequest)
		return
	}
	shared, _ := body["shared"].(bool)

	q := fmt.Sprintf(`
		INSERT INTO %q.configuration (project_id, label, elitea_title, type, section, data, meta, shared, source, author_id)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'user', $9)
		RETURNING id, uuid::text, created_at
	`, schema)

	pID, err := strconv.Atoi(projectID)
	if err != nil {
		http.Error(w, `{"error":"invalid project"}`, http.StatusBadRequest)
		return
	}
	var authorID any
	if user, ok := auth.UserFromContext(ctx); ok {
		if owningUserID, safe := user.OwningUserID(); safe {
			authorID = owningUserID
		}
	}
	configType := strVal(body, "type")
	title := firstStrVal(body, "elitea_title", "name")
	section := h.sectionFor(configType, strVal(body, "section"))

	var id int
	var uuid string
	var createdAt time.Time
	err = h.pool.QueryRow(ctx, q,
		pID,
		strVal(body, "label"),
		title,
		configType,
		section,
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
		Name:      title,
		Type:      configType,
		Section:   section,
		Shared:    shared,
		Source:    "user",
		CreatedAt: createdAt.Format(time.RFC3339),
	}
	if err := json.Unmarshal(dataBytes, &c.Data); err != nil {
		http.Error(w, `{"error":"invalid configuration data"}`, http.StatusInternalServerError)
		return
	}
	if err := json.Unmarshal(metaBytes, &c.Meta); err != nil {
		http.Error(w, `{"error":"invalid configuration metadata"}`, http.StatusInternalServerError)
		return
	}

	writeJSON(w, http.StatusCreated, c)
}

// sectionFor resolves the `section` column for a configuration. The UI never
// sends one — it posts {elitea_title, label, data, shared, type} — so the
// column was written empty and the row belonged to none of the sections the
// AI-Configuration page queries (#131). The registry entry for the type is
// the authority (open_ai → ai_credentials), matching what the current
// mutation service does (application/configurations/mutation.go).
// An explicit body value still wins, and an unknown type still stores "".
func (h *Handler) sectionFor(configType, requested string) string {
	if requested != "" {
		return requested
	}
	entry, ok := h.catalog.EntryByType(configType)
	if !ok {
		return ""
	}
	return entry.Section
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

	dataMap, _ := body["data"].(map[string]any)
	if dataMap == nil {
		dataMap = map[string]any{}
	}
	if err := validateNotSelfReferential(dataMap, selfLLMOrigins()); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":%q}`, err.Error()), http.StatusBadRequest)
		return
	}

	dataBytes, err := json.Marshal(dataMap)
	if err != nil {
		http.Error(w, `{"error":"invalid configuration data"}`, http.StatusBadRequest)
		return
	}
	metaBytes, err := json.Marshal(body["meta"])
	if err != nil {
		http.Error(w, `{"error":"invalid configuration metadata"}`, http.StatusBadRequest)
		return
	}
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
		WHERE %s = $8
		RETURNING id, COALESCE(uuid::text, ''), project_id, COALESCE(label, ''), elitea_title, type, section,
			data, meta, shared, status_ok, COALESCE(status_logs, ''), source, author_id, created_at, updated_at
	`, schema, configurationIDColumn(configID))

	var c Configuration
	var data2, meta2 []byte
	var createdAt, updatedAt *time.Time
	updatedType := strVal(body, "type")
	err = h.pool.QueryRow(ctx, q,
		nullableStrVal(strVal(body, "label")),
		nullableStrVal(firstStrVal(body, "elitea_title", "name")),
		nullableStrVal(updatedType),
		nullableStrVal(h.sectionFor(updatedType, strVal(body, "section"))),
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
	if err := json.Unmarshal(data2, &c.Data); err != nil {
		http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
		return
	}
	if err := json.Unmarshal(meta2, &c.Meta); err != nil {
		http.Error(w, `{"error":"invalid stored configuration"}`, http.StatusInternalServerError)
		return
	}
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

	q := fmt.Sprintf(`DELETE FROM %q.configuration WHERE %s = $1`, schema, configurationIDColumn(configID))
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
			if err := json.Unmarshal(dataBytes, &m.Data); err != nil {
				http.Error(w, `{"error":"invalid stored model"}`, http.StatusInternalServerError)
				return
			}
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
	if err := json.NewEncoder(w).Encode(v); err != nil {
		slog.Error("failed to encode configurations response", "err", err)
	}
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
