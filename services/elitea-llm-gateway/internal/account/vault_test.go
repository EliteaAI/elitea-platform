package account

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"testing"
)

// fernetEncrypt is a test-only encryptor byte-compatible with the decrypt-only
// fernetDecrypt in vault.go and with Python's cryptography.fernet.Fernet. It
// lets the vault tests exercise a full encrypt→decrypt round-trip.
func fernetEncrypt(t *testing.T, key, plaintext []byte) []byte {
	t.Helper()
	if len(key) != 32 {
		t.Fatalf("fernet key must be 32 bytes, got %d", len(key))
	}
	signingKey := key[:16]
	encKey := key[16:]

	iv := make([]byte, aes.BlockSize)
	if _, err := rand.Read(iv); err != nil {
		t.Fatalf("rand iv: %v", err)
	}

	padded := pkcs7Pad(plaintext, aes.BlockSize)
	block, err := aes.NewCipher(encKey)
	if err != nil {
		t.Fatalf("new cipher: %v", err)
	}
	ciphertext := make([]byte, len(padded))
	cipher.NewCBCEncrypter(block, iv).CryptBlocks(ciphertext, padded)

	buf := make([]byte, 0, 1+8+len(iv)+len(ciphertext)+32)
	buf = append(buf, 0x80) // version
	ts := make([]byte, 8)
	binary.BigEndian.PutUint64(ts, 1_700_000_000) // fixed timestamp (Fernet ignores it on decrypt without TTL)
	buf = append(buf, ts...)
	buf = append(buf, iv...)
	buf = append(buf, ciphertext...)

	mac := hmac.New(sha256.New, signingKey)
	mac.Write(buf)
	buf = mac.Sum(buf)

	out := make([]byte, base64.URLEncoding.EncodedLen(len(buf)))
	base64.URLEncoding.Encode(out, buf)
	return out
}

func pkcs7Pad(data []byte, blockSize int) []byte {
	pad := blockSize - len(data)%blockSize
	out := make([]byte, len(data)+pad)
	copy(out, data)
	for i := len(data); i < len(out); i++ {
		out[i] = byte(pad)
	}
	return out
}

func newTestKey() []byte {
	k := make([]byte, 32)
	for i := range k {
		k[i] = byte(i + 1)
	}
	return k
}

func TestFernetRoundTrip(t *testing.T) {
	key := newTestKey()
	for _, msg := range []string{"", "a", "sixteen bytes!!!", "a longer secret value spanning multiple aes blocks"} {
		token := fernetEncrypt(t, key, []byte(msg))
		got, err := fernetDecrypt(key, token)
		if err != nil {
			t.Fatalf("decrypt %q: %v", msg, err)
		}
		if string(got) != msg {
			t.Fatalf("round-trip mismatch: got %q, want %q", got, msg)
		}
	}
}

func TestFernetDecrypt_Errors(t *testing.T) {
	key := newTestKey()

	if _, err := fernetDecrypt(key[:16], []byte("x")); err == nil {
		t.Error("expected error for short key")
	}
	if _, err := fernetDecrypt(key, []byte("!!!not base64!!!")); err == nil {
		t.Error("expected base64 decode error")
	}
	if _, err := fernetDecrypt(key, []byte("AAAA")); err == nil {
		t.Error("expected too-short token error")
	}

	// Valid token, then corrupt the HMAC (flip last byte) → mismatch.
	token := fernetEncrypt(t, key, []byte("secret"))
	raw, _ := base64.URLEncoding.DecodeString(string(token))
	raw[len(raw)-1] ^= 0xFF
	corrupt := make([]byte, base64.URLEncoding.EncodedLen(len(raw)))
	base64.URLEncoding.Encode(corrupt, raw)
	if _, err := fernetDecrypt(key, corrupt); err == nil {
		t.Error("expected HMAC mismatch error")
	}

	// Wrong version byte.
	raw2, _ := base64.URLEncoding.DecodeString(string(fernetEncrypt(t, key, []byte("secret"))))
	raw2[0] = 0x79
	badVer := make([]byte, base64.URLEncoding.EncodedLen(len(raw2)))
	base64.URLEncoding.Encode(badVer, raw2)
	if _, err := fernetDecrypt(key, badVer); err == nil {
		t.Error("expected unsupported version error")
	}
}

func TestPKCS7Unpad_Errors(t *testing.T) {
	if _, err := pkcs7Unpad(nil); err == nil {
		t.Error("expected error for empty data")
	}
	if _, err := pkcs7Unpad([]byte{0x00}); err == nil {
		t.Error("expected error for zero pad byte")
	}
	if _, err := pkcs7Unpad([]byte{0x05}); err == nil {
		t.Error("expected error for pad byte larger than data")
	}
	// Inconsistent padding bytes.
	if _, err := pkcs7Unpad([]byte{0x01, 0x02, 0x02, 0x03}); err == nil {
		t.Error("expected error for inconsistent padding")
	}
}

func TestFernetDecodeKey(t *testing.T) {
	raw := newTestKey()
	enc := base64.URLEncoding.EncodeToString(raw)
	got, err := fernetDecodeKey(enc)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if string(got) != string(raw) {
		t.Fatal("decoded key mismatch")
	}
	if _, err := fernetDecodeKey("not-base64!!!"); err == nil {
		t.Error("expected base64 error")
	}
	if _, err := fernetDecodeKey(base64.URLEncoding.EncodeToString([]byte("short"))); err == nil {
		t.Error("expected length error for non-32-byte key")
	}
}

func TestParseSecretRef(t *testing.T) {
	name, isRef := parseSecretRef("{{secret.MY_KEY}}")
	if !isRef || name != "MY_KEY" {
		t.Fatalf("parseSecretRef ref: name=%q isRef=%v", name, isRef)
	}
	if _, isRef := parseSecretRef("literal-value"); isRef {
		t.Fatal("literal should not be a ref")
	}
	if _, isRef := parseSecretRef("{{secret.NO_SUFFIX"); isRef {
		t.Fatal("missing suffix should not be a ref")
	}
}

func TestVaultResolve_Literal(t *testing.T) {
	v := &FernetVault{db: &fakeDB{}}
	got, err := v.Resolve(context.Background(), "1", "sk-literal")
	if err != nil {
		t.Fatalf("Resolve literal: %v", err)
	}
	if got != "sk-literal" {
		t.Fatalf("got %q, want sk-literal", got)
	}
}

func TestVaultResolve_FromVault_RawKey(t *testing.T) {
	// masterKey nil → project key stored raw (32 bytes). Encrypt the vault blob
	// directly under the raw project key.
	projectKey := newTestKey()
	blob := fernetEncrypt(t, projectKey, []byte(`{"secrets":{"OPENAI_KEY":"sk-vaulted"},"hidden_secrets":{}}`))
	db := &fakeDB{keyRow: projectKey, dataRow: blob}

	v := &FernetVault{db: db} // masterKey nil
	got, err := v.Resolve(context.Background(), "42", "{{secret.OPENAI_KEY}}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "sk-vaulted" {
		t.Fatalf("got %q, want sk-vaulted", got)
	}
}

func TestVaultResolve_FromVault_HiddenSecret(t *testing.T) {
	projectKey := newTestKey()
	blob := fernetEncrypt(t, projectKey, []byte(`{"secrets":{},"hidden_secrets":{"H":"hidden-val"}}`))
	db := &fakeDB{keyRow: projectKey, dataRow: blob}

	v := &FernetVault{db: db}
	got, err := v.Resolve(context.Background(), "1", "{{secret.H}}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "hidden-val" {
		t.Fatalf("got %q, want hidden-val", got)
	}
}

func TestVaultResolve_FromVault_WithMasterKey(t *testing.T) {
	// masterKey set → project key is itself Fernet-wrapped under the master key.
	masterKey := newTestKey()
	projectKey := make([]byte, 32)
	for i := range projectKey {
		projectKey[i] = byte(255 - i)
	}
	wrappedKey := fernetEncrypt(t, masterKey, projectKey)
	blob := fernetEncrypt(t, projectKey, []byte(`{"secrets":{"K":"deep"},"hidden_secrets":{}}`))
	db := &fakeDB{keyRow: wrappedKey, dataRow: blob}

	v := &FernetVault{db: db, masterKey: masterKey}
	got, err := v.Resolve(context.Background(), "9", "{{secret.K}}")
	if err != nil {
		t.Fatalf("Resolve: %v", err)
	}
	if got != "deep" {
		t.Fatalf("got %q, want deep", got)
	}
}

func TestVaultResolve_SecretNotFound(t *testing.T) {
	projectKey := newTestKey()
	blob := fernetEncrypt(t, projectKey, []byte(`{"secrets":{},"hidden_secrets":{}}`))
	db := &fakeDB{keyRow: projectKey, dataRow: blob}

	v := &FernetVault{db: db}
	if _, err := v.Resolve(context.Background(), "1", "{{secret.MISSING}}"); err == nil {
		t.Fatal("expected not-found error")
	}
}

func TestVaultResolve_KeyRowError(t *testing.T) {
	db := &fakeDB{keyErr: errors.New("no such key")}
	v := &FernetVault{db: db}
	if _, err := v.Resolve(context.Background(), "1", "{{secret.X}}"); err == nil {
		t.Fatal("expected error when secrets_key missing")
	}
}

func TestVaultResolve_DataRowError(t *testing.T) {
	db := &fakeDB{keyRow: newTestKey(), dataErr: errors.New("no such data")}
	v := &FernetVault{db: db}
	if _, err := v.Resolve(context.Background(), "1", "{{secret.X}}"); err == nil {
		t.Fatal("expected error when secrets_data missing")
	}
}

func TestVaultDecryptKey_RawLengthGuard(t *testing.T) {
	v := &FernetVault{db: &fakeDB{}}
	if _, err := v.decryptKey([]byte("too short")); err == nil {
		t.Fatal("expected length error for raw key that is not 32 bytes")
	}
}

func TestNewFernetVault_NoMasterKey(t *testing.T) {
	t.Setenv("SECRETS_MASTER_KEY", "")
	v := NewFernetVault(&fakeDB{})
	if v.masterKey != nil {
		t.Fatal("expected nil masterKey when SECRETS_MASTER_KEY unset")
	}
}

func TestNewFernetVault_WithMasterKey(t *testing.T) {
	raw := newTestKey()
	t.Setenv("SECRETS_MASTER_KEY", base64.URLEncoding.EncodeToString(raw))
	v := NewFernetVault(&fakeDB{})
	if string(v.masterKey) != string(raw) {
		t.Fatal("expected masterKey decoded from env")
	}
}
