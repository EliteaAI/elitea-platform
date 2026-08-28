package account

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// FernetVault resolves project secret references from the Fernet-encrypted vault
// (centry.secrets_key / centry.secrets_data). It is decrypt-only: the gateway
// never writes to the vault (elitea-main's secrets handler owns writes).
//
// Encryption scheme (Python cryptography.fernet.Fernet — must byte-match the
// pylon secrets plugin and elitea-main's internal/api/v2/secrets handler):
//
//	32-byte key   = <first-16 bytes: HMAC-SHA256 signing key>
//	                <last-16 bytes:  AES-128-CBC encryption key>
//	Token layout  = base64url( version[1] | timestamp[8] | iv[16] |
//	                            ciphertext[N] | hmac[32] )
//
// The project-level Fernet key is stored in centry.secrets_key as the 44-byte
// URL-safe base64 encoding of its 32 bytes (`Fernet.generate_key()` output),
// itself Fernet-encrypted with a master key when one is configured
// (SECRETS_MASTER_KEY env var, base64url-encoded 32-byte Fernet key).
type FernetVault struct {
	db        rowQuerier
	masterKey []byte // nil when SECRETS_MASTER_KEY is unset (keys stored unwrapped)
}

var _ vaultDecryptor = (*FernetVault)(nil)

// vaultData is the JSON stored (after Fernet encryption) in centry.secrets_data.
type vaultData struct {
	Secrets       map[string]json.RawMessage `json:"secrets"`
	HiddenSecrets map[string]json.RawMessage `json:"hidden_secrets"`
}

// NewFernetVault constructs a FernetVault. The master key is read from
// SECRETS_MASTER_KEY (base64url 32-byte Fernet key); when unset the vault treats
// project keys as stored unwrapped, matching centry and the elitea-main secrets
// handler. When the env
// var is set but malformed, NewFernetVault returns an error — a decode failure is
// a startup misconfiguration that must be surfaced loudly rather than silently
// degrading to single-level storage (which would fail to decrypt wrapped keys at
// runtime with no actionable signal).
func NewFernetVault(db rowQuerier) (*FernetVault, error) {
	v := &FernetVault{db: db}
	if mk := os.Getenv("SECRETS_MASTER_KEY"); mk != "" {
		raw, err := fernetDecodeKey(mk)
		if err != nil {
			return nil, fmt.Errorf("SECRETS_MASTER_KEY decode failed: %w", err)
		}
		v.masterKey = raw
	}
	return v, nil
}

// Resolve returns the plaintext for secretRef within projectID. When secretRef is
// not a {{secret.NAME}} reference it is returned verbatim (a literal credential).
func (v *FernetVault) Resolve(ctx context.Context, projectID, secretRef string) (string, error) {
	name, isRef := parseSecretRef(secretRef)
	if !isRef {
		return secretRef, nil
	}
	vault, err := v.readVault(ctx, projectID)
	if err != nil {
		return "", err
	}
	if value, ok := vault.Secrets[name]; ok {
		return decodeVaultSecret(value, name)
	}
	if value, ok := vault.HiddenSecrets[name]; ok {
		return decodeVaultSecret(value, name)
	}
	return "", fmt.Errorf("secret %q not found in project %s vault", name, projectID)
}

// decodeVaultSecret requires the referenced value to be a string without
// requiring every unrelated entry in a legacy Python-written vault to have
// that type. The Python engine stores arbitrary JSON values in the same maps,
// so decoding the whole map as map[string]string makes one numeric setting
// prevent an otherwise valid API-key reference from resolving.
func decodeVaultSecret(value json.RawMessage, name string) (string, error) {
	var secret string
	if err := json.Unmarshal(value, &secret); err != nil {
		return "", fmt.Errorf("secret %q is not a string", name)
	}
	return secret, nil
}

// parseSecretRef reports whether ref is a {{secret.NAME}} reference and returns
// the secret name when it is. A bare value is treated as a literal.
func parseSecretRef(ref string) (name string, isRef bool) {
	const prefix = "{{secret."
	const suffix = "}}"
	if strings.HasPrefix(ref, prefix) && strings.HasSuffix(ref, suffix) {
		return strings.TrimSuffix(strings.TrimPrefix(ref, prefix), suffix), true
	}
	return "", false
}

// readVault decrypts and returns the vault for a project. The project Fernet key
// is unwrapped with the master key (when set) before decrypting the vault blob.
func (v *FernetVault) readVault(ctx context.Context, projectID string) (vaultData, error) {
	key := fmt.Sprintf("project-%s", projectID)

	var keyBytes, dataBytes []byte
	if err := v.db.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, key,
	).Scan(&keyBytes); err != nil {
		return vaultData{}, fmt.Errorf("secrets_key not found for project %s: %w", projectID, err)
	}
	if err := v.db.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, key,
	).Scan(&dataBytes); err != nil {
		return vaultData{}, fmt.Errorf("secrets_data not found for project %s: %w", projectID, err)
	}

	fernetKey, err := v.decryptKey(keyBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt project key: %w", err)
	}
	plaintext, err := fernetDecrypt(fernetKey, dataBytes)
	if err != nil {
		return vaultData{}, fmt.Errorf("decrypt vault data: %w", err)
	}

	var vd vaultData
	if err := json.Unmarshal(plaintext, &vd); err != nil {
		return vaultData{}, fmt.Errorf("unmarshal vault data: %w", err)
	}
	if vd.Secrets == nil {
		vd.Secrets = map[string]json.RawMessage{}
	}
	if vd.HiddenSecrets == nil {
		vd.HiddenSecrets = map[string]json.RawMessage{}
	}
	return vd, nil
}

// decryptKey unwraps the stored key bytes back to a 32-byte Fernet key.
//
// It accepts BOTH stored representations. The one centry actually writes is the
// 44-byte URL-safe base64 ENCODING of the 32 key bytes — that is what
// `cryptography.fernet.Fernet.generate_key()` returns and what the pylon secrets
// plugin's `_write_key` persists verbatim (or master-key-wrapped). The raw 32
// bytes are the legacy form earlier builds of elitea-main's secrets handler
// wrote; those rows must keep opening, or an upgrade locks projects out of their
// own secrets. This mirrors the reconciliation in
// services/elitea-main/internal/api/v2/secrets (handler.decryptKey).
//
// With a master key set, the wrapping is applied over whichever representation
// is stored, so unwrap first and then decide.
func (v *FernetVault) decryptKey(stored []byte) ([]byte, error) {
	if v.masterKey != nil {
		unwrapped, err := fernetDecrypt(v.masterKey, stored)
		if err != nil {
			return nil, err
		}
		stored = unwrapped
	}
	if len(stored) == 32 {
		return stored, nil
	}
	key, err := fernetDecodeKey(string(stored))
	if err != nil {
		return nil, fmt.Errorf("stored key is neither the 44-byte base64 form nor raw 32 bytes (%d bytes): %w", len(stored), err)
	}
	return key, nil
}

// ─── Fernet decryption (decrypt-only; mirrors the secrets handler) ─────────────

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

// fernetDecrypt decrypts a Fernet token (base64url bytes) with a raw 32-byte key.
func fernetDecrypt(key, token []byte) ([]byte, error) {
	if len(key) != 32 {
		return nil, fmt.Errorf("fernet key must be 32 bytes, got %d", len(key))
	}
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

	return pkcs7Unpad(plaintext)
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
