package secrets

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// Handler serves the secrets API, backed by the same centry.secrets_key /
// centry.secrets_data tables that the Python pylon secrets plugin uses.
//
// Encryption scheme (Python cryptography.fernet.Fernet):
//
//	32-byte key   = <first-16 bytes: HMAC-SHA256 signing key>
//	                <last-16 bytes:  AES-128-CBC encryption key>
//	Token layout  = base64url( version[1] | timestamp[8] | iv[16] |
//	                            ciphertext[N] | hmac[32] )
//
// The project-level key is itself stored encrypted with a master key
// (SECRETS_MASTER_KEY env var, base64url-encoded 32-byte Fernet key).
type Handler struct {
	pool      *pgxpool.Pool
	masterKey []byte // nil when SECRETS_MASTER_KEY is absent
	// masterKeyErr is set when SECRETS_MASTER_KEY is present and malformed.
	// Every vault read and every vault write then fails with it, so the
	// handler stores NOTHING rather than storing project keys unwrapped
	// (#412). See MasterKeyFromEnv for why the two cases differ.
	masterKeyErr error
	// permissionResolver authorises BOTH mode families: the `administration`
	// routes (admin.go, central mode) and the project routes below (`default`
	// mode, keyed on the `{projectID}` in the path). nil for the two
	// programmatic constructors that never serve HTTP, which is safe: both
	// gates fail closed on a nil resolver.
	permissionResolver auth.PermissionResolver
}

// Option configures a Handler. Same shape as the other v2 packages'.
type Option func(*Handler)

// WithPermissionResolver supplies the resolver EVERY route is gated on — the
// `administration`-mode ones in admin.go and the project ones in Routes().
// Without it every one of them answers 403.
func WithPermissionResolver(resolver auth.PermissionResolver) Option {
	return func(h *Handler) { h.permissionResolver = resolver }
}

// MasterKeyEnvVar names the one variable that decides whether a project
// vault's key row is wrapped. Every message this package writes about the
// master key names it, so an operator can search the logs for it.
const MasterKeyEnvVar = "SECRETS_MASTER_KEY"

// MasterKeyFromEnv reads the master key and validates it.
//
// It separates the two cases the old NewHandler answered identically:
//
//   - ABSENT: key is nil and err is nil. The deployment asks for unwrapped
//     storage. That stays supported, because centry supports it and because a
//     local stack has no key to give. The caller must say so out loud —
//     cmd/elitea-main logs a warning that names the consequence.
//   - MALFORMED: err is not nil. The deployment asks for wrapped storage and
//     cannot get it. A wrong length, bad base64, or a stray space or tab from a
//     mounted secret is an operator error. It is never an instruction to
//     downgrade the storage.
//
// The old code read the second case as the first. It left masterKey nil, and
// the handler then minted and wrote UNWRAPPED vaults while the operator
// believed the keys were wrapped. Nothing logged and nothing failed, because
// every later read of an unwrapped vault also succeeds (#412).
//
// WHAT COUNTS AS MALFORMED IS UNCHANGED. This function validates with
// fernetDecodeKey, exactly as the old code did, and adds no whitespace rule of
// its own. That matters for one shape in particular: Go's base64 decoder
// IGNORES "\r" and "\n", so a key read from a file with a trailing newline
// decodes to the same 32 bytes and keeps working. Python's
// base64.urlsafe_b64decode ignores it too, so pylon's secrets engine agrees.
// Rejecting a newline here would stop a deployment that works today, which is
// the opposite of the repair. A space or a tab is a different matter: neither
// decoder pair agrees on it, so it stays an error.
//
// getenv is injected so a test can supply a value without t.Setenv, which
// forbids t.Parallel.
func MasterKeyFromEnv(getenv func(string) string) ([]byte, error) {
	value := getenv(MasterKeyEnvVar)
	if value == "" {
		return nil, nil
	}
	raw, err := fernetDecodeKey(value)
	if err != nil {
		return nil, fmt.Errorf(
			"%s is set and malformed: %w; supply a base64url-encoded 32-byte Fernet key "+
				"with no stray spaces or tabs, or remove the variable to store project "+
				"vault keys unwrapped", MasterKeyEnvVar, err)
	}
	return raw, nil
}

// NewHandler constructs the secrets handler.  The pool is used for
// centry.secrets_key / centry.secrets_data reads and writes.
//
// A malformed SECRETS_MASTER_KEY does not stop construction, because this
// constructor cannot report an error: two of its four callers build a handler
// per request, so an error here would surface long after provisioning had
// already written vaults. cmd/elitea-main validates the variable at start-up
// instead, and stops. This constructor keeps the fault so that a handler built
// WITHOUT that gate still fails closed (#412).
func NewHandler(pool *pgxpool.Pool, opts ...Option) *Handler {
	h := &Handler{pool: pool}
	h.masterKey, h.masterKeyErr = MasterKeyFromEnv(os.Getenv)
	for _, opt := range opts {
		opt(h)
	}
	return h
}

// Legacy pylon API modes (legacy/plugins/shared/tools/config.py:40-41).
// `mode` is a real path segment that SELECTS THE HANDLER in pylon
// (api_tools.APIBase.proxy_method looks it up in mode_handlers and
// abort(404)s on a miss), not decoration.
const (
	// modeDefault is pylon's c.DEFAULT_MODE: the project-scoped vault
	// (VaultClient.from_project(project_id)).  It is also what pylon uses
	// when the segment is omitted entirely — proxy_method's `mode` kwarg
	// defaults to "default", and api_tools.with_modes registers both the
	// mode-ful and the mode-less URL for every resource.
	modeDefault = "default"
	// modeAdministration is pylon's c.ADMINISTRATION_MODE: a DIFFERENT
	// handler over the GLOBAL vault (a bare VaultClient(), project_id nil
	// → row id "admin"), with different request/response shapes.  Unit A14
	// implements it, in admin.go — see that file's header for why it had to
	// be a separate handler rather than a flag on this one, and where the
	// "admin" row id is established.  (Earlier revisions of this comment
	// said the row id was "project-None"; that is the HashiCorp engine's
	// naming, not the database engine this deployment runs.)
	modeAdministration = "administration"
)

// Routes returns the secrets subrouter.  It is Mount()ed at "/secrets" by
// internal/api/router.go, which reproduces the pylon URL shape exactly:
//
//	/api/v2/<plugin>/<resource-module>/<mode>/<params>
//
// The plugin is `secrets` (the mount prefix) and the resource modules are
// legacy/plugins/secrets/api/v2/{secrets,secret,hide}.py, so the served
// paths are /api/v2/secrets/{secrets,secret,hide}/…  The doubled "secrets"
// is the REAL legacy shape, not the double-mount bug #137 took it for: the
// pinned baseline client agrees (apps/elitea-ui/src/api/secrets.js:3 sets
// apiSlicePath = '/secrets' and appends '/secrets/default/<id>'), and so do
// elitea-sdk (runtime/clients/{client,sandbox_client}.py), admin_ui
// (frontend/src/api/secretsApi.js) and qa/elitea-api-testing
// (utils/utils.py:322).  #137 moved these routes to the v2 root and broke
// all four; #151 restores them and moves the new client onto this shape.
func (h *Handler) Routes() chi.Router {
	r := chi.NewRouter()
	// Each route serves BOTH pylon modes: the first handler is the project
	// vault, the second the global vault (admin.go).  They are separate
	// handlers over separate stores with separate bodies — see withModes.
	//
	// GET  /secrets/{mode}/{projectID}            – list secret names
	r.Get("/secrets/{mode}/{projectID}", h.withModes(
		h.projectGate(permSecretList, h.List),
		h.adminGate(permSecretView, h.AdminList)))
	// POST /secrets/{mode}/{projectID}            – create a new secret
	//
	// The administration form of this ONE route is not implemented.  Pylon's
	// `AdminAPI.post` takes `{"secrets": {…}}` and REPLACES the entire global
	// vault in a single call; no client in this workspace calls it (admin_ui
	// creates through /secret/…/{name}, and elitea-sdk and qa/ never touch
	// administration mode), so it is a bulk-destructive operation with no
	// caller and no test that could discriminate a correct implementation
	// from a wrong one.  501 says so instead of guessing.
	r.Post("/secrets/{mode}/{projectID}", h.withModes(
		h.projectGate(permSecretCreate, h.Create), notImplementedBulkReplace))
	// GET  /secret/{mode}/{projectID}/{name}      – get a single secret (with value)
	r.Get("/secret/{mode}/{projectID}/{name}", h.withModes(
		h.projectGate(permSecretUnsecret, h.Get),
		h.adminGate(permSecretView, h.AdminGet)))
	// POST /secret/{mode}/{projectID}/{name}      – administration-mode create
	//
	// Project mode has no POST on this path (pylon's ProjectAPI defines only
	// get/put/delete here), so it 405s rather than pretending.
	r.Post("/secret/{mode}/{projectID}/{name}", h.withModes(methodNotAllowed,
		h.adminGate(permSecretCreate, h.AdminCreate)))
	// PUT  /secret/{mode}/{projectID}/{name}      – rename / update a secret
	r.Put("/secret/{mode}/{projectID}/{name}", h.withModes(
		h.projectGate(permSecretEdit, h.Update),
		h.adminGate(permSecretEdit, h.AdminUpdate)))
	// DELETE /secret/{mode}/{projectID}/{name}    – delete a secret
	r.Delete("/secret/{mode}/{projectID}/{name}", h.withModes(
		h.projectGate(permSecretDelete, h.Delete),
		h.adminGate(permSecretDelete, h.AdminDelete)))
	// POST /hide/{mode}/{projectID}/{name}        – move secret to hidden_secrets
	r.Post("/hide/{mode}/{projectID}/{name}", h.withModes(
		h.projectGate(permSecretHide, h.Hide),
		h.adminGate(permSecretEdit, h.AdminHide)))

	// The mode-LESS form of the show route, which pylon also serves
	// (with_modes registers `<project_id>/<secret>` alongside
	// `<mode>/<project_id>/<secret>`) and which elitea-sdk is the sole
	// caller of: elitea_sdk/runtime/clients/client.py:108 and
	// sandbox_client.py:237 build
	// {api_v2}/secrets/secret/{project_id} and append /{name}.
	// Only this one variant is registered: pylon serves the mode-less form
	// of every route, but no consumer in the workspace calls any of the
	// others, and a route with no caller is a route no test can discriminate.
	//
	// It carries the SAME gate as the mode-ful GET, because in pylon it IS
	// the mode-ful GET. `api_tools.with_modes` registers the mode-less URL
	// against the same `APIBase`, and `proxy_method`'s signature is
	// `def proxy_method(self, method, mode='default', **kwargs)` — so a
	// request with no mode segment dispatches to `DEFAULT_MODE` →
	// `ProjectAPI.get`, which declares
	// `configuration.secrets.secret.unsecret` (secret.py:26). The runtime is
	// therefore already passing this exact check against pylon in production;
	// gating it here is parity, not a new restriction.
	//
	// The principal is not a permission-less service identity: both SDK
	// clients send `Authorization: Bearer <auth_token>` of the invoking user
	// (runtime/clients/client.py:92, sandbox_client.py:228), and
	// legacyrbac.PostgresResolver resolves a token to its OWNING USER and
	// then that user's project roles. The `X-SECRET` header those clients
	// also send is not an auth credential — pylon compares it to the
	// `secrets_header_value` secret purely to decide whether to suppress
	// default secret keys (`ignore_default_secret_api`), and it grants
	// nothing.
	r.Get("/secret/{projectID}/{name}", h.projectGate(permSecretUnsecret, h.Get))
	return r
}

// The permissions pylon's `ProjectAPI` methods declare that its `AdminAPI`
// ones do not (legacy/plugins/secrets/api/v2/{secrets,secret,hide}.py). The
// three the two families share — create, edit, delete — are declared once in
// admin.go and reused here; the values are the same strings in both modes.
const (
	permSecretList     = "configuration.secrets.secret.list"
	permSecretUnsecret = "configuration.secrets.secret.unsecret"
	permSecretHide     = "configuration.secrets.secret.hide"
)

// projectGate wraps a project-mode handler in the central permission check,
// resolved against the `{projectID}` in the path in `default` mode.
//
// It is applied here rather than in `router.go` because the mode that selects
// this handler is a PATH SEGMENT resolved at request time: one chi route serves
// both pylon modes, so route-level middleware could not gate one and not the
// other.
//
// It is passed as the `project` branch of withModes rather than wrapped around
// it, so each mode keeps its OWN gate: `administration` resolves centrally via
// adminGate (it ignores the {projectID} entirely), and an unknown mode stays a
// 404 rather than becoming a 403 that says nothing about why.
//
// Fail-closed by construction — RequireResolvedPermissionsForProject answers
// 403 when the resolver is nil, so a Handler built without one (the
// programmatic constructors in applications/ and conversations/, which never
// serve HTTP) exposes nothing.
func (h *Handler) projectGate(permission string, next http.HandlerFunc) http.HandlerFunc {
	gated := apimw.RequireResolvedPermissionsForProject(
		h.permissionResolver,
		auth.PermissionModeDefault,
		func(r *http.Request) (string, bool) {
			projectID := chi.URLParam(r, "projectID")
			return projectID, projectID != ""
		},
		permission,
	)(next)
	return gated.ServeHTTP
}

// withModes reproduces pylon's mode dispatch for the routes that carry a
// {mode} segment.  Anything other than the two modes pylon defines is a 404,
// exactly as APIBase.proxy_method's `abort(404)` on an unknown mode — which
// is what makes the third convention the new client had invented
// (`prompt_lib`, #151) a hard error rather than a silently-accepted alias.
//
// The two branches are genuinely different handlers, not one handler with a
// flag.  `project` is keyed by dbKey(projectID); `administration` addresses the
// GLOBAL vault (row id "admin") with its own request and response bodies, and
// IGNORES the {projectID} segment entirely — which is why admin_ui sends the
// placeholder `0` there.  Routing `administration` into the project handler
// would read and WRITE project 0's vault: the wrong store, silently.  That is
// what the 501 this replaced was protecting against; unit A14 implements the
// real second handler in admin.go instead.
func (h *Handler) withModes(project, administration http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch chi.URLParam(r, "mode") {
		case modeDefault:
			project(w, r)
		case modeAdministration:
			administration(w, r)
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown mode"})
		}
	}
}

// notImplementedBulkReplace is the administration branch of
// `POST /secrets/{mode}/{projectID}` — see the route comment for why it is not
// built.
func notImplementedBulkReplace(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotImplemented, map[string]string{
		"error": "bulk replacement of the global vault is not implemented; " +
			"create secrets one at a time through POST /secret/administration/{projectID}/{name}",
	})
}

// methodNotAllowed is the project branch of routes pylon defines for the
// administration mode only.
func methodNotAllowed(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed for this mode"})
}

// ─── response models ─────────────────────────────────────────────────────────

// SecretListItem mirrors the Python SecretList pydantic model returned by
// the pylon secrets plugin for list responses.
type SecretListItem struct {
	Name       string `json:"name"`
	SecretName string `json:"secret_name"` // {{secret.<name>}}
	IsDefault  bool   `json:"is_default"`
}

// SecretDetail mirrors the Python SecretDetail pydantic model.
type SecretDetail struct {
	Name       string `json:"name"`
	SecretName string `json:"secret_name"`
	IsDefault  bool   `json:"is_default"`
	IsHidden   bool   `json:"is_hidden"`
	Value      string `json:"value"`
}

// ─── vault data layout ────────────────────────────────────────────────────────

// vaultData is the JSON stored (after Fernet encryption) in centry.secrets_data.
type vaultData struct {
	Secrets       map[string]string `json:"secrets"`
	HiddenSecrets map[string]string `json:"hidden_secrets"`
}

func dbKey(projectID string) string {
	return fmt.Sprintf("project-%s", projectID)
}

// ─── handler methods ──────────────────────────────────────────────────────────

// List returns the names of all (non-hidden) secrets for a project.
// Response format: JSON array of SecretListItem (same as Python plugin).
//
// A project with no vault is an empty list: it simply has no secrets, and
// 500ing would make every new project look broken.  A vault that EXISTS and
// will not open is a 500 — it used to be an empty list too, which showed the
// page "no secrets" for a project whose secrets were all still there, and
// invited the create that would then have replaced them.
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	vault, err := h.readVaultCtx(r.Context(), projectID)
	if errors.Is(err, errVaultAbsent) {
		writeJSON(w, http.StatusOK, []SecretListItem{})
		return
	}
	if err != nil {
		vaultUnreadable(w)
		return
	}
	items := make([]SecretListItem, 0, len(vault.Secrets))
	for name := range vault.Secrets {
		items = append(items, SecretListItem{
			Name:       name,
			SecretName: fmt.Sprintf("{{secret.%s}}", name),
		})
	}
	writeJSON(w, http.StatusOK, items)
}

// Create adds a new secret.  Body: {"name": "...", "value": "..."}.
// Response: SecretListItem (201).
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Name == "" {
		http.Error(w, `{"error":"name is required"}`, http.StatusBadRequest)
		return
	}

	// An absent vault is initialised here; an UNREADABLE one is refused.  The
	// fallback this replaced wrote a fresh empty vault on any read failure, so
	// one create against a vault that would not decrypt replaced every secret
	// in it and answered 201.
	vault, err := h.readOrInitVaultCtx(r.Context(), projectID)
	if err != nil {
		vaultUnreadable(w)
		return
	}
	if _, exists := vault.Secrets[body.Name]; exists {
		http.Error(w, fmt.Sprintf(`{"error":"Secret %q already exists"}`, body.Name), http.StatusBadRequest)
		return
	}
	vault.Secrets[body.Name] = body.Value
	if err := h.writeVaultCtx(r.Context(), projectID, vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save the secret"})
		return
	}
	writeJSON(w, http.StatusCreated, SecretListItem{
		Name:       body.Name,
		SecretName: fmt.Sprintf("{{secret.%s}}", body.Name),
	})
}

// Get returns a single secret including its plaintext value.
func (h *Handler) Get(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")

	vault, err := h.readVaultCtx(r.Context(), projectID)
	if errors.Is(err, errVaultAbsent) {
		http.Error(w, `{"error":"secret not found"}`, http.StatusNotFound)
		return
	}
	if err != nil {
		vaultUnreadable(w)
		return
	}

	if val, ok := vault.Secrets[name]; ok {
		writeJSON(w, http.StatusOK, SecretDetail{
			Name:       name,
			SecretName: fmt.Sprintf("{{secret.%s}}", name),
			Value:      val,
		})
		return
	}
	if val, ok := vault.HiddenSecrets[name]; ok {
		writeJSON(w, http.StatusOK, SecretDetail{
			Name:       name,
			SecretName: fmt.Sprintf("{{secret.%s}}", name),
			Value:      val,
			IsHidden:   true,
		})
		return
	}
	http.Error(w, `{"error":"secret not found"}`, http.StatusNotFound)
}

// Update renames and/or changes the value of an existing secret.
// Body: {"name": "<new_name>", "value": "<new_value>"}.
func (h *Handler) Update(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	oldName := chi.URLParam(r, "name")

	var body struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, `{"error":"invalid request body"}`, http.StatusBadRequest)
		return
	}
	if body.Name == "" {
		body.Name = oldName
	}

	vault, err := h.readVaultCtx(r.Context(), projectID)
	if errors.Is(err, errVaultAbsent) {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, oldName), http.StatusBadRequest)
		return
	}
	if err != nil {
		vaultUnreadable(w)
		return
	}
	if _, ok := vault.Secrets[oldName]; !ok {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, oldName), http.StatusBadRequest)
		return
	}
	delete(vault.Secrets, oldName)
	vault.Secrets[body.Name] = body.Value
	if err := h.writeVaultCtx(r.Context(), projectID, vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to save the secret"})
		return
	}
	writeJSON(w, http.StatusOK, SecretListItem{
		Name:       body.Name,
		SecretName: fmt.Sprintf("{{secret.%s}}", body.Name),
	})
}

// Delete removes a secret by name (from either secrets or hidden_secrets).
// Deleting from a project that has no vault is a no-op success, as in pylon.
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")

	vault, err := h.readVaultCtx(r.Context(), projectID)
	if errors.Is(err, errVaultAbsent) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		vaultUnreadable(w)
		return
	}
	delete(vault.Secrets, name)
	delete(vault.HiddenSecrets, name)
	// The write error was swallowed here, so a delete that did not persist
	// still answered 204 and the page removed the row it had just re-listed.
	if err := h.writeVaultCtx(r.Context(), projectID, vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to delete the secret"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// Hide moves a secret from secrets → hidden_secrets.
func (h *Handler) Hide(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")

	vault, err := h.readVaultCtx(r.Context(), projectID)
	if errors.Is(err, errVaultAbsent) {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, name), http.StatusBadRequest)
		return
	}
	if err != nil {
		vaultUnreadable(w)
		return
	}
	val, ok := vault.Secrets[name]
	if !ok {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, name), http.StatusBadRequest)
		return
	}
	delete(vault.Secrets, name)
	vault.HiddenSecrets[name] = val
	if err := h.writeVaultCtx(r.Context(), projectID, vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to hide the secret"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Project secret was moved to hidden secrets"})
}

// ─── vault read / write ───────────────────────────────────────────────────────
//
// One vault is one `centry.secrets_key` row plus the `centry.secrets_data` row
// with the same id.  The three functions below are keyed by that id and know
// nothing else about the vault, so the project store (`project-<id>`) and the
// global store (`admin`, admin.go) go through the SAME code.  They used to be
// two implementations with two different error contracts, and only the global
// one distinguished "there is nothing here" from "I could not open this".
//
// The distinction is the whole point.  A read failure has two causes that look
// identical to a caller comparing against nil:
//
//   - the rows do not exist — a project that has never had a secret, where a
//     write must create them; and
//   - the rows exist and would not open — the wrong SECRETS_MASTER_KEY, a key
//     row in an unexpected format, a data row that is not a Fernet token, a
//     vault body that is not `{"secrets":{…},"hidden_secrets":{…}}`.
//
// Collapsing the two is a silent data loss: the project path's old
// readOrInitVault answered ANY read failure by writing a fresh empty vault, so
// a single POST against an unreadable-but-present vault replaced every secret
// in it and reported 201.  errVaultAbsent is returned for the first cause only,
// and only a caller that has checked for it may write.

// errVaultAbsent means the vault's rows do not exist yet — the only condition
// under which a write is allowed to create them.  Any OTHER read failure means
// rows exist that could not be opened, and must never be overwritten.
var errVaultAbsent = errors.New("secrets: vault has not been initialised")

// newFernetKey returns 32 fresh random bytes — the raw form; `encryptKey`
// renders them in centry's on-disk representation.
func newFernetKey() ([]byte, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate fernet key: %w", err)
	}
	return key, nil
}

// vaultKeyRow reads one vault's raw `centry.secrets_key` blob.  pgx.ErrNoRows
// is returned unwrapped so callers can tell it from a transport failure — the
// conflation the project path used to make, where a dropped connection during
// the key lookup was indistinguishable from a project with no vault and led
// straight to minting a second key over the first.
func (h *Handler) vaultKeyRow(ctx context.Context, vaultID string) ([]byte, error) {
	var keyBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, vaultID,
	).Scan(&keyBytes)
	return keyBytes, err
}

// readVaultByID reads and decrypts one vault.
//
// It returns errVaultAbsent ONLY when neither row exists.  Every other failure —
// a missing key row beside a present data row, a decrypt failure, a body that is
// not the expected shape — is returned as itself, so no caller can mistake
// "I could not open this" for "there is nothing here" and write over it.
func (h *Handler) readVaultByID(ctx context.Context, vaultID string) (vaultData, error) {
	keyBytes, err := h.vaultKeyRow(ctx, vaultID)
	if errors.Is(err, pgx.ErrNoRows) {
		return vaultData{}, errVaultAbsent
	}
	if err != nil {
		return vaultData{}, fmt.Errorf("read %s secrets_key: %w", vaultID, err)
	}

	var dataBytes []byte
	err = h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, vaultID,
	).Scan(&dataBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		// A key with no data is a half-initialised vault, not an absent one.
		// Treating it as absent would let the next write mint a SECOND key over
		// the first, orphaning whatever data row arrives later.
		return vaultData{}, fmt.Errorf("vault %s has a key row but no data row", vaultID)
	}
	if err != nil {
		return vaultData{}, fmt.Errorf("read %s secrets_data: %w", vaultID, err)
	}

	fernetKey, err := h.decryptKey(keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt %s vault key: %w", vaultID, err)
	}
	plaintext, err := fernetDecrypt(fernetKey, dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt %s vault data: %w", vaultID, err)
	}
	var v vaultData
	if err := json.Unmarshal(plaintext, &v); err != nil {
		return vaultData{}, fmt.Errorf("unmarshal %s vault data: %w", vaultID, err)
	}
	if v.Secrets == nil {
		v.Secrets = map[string]string{}
	}
	if v.HiddenSecrets == nil {
		v.HiddenSecrets = map[string]string{}
	}
	return v, nil
}

// vaultForWriteByID is readVaultByID with the one safe fallback: an ABSENT vault
// becomes an empty one, ready to be written.  An unreadable vault still fails,
// and its rows are left exactly as they are.
func (h *Handler) vaultForWriteByID(ctx context.Context, vaultID string) (vaultData, error) {
	v, err := h.readVaultByID(ctx, vaultID)
	if errors.Is(err, errVaultAbsent) {
		return vaultData{Secrets: map[string]string{}, HiddenSecrets: map[string]string{}}, nil
	}
	return v, err
}

// vaultFernetKey returns the vault's Fernet key, minting and persisting one on
// first write.
//
// The key row is inserted with DO NOTHING and then RE-READ, rather than
// upserted.  Both halves matter: an upsert would replace an existing key row —
// which orphans the data row encrypted under the old key — and using the key we
// minted rather than the one that is actually stored would, under a concurrent
// first write, produce a data row that nothing can open.  Whatever key survives
// the insert is the key the data is encrypted with.
func (h *Handler) vaultFernetKey(ctx context.Context, vaultID string) ([]byte, error) {
	storedKey, err := h.vaultKeyRow(ctx, vaultID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		minted, err := newFernetKey()
		if err != nil {
			return nil, err
		}
		encoded, err := h.encryptKey(minted)
		if err != nil {
			return nil, fmt.Errorf("encrypt %s vault key: %w", vaultID, err)
		}
		if _, err := h.pool.Exec(ctx,
			`INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
			 ON CONFLICT (id) DO NOTHING`,
			vaultID, encoded,
		); err != nil {
			return nil, fmt.Errorf("write %s secrets_key: %w", vaultID, err)
		}
		storedKey, err = h.vaultKeyRow(ctx, vaultID)
		if err != nil {
			return nil, fmt.Errorf("read back %s secrets_key: %w", vaultID, err)
		}
	case err != nil:
		return nil, fmt.Errorf("read %s secrets_key: %w", vaultID, err)
	}

	fernetKey, err := h.decryptKey(storedKey)
	if err != nil {
		return nil, fmt.Errorf("decrypt %s vault key: %w", vaultID, err)
	}
	return fernetKey, nil
}

// writeVaultByID encrypts and persists one vault, generating its Fernet key on
// first write.
//
// The key is stored in centry's on-disk form (the 44-byte base64 ENCODING of the
// 32 key bytes) via `encryptKey`, not as the raw bytes — see that function for
// why (#196/#197).
func (h *Handler) writeVaultByID(ctx context.Context, vaultID string, v vaultData) error {
	fernetKey, err := h.vaultFernetKey(ctx, vaultID)
	if err != nil {
		return err
	}
	plaintext, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal %s vault data: %w", vaultID, err)
	}
	ciphertext, err := fernetEncrypt(fernetKey, plaintext)
	if err != nil {
		return fmt.Errorf("encrypt %s vault data: %w", vaultID, err)
	}
	if _, err := h.pool.Exec(ctx,
		`INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
		vaultID, ciphertext,
	); err != nil {
		return fmt.Errorf("write %s secrets_data: %w", vaultID, err)
	}
	return nil
}

// ─── the project vault ────────────────────────────────────────────────────────

// readVaultCtx reads project `projectID`'s vault.  errVaultAbsent means the
// project has no vault yet; any other error means one exists and would not open.
func (h *Handler) readVaultCtx(ctx context.Context, projectID string) (vaultData, error) {
	return h.readVaultByID(ctx, dbKey(projectID))
}

// readOrInitVaultCtx returns the project's vault, or an empty one to write when
// the project has none.  It does NOT fall back for an unreadable vault.
func (h *Handler) readOrInitVaultCtx(ctx context.Context, projectID string) (vaultData, error) {
	return h.vaultForWriteByID(ctx, dbKey(projectID))
}

func (h *Handler) writeVaultCtx(ctx context.Context, projectID string, v vaultData) error {
	return h.writeVaultByID(ctx, dbKey(projectID), v)
}

// vaultUnreadable answers the one failure every project route shares: the vault
// exists and could not be opened.  It is a 500 and not an empty result, because
// an empty result is what invites the write that destroys it.
func vaultUnreadable(w http.ResponseWriter) {
	writeJSON(w, http.StatusInternalServerError, map[string]string{
		"error": "project vault is unreadable",
	})
}

// encryptKey renders a raw 32-byte Fernet key in the ON-DISK representation
// centry writes, then wraps it with the master key (if set).
//
// centry's database secret engine stores `cryptography.fernet.Fernet.
// generate_key()` output — the 44-byte URL-safe base64 ENCODING of the 32 key
// bytes — not the raw bytes (legacy/…/secret_engines/database.py `_write_key`).
// This handler used to persist the raw 32 bytes, which no other reader in this
// repository can open: `centrysecrets.decodeFernetKey` (the reader behind the
// current chat-config and Configurations vault paths) requires exactly 44
// base64 bytes and rejects a 32-byte row outright. A project whose vault this
// handler created was therefore unreadable by the current generation, and a
// project whose vault centry created was unwritable by this handler
// (`fernetEncrypt` would slice a 28-byte AES key out of the 44 and fail).
// Found while making the chat-config route reachable (#194).
func (h *Handler) encryptKey(raw []byte) ([]byte, error) {
	// A malformed master key stops the write here (#412). Returning the
	// unwrapped encoding instead is what made the defect silent: the vault was
	// minted in the clear and every later read of it succeeded.
	if h.masterKeyErr != nil {
		return nil, h.masterKeyErr
	}
	encoded := []byte(base64.URLEncoding.EncodeToString(raw))
	if h.masterKey == nil {
		return encoded, nil
	}
	return fernetEncrypt(h.masterKey, encoded)
}

// decryptKey unwraps the stored key bytes back to a 32-byte Fernet key. It
// accepts BOTH representations: centry's 44-byte base64 encoding (what
// encryptKey now writes) and the raw 32 bytes earlier builds of this handler
// wrote, so an existing database keeps opening.
func (h *Handler) decryptKey(stored []byte) ([]byte, error) {
	// A malformed master key stops the read too (#412). A wrapped key row would
	// otherwise be read as an unwrapped one, which fails later and further away.
	if h.masterKeyErr != nil {
		return nil, h.masterKeyErr
	}
	if h.masterKey != nil {
		unwrapped, err := fernetDecrypt(h.masterKey, stored)
		if err != nil {
			return nil, err
		}
		stored = unwrapped
	}
	if len(stored) == 32 {
		return stored, nil
	}
	return fernetDecodeKey(string(stored))
}

// ─── Fernet implementation ────────────────────────────────────────────────────
//
// Fernet spec: https://github.com/fernet/spec/blob/master/Spec.md
//
// Token = base64url( Version[1] | Timestamp[8] | IV[16] |
//                    Ciphertext[16*ceil(n/16)] | HMAC[32] )
//
// Key layout: first 16 bytes = HMAC-SHA256 signing key
//             last  16 bytes = AES-128-CBC encryption key

// fernetDecodeKey base64url-decodes a Fernet key string into 32 bytes.
func fernetDecodeKey(key string) ([]byte, error) {
	b, err := base64.URLEncoding.DecodeString(key)
	if err != nil {
		return nil, err
	}
	if len(b) != 32 {
		return nil, fmt.Errorf("fernet key must be 32 bytes, got %d", len(b))
	}
	return b, nil
}

// fernetEncrypt encrypts plaintext using a raw 32-byte Fernet key.
// The returned value is the base64url-encoded Fernet token as bytes.
func fernetEncrypt(key, plaintext []byte) ([]byte, error) {
	signingKey := key[:16]
	encKey := key[16:]

	// PKCS7-pad plaintext to a multiple of 16.
	padded, err := pkcs7Pad(plaintext, aes.BlockSize)
	if err != nil {
		return nil, err
	}

	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv); err != nil {
		return nil, err
	}

	block, err := aes.NewCipher(encKey)
	if err != nil {
		return nil, err
	}
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext, padded)

	// Build the token body (before HMAC).
	ts := make([]byte, 8)
	binary.BigEndian.PutUint64(ts, uint64(time.Now().Unix()))

	var body bytes.Buffer
	body.WriteByte(0x80) // version
	body.Write(ts)
	body.Write(iv)
	body.Write(ciphertext)

	mac := hmac.New(sha256.New, signingKey)
	mac.Write(body.Bytes())
	body.Write(mac.Sum(nil))

	token := base64.URLEncoding.EncodeToString(body.Bytes())
	return []byte(token), nil
}

// fernetDecrypt decrypts a Fernet token (base64url bytes) with a raw 32-byte key.
func fernetDecrypt(key, token []byte) ([]byte, error) {
	signingKey := key[:16]
	encKey := key[16:]

	raw, err := base64.URLEncoding.DecodeString(string(token))
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}
	// Minimum: 1 (ver) + 8 (ts) + 16 (iv) + 16 (≥1 block) + 32 (hmac) = 73
	if len(raw) < 73 {
		return nil, fmt.Errorf("token too short (%d bytes)", len(raw))
	}
	if raw[0] != 0x80 {
		return nil, fmt.Errorf("unsupported fernet version 0x%02x", raw[0])
	}

	// Verify HMAC.
	mac := hmac.New(sha256.New, signingKey)
	mac.Write(raw[:len(raw)-32])
	if !hmac.Equal(mac.Sum(nil), raw[len(raw)-32:]) {
		return nil, fmt.Errorf("fernet HMAC mismatch")
	}

	iv := raw[9:25]
	ciphertext := raw[25 : len(raw)-32]
	if len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("ciphertext length not a multiple of block size")
	}

	block, err := aes.NewCipher(encKey)
	if err != nil {
		return nil, err
	}
	plaintext := make([]byte, len(ciphertext))
	cipher.NewCBCDecrypter(block, iv).CryptBlocks(plaintext, ciphertext)

	plaintext, err = pkcs7Unpad(plaintext)
	if err != nil {
		return nil, err
	}
	return plaintext, nil
}

// pkcs7Pad pads data to a multiple of blockSize using PKCS#7.
//
// Returns an error rather than padding blindly, for two reasons the previous
// signature could not express:
//
//   - blockSize must be in 1..255. PKCS#7 encodes the pad length in a single
//     byte, so a larger block size cannot be represented and `byte(pad)` would
//     silently truncate — producing padding that pkcs7Unpad rejects, or worse,
//     padding that unpads to the wrong length. The only current caller passes
//     aes.BlockSize, but a future one passing 256 would get silent corruption
//     of a SECRET rather than a loud failure.
//   - len(data)+pad must not overflow int (CodeQL go/allocation-size-overflow,
//     alert 11). Unreachable with today's caller, since data is a secret value
//     bounded long before here — but the guard costs one comparison and removes
//     the need for anyone to re-derive that reasoning.
func pkcs7Pad(data []byte, blockSize int) ([]byte, error) {
	if blockSize <= 0 || blockSize > 255 {
		return nil, fmt.Errorf("pkcs7: block size %d out of range (1..255)", blockSize)
	}
	pad := blockSize - (len(data) % blockSize)
	if len(data) > math.MaxInt-pad {
		return nil, fmt.Errorf("pkcs7: input too large to pad")
	}
	result := make([]byte, len(data)+pad)
	copy(result, data)
	for i := len(data); i < len(result); i++ {
		result[i] = byte(pad)
	}
	return result, nil
}

// pkcs7Unpad removes PKCS#7 padding.
func pkcs7Unpad(data []byte) ([]byte, error) {
	if len(data) == 0 {
		return nil, fmt.Errorf("empty data")
	}
	pad := int(data[len(data)-1])
	if pad == 0 || pad > aes.BlockSize || pad > len(data) {
		return nil, fmt.Errorf("invalid PKCS#7 padding byte %d", pad)
	}
	for i := len(data) - pad; i < len(data); i++ {
		if data[i] != byte(pad) {
			return nil, fmt.Errorf("invalid PKCS#7 padding")
		}
	}
	return data[:len(data)-pad], nil
}

// EnsureProjectVault creates an EMPTY vault for a project that has none, and
// does nothing for a project that already has a readable one (#373).
//
// WHY PROVISIONING NEEDS THIS. Every write route below mints a project's Fernet
// key lazily, so the secrets API alone never needs a vault created in advance.
// The model catalogue does. storage.PostgresSecretVaultLoader reports absent
// rows as ErrContentUnavailable, storage.CurrentModelDefaultsReader fails the
// whole read on that error, and the configurations route turns it into a 500 —
// so a project with no vault rows presents to its owner as "the product has no
// models". internal/application/projectprovisioning calls this as its
// project_secrets step.
//
// WHY IT IS HERE AND NOT IN THE PROVISIONER. This is the only code in the tree
// that mints a vault key, and it decides — from SECRETS_MASTER_KEY — whether
// the stored key is wrapped. A second minter with its own rule would write
// vaults this handler cannot open, and readVaultByID never overwrites an
// unreadable vault, so that project's secrets would 500 for ever with no way
// back. One minter, one rule.
//
// IDEMPOTENT, and deliberately narrow about which failure it acts on. Only
// errVaultAbsent — neither row present — permits a write. A vault that exists
// and will not open is reported, never replaced.
func (h *Handler) EnsureProjectVault(ctx context.Context, projectID string) error {
	_, err := h.readVaultCtx(ctx, projectID)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, errVaultAbsent):
		return h.writeVaultCtx(ctx, projectID, vaultData{
			Secrets:       map[string]string{},
			HiddenSecrets: map[string]string{},
		})
	default:
		return err
	}
}

// RemoveProjectVault deletes a project's vault rows.
//
// It is the compensation half of EnsureProjectVault, and the delete half of
// project deprovisioning. Neither centry.secrets_key nor centry.secrets_data
// carries a foreign key to centry.project — the id is the TEXT `project-<id>`
// rather than the integer — so nothing removes these rows for us, and a vault
// left behind would be adopted by the next project that draws the same id.
//
// Removing an absent vault is success, so a re-run and a compensation for a
// step that never ran both converge.
func (h *Handler) RemoveProjectVault(ctx context.Context, projectID string) error {
	vaultID := dbKey(projectID)
	// One transaction: a key row without its data row is the half state
	// readVaultByID reports as a hard error rather than as an absent vault.
	transaction, err := h.pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin %s vault delete: %w", vaultID, err)
	}
	defer func() { _ = transaction.Rollback(context.WithoutCancel(ctx)) }()

	for _, statement := range []string{
		`DELETE FROM centry.secrets_data WHERE id = $1`,
		`DELETE FROM centry.secrets_key WHERE id = $1`,
	} {
		if _, err := transaction.Exec(ctx, statement, vaultID); err != nil {
			return fmt.Errorf("delete %s vault rows: %w", vaultID, err)
		}
	}
	return transaction.Commit(ctx)
}

// StoreProjectSecrets writes several regular secrets to one project vault in a
// SINGLE rewrite. It never creates a vault: an absent or unreadable vault is an
// error (#399).
//
// WHY IT IS HERE AND NOT IN THE PROVISIONER, for the same reason
// EnsureProjectVault is. This handler holds the only master key a deployment
// actually sets. A material writer built anywhere else derives its own key, so
// it writes material this handler cannot open, and it cannot open material this
// handler wrote. The creator and the writer must share one key source, or the
// vault is unusable whichever creator ran first.
//
// WHY ONE REWRITE, AND NOT REPEATED StoreSecret CALLS. Provisioning stores a
// project's PgVector password and its connection string together. Two calls are
// two read-modify-write cycles, so a failure between them leaves half the
// material behind. A later index run then reads a password with no connection
// string.
//
// The caller must create the vault first. The project_secrets provisioning step
// does that, and it runs before every caller of this.
func (h *Handler) StoreProjectSecrets(ctx context.Context, projectID string, values map[string]string) error {
	vaultID := dbKey(projectID)
	if len(values) == 0 {
		return fmt.Errorf("store %s secrets: no values given", vaultID)
	}
	vault, err := h.readVaultCtx(ctx, projectID)
	if err != nil {
		return fmt.Errorf("store %s secrets: %w", vaultID, err)
	}
	for name, value := range values {
		if name == "" {
			return fmt.Errorf("store %s secrets: a secret name is empty", vaultID)
		}
		vault.Secrets[name] = value
	}
	return h.writeVaultCtx(ctx, projectID, vault)
}

// LookupProjectSecret reads one regular secret from a project vault.
//
// found is false only when the vault opens and holds no such name. An absent
// vault and an unreadable vault are both errors, so no caller can read a key
// mismatch as an empty result.
func (h *Handler) LookupProjectSecret(
	ctx context.Context,
	projectID string,
	name string,
) (value string, found bool, err error) {
	vaultID := dbKey(projectID)
	if name == "" {
		return "", false, fmt.Errorf("look up %s secret: the name is empty", vaultID)
	}
	vault, err := h.readVaultCtx(ctx, projectID)
	if err != nil {
		return "", false, fmt.Errorf("look up %s secret: %w", vaultID, err)
	}
	if stored, ok := vault.Secrets[name]; ok {
		return stored, true, nil
	}
	return "", false, nil
}

// StoreSecret programmatically stores a secret value without going through HTTP.
func (h *Handler) StoreSecret(ctx context.Context, _ *http.Request, projectID, name, value string) error {
	vault, err := h.readOrInitVaultCtx(ctx, projectID)
	if err != nil {
		return err
	}
	vault.Secrets[name] = value
	return h.writeVaultCtx(ctx, projectID, vault)
}

// ResolveSecretValue resolves a {{secret.name}} reference to its plaintext value.
func (h *Handler) ResolveSecretValue(ctx context.Context, projectID, secretRef string) (string, error) {
	name := strings.TrimSuffix(strings.TrimPrefix(secretRef, "{{secret."), "}}")
	vault, err := h.readVaultCtx(ctx, projectID)
	if err != nil {
		return "", err
	}
	if val, ok := vault.Secrets[name]; ok {
		return val, nil
	}
	if val, ok := vault.HiddenSecrets[name]; ok {
		return val, nil
	}
	return "", fmt.Errorf("secret %q not found", name)
}

// ─── helpers ──────────────────────────────────────────────────────────────────

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
