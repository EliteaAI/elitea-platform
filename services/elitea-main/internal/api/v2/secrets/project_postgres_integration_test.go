package secrets

// The PROJECT vault's destructive-write guards — the same acceptance A14 set for
// the global vault (admin_postgres_integration_test.go), applied to the store
// that every project's `{{secret.name}}` references resolve against.
//
// The defect these exist to make impossible is not "the endpoint 500s". It is
// "the endpoint answered 201 and the project's secrets are gone". `readVault`
// fails for two unrelated reasons — the rows are absent, and the rows are there
// but will not open (wrong SECRETS_MASTER_KEY, a key row in an unexpected
// format, a data row that is not a Fernet token) — and the old
// `readOrInitVault` answered both by writing a fresh empty vault. One create
// against the second case replaced the whole vault and reported success.
//
// So every assertion here is on the STORED BYTES, read with SQL rather than
// through the handler: a handler that cannot open the vault also cannot be
// trusted to report what is in it, and "GET says the secret is still there" is
// exactly the evidence a wiped vault cannot produce and an intact one might not
// either. The reads are asserted separately, on the status code they answer.
//
// Requires a PostgreSQL to create an isolated database in; skipped otherwise.

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	// The project whose vault is corrupted. Deliberately not "0" or "1": those
	// are the two the admin tests seed, and reusing them would let a mistake in
	// one file mask a mistake in the other.
	corruptProjectID = "7"
	// The project whose vault must keep initialising normally.
	freshProjectID = "8"

	projectSecretName  = "project_marker"
	projectSecretValue = "marker-project"
)

// rawVaultBlobs returns the two stored blobs for one vault id, as bytes. Unlike
// vaultRowDigest it does not require BOTH rows to exist, because half the cases
// here are about a vault that is only partly there.
func rawVaultBlobs(t *testing.T, pool *pgxpool.Pool, id string) (keyRow, dataRow []byte) {
	t.Helper()
	ctx := context.Background()
	if err := pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_key WHERE id = $1`, id).Scan(&keyRow); err != nil {
		keyRow = nil
	}
	if err := pool.QueryRow(ctx,
		`SELECT data FROM centry.secrets_data WHERE id = $1`, id).Scan(&dataRow); err != nil {
		dataRow = nil
	}
	return keyRow, dataRow
}

// seedProjectVault writes a project vault holding one marker, through the
// handler's own writer, so the fixture is in the format the product reads.
func seedProjectVault(t *testing.T, pool *pgxpool.Pool, projectID string) {
	t.Helper()
	if err := NewHandler(pool).writeVaultCtx(context.Background(), projectID, vaultData{
		Secrets:       map[string]string{projectSecretName: projectSecretValue},
		HiddenSecrets: map[string]string{},
	}); err != nil {
		t.Fatalf("seed project %s vault: %v", projectID, err)
	}
}

// corruptProjectVaultData replaces the data row with something that is not a
// Fernet token — the shape of a wrong-master-key or foreign-format vault, which
// is the case that must never be written over.
func corruptProjectVaultData(t *testing.T, pool *pgxpool.Pool, projectID string) {
	t.Helper()
	if _, err := pool.Exec(context.Background(),
		`UPDATE centry.secrets_data SET data = $1 WHERE id = $2`,
		[]byte("this is not a fernet token"), dbKey(projectID),
	); err != nil {
		t.Fatalf("corrupt project %s vault data row: %v", projectID, err)
	}
}

const projectSecretsBase = "/secrets/secrets/default/"

/* ── the guard ─────────────────────────────────────────────────────────────── */

// The acceptance bar: a create against an unreadable-but-present project vault
// must leave the stored rows BYTE-IDENTICAL. The comparison is raw SQL on both
// blobs, not a round trip through the handler — the point is what is on disk.
func TestProjectSecretCreateRefusesAnUnreadableVaultInsteadOfReplacingIt(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	corruptProjectVaultData(t, pool, corruptProjectID)
	router := secretsRouter(t, pool, allSecretPermissions())

	keyBefore, dataBefore := rawVaultBlobs(t, pool, dbKey(corruptProjectID))
	if keyBefore == nil || dataBefore == nil {
		t.Fatalf("fixture is wrong: the corrupted vault must still have BOTH rows")
	}

	recorder := do(t, router, http.MethodPost, projectSecretsBase+corruptProjectID,
		map[string]string{"name": "new_secret", "value": "marker-new"})
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("create against an unreadable vault status = %d, want 500 (body %s)",
			recorder.Code, recorder.Body.String())
	}

	keyAfter, dataAfter := rawVaultBlobs(t, pool, dbKey(corruptProjectID))
	if string(keyAfter) != string(keyBefore) {
		t.Fatalf("the failed create rewrote the KEY row (%x → %x) — the vault can never be recovered now",
			keyBefore, keyAfter)
	}
	if string(dataAfter) != string(dataBefore) {
		t.Fatalf("the failed create REPLACED the unreadable vault (%x → %x) — "+
			"that is a silent wipe of every secret in project %s", dataBefore, dataAfter, corruptProjectID)
	}
}

// The same guard on every other write path. Each of these also read the vault
// first and each would have written afterwards; a fix that only covered Create
// would leave the wipe reachable through a rename or a hide.
func TestEveryProjectSecretWriteRefusesAnUnreadableVault(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	corruptProjectVaultData(t, pool, corruptProjectID)
	router := secretsRouter(t, pool, allSecretPermissions())

	keyBefore, dataBefore := rawVaultBlobs(t, pool, dbKey(corruptProjectID))
	secretBase := "/secrets/secret/default/" + corruptProjectID + "/"

	for _, attempt := range []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"update", http.MethodPut, secretBase + projectSecretName,
			map[string]string{"name": projectSecretName, "value": "marker-updated"}},
		{"delete", http.MethodDelete, secretBase + projectSecretName, nil},
		{"hide", http.MethodPost, "/secrets/hide/default/" + corruptProjectID + "/" + projectSecretName, nil},
	} {
		recorder := do(t, router, attempt.method, attempt.path, attempt.body)
		if recorder.Code != http.StatusInternalServerError {
			t.Fatalf("%s against an unreadable vault status = %d, want 500 (body %s)",
				attempt.name, recorder.Code, recorder.Body.String())
		}
		keyAfter, dataAfter := rawVaultBlobs(t, pool, dbKey(corruptProjectID))
		if string(keyAfter) != string(keyBefore) || string(dataAfter) != string(dataBefore) {
			t.Fatalf("%s changed the stored vault of a project whose secrets it could not read", attempt.name)
		}
	}
}

// The read side of the same defect. `List` answered 200 [] on ANY read failure,
// so a vault that exists and will not open looked EMPTY — which is both a false
// report and the thing that invites the destroying create. An absent vault is
// still an empty list, because a project with no secrets is not an error.
func TestProjectSecretListReportsAnUnreadableVaultButNotAnAbsentOne(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	corruptProjectVaultData(t, pool, corruptProjectID)
	router := secretsRouter(t, pool, allSecretPermissions())

	recorder := do(t, router, http.MethodGet, projectSecretsBase+corruptProjectID, nil)
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("listing an unreadable vault status = %d, want 500; a 200 [] tells the page "+
			"the project has no secrets when in fact it has secrets nobody can open (body %s)",
			recorder.Code, recorder.Body.String())
	}
	if recorder.Body.String() == "[]\n" {
		t.Fatalf("the body is still an empty list")
	}

	// A project that genuinely has no vault is unchanged: 200 [].
	recorder = do(t, router, http.MethodGet, projectSecretsBase+freshProjectID, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("listing a project with no vault status = %d, want 200", recorder.Code)
	}
	var rows []SecretListItem
	if err := json.Unmarshal(recorder.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode listing %q: %v", recorder.Body.String(), err)
	}
	if len(rows) != 0 {
		t.Fatalf("a project with no vault listed %v, want []", rows)
	}
	// …and listing it did not CREATE one. A read must not write.
	if key, data := rawVaultBlobs(t, pool, dbKey(freshProjectID)); key != nil || data != nil {
		t.Fatalf("listing an absent vault created its rows")
	}
}

// The single-secret read reports the same distinction: "not found" for a project
// with no vault, a failure for a vault that will not open.
func TestProjectSecretGetReportsAnUnreadableVaultButNotAnAbsentOne(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	corruptProjectVaultData(t, pool, corruptProjectID)
	router := secretsRouter(t, pool, allSecretPermissions())

	if code := do(t, router, http.MethodGet,
		"/secrets/secret/default/"+corruptProjectID+"/"+projectSecretName, nil).Code; code != http.StatusInternalServerError {
		t.Fatalf("reading a secret from an unreadable vault status = %d, want 500; a 404 says "+
			"the secret does not exist when it does", code)
	}
	if code := do(t, router, http.MethodGet,
		"/secrets/secret/default/"+freshProjectID+"/"+projectSecretName, nil).Code; code != http.StatusNotFound {
		t.Fatalf("reading a secret from a project with no vault status = %d, want 404", code)
	}
}

/* ── the behaviour that must NOT change ────────────────────────────────────── */

// A project with no vault at all still gets one on its first create, and the
// secret is readable back through the product's own GET. This is the case the
// destructive fallback was there to serve, and it is the one that must survive
// the fix intact — J21 in the E2E suite is exactly this journey.
func TestProjectSecretCreateStillInitialisesAnAbsentVault(t *testing.T) {
	pool := newSecretsPool(t)
	router := secretsRouter(t, pool, allSecretPermissions())

	if key, data := rawVaultBlobs(t, pool, dbKey(freshProjectID)); key != nil || data != nil {
		t.Fatalf("fixture is wrong: project %s must start with no vault", freshProjectID)
	}

	recorder := do(t, router, http.MethodPost, projectSecretsBase+freshProjectID,
		map[string]string{"name": projectSecretName, "value": projectSecretValue})
	if recorder.Code != http.StatusCreated {
		t.Fatalf("first create status = %d, want 201 (body %s)", recorder.Code, recorder.Body.String())
	}

	// Read back through the PRODUCT's GET, not the handler's internals.
	recorder = do(t, router, http.MethodGet,
		"/secrets/secret/default/"+freshProjectID+"/"+projectSecretName, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("reading the first secret back status = %d, want 200", recorder.Code)
	}
	var detail SecretDetail
	if err := json.Unmarshal(recorder.Body.Bytes(), &detail); err != nil {
		t.Fatalf("decode detail %q: %v", recorder.Body.String(), err)
	}
	if detail.Value != projectSecretValue {
		t.Fatalf("the first create is not readable back: value = %q", detail.Value)
	}

	// The minted key row is centry's 44-byte base64 form (#196/#197) — the same
	// assertion the global vault carries, because the project vault is where
	// the gateway and centrysecrets read provider credentials from.
	keyRow, dataRow := rawVaultBlobs(t, pool, dbKey(freshProjectID))
	if len(keyRow) != 44 {
		t.Fatalf("minted key row is %d bytes; centry stores the 44-byte base64 encoding", len(keyRow))
	}
	if _, err := fernetDecodeKey(string(keyRow)); err != nil {
		t.Fatalf("the minted key row is not a decodable Fernet key: %v", err)
	}
	if dataRow == nil {
		t.Fatalf("the first create left no data row")
	}
}

// The ordinary edit path still works end to end on a readable vault: nothing
// here is guarded into uselessness.
func TestProjectSecretRoundTripOnAReadableVault(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID) // readable — not corrupted in this test
	router := secretsRouter(t, pool, allSecretPermissions())
	base := "/secrets/secret/default/" + corruptProjectID + "/"

	if code := do(t, router, http.MethodPost, projectSecretsBase+corruptProjectID,
		map[string]string{"name": "second_marker", "value": "marker-two"}).Code; code != http.StatusCreated {
		t.Fatalf("create on a readable vault status = %d, want 201", code)
	}
	if code := do(t, router, http.MethodPut, base+"second_marker",
		map[string]string{"name": "second_marker", "value": "marker-three"}).Code; code != http.StatusOK {
		t.Fatalf("update status = %d, want 200", code)
	}
	if code := do(t, router, http.MethodPost,
		"/secrets/hide/default/"+corruptProjectID+"/second_marker", nil).Code; code != http.StatusOK {
		t.Fatalf("hide status = %d, want 200", code)
	}
	if code := do(t, router, http.MethodDelete, base+"second_marker", nil).Code; code != http.StatusNoContent {
		t.Fatalf("delete status = %d, want 204", code)
	}
	// The secret the vault started with survived all four writes.
	recorder := do(t, router, http.MethodGet, base+projectSecretName, nil)
	if recorder.Code != http.StatusOK {
		t.Fatalf("the original secret is gone after the round trip: %d %s",
			recorder.Code, recorder.Body.String())
	}
}

// A half-initialised vault — a key row with no data row — is NOT an absent one.
// Writing it as absent would mint a second key over the first, so the data row
// that arrives later could never be opened.
func TestProjectVaultWithAKeyRowAndNoDataRowIsNotTreatedAsAbsent(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	if _, err := pool.Exec(context.Background(),
		`DELETE FROM centry.secrets_data WHERE id = $1`, dbKey(corruptProjectID)); err != nil {
		t.Fatalf("remove the data row: %v", err)
	}
	router := secretsRouter(t, pool, allSecretPermissions())

	keyBefore, _ := rawVaultBlobs(t, pool, dbKey(corruptProjectID))

	recorder := do(t, router, http.MethodPost, projectSecretsBase+corruptProjectID,
		map[string]string{"name": "new_secret", "value": "marker-new"})
	if recorder.Code != http.StatusInternalServerError {
		t.Fatalf("create against a half-initialised vault status = %d, want 500 (body %s)",
			recorder.Code, recorder.Body.String())
	}
	if keyAfter, _ := rawVaultBlobs(t, pool, dbKey(corruptProjectID)); string(keyAfter) != string(keyBefore) {
		t.Fatalf("the key row was replaced; a data row written under the old key is now unopenable")
	}
}

// The programmatic path is the same store and the same hazard: StoreSecret is
// called by the applications and conversations handlers, not over HTTP, and it
// went through the identical fallback.
func TestStoreSecretRefusesAnUnreadableVault(t *testing.T) {
	pool := newSecretsPool(t)
	seedProjectVault(t, pool, corruptProjectID)
	corruptProjectVaultData(t, pool, corruptProjectID)

	keyBefore, dataBefore := rawVaultBlobs(t, pool, dbKey(corruptProjectID))

	err := NewHandler(pool).StoreSecret(context.Background(), nil, corruptProjectID, "new_secret", "marker-new")
	if err == nil {
		t.Fatalf("StoreSecret against an unreadable vault returned no error")
	}
	keyAfter, dataAfter := rawVaultBlobs(t, pool, dbKey(corruptProjectID))
	if string(keyAfter) != string(keyBefore) || string(dataAfter) != string(dataBefore) {
		t.Fatalf("StoreSecret replaced a vault it could not read")
	}
}
