package centrysecrets

// The round trip is the whole point of these tests.
//
// A created vault is only useful if the two functions that consume vaults —
// open() and rewrite() — accept it. Both are strict: rewrite() rejects a vault
// whose `secrets` or `hidden_secrets` member is absent or null, and open()
// rejects a token it cannot authenticate. So each case creates a vault, WRITES
// through the real mutator, and READS the value back through the real reader.
// Asserting only that CreateUnwrapped returns two non-empty slices would accept
// a vault nothing can open.

import (
	"crypto/rand"
	"encoding/base64"
	"errors"
	"testing"
)

func TestCreateUnwrappedMakesAVaultTheMutatorAndReaderAccept(t *testing.T) {
	t.Parallel()

	storedKey, encryptedVault, err := CreateUnwrapped()
	if err != nil {
		t.Fatalf("CreateUnwrapped() error = %v", err)
	}
	if len(storedKey) != fernetEncodedKey {
		t.Fatalf("stored key length = %d, want %d (the form centry.secrets_key holds)",
			len(storedKey), fernetEncodedKey)
	}

	// A new vault is empty rather than absent. That distinction is what makes
	// the first write succeed instead of reporting a missing secret store.
	vault, err := OpenUnwrapped(storedKey, encryptedVault)
	if err != nil {
		t.Fatalf("OpenUnwrapped() on a freshly created vault: %v", err)
	}
	if _, err := vault.LookupRegular("pgvector_project_connstr"); !errors.Is(err, ErrSecretNotFound) {
		t.Fatalf("LookupRegular on an empty vault = %v, want ErrSecretNotFound", err)
	}

	rewritten, err := RewriteUnwrapped(storedKey, encryptedVault, []Mutation{
		{Collection: RegularSecrets, Name: "pgvector_project_connstr", Value: "postgresql://example"},
		{Collection: HiddenSecrets, Name: "pgvector_project_password", Value: "secret"},
	})
	if err != nil {
		t.Fatalf("RewriteUnwrapped() on a freshly created vault: %v", err)
	}
	written, err := OpenUnwrapped(storedKey, rewritten)
	if err != nil {
		t.Fatalf("OpenUnwrapped() after the first write: %v", err)
	}
	secret, err := written.LookupRegular("pgvector_project_connstr")
	if err != nil || secret.Value != "postgresql://example" {
		t.Fatalf("regular secret = %+v error = %v", secret, err)
	}
	hidden, err := written.Lookup("pgvector_project_password")
	if err != nil || hidden.Value != "secret" || !hidden.Hidden {
		t.Fatalf("hidden secret = %+v error = %v", hidden, err)
	}
}

func TestCreateWrappedMakesAVaultTheWrappedMutatorAndReaderAccept(t *testing.T) {
	t.Parallel()

	masterKey := newTestMasterKey(t)
	encryptedProjectKey, encryptedVault, err := CreateWrapped(masterKey)
	if err != nil {
		t.Fatalf("CreateWrapped() error = %v", err)
	}
	// The stored key is a Fernet token here, not the 44-byte encoding, so a
	// reader that ignored the master key would fail. That is the property this
	// case pins.
	if len(encryptedProjectKey) == fernetEncodedKey {
		t.Fatal("the wrapped project key was stored unwrapped")
	}
	if _, err := OpenUnwrapped(encryptedProjectKey, encryptedVault); err == nil {
		t.Fatal("OpenUnwrapped accepted a master-key-wrapped vault")
	}

	if _, err := OpenWrapped(masterKey, encryptedProjectKey, encryptedVault); err != nil {
		t.Fatalf("OpenWrapped() on a freshly created vault: %v", err)
	}
	rewritten, err := RewriteWrapped(masterKey, encryptedProjectKey, encryptedVault, []Mutation{
		{Collection: RegularSecrets, Name: "name", Value: "value"},
	})
	if err != nil {
		t.Fatalf("RewriteWrapped() on a freshly created vault: %v", err)
	}
	vault, err := OpenWrapped(masterKey, encryptedProjectKey, rewritten)
	if err != nil {
		t.Fatalf("OpenWrapped() after the first write: %v", err)
	}
	if secret, err := vault.LookupRegular("name"); err != nil || secret.Value != "value" {
		t.Fatalf("secret = %+v error = %v", secret, err)
	}
}

func TestCreateWrappedRejectsAnUnusableMasterKey(t *testing.T) {
	t.Parallel()

	for name, masterKey := range map[string][]byte{
		"absent":  nil,
		"empty":   {},
		"short":   []byte("too-short"),
		"unbased": make([]byte, fernetEncodedKey),
	} {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			if _, _, err := CreateWrapped(masterKey); err == nil {
				t.Fatal("CreateWrapped accepted an unusable master key")
			}
		})
	}
}

func TestCreateUnwrappedMakesADifferentVaultEachTime(t *testing.T) {
	t.Parallel()

	firstKey, firstVault, err := CreateUnwrapped()
	if err != nil {
		t.Fatalf("first CreateUnwrapped(): %v", err)
	}
	secondKey, secondVault, err := CreateUnwrapped()
	if err != nil {
		t.Fatalf("second CreateUnwrapped(): %v", err)
	}
	if string(firstKey) == string(secondKey) {
		t.Fatal("two vaults share one project key")
	}
	// One project's key must not open another's ciphertext.
	if _, err := OpenUnwrapped(firstKey, secondVault); err == nil {
		t.Fatal("one project's key opened another project's vault")
	}
	if _, err := OpenUnwrapped(secondKey, firstVault); err == nil {
		t.Fatal("one project's key opened another project's vault")
	}
}

func newTestMasterKey(t *testing.T) []byte {
	t.Helper()
	var raw [fernetKeyBytes]byte
	if _, err := rand.Read(raw[:]); err != nil {
		t.Fatalf("generate master key: %v", err)
	}
	encoded := make([]byte, fernetEncodedKey)
	base64.URLEncoding.Encode(encoded, raw[:])
	return encoded
}
