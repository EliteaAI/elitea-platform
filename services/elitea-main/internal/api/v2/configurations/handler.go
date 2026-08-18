package configurations

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
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
	// connectionChecker performs the real, minimal provider round trip
	// CheckConnection/BatchCheckConnections need (#319, check_connection.go).
	// nil means "not configured" — the handlers then report an honest
	// "not available" failure rather than fabricating success.
	connectionChecker ConnectionChecker
	// providerAdmission decides the status_ok column for a written provider
	// row (#457, provider_admission.go). nil keeps the column at its default.
	providerAdmission ProviderAdmission
}

type Option func(*Handler)

// WithPermissionResolver supplies the resolver EVERY project-scoped route in
// Routes() is gated on. Without it those routes answer 403 — see require below,
// which is fail-closed by construction, so a Handler built without a resolver
// exposes nothing rather than everything.
func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(handler *Handler) {
		handler.permissionResolver = resolver
	}
}

// WithConnectionChecker wires the real provider-connection checker (#319).
// Without this option CheckConnection/BatchCheckConnections report an honest
// "not available" failure for every checkable type — never a fabricated
// success.
func WithConnectionChecker(checker ConnectionChecker) Option {
	return func(handler *Handler) {
		handler.connectionChecker = checker
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

// Routes is the broad current-main compatibility surface. It is the surface
// EVERY shipped deployment serves for this plugin, not a prototype: #243 made
// newProductionRouter the only build path, and router.go mounts this router at
// /api/v2/configurations there.
//
// The comment that stood here said "Production composition uses ProductionRoutes
// or the typed current handlers instead". Both halves were wrong, and the second
// half was the dangerous one:
//
//   - ProductionRoutes had no caller outside this package's tests. It is deleted
//     with this change rather than left as a second, differently-authorized
//     registration of paths this router already owns.
//   - The typed current handlers (read.go, mutation.go, models.go, types.go,
//     available_route.go) replace only the MODE-LESS twins, and only when
//     composed. Reads need ELITEA_CONFIGURATIONS_ENABLED; the writes need
//     ELITEA_CONFIGURATIONS_MUTATION_ENABLED, which deploy/README.md records as
//     off in BOTH profiles. So POST, PUT and DELETE on a project's
//     configurations always land here, and every `{mode}` twin always lands
//     here, whatever is composed.
//
// So this router carried no gate at all over the per-project CREDENTIAL store
// (#496). GET /configurations/configurations/{mode}/{projectID} answered any
// authenticated caller for any project id with the whole `configuration` table
// of that project, `data` included — and this platform stores the provider
// api_key in `data` verbatim (Create/Update below marshal the request body
// straight into the column; there is no store_secrets step, so the row holds
// the literal key rather than the `{{secret.NAME}}` reference the reference
// implementation writes). DELETE removed any project's row.
//
// EVERY GATE BELOW IS THE ONE THE REVIEWED COPY OF THE SAME PATH ALREADY USES,
// and the five strings are the ones the reference declares
// (legacy/plugins/configurations/api/v2/{configurations,configuration}.py). They
// are granted in DEFAULT mode by migrations/shared/0072, so no new migration is
// needed and no route here answers 403 to every caller on a clean database —
// the shape of #354, #359 and #402.
//
// THE `{mode}` TWINS ARE GATED IN THE DEFAULT MODE, WHATEVER THE SEGMENT SAYS.
// The reference resolves an `administration`-mode URL against the caller's
// CENTRAL roles, which would let an operator who is a member of no project read
// every project's credentials. This router does not reproduce that: the mode
// segment is decoration here (one handler serves both, unlike /secrets, whose
// two modes address two different stores), no client in the workspace calls the
// mode-ful form at all — apps/elitea-web, apps/elitea-ui, elitea-sdk and qa/ all
// send the mode-LESS URL — and adding a cross-tenant read while closing a
// cross-tenant read would be the wrong direction. An unknown mode segment stays
// what it is today rather than becoming a 404: the gate does not read it, so no
// mode value can change the answer.
//
// `/available/` is the ONE route with no gate, and it names no project: it
// serves the pinned, credential-free registry snapshot. NewCurrentAvailableRoute
// authenticates and does not authorize the same catalogue for the same reason.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	list := h.require(CurrentConfigurationListPermission)
	details := h.require(CurrentConfigurationGetPermission)
	create := h.require(CurrentConfigurationCreatePermission)
	update := h.require(CurrentConfigurationUpdatePermission)
	remove := h.require(CurrentConfigurationDeletePermission)

	r.Get("/available/", h.Available)
	r.With(list).Get("/configurations/{projectID}", h.List)
	r.With(list).Get("/configurations/{mode}/{projectID}", h.List)
	r.With(create).Post("/configurations/{projectID}", h.Create)
	r.With(create).Post("/configurations/{mode}/{projectID}", h.Create)
	r.With(details).Get("/configuration/{projectID}/{configID}", h.Get)
	r.With(details).Get("/configuration/{mode}/{projectID}/{configID}", h.Get)
	r.With(update).Put("/configuration/{projectID}/{configID}", h.Update)
	r.With(update).Put("/configuration/{mode}/{projectID}/{configID}", h.Update)
	r.With(remove).Delete("/configuration/{projectID}/{configID}", h.Delete)
	r.With(remove).Delete("/configuration/{mode}/{projectID}/{configID}", h.Delete)
	// The connection checks take the CREATE string. The reference declares no
	// permission on either route, so this is a proposal, and it is the narrowest
	// one that costs no caller a control: the button they serve sits on the
	// credential create form and on the edit form, and the legacy matrix gives
	// `create` and `update` to exactly the same default-mode roles (admin and
	// editor), so naming one of the two withholds nothing from the other's
	// holders. It has to be a WRITE-tier string rather than `list`: the handler
	// makes the platform dial a caller-supplied api_base, attributed to the
	// {projectID} in the path through the signed identity header, and a viewer
	// who may not save a credential has no use for a pre-save probe.
	//
	// THE TOOLKIT FORMS CALL THIS ROUTE TOO, and that was checked rather than
	// assumed. apps/elitea-web features/toolkits and features/agents both post
	// to /configurations/check_connection/{projectID}/{configType} for toolkit
	// credential types (github, jira, sharepoint), so a caller who may create a
	// TOOLKIT and not a CREDENTIAL would lose that button. The legacy matrix
	// gives `models.applications.tools.create` and
	// `configurations.configuration.create` to the SAME default-mode roles —
	// admin and editor — so the two sets are identical and no role loses a
	// control here.
	r.With(create).Post("/check_connection/{projectID}/{configType}", h.CheckConnection)
	r.With(create).Post("/check_connection/{mode}/{projectID}/{configType}", h.CheckConnection)
	r.With(create).Post("/check_connections/{projectID}", h.BatchCheckConnections)
	r.With(create).Post("/check_connections/{mode}/{projectID}", h.BatchCheckConnections)
	// models.go and model_default.go gate the reviewed copies of these two on
	// exactly these strings, over the same paths.
	r.With(list).Get("/models/{projectID}", h.ListModels)
	r.With(list).Get("/models/{mode}/{projectID}", h.ListModels)
	r.With(update).Post("/models/{projectID}", h.SetDefaultModel)
	r.With(update).Post("/models/{mode}/{projectID}", h.SetDefaultModel)
	// types.go gates the reviewed copy on the list string, and states why:
	// "listing stored type names is inventory access, not public schema
	// discovery".
	r.With(list).Get("/types/{projectID}", h.ListTypes)
	r.With(list).Get("/types/{mode}/{projectID}", h.ListTypes)
	// TTSVoices answers 501 for every project (see ttsVoicesUnavailable). It is
	// still gated, and on the list string, because a gate must match what the
	// route is for and not what its body does today: the reference reads the
	// project's tts configuration row, which is the same inventory access every
	// other read here takes. When #323 gives it a real body the gate is already
	// the right one.
	r.With(list).Get("/tts_voices/{projectID}", h.TTSVoices)
	r.With(list).Get("/tts_voices/{mode}/{projectID}", h.TTSVoices)
	return r
}

// require gates one route on the named legacy permission, resolved in DEFAULT
// mode against the `{projectID}` path segment.
//
// It fails closed twice over, and both matter here.
//
//  1. RequireResolvedPermissionsForProject answers 403 when the resolver is nil,
//     so a Handler built without WithPermissionResolver serves nothing.
//  2. legacyrbac.PostgresResolver parses the project id with parsePositiveID in
//     the default mode, so a project id that is not a positive integer is
//     refused BEFORE any handler runs. That closes a second hazard on this
//     surface: every handler below builds its tenant schema as
//     fmt.Sprintf("p_%s", projectID) and interpolates it with %q, which is Go
//     string quoting and not SQL identifier quoting (PostgreSQL escapes a quote
//     inside an identifier by doubling it, never with a backslash). Measured on
//     PostgreSQL 16, a crafted id does break out of the quoted identifier, and
//     the breakout is not exploitable only because the backslash %q inserts
//     lands INSIDE the identifier, so the schema it names cannot exist. That is
//     an accident, not a defence. No caller reaches it now.
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
	var snapshotAuthorID *int
	if user, ok := auth.UserFromContext(ctx); ok {
		// author_id is an INTEGER column, so an id above math.MaxInt32 names
		// no row. The sibling mutation service applies the same bound
		// (application/configurations/mutation.go). Without the bound,
		// `int(owningUserID)` truncates on a 32-bit build. The row is then
		// stored against a different person's id.
		if owningUserID, safe := user.OwningUserID(); safe && owningUserID > 0 && owningUserID <= math.MaxInt32 {
			authorID = owningUserID
			owner := int(owningUserID)
			snapshotAuthorID = &owner
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
	// The INSERT above stores the column default, false. A provider row that
	// resolves must reach status_ok = true here, in this request, because the
	// LLM gateway admits only status_ok = true and no other component in a
	// shipped stack writes the column (#457).
	if snapshot, ok := configurationAdmissionSnapshot(
		id, uuid, pID, title, configType, section, c.Data, snapshotAuthorID,
	); ok {
		c.StatusOK = h.admitConfiguration(ctx, schema, c.StatusOK, snapshot)
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
	// An update carries new data, so the previous decision no longer describes
	// the row. A row that stops resolving must drop back to status_ok = false:
	// withdrawing the row from every reader is exactly this write (#457).
	// The path project identifier is the one the schema was built from, so it
	// is the project whose row was just written.
	if pID, convErr := strconv.Atoi(projectID); convErr == nil {
		if snapshot, ok := configurationAdmissionSnapshot(
			c.ID, c.UUID, pID, c.Name, c.Type, c.Section, c.Data, c.AuthorID,
		); ok {
			c.StatusOK = h.admitConfiguration(ctx, schema, c.StatusOK, snapshot)
		}
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

// CheckConnection and BatchCheckConnections are implemented in
// check_connection.go (#319) — they used to be unconditional stubs here that
// reported success for every payload without ever contacting the provider.

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

// ttsVoicesUnavailable is what GET /configurations/tts_voices/{projectID}
// answers, and why (#466).
//
// The reference resolves a voice list from two sources, and both of them are
// provider audio calls (legacy/plugins/configurations/api/v2/tts_voices.py,
// `_resolve_voices`):
//
//   - `meta.voices` on the project's tts configuration row. The reference fills
//     that cache with a provider round trip when the configuration is saved.
//   - the provider itself, on `refresh=true`.
//
// This platform makes no audio call to any provider. The gateway serves no audio
// route (#323), no code path writes `meta.voices`, and the create path stores
// only the `meta` object the client sends. Both sources are therefore empty by
// construction, for every project, forever.
//
// Reading the cache anyway would restore the same defect in a longer form: the
// answer would still be an empty list, and the caller still could not tell an
// empty cache from a route that does no work. So the route reports the missing
// capability instead.
//
// Do not restore the 200 with an empty list. Issue #323 owns the audio data
// plane; when a synthesis route exists, this handler serves the real voices and
// this constant goes with the stub.
const ttsVoicesUnavailable = "the TTS voice list is not available in this platform. The reference reads voices " +
	"from the TTS provider, and caches them on the configuration row from the same provider call. This platform " +
	"serves no audio route to any provider (issue #323), so neither source holds data. This route reports the " +
	"missing capability rather than answering an empty list, which a caller cannot tell from a project that has " +
	"no voices."

// TTSVoices refuses. It answered 200 with `{"voices": []}` for every project
// until #466 — see ttsVoicesUnavailable for why that answer was worse than a
// refusal, and why a real list has nothing behind it today.
//
// Both web callers already treat a failed query as an empty option list
// (apps/elitea-web features/chat-input/lib/hooks/useReadAloud.hooks.ts and
// features/settings/ui/profile/voice-config/VoicePersonalizationSection.tsx), so
// the page shows what it showed before. The difference is that the API now says
// which of the two states it is in.
func (h *Handler) TTSVoices(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]any{"error": ttsVoicesUnavailable})
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
