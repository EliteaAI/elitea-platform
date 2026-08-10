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
	"fmt"
	"math"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
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
	masterKey []byte // nil when SECRETS_MASTER_KEY is unset
}

// NewHandler constructs the secrets handler.  The pool is used for
// centry.secrets_key / centry.secrets_data reads and writes.
func NewHandler(pool *pgxpool.Pool) *Handler {
	h := &Handler{pool: pool}
	if mk := os.Getenv("SECRETS_MASTER_KEY"); mk != "" {
		raw, err := fernetDecodeKey(mk)
		if err == nil {
			h.masterKey = raw
		}
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
	// → row id "project-None"), with different request/response shapes.
	// This Go handler implements the project handler only; see requireMode.
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
	// GET  /secrets/{mode}/{projectID}            – list secret names
	r.Get("/secrets/{mode}/{projectID}", requireMode(h.List))
	// POST /secrets/{mode}/{projectID}            – create a new secret
	r.Post("/secrets/{mode}/{projectID}", requireMode(h.Create))
	// GET  /secret/{mode}/{projectID}/{name}      – get a single secret (with value)
	r.Get("/secret/{mode}/{projectID}/{name}", requireMode(h.Get))
	// PUT  /secret/{mode}/{projectID}/{name}      – rename / update a secret
	r.Put("/secret/{mode}/{projectID}/{name}", requireMode(h.Update))
	// DELETE /secret/{mode}/{projectID}/{name}    – delete a secret
	r.Delete("/secret/{mode}/{projectID}/{name}", requireMode(h.Delete))
	// POST /hide/{mode}/{projectID}/{name}        – move secret to hidden_secrets
	r.Post("/hide/{mode}/{projectID}/{name}", requireMode(h.Hide))

	// The mode-LESS form of the show route, which pylon also serves
	// (with_modes registers `<project_id>/<secret>` alongside
	// `<mode>/<project_id>/<secret>`) and which elitea-sdk is the sole
	// caller of: elitea_sdk/runtime/clients/client.py:108 and
	// sandbox_client.py:237 build
	// {api_v2}/secrets/secret/{project_id} and append /{name}.
	// Only this one variant is registered: pylon serves the mode-less form
	// of every route, but no consumer in the workspace calls any of the
	// others, and a route with no caller is a route no test can discriminate.
	r.Get("/secret/{projectID}/{name}", h.Get)
	return r
}

// requireMode reproduces pylon's mode dispatch for the routes that carry a
// {mode} segment.  Anything other than the two modes pylon defines is a 404,
// exactly as APIBase.proxy_method's `abort(404)` on an unknown mode — which
// is what makes the third convention the new client had invented
// (`prompt_lib`, #151) a hard error rather than a silently-accepted alias.
//
// `administration` is deliberately 501, NOT served: pylon's AdminAPI reads
// and writes the GLOBAL vault (VaultClient() with no project → row id
// "project-None") with its own request/response shapes, while every method
// on this Handler is the project handler keyed by dbKey(projectID).  Serving
// admin_ui's /secrets/secret/administration/0/{name} from this handler would
// answer with project 0's vault — the wrong store — and its PUT/DELETE would
// WRITE it.  A 501 says "not implemented here" instead of quietly returning
// and mutating the wrong secrets.
func requireMode(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		switch chi.URLParam(r, "mode") {
		case modeDefault:
			next(w, r)
		case modeAdministration:
			writeJSON(w, http.StatusNotImplemented, map[string]string{
				"error": "administration mode is not implemented by elitea-main; " +
					"it addresses the global vault, not a project vault",
			})
		default:
			writeJSON(w, http.StatusNotFound, map[string]string{"error": "unknown mode"})
		}
	}
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
func (h *Handler) List(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	vault, err := h.readVault(r, projectID)
	if err != nil {
		// Project may not have a vault yet → return empty list
		writeJSON(w, http.StatusOK, []SecretListItem{})
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

	vault, err := h.readOrInitVault(r, projectID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	if _, exists := vault.Secrets[body.Name]; exists {
		http.Error(w, fmt.Sprintf(`{"error":"Secret %q already exists"}`, body.Name), http.StatusBadRequest)
		return
	}
	vault.Secrets[body.Name] = body.Value
	if err := h.writeVault(r, projectID, vault); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
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

	vault, err := h.readVault(r, projectID)
	if err != nil {
		http.Error(w, `{"error":"secret not found"}`, http.StatusNotFound)
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

	vault, err := h.readVault(r, projectID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, oldName), http.StatusBadRequest)
		return
	}
	if _, ok := vault.Secrets[oldName]; !ok {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, oldName), http.StatusBadRequest)
		return
	}
	delete(vault.Secrets, oldName)
	vault.Secrets[body.Name] = body.Value
	if err := h.writeVault(r, projectID, vault); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, SecretListItem{
		Name:       body.Name,
		SecretName: fmt.Sprintf("{{secret.%s}}", body.Name),
	})
}

// Delete removes a secret by name (from either secrets or hidden_secrets).
func (h *Handler) Delete(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")

	vault, err := h.readVault(r, projectID)
	if err != nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	delete(vault.Secrets, name)
	delete(vault.HiddenSecrets, name)
	_ = h.writeVault(r, projectID, vault)
	w.WriteHeader(http.StatusNoContent)
}

// Hide moves a secret from secrets → hidden_secrets.
func (h *Handler) Hide(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := chi.URLParam(r, "name")

	vault, err := h.readVault(r, projectID)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, name), http.StatusBadRequest)
		return
	}
	val, ok := vault.Secrets[name]
	if !ok {
		http.Error(w, fmt.Sprintf(`{"error":"secret %q not found"}`, name), http.StatusBadRequest)
		return
	}
	delete(vault.Secrets, name)
	vault.HiddenSecrets[name] = val
	if err := h.writeVault(r, projectID, vault); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"message": "Project secret was moved to hidden secrets"})
}

// ─── vault read / write ───────────────────────────────────────────────────────

// readVault decrypts and returns the vault for a project.
// Returns an error when the project has no vault yet.
func (h *Handler) readVault(r *http.Request, projectID string) (vaultData, error) {
	ctx := r.Context()
	key := dbKey(projectID)

	var keyBytes, dataBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, key,
	).Scan(&keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("secrets_key not found for project %s", projectID)
	}
	err = h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, key,
	).Scan(&dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("secrets_data not found for project %s", projectID)
	}

	// Decrypt the Fernet key with the master key (if set).
	fernetKey, err := h.decryptKey(keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt project key: %w", err)
	}

	// Decrypt the vault data with the project Fernet key.
	plaintext, err := fernetDecrypt(fernetKey, dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt vault data: %w", err)
	}

	var v vaultData
	if err := json.Unmarshal(plaintext, &v); err != nil {
		return vaultData{}, fmt.Errorf("unmarshal vault data: %w", err)
	}
	if v.Secrets == nil {
		v.Secrets = map[string]string{}
	}
	if v.HiddenSecrets == nil {
		v.HiddenSecrets = map[string]string{}
	}
	return v, nil
}

// readOrInitVault returns an existing vault or creates a new empty one
// (generating a fresh Fernet key and writing both rows to the DB).
func (h *Handler) readOrInitVault(r *http.Request, projectID string) (vaultData, error) {
	v, err := h.readVault(r, projectID)
	if err == nil {
		return v, nil
	}
	// Initialise a new vault.
	v = vaultData{
		Secrets:       map[string]string{},
		HiddenSecrets: map[string]string{},
	}
	return v, h.writeVault(r, projectID, v)
}

// writeVault encrypts and persists vault data to the DB.
// If no key row exists yet, a new Fernet key is generated for the project.
func (h *Handler) writeVault(r *http.Request, projectID string, v vaultData) error {
	ctx := r.Context()
	key := dbKey(projectID)

	// Load or generate the project Fernet key.
	var keyBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, key,
	).Scan(&keyBytes)

	var fernetKey []byte
	if err != nil {
		// No key yet → generate a new one.
		fernetKey = make([]byte, 32)
		if _, err := rand.Read(fernetKey); err != nil {
			return fmt.Errorf("generate fernet key: %w", err)
		}
		// Persist it (encrypted with master key if set).
		storedKey, err := h.encryptKey(fernetKey)
		if err != nil {
			return fmt.Errorf("encrypt project key: %w", err)
		}
		_, err = h.pool.Exec(ctx,
			`INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
			 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
			key, storedKey,
		)
		if err != nil {
			return fmt.Errorf("write secrets_key: %w", err)
		}
	} else {
		fernetKey, err = h.decryptKey(keyBytes)
		if err != nil {
			return fmt.Errorf("decrypt project key: %w", err)
		}
	}

	// Encrypt the vault data.
	plaintext, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal vault data: %w", err)
	}
	ciphertext, err := fernetEncrypt(fernetKey, plaintext)
	if err != nil {
		return fmt.Errorf("encrypt vault data: %w", err)
	}

	_, err = h.pool.Exec(ctx,
		`INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
		key, ciphertext,
	)
	return err
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

// StoreSecret programmatically stores a secret value without going through HTTP.
func (h *Handler) StoreSecret(ctx context.Context, _ *http.Request, projectID, name, value string) error {
	vault, err := h.readOrInitVaultCtx(ctx, projectID)
	if err != nil {
		return err
	}
	vault.Secrets[name] = value
	return h.writeVaultCtx(ctx, projectID, vault)
}

func (h *Handler) readVaultCtx(ctx context.Context, projectID string) (vaultData, error) {
	key := dbKey(projectID)
	var keyBytes, dataBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, key,
	).Scan(&keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("secrets_key not found for project %s", projectID)
	}
	err = h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, key,
	).Scan(&dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("secrets_data not found for project %s", projectID)
	}
	fernetKey, err := h.decryptKey(keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt project key: %w", err)
	}
	plaintext, err := fernetDecrypt(fernetKey, dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt vault data: %w", err)
	}
	var v vaultData
	if err := json.Unmarshal(plaintext, &v); err != nil {
		return vaultData{}, fmt.Errorf("unmarshal vault data: %w", err)
	}
	if v.Secrets == nil {
		v.Secrets = map[string]string{}
	}
	if v.HiddenSecrets == nil {
		v.HiddenSecrets = map[string]string{}
	}
	return v, nil
}

func (h *Handler) readOrInitVaultCtx(ctx context.Context, projectID string) (vaultData, error) {
	v, err := h.readVaultCtx(ctx, projectID)
	if err == nil {
		return v, nil
	}
	v = vaultData{
		Secrets:       map[string]string{},
		HiddenSecrets: map[string]string{},
	}
	return v, h.writeVaultCtx(ctx, projectID, v)
}

func (h *Handler) writeVaultCtx(ctx context.Context, projectID string, v vaultData) error {
	key := dbKey(projectID)
	var keyBytes []byte
	err := h.pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, key,
	).Scan(&keyBytes)
	var fernetKey []byte
	if err != nil {
		fernetKey = make([]byte, 32)
		if _, err := rand.Read(fernetKey); err != nil {
			return fmt.Errorf("generate fernet key: %w", err)
		}
		storedKey, err := h.encryptKey(fernetKey)
		if err != nil {
			return fmt.Errorf("encrypt project key: %w", err)
		}
		_, err = h.pool.Exec(ctx,
			`INSERT INTO centry.secrets_key (id, data) VALUES ($1, $2)
			 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
			key, storedKey,
		)
		if err != nil {
			return fmt.Errorf("write secrets_key: %w", err)
		}
	} else {
		fernetKey, err = h.decryptKey(keyBytes)
		if err != nil {
			return fmt.Errorf("decrypt project key: %w", err)
		}
	}
	plaintext, err := json.Marshal(v)
	if err != nil {
		return fmt.Errorf("marshal vault data: %w", err)
	}
	ciphertext, err := fernetEncrypt(fernetKey, plaintext)
	if err != nil {
		return fmt.Errorf("encrypt vault data: %w", err)
	}
	_, err = h.pool.Exec(ctx,
		`INSERT INTO centry.secrets_data (id, data) VALUES ($1, $2)
		 ON CONFLICT (id) DO UPDATE SET data = excluded.data`,
		key, ciphertext,
	)
	return err
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
