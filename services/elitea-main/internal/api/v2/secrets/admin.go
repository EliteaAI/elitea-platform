package secrets

// The GLOBAL secret vault — the store behind admin_ui's Secrets page, ported as
// unit A14 (issue #200).
//
// ## Why this is a separate handler and not a mode flag on the project one
//
// `requireMode` used to answer 501 to `administration`, reasoning that the mode
// addresses the global vault while every method on this Handler is the project
// handler keyed by `dbKey(projectID)`. That reasoning was CORRECT, and the
// evidence is unambiguous — unlike `/admin/users/{mode}/{projectID}`, where the
// equivalent 501 turned out to be a hole (pylon maps both modes of that resource
// to the same body, and the project id is in the path).
//
// Here the two modes are two different stores AND two different contracts:
//
//   - `legacy/plugins/shared/tools/secret_engines/database.py` — `Engine.db_key`
//     returns the literal string `'admin'` when `project_id is None`, and
//     `f'project-{id}'` otherwise. The row id is `admin`, not `project-None`
//     (the previous comment in handler.go said `project-None`; that came from
//     the HashiCorp engine's `VAULT_ADMINISTRATION_NAME` naming, not from the
//     database engine this deployment runs).
//   - `legacy/plugins/secrets/api/v2/{secrets,secret,hide}.py` — every `AdminAPI`
//     method constructs a bare `VaultClient()` (no project), while every
//     `ProjectAPI` method constructs `VaultClient.from_project(project_id)`. The
//     `project_id` path segment is accepted and then IGNORED by all six admin
//     methods, which is why admin_ui sends the placeholder `0`.
//   - The request and response bodies differ in every single method. Listing
//     returns `{"name","secret":"******"}` rather than `{"name","secret_name"}`;
//     reading returns `{"secret": …}` rather than a `SecretDetail`; creating
//     takes `{"secret": "<value>"}` at `POST …/secret/…/{name}` rather than
//     `{"name","value"}` at `POST …/secrets/…`; updating takes a NESTED
//     `{"secret":{"old_name","value"}}`.
//
// Confirmed against both running databases: `centry.secrets_key` holds an
// `admin` row alongside the `project-*` rows, and this repository already agrees
// — `internal/infra/storage/postgres_secret_vault.go` calls the same id
// `currentAdminVaultID = "admin"` for its shared-admin fallback.
//
// So serving `administration` from the project handler with the placeholder `0`
// really would have read and WRITTEN `project-0`: the wrong store, silently.
// The 501 was policy. This file is the handler it was pointing at.
//
// ## The global vault is shared into every project
//
// `EngineBase.get_all_secrets` merges `self.__class__().get_secrets()` — the
// GLOBAL vault — into the secrets every project resolves `{{secret.name}}`
// against. A write here is therefore platform-wide, which is why this file is
// stricter than the project handler in three places (see `adminVault`,
// `AdminCreate` and `validSecretName`).
//
// ## Deliberate divergences from the pylon original
//
//  1. **An unreadable existing vault is never overwritten.** The project path's
//     `readOrInitVault` falls back to writing a fresh empty vault whenever the
//     read fails — including when the rows exist but fail to decrypt or
//     unmarshal. On the global vault that is a platform-wide secret wipe
//     disguised as a first write, so `adminVault` distinguishes "no rows" from
//     "rows I could not open" and refuses the second.
//  2. **Create does not silently overwrite.** Pylon's admin POST assigns into
//     the dict unconditionally, so creating a name that already exists destroys
//     the current value with a 200 and no warning. This returns 400.
//  3. **Names are validated.** `{{secret.<name>}}` interpolation matches
//     `[A-Za-z0-9_]+` (`EngineBase._secret_pattern`), so a name outside that
//     class can be stored but never resolved. Pylon accepts it and creates a
//     secret nothing can read; this returns 400.
//
// ## Authorisation
//
// Every route is gated on the permission its pylon counterpart declares,
// resolved from `auth_core__user_role` in `administration` mode on each request.
// The admin SPA's `window.admin_ui_config.permissions` is presentation state and
// is never consulted here.
//
// Note the grant table this reproduces is uneven, and deliberately so: on the
// reference deployment the administration-mode `editor` role holds `.list`,
// `.create`, `.edit`, `.delete` and `.unsecret` but NOT `.view` — so an editor
// may write global secrets and may not read them. That is pylon's behaviour
// (both of its admin READ methods declare `.view`), and the page surfaces the
// server's refusal rather than pretending otherwise.

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"sort"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

// adminVaultKey is the `centry.secrets_key` / `centry.secrets_data` row id of
// the global vault. See this file's header for the three independent sources.
const adminVaultKey = "admin"

// The permissions pylon's `AdminAPI` methods declare, one per operation.
const (
	permSecretView   = "configuration.secrets.secret.view"
	permSecretCreate = "configuration.secrets.secret.create"
	permSecretEdit   = "configuration.secrets.secret.edit"
	permSecretDelete = "configuration.secrets.secret.delete"
)

// errVaultAbsent means the vault rows do not exist yet — the only condition
// under which a write is allowed to create them. Any OTHER read failure means
// rows exist that could not be opened, and must never be overwritten.
var errVaultAbsent = errors.New("secrets: global vault has not been initialised")

// validSecretName mirrors `EngineBase._secret_pattern`: the character class
// `{{secret.<name>}}` interpolation can actually resolve.
var validSecretName = regexp.MustCompile(`^[A-Za-z0-9_]+$`)

/* ── wire shapes (pylon's, exactly) ───────────────────────────────────────── */

// adminSecretListItem is one row of `GET …/secrets/administration/{projectID}`.
// The value is always the literal mask — the listing never carries plaintext,
// and the page fetches a single value on demand through AdminGet.
type adminSecretListItem struct {
	Name   string `json:"name"`
	Secret string `json:"secret"`
}

// adminSecretMask is what pylon puts in every listing row's `secret` field.
const adminSecretMask = "******"

// adminSecretUpdateBody is the NESTED body pylon's admin PUT takes. `OldName`
// selects the entry to replace; the new name comes from the URL, which is what
// makes a rename expressible.
type adminSecretUpdateBody struct {
	Secret struct {
		OldName string `json:"old_name"`
		Value   string `json:"value"`
	} `json:"secret"`
}

/* ── permission gate ──────────────────────────────────────────────────────── */

// adminGate wraps an admin-mode handler in the central permission check.
//
// It is applied here rather than in `router.go` because the mode that selects
// this handler is a PATH SEGMENT resolved at request time: one chi route serves
// both modes, so route-level middleware could not gate one and not the other.
//
// Fail-closed by construction — `RequireCentralPermissions` answers 403 when the
// resolver is nil, so a Handler built without one (the programmatic constructors
// in applications/ and conversations/, which never serve HTTP) exposes nothing.
func (h *Handler) adminGate(permission string, next http.HandlerFunc) http.HandlerFunc {
	gated := apimw.RequireCentralPermissions(
		h.permissionResolver,
		modeAdministration,
		permission,
	)(next)
	return gated.ServeHTTP
}

/* ── handler methods ──────────────────────────────────────────────────────── */

// AdminList answers `GET /secrets/secrets/administration/{projectID}` with every
// global secret NAME, each masked. Pylon returns `[]` shaped exactly this way.
//
// A vault that does not exist yet is an empty list, not an error: the deployment
// simply has no global secrets, and 500ing would make a fresh install look
// broken.
func (h *Handler) AdminList(w http.ResponseWriter, r *http.Request) {
	vault, err := h.adminVault(r.Context())
	if errors.Is(err, errVaultAbsent) {
		writeJSON(w, http.StatusOK, []adminSecretListItem{})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "global vault is unreadable"})
		return
	}
	items := make([]adminSecretListItem, 0, len(vault.Secrets))
	for name := range vault.Secrets {
		items = append(items, adminSecretListItem{Name: name, Secret: adminSecretMask})
	}
	sortByName(items)
	writeJSON(w, http.StatusOK, items)
}

// AdminGet answers `GET /secrets/secret/administration/{projectID}/{name}` with
// `{"secret": "<value>"}`, or `{"secret": null}` when the name is unknown —
// pylon's `secrets.get(secret)`, 200 either way.
//
// Hidden secrets are NOT consulted, matching pylon (its admin GET has the
// hidden-secret lookup commented out, and its hide endpoint refuses outright —
// the global vault has no hidden section in practice).
func (h *Handler) AdminGet(w http.ResponseWriter, r *http.Request) {
	name, ok := adminSecretNameParam(w, r)
	if !ok {
		return
	}
	vault, err := h.adminVault(r.Context())
	if errors.Is(err, errVaultAbsent) {
		writeJSON(w, http.StatusOK, map[string]*string{"secret": nil})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "global vault is unreadable"})
		return
	}
	if value, exists := vault.Secrets[name]; exists {
		writeJSON(w, http.StatusOK, map[string]*string{"secret": &value})
		return
	}
	writeJSON(w, http.StatusOK, map[string]*string{"secret": nil})
}

// AdminCreate answers `POST /secrets/secret/administration/{projectID}/{name}`
// with body `{"secret": "<value>"}`.
//
// Unlike pylon it refuses to overwrite an existing name — see divergence 2 in
// this file's header.
func (h *Handler) AdminCreate(w http.ResponseWriter, r *http.Request) {
	name, ok := adminSecretNameParam(w, r)
	if !ok {
		return
	}
	if !validSecretName.MatchString(name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"message": "secret name must contain only letters, digits and underscores",
		})
		return
	}
	var body struct {
		Secret *string `json:"secret"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Secret == nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "secret value is required"})
		return
	}

	vault, err := h.adminVaultForWrite(r.Context())
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "global vault is unreadable"})
		return
	}
	if _, exists := vault.Secrets[name]; exists {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"message": fmt.Sprintf("Secret %q already exists", name),
		})
		return
	}
	vault.Secrets[name] = *body.Secret
	if err := h.writeAdminVault(r.Context(), vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "failed to save the secret"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Project secret was saved"})
}

// AdminUpdate answers `PUT /secrets/secret/administration/{projectID}/{name}`
// with body `{"secret":{"old_name":"…","value":"…"}}`.
//
// `old_name` names the entry being replaced and `{name}` is what it becomes, so
// a rename is `old_name != name` and a plain value change is `old_name == name`
// (which is all admin_ui sends). Pylon 404s when `old_name` is unknown.
func (h *Handler) AdminUpdate(w http.ResponseWriter, r *http.Request) {
	name, ok := adminSecretNameParam(w, r)
	if !ok {
		return
	}
	if !validSecretName.MatchString(name) {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"message": "secret name must contain only letters, digits and underscores",
		})
		return
	}
	var body adminSecretUpdateBody
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "invalid request body"})
		return
	}
	oldName := body.Secret.OldName
	if oldName == "" {
		oldName = name
	}

	vault, err := h.adminVault(r.Context())
	if errors.Is(err, errVaultAbsent) {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Project secret was not found"})
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "global vault is unreadable"})
		return
	}
	if _, exists := vault.Secrets[oldName]; !exists {
		writeJSON(w, http.StatusNotFound, map[string]string{"message": "Project secret was not found"})
		return
	}
	// A rename onto an occupied name would silently destroy that entry.
	if oldName != name {
		if _, occupied := vault.Secrets[name]; occupied {
			writeJSON(w, http.StatusBadRequest, map[string]string{
				"message": fmt.Sprintf("Secret %q already exists", name),
			})
			return
		}
	}
	delete(vault.Secrets, oldName)
	vault.Secrets[name] = body.Secret.Value
	if err := h.writeAdminVault(r.Context(), vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "failed to save the secret"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Project secret was updated"})
}

// AdminDelete answers `DELETE /secrets/secret/administration/{projectID}/{name}`
// with 204. Deleting an unknown name is a no-op success, as in pylon.
func (h *Handler) AdminDelete(w http.ResponseWriter, r *http.Request) {
	name, ok := adminSecretNameParam(w, r)
	if !ok {
		return
	}
	vault, err := h.adminVault(r.Context())
	if errors.Is(err, errVaultAbsent) {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "global vault is unreadable"})
		return
	}
	if _, exists := vault.Secrets[name]; !exists {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	delete(vault.Secrets, name)
	if err := h.writeAdminVault(r.Context(), vault); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"message": "failed to delete the secret"})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// AdminHide answers `POST /secrets/hide/administration/{projectID}/{name}`.
//
// Pylon refuses it with 401 and that sentence — the global vault has no hidden
// section — so the route exists to say so rather than 404ing as an unknown path.
// The admin page renders no hide control at all; this is the contract, kept
// complete because elitea-sdk and qa/ speak to the same surface.
func (h *Handler) AdminHide(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusUnauthorized, map[string]string{
		"message": "There are no hidden secrets in administration mode",
	})
}

/* ── small helpers ────────────────────────────────────────────────────────── */

// adminSecretNameParam reads `{name}` and rejects an empty one.
//
// No unescaping is applied. Pylon calls `unquote()` here because its route
// accepts any string; this surface only ever stores names matching
// `[A-Za-z0-9_]+` (see validSecretName), which are their own percent-encoding,
// so a second decode could only turn a legitimate literal into something else.
func adminSecretNameParam(w http.ResponseWriter, r *http.Request) (string, bool) {
	name := chi.URLParam(r, "name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"message": "secret name is required"})
		return "", false
	}
	return name, true
}

// sortByName gives the listing a stable order. Go map iteration is randomised,
// so without this the page's rows would reshuffle on every poll — and a test
// asserting order would pass or fail by luck.
func sortByName(items []adminSecretListItem) {
	sort.Slice(items, func(i, j int) bool { return items[i].Name < items[j].Name })
}

// newFernetKey returns 32 fresh random bytes — the raw form; `encryptKey`
// renders them in centry's on-disk representation.
func newFernetKey() ([]byte, error) {
	key := make([]byte, 32)
	if _, err := rand.Read(key); err != nil {
		return nil, fmt.Errorf("generate fernet key: %w", err)
	}
	return key, nil
}

/* ── vault access ─────────────────────────────────────────────────────────── */

// adminVault reads and decrypts the global vault.
//
// It returns errVaultAbsent ONLY when neither row exists. Every other failure —
// a missing key row beside a present data row, a decrypt failure, a body that is
// not `{"secrets":{…},"hidden_secrets":{…}}` — is returned as itself, so no
// caller can mistake "I could not open this" for "there is nothing here" and
// write over it.
func (h *Handler) adminVault(ctx context.Context) (vaultData, error) {
	var keyBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, adminVaultKey,
	).Scan(&keyBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		return vaultData{}, errVaultAbsent
	}
	if err != nil {
		return vaultData{}, fmt.Errorf("read global secrets_key: %w", err)
	}

	var dataBytes []byte
	err = h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, adminVaultKey,
	).Scan(&dataBytes)
	if errors.Is(err, pgx.ErrNoRows) {
		// A key with no data is a half-initialised vault, not an absent one.
		// Treating it as absent would let the next write mint a SECOND key over
		// the first, orphaning whatever data row arrives later.
		return vaultData{}, errors.New("global vault has a key row but no data row")
	}
	if err != nil {
		return vaultData{}, fmt.Errorf("read global secrets_data: %w", err)
	}

	fernetKey, err := h.decryptKey(keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt global vault key: %w", err)
	}
	plaintext, err := fernetDecrypt(fernetKey, dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt global vault data: %w", err)
	}
	var v vaultData
	if err := json.Unmarshal(plaintext, &v); err != nil {
		return vaultData{}, fmt.Errorf("unmarshal global vault data: %w", err)
	}
	if v.Secrets == nil {
		v.Secrets = map[string]string{}
	}
	if v.HiddenSecrets == nil {
		v.HiddenSecrets = map[string]string{}
	}
	return v, nil
}

// adminVaultForWrite is adminVault with the one safe fallback: an ABSENT vault
// becomes an empty one, ready to be written. An unreadable vault still fails.
func (h *Handler) adminVaultForWrite(ctx context.Context) (vaultData, error) {
	v, err := h.adminVault(ctx)
	if errors.Is(err, errVaultAbsent) {
		return vaultData{Secrets: map[string]string{}, HiddenSecrets: map[string]string{}}, nil
	}
	return v, err
}

// writeAdminVault encrypts and persists the global vault, generating its Fernet
// key on first write.
//
// The key is stored in centry's on-disk form (the 44-byte base64 ENCODING of the
// 32 key bytes) via `encryptKey`, not as the raw bytes. That distinction is
// #196/#197: a raw-32-byte row cannot be opened by `centrysecrets.decodeFernetKey`,
// which is the reader behind chat-config and Configurations — and the global
// vault is exactly where those limits live, so writing the wrong form here would
// break unrelated features across the whole deployment.
func (h *Handler) writeAdminVault(ctx context.Context, v vaultData) error {
	var storedKey []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, adminVaultKey,
	).Scan(&storedKey)

	var fernetKey []byte
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		fernetKey, err = newFernetKey()
		if err != nil {
			return err
		}
		encoded, err := h.encryptKey(fernetKey)
		if err != nil {
			return fmt.Errorf("encrypt global vault key: %w", err)
		}
		if _, err := h.pool.Exec(ctx,
			`INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
			 ON CONFLICT (id) DO NOTHING`,
			adminVaultKey, encoded,
		); err != nil {
			return fmt.Errorf("write global secrets_key: %w", err)
		}
	case err != nil:
		return fmt.Errorf("read global secrets_key: %w", err)
	default:
		fernetKey, err = h.decryptKey(storedKey)
		if err != nil {
			return fmt.Errorf("decrypt global vault key: %w", err)
		}
	}

	plaintext, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal global vault data: %w", err)
	}
	ciphertext, err := fernetEncrypt(fernetKey, plaintext)
	if err != nil {
		return fmt.Errorf("encrypt global vault data: %w", err)
	}
	if _, err := h.pool.Exec(ctx,
		`INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
		adminVaultKey, ciphertext,
	); err != nil {
		return fmt.Errorf("write global secrets_data: %w", err)
	}
	return nil
}
