package secrets

// What SECRETS_MASTER_KEY actually does to the STORED BYTES (#412).
//
// The defect these cases exist to make impossible is not "the handler returns
// the wrong error". It is "the operator set a master key, the service started,
// provisioning succeeded, and the project vault keys are sitting in the
// database in the clear".
//
// So every assertion here reads centry.secrets_key and centry.secrets_data with
// SQL, not through the handler. A handler built on the wrong key cannot be
// trusted to report what it stored, and "the round trip works" is evidence an
// UNWRAPPED vault produces just as happily as a wrapped one. That is precisely
// why the defect was invisible.
//
// Requires a PostgreSQL to create an isolated database in; skipped otherwise.

import (
	"bytes"
	"context"
	"strings"
	"testing"
)

const (
	// The project whose vault these cases write. Deliberately not "0", "1", "7"
	// or "8": those belong to the admin and project cases, and reusing one
	// would let a mistake in either file mask a mistake here.
	masterKeyProjectID = "412"

	masterKeySecretName = "master_key_marker"
	// Distinctive on purpose. The data row is searched for these bytes, so the
	// value must not be a string that could appear in Fernet output by chance.
	masterKeySecretValue = "PLAINTEXT-CANARY-8f3a1c-must-not-appear-in-the-database"
)

/* ── a valid key wraps ──────────────────────────────────────────────────── */

// The acceptance bar for a working deployment: the stored key row is NOT the
// key, and the stored data row is NOT the secret.
func TestAValidMasterKeyWrapsTheStoredVaultKey(t *testing.T) {
	fixture := loadCentryVaultFixture(t)
	t.Setenv(MasterKeyEnvVar, fixture.MasterKeyEnvValue)

	pool := newSecretsPool(t)
	handler := NewHandler(pool)
	if handler.masterKey == nil {
		t.Fatal("premise failed: the fixture's master key was not loaded, so this case proves nothing")
	}

	if err := handler.writeVaultCtx(context.Background(), masterKeyProjectID, vaultData{
		Secrets:       map[string]string{masterKeySecretName: masterKeySecretValue},
		HiddenSecrets: map[string]string{},
	}); err != nil {
		t.Fatalf("write the project vault with a valid master key: %v", err)
	}

	keyRow, dataRow := rawVaultBlobs(t, pool, dbKey(masterKeyProjectID))
	if len(keyRow) == 0 || len(dataRow) == 0 {
		t.Fatalf("the vault was not written: key row %d bytes, data row %d bytes", len(keyRow), len(dataRow))
	}

	// The key row must not be the project key. Unwrapped, centry stores the
	// 44-byte base64 encoding of the 32 key bytes, which fernetDecodeKey
	// accepts. A wrapped row is a Fernet token, which it must reject. This is
	// the assertion that fails against the tolerant code.
	if _, err := fernetDecodeKey(string(keyRow)); err == nil {
		t.Fatalf("the stored key row is a bare Fernet key, so %s did not wrap it: %q",
			MasterKeyEnvVar, keyRow)
	}
	// And it must be the wrapped form of a real key, not merely unreadable.
	unwrapped, err := fernetDecrypt(handler.masterKey, keyRow)
	if err != nil {
		t.Fatalf("the stored key row does not unwrap with the master key: %v", err)
	}
	if _, err := fernetDecodeKey(string(unwrapped)); err != nil {
		t.Fatalf("the unwrapped key row is not a Fernet key: %v", err)
	}

	// The secret value must not be lying in the data row.
	if bytes.Contains(dataRow, []byte(masterKeySecretValue)) {
		t.Fatalf("the secret value is stored in the clear in centry.secrets_data: %q", dataRow)
	}

	// A handler holding the same key still reads it back, so wrapping did not
	// simply break the vault.
	readBack, err := handler.readVaultCtx(context.Background(), masterKeyProjectID)
	if err != nil {
		t.Fatalf("read the wrapped vault back: %v", err)
	}
	if readBack.Secrets[masterKeySecretName] != masterKeySecretValue {
		t.Fatalf("read back %q, want %q", readBack.Secrets[masterKeySecretName], masterKeySecretValue)
	}
}

/* ── a malformed key writes nothing ─────────────────────────────────────── */

// The regression case. Against the tolerant code this FAILS: the handler
// ignored the malformed value, minted a key, and wrote an unwrapped vault whose
// data row holds the canary above.
func TestAMalformedMasterKeyWritesNoVaultAtAll(t *testing.T) {
	// A valid key with a trailing SPACE: the mounted-secret shape an operator
	// is most likely to produce by accident and the decoder actually rejects.
	// A trailing NEWLINE would not do — Go's base64 decoder ignores "\r" and
	// "\n", so that key still decodes correctly (see the unit case).
	fixture := loadCentryVaultFixture(t)
	t.Setenv(MasterKeyEnvVar, fixture.MasterKeyEnvValue+" ")

	pool := newSecretsPool(t)
	handler := NewHandler(pool)
	if handler.masterKeyErr == nil {
		t.Fatalf("premise failed: %s with a trailing space was accepted", MasterKeyEnvVar)
	}

	err := handler.writeVaultCtx(context.Background(), masterKeyProjectID, vaultData{
		Secrets:       map[string]string{masterKeySecretName: masterKeySecretValue},
		HiddenSecrets: map[string]string{},
	})
	if err == nil {
		t.Fatalf("the write SUCCEEDED with a malformed %s; it must fail, because the "+
			"vault it writes is unwrapped and the operator believes it is wrapped", MasterKeyEnvVar)
	}
	if !strings.Contains(err.Error(), MasterKeyEnvVar) {
		t.Fatalf("the write error must name %s, got %q", MasterKeyEnvVar, err)
	}

	// Nothing may be left behind. A minted key row with no data row is a
	// half-initialised vault, and the next write would mint a SECOND key over
	// it.
	keyRow, dataRow := rawVaultBlobs(t, pool, dbKey(masterKeyProjectID))
	if len(keyRow) != 0 {
		t.Fatalf("a malformed %s still minted a key row: %q", MasterKeyEnvVar, keyRow)
	}
	if len(dataRow) != 0 {
		t.Fatalf("a malformed %s still wrote a data row: %q", MasterKeyEnvVar, dataRow)
	}
}

/* ── absent is not malformed ────────────────────────────────────────────── */

// The two cases must be distinguishable, or an unwrapped mode could be entered
// by accident. An absent key writes a working unwrapped vault; the malformed
// key above writes nothing.
func TestAnAbsentMasterKeyStillWritesAnUnwrappedVault(t *testing.T) {
	t.Setenv(MasterKeyEnvVar, "")

	pool := newSecretsPool(t)
	handler := NewHandler(pool)
	if handler.masterKey != nil || handler.masterKeyErr != nil {
		t.Fatalf("premise failed: an absent %s produced key %x and error %v",
			MasterKeyEnvVar, handler.masterKey, handler.masterKeyErr)
	}

	if err := handler.writeVaultCtx(context.Background(), masterKeyProjectID, vaultData{
		Secrets:       map[string]string{masterKeySecretName: masterKeySecretValue},
		HiddenSecrets: map[string]string{},
	}); err != nil {
		t.Fatalf("an absent %s must keep writing an unwrapped vault, got: %v", MasterKeyEnvVar, err)
	}

	// The unwrapped shape: the key row IS the bare Fernet key. This is what the
	// malformed case must never produce.
	keyRow, dataRow := rawVaultBlobs(t, pool, dbKey(masterKeyProjectID))
	if _, err := fernetDecodeKey(string(keyRow)); err != nil {
		t.Fatalf("an absent %s must store the bare Fernet key row, got %q (%v)",
			MasterKeyEnvVar, keyRow, err)
	}
	// The vault DATA is still encrypted under the project key, even unwrapped.
	// Only the key row is in the clear. Saying so here keeps the next reader
	// from taking this case for proof that plaintext storage is acceptable.
	if bytes.Contains(dataRow, []byte(masterKeySecretValue)) {
		t.Fatalf("the secret value is stored in the clear in centry.secrets_data: %q", dataRow)
	}
}
