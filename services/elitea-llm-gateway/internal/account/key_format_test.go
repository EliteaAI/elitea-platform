package account

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// centryVaultFixture is testdata/centry/vault-key-format.json: a project vault
// written by the real Python implementation (cryptography.fernet, driven the way
// centry's secret engine drives it — see the generator script beside the file).
//
// It is deliberately authored by neither Go reader. Two implementations in
// separate modules consume these rows — this vault and elitea-main's
// internal/api/v2/secrets — and each previously hard-coded its own idea of the
// stored key format. A test that round-trips within one implementation passes
// against that bug, which is exactly how the defect survived in elitea-main
// until an unrelated feature started sharing the store (#194, #197).
type centryVaultFixture struct {
	VaultPlaintext         string `json:"vault_plaintext"`
	SecretsKeyRowUnwrapped string `json:"secrets_key_row_unwrapped"`
	SecretsKeyRowWrapped   string `json:"secrets_key_row_wrapped"`
	SecretsDataRow         string `json:"secrets_data_row"`
	MasterKeyEnvValue      string `json:"master_key_env_value"`
	ProjectKeyRawB64Std    string `json:"project_key_raw_bytes_b64std"`
}

// loadCentryVaultFixture walks up from the package directory to the repository
// root to find the shared fixture. Walking beats a counted "../../../.." chain:
// this module sits at a different depth from the other reader, and a miscounted
// path would fail identically to a missing file.
func loadCentryVaultFixture(t *testing.T) centryVaultFixture {
	t.Helper()

	const rel = "testdata/centry/vault-key-format.json"
	dir, err := os.Getwd()
	if err != nil {
		t.Fatalf("getwd: %v", err)
	}
	for {
		raw, err := os.ReadFile(filepath.Join(dir, filepath.FromSlash(rel)))
		if err == nil {
			var fixture centryVaultFixture
			if err := json.Unmarshal(raw, &fixture); err != nil {
				t.Fatalf("parse %s: %v", rel, err)
			}
			return fixture
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			t.Fatalf("%s not found in any parent of the package directory", rel)
		}
		dir = parent
	}
}

// projectKeyRaw is the fixture's 32 key bytes. The b64std field is only a
// transport encoding for JSON — unlike the key row, which is base64 because
// that is genuinely what centry stores.
func (f centryVaultFixture) projectKeyRaw(t *testing.T) []byte {
	t.Helper()
	raw, err := base64.StdEncoding.DecodeString(f.ProjectKeyRawB64Std)
	if err != nil {
		t.Fatalf("decode project_key_raw_bytes_b64std: %v", err)
	}
	return raw
}

// The vault must open against rows Python actually wrote. Before the fix this
// failed at the first row with "unexpected key length 44": the stored key is
// Fernet.generate_key()'s 44-byte base64 form, not the raw 32 bytes this vault
// insisted on, so no project credential in any real database could be resolved.
func TestVaultResolve_PythonWrittenVault(t *testing.T) {
	t.Parallel()

	fixture := loadCentryVaultFixture(t)
	v := &FernetVault{db: &fakeDB{
		keyRow:  []byte(fixture.SecretsKeyRowUnwrapped),
		dataRow: []byte(fixture.SecretsDataRow),
	}} // masterKey nil

	for ref, want := range map[string]string{
		"{{secret.OPENAI_API_KEY}}": "sk-fixture-not-a-real-credential",
		"{{secret.HIDDEN_TOKEN}}":   "hidden-fixture-not-a-real-credential",
	} {
		got, err := v.Resolve(context.Background(), "42", ref)
		if err != nil {
			t.Fatalf("Resolve(%s) against a Python-written vault: %v", ref, err)
		}
		if got != want {
			t.Fatalf("Resolve(%s) = %q, want %q", ref, got, want)
		}
	}
}

// With SECRETS_MASTER_KEY set, centry stores Fernet(master).encrypt(key) — the
// wrapping is applied over the base64 form, so unwrapping yields 44 bytes and
// not the 32 the vault used to pass straight into fernetDecrypt.
func TestVaultResolve_PythonWrittenVault_MasterWrapped(t *testing.T) {
	t.Parallel()

	fixture := loadCentryVaultFixture(t)
	masterKey, err := fernetDecodeKey(fixture.MasterKeyEnvValue)
	if err != nil {
		t.Fatalf("decode master key env value: %v", err)
	}

	v := &FernetVault{
		db: &fakeDB{
			keyRow:  []byte(fixture.SecretsKeyRowWrapped),
			dataRow: []byte(fixture.SecretsDataRow),
		},
		masterKey: masterKey,
	}
	got, err := v.Resolve(context.Background(), "42", "{{secret.OPENAI_API_KEY}}")
	if err != nil {
		t.Fatalf("Resolve against a wrapped Python-written vault: %v", err)
	}
	if got != "sk-fixture-not-a-real-credential" {
		t.Fatalf("got %q, want sk-fixture-not-a-real-credential", got)
	}
}

// Both stored representations must unwrap to the same 32 key bytes: centry's
// base64 form, and the raw 32 bytes an earlier build of elitea-main's secrets
// handler wrote. Dropping the legacy form would lock existing projects out of
// their own secrets on upgrade.
func TestVaultDecryptKeyAcceptsBothStoredRepresentations(t *testing.T) {
	t.Parallel()

	fixture := loadCentryVaultFixture(t)
	want := fixture.projectKeyRaw(t)
	v := &FernetVault{db: &fakeDB{}}

	for name, stored := range map[string][]byte{
		"centry base64 form":  []byte(fixture.SecretsKeyRowUnwrapped),
		"legacy raw 32 bytes": want,
	} {
		t.Run(name, func(t *testing.T) {
			got, err := v.decryptKey(stored)
			if err != nil || !bytes.Equal(got, want) {
				t.Fatalf("decryptKey(%s) = %x, %v; want the fixture's 32 key bytes", name, got, err)
			}
		})
	}

	if _, err := v.decryptKey([]byte("not-a-key")); err == nil {
		t.Fatal("a key that is neither representation was accepted")
	}
	// Well-formed base64, wrong decoded length — must not slip through.
	if _, err := v.decryptKey([]byte(base64.URLEncoding.EncodeToString(make([]byte, 48)))); err == nil {
		t.Fatal("a 48-byte base64-encoded key was accepted")
	}
}
