package llmproxy

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sync"
	"time"
)

// DefaultModelsCacheTTL is the per-project models-list cache lifetime. The
// synthetic /llm/v1/models surface resolves the calling project's configured
// models from p_{projectID}.configuration at request time behind a short cache
// so the hot path never makes a management RPC (design §4.2: "local cache
// (TTL 60 s, Postgres fallback)"). It replaces the legacy _map_model_name
// 3-step prefix probe entirely.
const DefaultModelsCacheTTL = 60 * time.Second

// modelObjectType / modelsListType are the OpenAI /v1/models object markers.
// The synthesised response is byte-shape-compatible with the legacy LiteLLM
// /v1/models so no SDK changes are required (spec §3, design §3.4).
const (
	modelObjectType = "model"
	modelsListType  = "list"
	// modelsOwnedBy is the owner tag stamped on every synthesised model. The
	// gateway is the model owner from the caller's perspective (the real
	// provider is never leaked); a fixed value keeps the response deterministic.
	modelsOwnedBy = "elitea"
)

// modelObject is one entry in the OpenAI /v1/models response. Created is a
// fixed 0 rather than a wall-clock timestamp: the models set is synthesised
// from static per-project config, has no meaningful creation time, and a fixed
// value keeps the response deterministic (the parity gate BFF.3 compares the id
// set, order-insensitive).
type modelObject struct {
	ID      string `json:"id"`
	Object  string `json:"object"`
	Created int64  `json:"created"`
	OwnedBy string `json:"owned_by"`

	// providerModel is the row's data.name — the model name the PROVIDER
	// accepts. ID is elitea_title, a user-authored label, and the two are
	// independent by construction, so the inference path must translate ID to
	// providerModel before it dispatches (issue #317).
	//
	// The field is deliberately UNEXPORTED: encoding/json skips it, so the
	// provider's wire name can never leak into a caller-facing /llm/v1/models
	// response (the gateway is the model owner from the caller's view — see
	// modelsOwnedBy).
	providerModel string
}

// modelsList is the OpenAI /v1/models list envelope.
type modelsList struct {
	Object string        `json:"object"`
	Data   []modelObject `json:"data"`
}

// modelRowQuerier is the minimal pgx surface the resolver needs: a multi-row
// Query. It is satisfied by *pgxpool.Pool (via ModelPoolQuerier) and by test
// fakes, mirroring the account/cost package DB seams so the resolver is
// unit-testable without a live database.
type modelRowQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (modelRows, error)
}

// modelRows mirrors the subset of pgx.Rows the resolver consumes.
type modelRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
	Close()
}

// modelConfigData is the subset of a model configuration row's JSONB `data` the
// resolver reads. name is the underlying model wire name; it backs the exposed
// id only when elitea_title is empty.
type modelConfigData struct {
	Name string `json:"name"`
}

// modelSection is one (section, type) pair in p_{projectID}.configuration that
// holds a model a /llm route can address.
type modelSection struct {
	section string
	typ     string
}

// addressableModelSections enumerates the configuration rows that describe a
// model the gateway can dispatch to. elitea-main writes the two columns as a
// pair (internal/api/v2/configurations/handler.go) and its own reads verify
// both before they trust a row, so both are matched here too.
//
// This is the WHOLE model surface, not the chat surface. mapModel gates EVERY
// dialect against this set, so a section that is absent here makes the gateway
// answer 404 `model_not_found` for every model it holds — even though the
// project configured the model and the credential resolves. That is what
// happened to POST /llm/v1/embeddings while the resolver read the `llm` section
// alone: an `embedding`/`embedding_model` row was invisible, so the embedding
// hop of the index plane could never dispatch.
//
// The order is precedence: a model id that two sections both carry resolves to
// the first section in this list (see modelsSQL's ORDER BY).
//
// Keep this in step with the routes in internal/api/router.go. `asr` and `tts`
// are deliberately absent — the gateway serves no audio route, so advertising
// those models would name something no caller can reach. `vectorstorage` holds
// no model at all. ADD THE PAIR HERE when you add a route that dispatches one.
var addressableModelSections = []modelSection{
	{section: "llm", typ: "llm_model"},                           // /chat/completions, /completions, /responses, /messages
	{section: "embedding", typ: "embedding_model"},               // /embeddings
	{section: "image_generation", typ: "image_generation_model"}, // /images/generations, /images/edits, /images/variations
}

// modelSectionArgs returns the two parallel arrays modelsSQL binds, in
// addressableModelSections order. Passing the pairs as bind parameters keeps
// the statement text fixed: nothing about which sections are read is built by
// string concatenation.
func modelSectionArgs() (sections, types []string) {
	sections = make([]string, len(addressableModelSections))
	types = make([]string, len(addressableModelSections))
	for i, s := range addressableModelSections {
		sections[i], types[i] = s.section, s.typ
	}
	return sections, types
}

// ModelResolver synthesises the per-project /llm/v1/models set from
// p_{projectID}.configuration, reading every pair in addressableModelSections.
// It caches the resolved list per project for a short TTL and, on a query
// failure, serves a stale cached list if one exists so a transient database blip
// does not empty a project's model surface. It is safe for concurrent use and
// NEVER routes through bifrost/core (design §4.2, §3.4).
type ModelResolver struct {
	db  modelRowQuerier
	ttl time.Duration
	now func() time.Time
	// publicProjectID is the platform's shared project (issue #316). Empty
	// disables the shared scope. Operator configuration, never request data.
	publicProjectID string
	logger          *slog.Logger

	mu    sync.RWMutex
	cache map[string]modelsCacheEntry
}

type modelsCacheEntry struct {
	models  []modelObject
	expires time.Time
}

// ModelResolverConfig configures a ModelResolver.
type ModelResolverConfig struct {
	// DB is the Postgres handle (*pgxpool.Pool via ModelPoolQuerier in
	// production). When nil the resolver returns an empty model set for every
	// project — a gateway booted without a database exposes no synthetic models
	// rather than erroring the /v1/models surface.
	DB modelRowQuerier
	// CacheTTL overrides the per-project cache lifetime. <= 0 uses
	// DefaultModelsCacheTTL.
	CacheTTL time.Duration
	// Now overrides the clock (tests). nil uses time.Now.
	Now func() time.Time
	// Logger is used for resolution warnings; nil uses slog.Default().
	Logger *slog.Logger
	// PublicProjectID is the platform's shared ("public") project id as a
	// decimal string (ELITEA_AI_PROJECT_ID). When set, List also returns that
	// project's `shared = true` models, so /llm/v1/models agrees with the model
	// picker the caller just used (issue #316). Empty disables the shared scope.
	//
	// This MUST be operator configuration. A request-supplied value would let a
	// caller name any project as "public" and enumerate its models.
	PublicProjectID string
}

// NewModelResolver builds a ModelResolver from cfg.
func NewModelResolver(cfg ModelResolverConfig) *ModelResolver {
	ttl := cfg.CacheTTL
	if ttl <= 0 {
		ttl = DefaultModelsCacheTTL
	}
	now := cfg.Now
	if now == nil {
		now = time.Now
	}
	logger := cfg.Logger
	if logger == nil {
		logger = slog.Default()
	}
	return &ModelResolver{
		db:              cfg.DB,
		ttl:             ttl,
		now:             now,
		publicProjectID: cfg.PublicProjectID,
		logger:          logger,
		cache:           make(map[string]modelsCacheEntry),
	}
}

// modelsSQL reads the caller-visible model ids for a project's configured
// models. elitea_title is the alias the caller uses in the request `model`
// field (it is what ChatConfig surfaces as the model "name"); data carries the
// underlying wire name as a fallback id.
//
// The admitted rows are the (section, type) pairs of addressableModelSections,
// bound as two parallel arrays and joined WITH ORDINALITY. The ordinality is
// load-bearing rather than decorative: it orders the result by the declared
// section order first and by row id second. The chat models therefore keep the
// position they held when the `llm` section was the only one read, and a model
// id that two sections both carry resolves to the same row on every call.
//
// %q is the schema name. %s is the scope predicate: empty for the caller's own
// project, and sharedModelPredicate for the public project, whose rows are
// visible to another project ONLY when the platform published them. `shared` is
// selected so the public-scope result can be re-verified in Go.
const modelsSQL = `SELECT COALESCE(c.elitea_title, ''), c.data, c.shared
	FROM %q.configuration AS c
	JOIN unnest($1::text[], $2::text[]) WITH ORDINALITY AS s(section, type, ord)
	  ON c.section = s.section AND c.type = s.type
	WHERE c.status_ok = true%s
	ORDER BY s.ord, c.id`

// sharedModelPredicate restricts a cross-project read to published rows. It is
// the only thing that makes reading a second schema safe, so it is a constant
// and is never built from a caller-supplied value.
const sharedModelPredicate = " AND c.shared = true"

// List returns the synthesised model set for projectID. It serves a fresh
// cached list when one exists, else queries Postgres and caches the result. On
// a query failure it serves a stale cached list if present (logging a warning)
// so a transient database blip does not empty the surface; with no cache and a
// failing/absent database it returns an empty (non-nil) slice. An empty
// projectID yields an empty set (no project ⇒ no models).
func (m *ModelResolver) List(ctx context.Context, projectID string) []modelObject {
	models, _ := m.list(ctx, projectID)
	return models
}

// list is List plus the "did I actually read this project's model set?" answer.
// known is false when the set is UNKNOWN — an empty projectID, no database, or
// a query failure with nothing cached — and true when the returned set is the
// project's real (possibly stale, possibly empty) model set.
//
// The two cases must stay distinct because the inference path acts on them
// differently: an unknown set forwards the caller's model unchanged, while a
// known set rejects a model that is not in it (see resolve). List collapses
// both to an empty slice, which is correct for the /llm/v1/models surface.
func (m *ModelResolver) list(ctx context.Context, projectID string) (models []modelObject, known bool) {
	if projectID == "" {
		return []modelObject{}, false
	}
	if m.db == nil {
		return []modelObject{}, false
	}

	m.mu.RLock()
	ent, cached := m.cache[projectID]
	fresh := cached && m.now().Before(ent.expires)
	m.mu.RUnlock()
	if fresh {
		return ent.models, true
	}

	models, err := m.query(ctx, projectID)
	if err != nil {
		// Serve a stale cached list on a transient failure rather than emptying
		// the project's model surface. Nothing cached ⇒ empty set.
		if cached {
			m.logger.WarnContext(ctx, "models: query failed; serving stale cached list",
				"project_id", projectID, "err", err, "stale_count", len(ent.models))
			return ent.models, true
		}
		m.logger.WarnContext(ctx, "models: query failed and no cache; returning empty set",
			"project_id", projectID, "err", err)
		return []modelObject{}, false
	}

	m.mu.Lock()
	m.cache[projectID] = modelsCacheEntry{models: models, expires: m.now().Add(m.ttl)}
	m.mu.Unlock()
	return models, true
}

// Get returns the single synthesised model with the given id for projectID and
// whether it was found. It reuses List (and therefore the cache), so a
// single-model lookup never hits the database when the list is already cached.
func (m *ModelResolver) Get(ctx context.Context, projectID, id string) (modelObject, bool) {
	for _, mo := range m.List(ctx, projectID) {
		if mo.ID == id {
			return mo, true
		}
	}
	return modelObject{}, false
}

// query reads and decodes the project's model rows into a deduplicated,
// order-preserving model set.
//
// It reads two scopes (issue #316): the caller's own project, then the public
// project's `shared = true` rows. The own-project scope is read FIRST and a
// duplicate id keeps its first occurrence, so where both scopes expose the same
// model id the project's own row wins — the precedence the legacy
// _map_model_name resolver had. The second scope is skipped when it is unset or
// when the caller IS the public project.
//
// A row with no usable id (empty elitea_title and empty data.name) is skipped.
//
// TENANT ISOLATION: publicProjectID is operator configuration, never request
// data, and the public-scope read always carries sharedModelPredicate.
func (m *ModelResolver) query(ctx context.Context, projectID string) ([]modelObject, error) {
	if m.db == nil {
		return []modelObject{}, nil
	}
	if err := validateNumericProjectID(projectID); err != nil {
		return nil, err
	}

	models := make([]modelObject, 0)
	seen := make(map[string]struct{})
	if err := m.queryScope(ctx, projectID, false, &models, seen); err != nil {
		return nil, err
	}

	if m.publicProjectID == "" || m.publicProjectID == projectID {
		return models, nil
	}
	if err := validateNumericProjectID(m.publicProjectID); err != nil {
		return nil, fmt.Errorf("public project id: %w", err)
	}
	if err := m.queryScope(ctx, m.publicProjectID, true, &models, seen); err != nil {
		return nil, err
	}
	return models, nil
}

// queryScope reads one project's model rows, across every pair in
// addressableModelSections, and appends the new ids to models, skipping any id
// already in seen. sharedOnly adds the `shared = true` predicate and re-verifies
// every returned row against its own `shared` column.
func (m *ModelResolver) queryScope(
	ctx context.Context,
	scopeProjectID string,
	sharedOnly bool,
	models *[]modelObject,
	seen map[string]struct{},
) error {
	predicate := ""
	if sharedOnly {
		predicate = sharedModelPredicate
	}
	// scopeProjectID is either the signed, server-resolved caller project or the
	// operator-configured public project. Both are numeric-validated before they
	// reach here, so the fmt-built schema identifier is not an injection vector
	// — the same guard the account package applies (design §5.3).
	q := fmt.Sprintf(modelsSQL, "p_"+scopeProjectID, predicate)
	sections, types := modelSectionArgs()
	rows, err := m.db.Query(ctx, q, sections, types)
	if err != nil {
		return fmt.Errorf("query models for project %s: %w", scopeProjectID, err)
	}
	defer rows.Close()

	for rows.Next() {
		var (
			title     string
			dataBytes []byte
			shared    bool
		)
		if err := rows.Scan(&title, &dataBytes, &shared); err != nil {
			return fmt.Errorf("scan model row: %w", err)
		}
		// Defence in depth: a cross-project read must never yield an unpublished
		// row. Reaching here means the query lost its predicate, so fail the read
		// rather than advertise another project's private model.
		if sharedOnly && !shared {
			return fmt.Errorf("model row from project %s escaped the shared scope", scopeProjectID)
		}
		id, providerModel := modelNames(title, dataBytes)
		if id == "" {
			continue
		}
		if _, dup := seen[id]; dup {
			continue
		}
		seen[id] = struct{}{}
		// A shared row carries providerModel exactly like an own row (issue
		// #317). The scope decides WHICH rows come back; it does not change what
		// a row carries. A shared model must map to the provider's name too,
		// else the budget gate prices the wrong model and the provider gets a
		// title it does not know.
		*models = append(*models, modelObject{
			ID:            id,
			Object:        modelObjectType,
			Created:       0,
			OwnedBy:       modelsOwnedBy,
			providerModel: providerModel,
		})
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate model rows: %w", err)
	}
	return nil
}

// modelNames resolves the two names of one model row:
//
//   - id is the caller-visible model id: the elitea_title alias when present,
//     else the underlying data.name. It is "" when neither is usable, and the
//     row is then skipped.
//   - providerModel is the name to send to the provider: data.name. It falls
//     back to id when data.name is absent, so a row that carries a title and no
//     wire name dispatches the title exactly as it did before issue #317.
//
// A malformed data JSONB is treated as absent.
func modelNames(title string, dataBytes []byte) (id, providerModel string) {
	var d modelConfigData
	if len(dataBytes) > 0 {
		if err := json.Unmarshal(dataBytes, &d); err != nil {
			d = modelConfigData{}
		}
	}
	id = title
	if id == "" {
		id = d.Name
	}
	if id == "" {
		return "", ""
	}
	providerModel = d.Name
	if providerModel == "" {
		providerModel = id
	}
	return id, providerModel
}

// validateNumericProjectID rejects a non-numeric projectID before it is
// interpolated into the schema name. The id is server-resolved, but this guards
// a malformed/hostile value from reaching the query (mirrors the account
// package's guard).
func validateNumericProjectID(projectID string) error {
	if projectID == "" {
		return fmt.Errorf("empty project id")
	}
	for _, r := range projectID {
		if r < '0' || r > '9' {
			return fmt.Errorf("invalid project id %q: must be numeric", projectID)
		}
	}
	return nil
}
