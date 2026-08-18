package account

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"

	bifrost "github.com/maximhq/bifrost/core"
	"github.com/maximhq/bifrost/core/schemas"
)

// TestSharedOnlyProjectCompletesChatCompletion is the behavioural proof for
// issue #316. Everything below the gateway is real: a real bifrost/core, the
// real EliteaAccount, and a real HTTP provider. Only the database and the
// provider itself are fakes.
//
// The calling project owns NO credential. The platform published one on the
// public project. The test asserts the completion succeeds AND that the
// upstream received the SHARED project's key — a status check alone would pass
// even if the wrong credential were used, so the Authorization header is the
// assertion that discriminates.
func TestSharedOnlyProjectCompletesChatCompletion(t *testing.T) {
	upstream := newRecordingProvider(t)
	defer upstream.Close()

	acct := newChatTestAccount(t, upstream.URL, map[string][][]any{
		callerProject: {}, // owns nothing at all
		publicProject: {vllmRow("pub-1", "platform-vllm", "SHARED-KEY", upstream.URL, true)},
	})

	core, err := bifrost.Init(context.Background(), schemas.BifrostConfig{
		Account:         acct,
		InitialPoolSize: 1,
	})
	if err != nil {
		t.Fatalf("bifrost.Init: %v", err)
	}
	defer core.Shutdown()

	// The virtual key is the CALLER's project — the project that owns nothing.
	ctx := schemas.NewBifrostContext(ctxWithProject(callerProject), schemas.NoDeadline)
	resp, bErr := core.ChatCompletionRequest(ctx, &schemas.BifrostChatRequest{
		Provider: schemas.VLLM,
		Model:    "platform-gpt",
		Input: []schemas.ChatMessage{{
			Role:    schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("hello")},
		}},
	})
	if bErr != nil {
		t.Fatalf("ChatCompletionRequest failed for a shared-only project: %+v", bErr)
	}
	if resp == nil || len(resp.Choices) == 0 {
		t.Fatalf("empty completion: %+v", resp)
	}

	// The provider was actually called, with the SHARED credential.
	if got := upstream.calls(); got != 1 {
		t.Fatalf("upstream called %d times, want 1", got)
	}
	if got, want := upstream.lastAuth(), "Bearer SHARED-KEY"; got != want {
		t.Errorf("upstream Authorization = %q, want %q "+
			"(the shared credential must be the one used)", got, want)
	}
}

// TestSharedOnlyProjectFailsWithoutTheSharedScope is the control for the test
// above. It is the same setup with the shared scope switched OFF — the state
// issue #316 describes. The call must NOT succeed, which is what proves the
// test above measures the fix rather than the harness.
func TestSharedOnlyProjectFailsWithoutTheSharedScope(t *testing.T) {
	upstream := newRecordingProvider(t)
	defer upstream.Close()

	// Same rows, but no PublicProjectID configured.
	acct, err := New(Config{
		DB: &fakeDB{bySchema: map[string][][]any{
			callerProject: {},
			publicProject: {vllmRow("pub-1", "platform-vllm", "SHARED-KEY", upstream.URL, true)},
		}},
		Vault:           &fakeVault{},
		EgressAllowlist: []string{hostOf(t, upstream.URL)},
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

	ctx := schemas.NewBifrostContext(ctxWithProject(callerProject), schemas.NoDeadline)
	_, bErr := core.ChatCompletionRequest(ctx, &schemas.BifrostChatRequest{
		Provider: schemas.VLLM,
		Model:    "platform-gpt",
		Input: []schemas.ChatMessage{{
			Role:    schemas.ChatMessageRoleUser,
			Content: &schemas.ChatMessageContent{ContentStr: schemas.Ptr("hello")},
		}},
	})
	if bErr == nil {
		t.Fatal("completion succeeded with the shared scope off; " +
			"the sibling test would then prove nothing")
	}
	if got := upstream.calls(); got != 0 {
		t.Errorf("upstream called %d times, want 0 (no credential should resolve)", got)
	}
}

// --- harness ---------------------------------------------------------------

// recordingProvider is an OpenAI-compatible upstream that records the
// Authorization header of each request, so a test can assert WHICH credential
// was used rather than merely that a call succeeded.
type recordingProvider struct {
	*httptest.Server
	mu   sync.Mutex
	n    int
	auth string
}

func newRecordingProvider(t *testing.T) *recordingProvider {
	t.Helper()
	p := &recordingProvider{}
	p.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p.mu.Lock()
		p.n++
		p.auth = r.Header.Get("Authorization")
		p.mu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(map[string]any{
			"id":      "chatcmpl-test",
			"object":  "chat.completion",
			"created": 0,
			"model":   "platform-gpt",
			"choices": []map[string]any{{
				"index":         0,
				"message":       map[string]any{"role": "assistant", "content": "hi"},
				"finish_reason": "stop",
			}},
			"usage": map[string]any{
				"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2,
			},
		})
	}))
	return p
}

func (p *recordingProvider) calls() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.n
}

func (p *recordingProvider) lastAuth() string {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.auth
}

// vllmRow builds a vllm ai_credentials row. The vllm class carries its endpoint
// on the key itself, which is what lets this test point a real provider at a
// local server.
func vllmRow(id, title, apiKey, apiBase string, shared bool) []any {
	data, _ := json.Marshal(map[string]string{"api_key": apiKey, "api_base": apiBase})
	return []any{id, title, data, shared}
}

// newChatTestAccount builds an account with the shared scope armed and an egress
// allowlist naming the local test provider. The allowlist is required because
// the self-hosted classes may only reach a private address when an operator has
// enumerated it (issue #13).
func newChatTestAccount(t *testing.T, upstreamURL string, rows map[string][][]any) *EliteaAccount {
	t.Helper()
	a, err := New(Config{
		DB:              &fakeDB{bySchema: rows},
		Vault:           &fakeVault{},
		PublicProjectID: publicProject,
		EgressAllowlist: []string{hostOf(t, upstreamURL)},
	})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return a
}

// hostOf returns the host:port of a URL for use as an egress allowlist entry.
func hostOf(t *testing.T, raw string) string {
	t.Helper()
	u, err := url.Parse(raw)
	if err != nil {
		t.Fatalf("parse %q: %v", raw, err)
	}
	return strings.ToLower(u.Host)
}

// vllmCredentialTypeIsMapped guards the assumption the two tests above rest on:
// the "vllm" configuration type must map to the VLLM provider, or they would
// silently resolve nothing and pass for the wrong reason.
func TestVLLMCredentialTypeIsMapped(t *testing.T) {
	types := providerConfigTypes[schemas.VLLM]
	found := false
	for _, ty := range types {
		if ty == "vllm" {
			found = true
		}
	}
	if !found {
		t.Fatalf("vllm config type not mapped to the VLLM provider: %v", types)
	}
}
