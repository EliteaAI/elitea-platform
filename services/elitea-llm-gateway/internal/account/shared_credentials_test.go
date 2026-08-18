package account

import (
	"context"
	"strings"
	"testing"

	"github.com/maximhq/bifrost/core/schemas"
)

// Issue #316: the gateway read p_{caller} only, so a platform-shared credential
// never resolved and a shared model could not be served.
//
// Every test here answers one of two questions:
//
//	1. does the credential the platform PUBLISHED resolve for a project that does
//	   not own it?
//	2. does a credential the platform did NOT publish stay unreachable?
//
// The assertions therefore name the credential that must resolve (id, label and
// secret value), never just a count — a count cannot tell the two apart.

const (
	callerProject = "7" // the project making the request; owns nothing by default
	publicProject = "1" // the platform's shared project
	otherProject  = "9" // an unrelated tenant; must stay unreachable
)

// newSharedAccount builds an account whose shared scope points at publicProject.
func newSharedAccount(t *testing.T, db rowQuerier, vault vaultDecryptor) *EliteaAccount {
	t.Helper()
	a, err := New(Config{
		DB:                  db,
		Vault:               vault,
		ProviderConcurrency: 50,
		PublicProjectID:     publicProject,
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

// openAIRow builds one ai_credentials row: {id, title, data, shared}.
func openAIRow(id, title, apiKey string, shared bool) []any {
	return []any{id, title, []byte(`{"api_key":"` + apiKey + `"}`), shared}
}

// TestSharedCredentialResolvesForNonOwningProject is the core of issue #316.
// Project 7 owns no credential at all. The platform published one on project 1.
// That credential — identified by id, label AND secret value — must resolve.
func TestSharedCredentialResolvesForNonOwningProject(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {}, // owns nothing
		publicProject: {openAIRow("pub-1", "platform-openai", "SHARED-KEY", true)},
	}}
	a := newSharedAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1 (the shared credential)", len(keys))
	}
	// Discriminating: assert WHICH credential resolved, not that one did.
	if got, want := keys[0].ID, sharedKeyIDPrefix+"pub-1"; got != want {
		t.Errorf("key ID = %q, want %q", got, want)
	}
	if got, want := keys[0].Name, "platform-openai"; got != want {
		t.Errorf("key Name = %q, want %q", got, want)
	}
	if got, want := keys[0].Value.Val, "SHARED-KEY"; got != want {
		t.Errorf("resolved secret = %q, want %q", got, want)
	}
}

// TestForeignPrivateCredentialDoesNotResolve is the isolation half. Widening the
// read must not turn into a cross-tenant read:
//
//   - project 9 is an unrelated tenant with a perfectly good credential;
//   - project 1 (the public project) holds an UNPUBLISHED credential.
//
// Project 7 must see neither, and the gateway must not even query project 9.
func TestForeignPrivateCredentialDoesNotResolve(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {},
		// Published = false. The platform never offered this one.
		publicProject: {openAIRow("pub-private", "not-published", "PUBLIC-PRIVATE-KEY", false)},
		otherProject:  {openAIRow("other-1", "another-tenant", "TENANT-9-KEY", true)},
	}}
	a := newSharedAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("got %d keys, want 0; leaked: %+v", len(keys), keys)
	}
	// No secret from either foreign scope may appear anywhere in the result.
	for _, k := range keys {
		if v := k.Value.Val; v == "PUBLIC-PRIVATE-KEY" || v == "TENANT-9-KEY" {
			t.Fatalf("cross-tenant credential leaked: %q", v)
		}
	}
	// The unrelated tenant's schema must never be named in a statement.
	for _, q := range db.gotSQL {
		if strings.Contains(q, `"p_`+otherProject+`"`) {
			t.Fatalf("gateway queried an unrelated tenant's schema: %s", q)
		}
	}
	// Exactly two scopes are read, and the cross-project one is filtered.
	if len(db.gotSQL) != 2 {
		t.Fatalf("got %d queries, want 2 (own + public)", len(db.gotSQL))
	}
	if strings.Contains(db.gotSQL[0], "shared = true") {
		t.Error("the caller's OWN scope must not be filtered to shared rows")
	}
	if !strings.Contains(db.gotSQL[1], "shared = true") {
		t.Error("the public scope MUST carry the shared predicate")
	}
}

// TestOwnCredentialWinsOverSharedCredential pins the collision rule the issue
// asks to decide: the project's own row comes first, matching the legacy
// resolver, which probed {project}_{model} before {public}_{model}.
func TestOwnCredentialWinsOverSharedCredential(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {openAIRow("own-1", "my-openai", "OWN-KEY", false)},
		publicProject: {openAIRow("pub-1", "platform-openai", "SHARED-KEY", true)},
	}}
	a := newSharedAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("got %d keys, want 2 (own + shared)", len(keys))
	}
	if got, want := keys[0].Value.Val, "OWN-KEY"; got != want {
		t.Errorf("first key = %q, want the project's OWN credential %q", got, want)
	}
	if got, want := keys[1].Value.Val, "SHARED-KEY"; got != want {
		t.Errorf("second key = %q, want the shared credential %q", got, want)
	}
	// The two rows carry the same numeric id in different schemas in the wild;
	// the Key IDs must still differ or bifrost sees one key twice.
	if keys[0].ID == keys[1].ID {
		t.Errorf("own and shared credentials collided on Key ID %q", keys[0].ID)
	}
}

// TestSharedCredentialSecretResolvesAgainstOwningProjectVault proves the vault
// scope follows the credential, not the caller. Both projects hold a secret of
// the SAME name with DIFFERENT values, so a resolve against the wrong project
// returns the wrong string instead of failing quietly.
func TestSharedCredentialSecretResolvesAgainstOwningProjectVault(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {},
		publicProject: {{
			"pub-1", "platform-openai",
			[]byte(`{"api_key":"{{secret.LLM_KEY}}"}`), true,
		}},
	}}
	vault := &fakeVault{secrets: map[string]map[string]string{
		callerProject: {"LLM_KEY": "CALLER-SECRET"},
		publicProject: {"LLM_KEY": "PUBLIC-SECRET"},
	}}
	a := newSharedAccount(t, db, vault)

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1", len(keys))
	}
	if got := keys[0].Value.Val; got != "PUBLIC-SECRET" {
		t.Errorf("resolved secret = %q, want PUBLIC-SECRET "+
			"(a shared credential names a secret in the PUBLIC project's vault)", got)
	}
}

// TestSharedScopeOffByDefault: with no public project configured the gateway
// behaves exactly as it did before issue #316 — one scope, no shared rows.
func TestSharedScopeOffByDefault(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {},
		publicProject: {openAIRow("pub-1", "platform-openai", "SHARED-KEY", true)},
	}}
	a := newTestAccount(t, db, &fakeVault{}) // no PublicProjectID

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 0 {
		t.Fatalf("got %d keys, want 0 while the shared scope is off", len(keys))
	}
	if len(db.gotSQL) != 1 {
		t.Fatalf("got %d queries, want 1 (own scope only)", len(db.gotSQL))
	}
}

// TestPublicProjectCallerReadsOneScope: when the caller IS the public project,
// the second read is skipped. Otherwise every shared row would appear twice.
func TestPublicProjectCallerReadsOneScope(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		publicProject: {openAIRow("pub-1", "platform-openai", "SHARED-KEY", true)},
	}}
	a := newSharedAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(publicProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1 (no duplicate of the same row)", len(keys))
	}
	if len(db.gotSQL) != 1 {
		t.Fatalf("got %d queries, want 1", len(db.gotSQL))
	}
	// The public project reads its own rows unfiltered, so an unpublished row of
	// its own is still its own to use.
	if got, want := keys[0].ID, "pub-1"; got != want {
		t.Errorf("key ID = %q, want the unprefixed own-scope id %q", got, want)
	}
}

// TestSharedScopeBackstopRejectsUnpublishedRow proves the Go-side check is a
// real backstop and not decoration: with the SQL predicate defeated, an
// unpublished row must still never reach the caller.
func TestSharedScopeBackstopRejectsUnpublishedRow(t *testing.T) {
	db := &fakeDB{
		ignoreSharedPredicate: true, // simulate a query that lost its predicate
		bySchema: map[string][][]any{
			callerProject: {},
			publicProject: {openAIRow("pub-private", "not-published", "LEAKED", false)},
		},
	}
	a := newSharedAccount(t, db, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err == nil {
		t.Fatalf("expected an error, got %d keys: %+v", len(keys), keys)
	}
	if len(keys) != 0 {
		t.Fatalf("unpublished row leaked despite the error: %+v", keys)
	}
	if !strings.Contains(err.Error(), "escaped the shared scope") {
		t.Errorf("error = %v, want the scope-escape backstop", err)
	}
}

// TestNewRejectsMalformedPublicProjectID: the id is interpolated into a schema
// name, so a bad value must fail at construction, not on the first request.
func TestNewRejectsMalformedPublicProjectID(t *testing.T) {
	for _, id := range []string{"abc", "1; DROP TABLE", "p_1", "-1", " 1"} {
		_, err := New(Config{
			DB:              &fakeDB{},
			Vault:           &fakeVault{},
			PublicProjectID: id,
		})
		if err == nil {
			t.Errorf("New with PublicProjectID %q = nil error, want rejection", id)
		}
	}
}

// TestSharedCredentialLoadErrorFailsClosed: a failure reading the shared scope
// must fail the request, never silently degrade to "own credentials only". A
// caller that suddenly loses the platform's models should see an error.
func TestSharedCredentialLoadErrorFailsClosed(t *testing.T) {
	db := &fakeDB{
		queryErr: context.DeadlineExceeded,
		bySchema: map[string][][]any{callerProject: {}},
	}
	a := newSharedAccount(t, db, &fakeVault{})

	if _, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI); err == nil {
		t.Fatal("expected an error when the configuration read fails")
	}
}
