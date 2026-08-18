// linked_credential_test.go — issue #451, the credential half.
//
// A model row names ONE credential. Before this change GetKeysForProvider
// returned EVERY credential of the provider and let bifrost/core choose. A
// project with two credentials of one provider could therefore call the
// endpoint the model did not name, with the key the model did not name, and
// nothing said so.
//
// Each test names the credential that must be used, by id, by label and by
// secret value. A count cannot tell two credentials apart, and neither can an
// HTTP status.
package account

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// twoOpenAIRows are two credentials of ONE provider in ONE project — the exact
// shape issue #451 describes.
func twoOpenAIRows() [][]any {
	return [][]any{
		openAIRow("cred-a", "team-openai", "KEY-A", false),
		openAIRow("cred-b", "personal-openai", "KEY-B", false),
	}
}

// ctxWithLink returns a context that carries a resolved project AND the
// credential a model row named, exactly as the /llm handler builds it.
func ctxWithLink(projectID string, link LinkedCredential) context.Context {
	bc := schemas.NewBifrostContext(context.Background(), schemas.NoDeadline)
	bc.SetValue(schemas.BifrostContextKeyVirtualKey, projectID)
	bc.SetValue(ContextKeyLinkedCredential, link)
	return bc
}

// ── the fix ───────────────────────────────────────────────────────────────────

// TestLinkedCredentialSelectsTheNamedRow is the fix. Two credentials, one
// named, one key returned — and it is the named one.
func TestLinkedCredentialSelectsTheNamedRow(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{
		ProjectID: callerProject, ConfigID: "cred-b", Title: "personal-openai",
	})
	keys, err := a.GetKeysForProvider(ctx, schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1 (the model named ONE credential)", len(keys))
	}
	if got, want := keys[0].ID, "cred-b"; got != want {
		t.Errorf("key ID = %q, want %q", got, want)
	}
	if got, want := keys[0].Name, "personal-openai"; got != want {
		t.Errorf("key Name = %q, want %q", got, want)
	}
	if got, want := keys[0].Value.Val, "KEY-B"; got != want {
		t.Errorf("resolved secret = %q, want %q", got, want)
	}
}

// TestWithoutALinkEveryCredentialIsStillOffered is the control. It measures the
// defect: the SAME two credentials, with no link on the context, both reach
// bifrost/core, and core alone decides which one calls the provider.
//
// It is also the compatibility statement. A model row that names no credential
// must keep this behaviour, or the standalone seed would stop working.
func TestWithoutALinkEveryCredentialIsStillOffered(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	keys, err := a.GetKeysForProvider(ctxWithProject(callerProject), schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("got %d keys, want 2 (no link ⇒ the whole provider set)", len(keys))
	}
}

// TestLinkedCredentialSelectsByTitleWhenTheIDIsAbsent covers the link that
// names its credential by title alone. The stored link shape carries a title
// and no id, so this is the path a row takes when the resolver could not read
// the credential's id.
func TestLinkedCredentialSelectsByTitleWhenTheIDIsAbsent(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{Title: "team-openai"})
	keys, err := a.GetKeysForProvider(ctx, schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 || keys[0].Value.Val != "KEY-A" {
		t.Fatalf("got %d keys (%+v), want 1 holding KEY-A", len(keys), keys)
	}
}

// ── the failure direction ─────────────────────────────────────────────────────

// TestLinkedCredentialAbsentFailsClosed is the other direction the fix must
// prove. The model names a credential that is gone. The request must FAIL, and
// it must not quietly use the other credential of the same provider.
func TestLinkedCredentialAbsentFailsClosed(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{
		ProjectID: callerProject, ConfigID: "cred-deleted", Title: "deleted-openai",
	})
	keys, err := a.GetKeysForProvider(ctx, schemas.OpenAI)
	if err == nil {
		t.Fatalf("GetKeysForProvider succeeded with %d keys, want an error; "+
			"a substituted credential bills the wrong account", len(keys))
	}
	if !errors.Is(err, ErrLinkedCredentialNotFound) {
		t.Errorf("error = %v, want ErrLinkedCredentialNotFound", err)
	}
	if len(keys) != 0 {
		t.Fatalf("got %d keys with the error, want 0: %+v", len(keys), keys)
	}
	// The error must name the credential and must NOT carry secret material.
	for _, secret := range []string{"KEY-A", "KEY-B"} {
		if strings.Contains(err.Error(), secret) {
			t.Fatalf("the error carries secret material: %v", err)
		}
	}
	if !strings.Contains(err.Error(), "cred-deleted") {
		t.Errorf("the error does not name the missing credential: %v", err)
	}
}

// TestLinkedCredentialOfAnotherProjectFailsClosed covers a link whose owner
// project is not the one that holds the row. The id alone is not identity: two
// schemas can each hold a configuration row with the same id.
func TestLinkedCredentialOfAnotherProjectFailsClosed(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{
		ProjectID: otherProject, ConfigID: "cred-a", Title: "team-openai",
	})
	if _, err := a.GetKeysForProvider(ctx, schemas.OpenAI); !errors.Is(err, ErrLinkedCredentialNotFound) {
		t.Fatalf("error = %v, want ErrLinkedCredentialNotFound", err)
	}
}

// TestLinkedCredentialOfAnotherProviderFailsClosed covers a link that names a
// credential of a DIFFERENT provider than the one being resolved. Nothing of
// this provider matches it, so nothing may be returned.
func TestLinkedCredentialOfAnotherProviderFailsClosed(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{
		ProjectID: callerProject, ConfigID: "an-azure-credential",
	})
	if _, err := a.GetKeysForProvider(ctx, schemas.OpenAI); !errors.Is(err, ErrLinkedCredentialNotFound) {
		t.Fatalf("error = %v, want ErrLinkedCredentialNotFound", err)
	}
}

// TestEmptyLinkIsTreatedAsNoLink guards the boundary. A LinkedCredential that
// names nothing must not refuse every request: it is indistinguishable from a
// model row that links to nothing.
func TestEmptyLinkIsTreatedAsNoLink(t *testing.T) {
	a := newSharedAccount(t, &fakeDB{rows: twoOpenAIRows()}, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{ProjectID: callerProject})
	keys, err := a.GetKeysForProvider(ctx, schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 2 {
		t.Fatalf("got %d keys, want 2 (a link that names nothing is no link)", len(keys))
	}
}

// ── the shared scope ──────────────────────────────────────────────────────────

// TestLinkedSharedCredentialSelectsThePublishedRow covers a model of the
// caller's own project that names a credential the platform published.
func TestLinkedSharedCredentialSelectsThePublishedRow(t *testing.T) {
	db := &fakeDB{bySchema: map[string][][]any{
		callerProject: {openAIRow("own-1", "my-openai", "OWN-KEY", false)},
		publicProject: {openAIRow("pub-1", "platform-openai", "SHARED-KEY", true)},
	}}
	a := newSharedAccount(t, db, &fakeVault{})

	ctx := ctxWithLink(callerProject, LinkedCredential{
		ProjectID: publicProject, ConfigID: "pub-1", Title: "platform-openai",
	})
	keys, err := a.GetKeysForProvider(ctx, schemas.OpenAI)
	if err != nil {
		t.Fatalf("GetKeysForProvider: %v", err)
	}
	if len(keys) != 1 {
		t.Fatalf("got %d keys, want 1", len(keys))
	}
	if got, want := keys[0].Value.Val, "SHARED-KEY"; got != want {
		t.Errorf("resolved secret = %q, want %q (the published credential was named)", got, want)
	}
	if got, want := keys[0].ID, sharedKeyIDPrefix+"pub-1"; got != want {
		t.Errorf("key ID = %q, want %q", got, want)
	}
}

// ── the end-to-end proof ──────────────────────────────────────────────────────

// TestLinkedCredentialReachesTheNamedEndpoint is the behavioural proof. Nothing
// below the gateway is a fake except the database and the two upstreams: a real
// bifrost/core resolves the key and a real HTTP round trip happens.
//
// The project holds TWO credentials of one provider, pointing at TWO different
// servers with TWO different keys. The model names the second. The assertions
// are that the second server was called, with the second key, and that the
// first server was never called at all.
func TestLinkedCredentialReachesTheNamedEndpoint(t *testing.T) {
	first := newRecordingProvider(t)
	defer first.Close()
	second := newRecordingProvider(t)
	defer second.Close()

	acct, err := New(Config{
		DB: &fakeDB{rows: [][]any{
			vllmRow("cred-first", "first-vllm", "KEY-FIRST", first.URL, false),
			vllmRow("cred-second", "second-vllm", "KEY-SECOND", second.URL, false),
		}},
		Vault:           &fakeVault{},
		EgressAllowlist: []string{hostOf(t, first.URL), hostOf(t, second.URL)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	core, initErr := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         acct,
		InitialPoolSize: 1,
	})
	if initErr != nil {
		t.Fatalf("bifrost.Init: %v", initErr)
	}
	defer core.Shutdown()

	ctx := schemas.NewBifrostContext(ctxWithLink(callerProject, LinkedCredential{
		ProjectID: callerProject, ConfigID: "cred-second", Title: "second-vllm",
	}), schemas.NoDeadline)
	_, bErr := core.ChatCompletionRequest(ctx, &schemas.BifrostChatRequest{
		Provider: schemas.VLLM,
		Model:    "the-model",
		Input: []schemas.ChatMessage{{
			Role:    schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("hello")},
		}},
	})
	if bErr != nil {
		t.Fatalf("ChatCompletionRequest: %+v", bErr)
	}

	if got := second.calls(); got != 1 {
		t.Errorf("the NAMED endpoint was called %d times, want 1", got)
	}
	if got := first.calls(); got != 0 {
		t.Errorf("the endpoint the model did NOT name was called %d times, want 0", got)
	}
	if got, want := second.lastAuth(), "Bearer KEY-SECOND"; got != want {
		t.Errorf("upstream Authorization = %q, want %q", got, want)
	}
}

// TestAbsentLinkedCredentialStopsTheRequest is the failing direction of the
// test above, through the same real bifrost/core. The model names a credential
// that is not there. Neither upstream may be called.
func TestAbsentLinkedCredentialStopsTheRequest(t *testing.T) {
	first := newRecordingProvider(t)
	defer first.Close()
	second := newRecordingProvider(t)
	defer second.Close()

	acct, err := New(Config{
		DB: &fakeDB{rows: [][]any{
			vllmRow("cred-first", "first-vllm", "KEY-FIRST", first.URL, false),
			vllmRow("cred-second", "second-vllm", "KEY-SECOND", second.URL, false),
		}},
		Vault:           &fakeVault{},
		EgressAllowlist: []string{hostOf(t, first.URL), hostOf(t, second.URL)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}

	core, initErr := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         acct,
		InitialPoolSize: 1,
	})
	if initErr != nil {
		t.Fatalf("bifrost.Init: %v", initErr)
	}
	defer core.Shutdown()

	ctx := schemas.NewBifrostContext(ctxWithLink(callerProject, LinkedCredential{
		ProjectID: callerProject, ConfigID: "cred-deleted", Title: "deleted-vllm",
	}), schemas.NoDeadline)
	_, bErr := core.ChatCompletionRequest(ctx, &schemas.BifrostChatRequest{
		Provider: schemas.VLLM,
		Model:    "the-model",
		Input: []schemas.ChatMessage{{
			Role:    schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("hello")},
		}},
	})
	if bErr == nil {
		t.Fatal("the request succeeded with a credential that does not exist")
	}
	if got := first.calls() + second.calls(); got != 0 {
		t.Fatalf("an upstream was called %d times, want 0; "+
			"a missing credential must not fall back to another one", got)
	}
}

// ── the type table ────────────────────────────────────────────────────────────

// TestProviderForCredentialTypeIsTheInverseOfTheTable proves the model
// resolver and the credential loader read ONE table. A second copy would drift,
// and a drifted copy would send a model to a provider whose credentials this
// package never loads — a 100 % failure that no unit test of either half would
// see.
func TestProviderForCredentialTypeIsTheInverseOfTheTable(t *testing.T) {
	for provider, types := range providerConfigTypes {
		for _, typ := range types {
			got, ok := ProviderForCredentialType(typ)
			if !ok {
				t.Errorf("credential type %q maps to no provider, but the table lists it under %q", typ, provider)
				continue
			}
			if got != provider {
				t.Errorf("credential type %q maps to provider %q, want %q", typ, got, provider)
			}
		}
	}
	if _, ok := ProviderForCredentialType(""); ok {
		t.Error("the empty credential type must map to no provider")
	}
	if _, ok := ProviderForCredentialType("pgvector"); ok {
		t.Error("a non-provider configuration type must map to no provider")
	}
}

// TestEveryMappedProviderIsSupported proves every provider the table can name
// is one the account offers to bifrost. A provider outside supportedProviders
// would be resolved from a model link and then never constructed.
func TestEveryMappedProviderIsSupported(t *testing.T) {
	supported := make(map[schemas.ModelProvider]bool, len(supportedProviders))
	for _, p := range supportedProviders {
		supported[p] = true
	}
	for provider := range providerConfigTypes {
		if !supported[provider] {
			t.Errorf("provider %q is reachable from a credential type but is not in supportedProviders", provider)
		}
	}
}

// TestLinkedCredentialStringCarriesNoSecret pins the log and error rendering.
// The value goes into a log line an operator reads, so it must carry an
// identifier and a label only.
func TestLinkedCredentialStringCarriesNoSecret(t *testing.T) {
	link := LinkedCredential{ProjectID: "7", ConfigID: "cred-b", Title: "personal-openai"}
	got := link.String()
	if !strings.Contains(got, "cred-b") || !strings.Contains(got, "7") {
		t.Fatalf("String() = %q, want it to name the credential and its project", got)
	}
	blob, _ := json.Marshal(link)
	if strings.Contains(string(blob), "api_key") {
		t.Fatalf("LinkedCredential carries credential data: %s", blob)
	}
}
