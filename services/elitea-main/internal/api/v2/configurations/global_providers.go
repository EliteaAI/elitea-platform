package configurations

// Global LLM providers — `/api/v2/admin/gateway/providers`.
//
// ## What "global" means here, and why it needed no new storage
//
// A platform-wide provider credential ALREADY EXISTS in this architecture, and
// the gateway already resolves one. `services/elitea-llm-gateway`'s account
// package reads two scopes for every request: the caller's own project schema,
// and the PUBLIC project's schema restricted to `shared = true` (issue #316,
// `shared_credentials_test.go`). A credential published there resolves for
// every project on the platform, with the secret read from the public project's
// own Fernet vault and the bifrost Key ID prefixed `shared:` so two schemas
// cannot collide.
//
// So nothing about the credential model changes here, and deliberately so.
// Inventing a second, platform-level credential table would mean teaching the
// gateway a second resolution path beside one that is already built, tested and
// enforcing the self-referential guard — and the two would then have to agree
// about precedence, sharing, vault scope and `status_ok` forever.
//
// What was missing was the SURFACE. To publish a platform credential an
// operator had to know that "project 1, ticked shared" is the global scope, open
// that project's ordinary settings screen, and be a member of it. Nothing said
// so anywhere, and nothing on the admin panel mentioned providers at all. That
// is what this file adds: the same rows, authored on purpose, from the LLM Proxy
// section that already explains the gateway.
//
// ## It is the SAME handlers, not a second implementation
//
// Every route below delegates to this package's own List/Create/Update/Delete
// after rewriting the request. That is the point: those handlers carry the
// self-referential guard, the vault sealing that keeps an api_key out of the
// row, the `section` resolution, provider admission (`status_ok`, which the
// gateway requires and which nothing else in a shipped stack writes) and the
// partial-update semantics that a naive re-implementation got wrong badly enough
// to erase credentials (see Update's header). A parallel copy would have to be
// right about all of it, forever, and would be discovered to be wrong the way
// those were.
//
// The rewrite is three things and no more:
//
//  1. the project is pinned to the public project — the caller never names one;
//  2. `shared` is forced true on every write, because a platform credential that
//     is not shared is invisible to every project including the one holding it;
//  3. `type` must be a provider credential type the gateway can dispatch to.
//
// (3) is what keeps this from being a general-purpose writer for the public
// project's whole configuration table under one central permission. Without it,
// the same route would author toolkit credentials, model rows and project
// context in a schema every tenant reads.
//
// ## Authorisation
//
// Central `configuration.governance`, in administration mode — the permission
// the rest of the `/admin/gateway` group takes. It is shared rather than new for
// the reason router.go states where that group is mounted: a second permission
// string reaches nobody until a migration grants it, which is the #386 shape.
// The privilege this adds is real but narrow: a holder could already write these
// exact rows through `/api/v2/configurations` if they were an admin of the
// public project.
//
// The gate is applied at the MOUNT, not per route, because one permission covers
// all four verbs here. That differs from Routes() above — which needs five
// different strings and therefore gates inside the package — and the difference
// is why this router does not simply reuse that one.

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"

	configurationapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
	"github.com/go-chi/chi/v5"
)

// GlobalProviderSection is the configuration section a provider credential
// lives in. The listing is pinned to it, so this router cannot read the public
// project's models, toolkit credentials or project context.
const GlobalProviderSection = "ai_credentials"

// GlobalProviderRoutes is the admin surface for platform-wide provider
// credentials. Mount it behind the central gate; it applies none itself.
func (h *Handler) GlobalProviderRoutes() chi.Router {
	r := chi.NewRouter()
	r.Get("/", h.ListGlobalProviders)
	r.Post("/", h.CreateGlobalProvider)
	r.Put("/{configID}", h.UpdateGlobalProvider)
	r.Delete("/{configID}", h.DeleteGlobalProvider)
	return r
}

// pinPublicProject rewrites the request so the delegated handler reads the
// public project, and reports whether this deployment has one.
//
// The project id is written into chi's route context rather than into the path,
// because that is what `chi.URLParam` reads and it is therefore the one place a
// delegated handler can be reached from. Writing a new URL would leave the route
// context saying something else, and any handler that consulted it would get the
// caller's — which on this router is nothing at all.
//
// An UNCONFIGURED public project refuses rather than defaulting. Guessing
// project 1 would publish a credential into a schema this deployment's gateway
// may never read, and the operator would be shown a success.
func (h *Handler) pinPublicProject(w http.ResponseWriter, r *http.Request) (*http.Request, bool) {
	if h.publicProjectID <= 0 {
		apierr.WriteStatus(w, http.StatusServiceUnavailable,
			"this deployment names no public project, so a platform-wide provider has nowhere to be "+
				"published. Set AI_PROJECT_ID to the shared project's id.")
		return nil, false
	}
	if h.pool == nil {
		apierr.WriteStatus(w, http.StatusServiceUnavailable, "the configuration store is not available")
		return nil, false
	}

	routeCtx := chi.RouteContext(r.Context())
	if routeCtx == nil {
		apierr.WriteStatus(w, http.StatusInternalServerError, "internal server error")
		return nil, false
	}
	routeCtx.URLParams.Add("projectID", fmt.Sprintf("%d", h.publicProjectID))
	return r, true
}

// GlobalProvider is one platform provider credential as the admin listing
// reports it.
//
// It carries NO `data` object, and that is the reason this route has a query of
// its own instead of delegating to List like the three writes delegate.
//
// Sealing makes the stored reference the redaction — a write through this
// platform replaces every schema-declared password with `{{secret.NAME}}`
// before the row is stored — but the listing must not DEPEND on that having
// happened. A row imported from a legacy deployment, or written before sealing
// existed, can still hold a literal api_key, and an admin screen over the public
// project's credentials is precisely where such a value would be handed to a
// browser and then to a browser cache, a screenshot and a support ticket.
//
// So the secret fields never leave the server at all. What an operator needs
// from a credential list is which provider it is, where it points, whether the
// gateway will admit it, and whether each secret is SET — never what the secret
// is. `Secrets` answers the last of those as booleans.
type GlobalProvider struct {
	ID    int    `json:"id"`
	UUID  string `json:"uuid"`
	Name  string `json:"elitea_title"`
	Label string `json:"label"`
	Type  string `json:"type"`
	// StatusOK is the column the gateway requires. A credential with false here
	// is stored, listed and completely inert, which is a state an operator has
	// no other way to see.
	StatusOK   bool   `json:"status_ok"`
	StatusLogs string `json:"status_logs"`
	// Endpoint is `api_base` — not a secret, and the field an operator most
	// often needs to check.
	Endpoint string `json:"endpoint"`
	// Settings are the remaining NON-SECRET fields, by provider: api_version for
	// Azure/DIAL, the AWS region and access-key id for Bedrock, the Vertex
	// project and location. An allowlist rather than "data minus the secrets",
	// because a field added to a provider schema later would otherwise be
	// published here without anyone deciding it was safe.
	Settings map[string]string `json:"settings"`
	// Secrets reports, per secret field the row carries, whether it holds a
	// value AND whether that value is sealed. An unsealed value is a finding:
	// the credential works, and the row is readable by every holder of the
	// project-scoped configuration permissions on the public project.
	Secrets   []GlobalProviderSecret `json:"secrets"`
	CreatedAt string                 `json:"created_at"`
	UpdatedAt string                 `json:"updated_at"`
}

// GlobalProviderSecret is one secret field's disclosure-free status.
type GlobalProviderSecret struct {
	Field string `json:"field"`
	Set   bool   `json:"set"`
	// Sealed is false when the row holds the value literally rather than as a
	// {{secret.NAME}} reference. The value is still never sent.
	Sealed bool `json:"sealed"`
}

// globalProviderSecretFields are the `data` keys that hold secret material,
// across every provider type the gateway dispatches to.
//
// Listed explicitly rather than derived from the pinned catalogue's `password`
// properties. The catalogue is the authority for SEALING, where a type it does
// not describe correctly keeps its data verbatim; here the failure direction is
// the opposite — a secret this list forgets is a secret published to a browser —
// so it is enumerated, and a type outside the enumeration discloses nothing
// because only these keys are ever inspected.
var globalProviderSecretFields = []string{
	"api_key", "api_token", "aws_secret_access_key", "vertex_credentials",
}

// globalProviderSettingFields are the non-secret `data` keys the listing
// publishes. See GlobalProvider.Settings for why this is an allowlist.
var globalProviderSettingFields = []string{
	"api_version", "aws_access_key_id", "aws_region_name",
	"vertex_project", "vertex_location", "use_anthropic_endpoints",
}

// listGlobalProvidersSQL reads the public project's shared credential rows.
//
// The schema is interpolated because a schema name cannot be a bind parameter;
// it is built from `h.publicProjectID`, an operator-configured integer, and
// never from request data. The two predicates are constants.
const listGlobalProvidersSQL = `
	SELECT id, COALESCE(uuid::text, ''), COALESCE(label, ''), elitea_title, type,
	       data, status_ok, COALESCE(status_logs, ''), created_at, updated_at
	  FROM %q.configuration
	 WHERE section = '` + GlobalProviderSection + `' AND shared = true
	 ORDER BY elitea_title, id`

// ListGlobalProviders serves GET /admin/gateway/providers.
func (h *Handler) ListGlobalProviders(w http.ResponseWriter, r *http.Request) {
	if _, ok := h.pinPublicProject(w, r); !ok {
		return
	}
	ctx := r.Context()
	schema := fmt.Sprintf("p_%d", h.publicProjectID)

	rows, err := h.pool.Query(ctx, fmt.Sprintf(listGlobalProvidersSQL, schema))
	if err != nil {
		writeConfigurationQueryFailure(ctx, w, "list global providers failed", schema, err)
		return
	}
	defer rows.Close()

	items := make([]GlobalProvider, 0)
	for rows.Next() {
		item, scanErr := scanGlobalProvider(rows.Scan)
		if scanErr != nil {
			writeConfigurationRowFailure(ctx, w, schema, scanErr)
			return
		}
		items = append(items, item)
	}
	if rows.Err() != nil {
		writeConfigurationQueryFailure(ctx, w, "list global providers failed", schema, rows.Err())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"total": len(items),
		// Echoed so an operator can confirm WHICH project this deployment
		// treats as the shared one. Getting that wrong is the failure where
		// every credential is published correctly into a schema the gateway
		// does not read.
		"public_project_id": h.publicProjectID,
	})
}

// scanGlobalProvider turns one row into its disclosure-free report.
//
// It takes `rows.Scan` rather than the `pgx.Rows`, so the redaction rules — the
// part with the disclosure decision in them — are testable without a database.
func scanGlobalProvider(scan func(...any) error) (GlobalProvider, error) {
	var item GlobalProvider
	var data []byte
	var createdAt, updatedAt time.Time
	if err := scan(&item.ID, &item.UUID, &item.Label, &item.Name, &item.Type,
		&data, &item.StatusOK, &item.StatusLogs, &createdAt, &updatedAt); err != nil {
		return GlobalProvider{}, err
	}

	var decoded map[string]any
	// A row whose `data` will not decode is reported as a credential with no
	// settings and no secrets rather than failing the whole listing: one corrupt
	// row must not make the platform's provider screen unreachable, which is
	// the exact shape of the `meta = 'null'` defect Create's header records.
	_ = json.Unmarshal(data, &decoded)

	item.Endpoint = globalProviderString(decoded, "api_base")
	item.Settings = map[string]string{}
	for _, field := range globalProviderSettingFields {
		if value := globalProviderString(decoded, field); value != "" {
			item.Settings[field] = value
		}
	}
	item.Secrets = make([]GlobalProviderSecret, 0, len(globalProviderSecretFields))
	for _, field := range globalProviderSecretFields {
		value := globalProviderString(decoded, field)
		if value == "" {
			continue
		}
		item.Secrets = append(item.Secrets, GlobalProviderSecret{
			Field:  field,
			Set:    true,
			Sealed: configurationapp.IsCurrentSecretReference(value),
		})
	}
	item.CreatedAt = createdAt.Format(time.RFC3339)
	item.UpdatedAt = updatedAt.Format(time.RFC3339)
	return item, nil
}

// globalProviderString reads one `data` key as a string.
//
// A non-string value yields "" rather than its formatted form. That matters for
// the SECRET fields: a secret stored as a number or an object must not be
// rendered into a string here on its way to a browser, and reporting it as
// "not set" is the safe error — the write paths type-check these fields, so a
// value of another type is a row nothing on this platform wrote.
func globalProviderString(data map[string]any, key string) string {
	if data == nil {
		return ""
	}
	switch value := data[key].(type) {
	case string:
		return value
	case bool:
		if value {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

// CreateGlobalProvider serves POST /admin/gateway/providers.
func (h *Handler) CreateGlobalProvider(w http.ResponseWriter, r *http.Request) {
	request, ok := h.pinPublicProject(w, r)
	if !ok {
		return
	}
	rewritten, ok := rewriteGlobalProviderBody(w, request, true)
	if !ok {
		return
	}
	h.Create(w, rewritten)
}

// UpdateGlobalProvider serves PUT /admin/gateway/providers/{configID}.
//
// The type is optional on an update — the delegated handler applies a PARTIAL
// change — but when it IS present it is checked, so a row cannot be edited out
// of the provider set and left behind on this surface.
func (h *Handler) UpdateGlobalProvider(w http.ResponseWriter, r *http.Request) {
	request, ok := h.pinPublicProject(w, r)
	if !ok {
		return
	}
	rewritten, ok := rewriteGlobalProviderBody(w, request, false)
	if !ok {
		return
	}
	h.Update(w, rewritten)
}

// DeleteGlobalProvider serves DELETE /admin/gateway/providers/{configID}.
//
// It carries no body, so there is nothing to rewrite and nothing to force. The
// route is still pinned to the public project, which is what stops a `configID`
// from naming a row in some other tenant's schema.
func (h *Handler) DeleteGlobalProvider(w http.ResponseWriter, r *http.Request) {
	request, ok := h.pinPublicProject(w, r)
	if !ok {
		return
	}
	h.Delete(w, request)
}

// maxGlobalProviderBodyBytes bounds the body this router buffers in order to
// rewrite it. It matches the delegated handlers' own bound, so a body this
// router accepts is never one they would then refuse for size — the rewrite
// must not become a second, looser gate.
const maxGlobalProviderBodyBytes = maxConfigurationRequestBytes

// rewriteGlobalProviderBody forces `shared: true` and checks the `type`.
//
// The body is buffered and re-encoded rather than streamed, because both facts
// have to be established BEFORE the delegated handler reads a byte: forcing
// `shared` afterwards is impossible, and refusing a type afterwards would mean
// the row was already written. The bound above keeps that buffering finite.
//
// `requireType` is true for a create and false for an update, matching the two
// handlers' own contracts: a create with no type stores an empty `section` and
// is useless, while an update names only the fields it changes.
func rewriteGlobalProviderBody(
	w http.ResponseWriter, r *http.Request, requireType bool,
) (*http.Request, bool) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, maxGlobalProviderBodyBytes+1))
	if err != nil {
		apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}
	if int64(len(raw)) > maxGlobalProviderBodyBytes {
		apierr.WriteStatus(w, http.StatusRequestEntityTooLarge, "request body too large")
		return nil, false
	}

	var body map[string]any
	if err := json.Unmarshal(raw, &body); err != nil {
		apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}
	if body == nil {
		body = map[string]any{}
	}

	if !admitGlobalProviderType(w, body, requireType) {
		return nil, false
	}

	// A caller that explicitly asked NOT to share is refused rather than
	// silently overridden. The two differ for the operator: an override reports
	// success for the opposite of what they asked, and the row they get back
	// says `shared: true` with no explanation of where their value went.
	if requested, present := body["shared"]; present {
		if shared, isBool := requested.(bool); !isBool || !shared {
			apierr.WriteStatus(w, http.StatusBadRequest,
				"a platform provider is always shared: a credential that is not shared is invisible to "+
					"every project, including the one that holds it")
			return nil, false
		}
	}
	body["shared"] = true

	rewritten, err := json.Marshal(body)
	if err != nil {
		apierr.WriteStatus(w, http.StatusBadRequest, "invalid request body")
		return nil, false
	}

	request := r.Clone(r.Context())
	request.Body = io.NopCloser(bytes.NewReader(rewritten))
	request.ContentLength = int64(len(rewritten))
	return request, true
}

// admitGlobalProviderType refuses a type no runtime can dispatch to, and — more
// importantly — refuses one that is not a provider credential at all.
//
// The second is the security property. Without it this route writes any row
// into the public project's configuration table: a toolkit credential, a model,
// a project context — every one of them readable or usable by every tenant,
// authored under a permission granted for governance.
func admitGlobalProviderType(w http.ResponseWriter, body map[string]any, required bool) bool {
	raw, present := body["type"]
	if !present {
		if required {
			apierr.WriteStatus(w, http.StatusBadRequest, "a provider type is required")
			return false
		}
		return true
	}
	configType, isString := raw.(string)
	if !isString || !configurationapp.CurrentProviderCredentialType(configType) {
		apierr.WriteStatus(w, http.StatusBadRequest,
			"not an LLM provider credential type the gateway can dispatch to")
		return false
	}
	return true
}
