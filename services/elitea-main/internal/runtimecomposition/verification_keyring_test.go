package runtimecomposition

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestEd25519VerificationKeyringSupportsRotationOverlapByExactID(t *testing.T) {
	oldPublic, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	newPublic, newPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := writeVerificationKeyring(t, []verificationKeyringEntry{
		{KeyID: "runtime-signing-old", PublicKeyBase64: base64.StdEncoding.EncodeToString(oldPublic)},
		{KeyID: "runtime-signing-new", PublicKeyBase64: base64.StdEncoding.EncodeToString(newPublic)},
	})
	keyring, err := loadEd25519VerificationKeyring(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := keyring.requireActiveSigningKey("runtime-signing-new", newPrivate); err != nil {
		t.Fatal(err)
	}
	for keyID, want := range map[string]ed25519.PublicKey{
		"runtime-signing-old": oldPublic,
		"runtime-signing-new": newPublic,
	} {
		resolved, err := keyring.ResolveEd25519PublicKey(context.Background(), keyID)
		if err != nil {
			t.Fatal(err)
		}
		if !resolved.Equal(want) {
			t.Fatalf("resolved %s does not match", keyID)
		}
	}
	if _, err := keyring.ResolveEd25519PublicKey(context.Background(), "runtime-signing"); err == nil {
		t.Fatal("prefix/fallback key lookup was accepted")
	}
}

func TestEd25519VerificationKeyringFailsClosedOnActiveMismatchAndMalformedInput(t *testing.T) {
	publicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	_, differentPrivate, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	path := writeVerificationKeyring(t, []verificationKeyringEntry{{
		KeyID: "runtime-signing-active", PublicKeyBase64: base64.StdEncoding.EncodeToString(publicKey),
	}})
	keyring, err := loadEd25519VerificationKeyring(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := keyring.requireActiveSigningKey("runtime-signing-active", differentPrivate); err == nil {
		t.Fatal("mismatched active private/public keys were accepted")
	}
	if err := keyring.requireActiveSigningKey("missing", differentPrivate); err == nil {
		t.Fatal("missing active signing key ID was accepted")
	}

	malformedRoot, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	malformed := filepath.Join(malformedRoot, "keyring.json")
	if err := os.WriteFile(malformed, []byte(`{"schema_version":"elitea.runtime-ed25519-keyring.v1","keys":[],"fallback":"unsafe"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := loadEd25519VerificationKeyring(malformed); err == nil {
		t.Fatal("malformed keyring with unknown fallback field was accepted")
	}
}

func writeVerificationKeyring(t *testing.T, keys []verificationKeyringEntry) string {
	t.Helper()
	raw, err := json.Marshal(verificationKeyringDocument{SchemaVersion: ed25519KeyringSchemaVersion, Keys: keys})
	if err != nil {
		t.Fatal(err)
	}
	root, err := filepath.EvalSymlinks(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "keyring.json")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}
