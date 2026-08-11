package currentcore

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type actorTokenIssuerStub struct {
	token   string
	actorID int64
	err     error
}

func (issuer *actorTokenIssuerStub) IssueToken(_ context.Context, actorID int64) (string, error) {
	issuer.actorID = actorID
	return issuer.token, issuer.err
}

func TestNextInputSuggestionResolverUsesExactActorAndProject(t *testing.T) {
	issuer := &actorTokenIssuerStub{token: "actor-pat"}
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodGet ||
			request.URL.Path != "/api/v2/elitea_core/next_input_suggestion_config/prompt_lib/7" ||
			request.Header.Get("Authorization") != "Bearer actor-pat" ||
			request.Header.Get("Accept") != "application/json" {
			t.Fatalf("unexpected policy request: %s %s headers=%v", request.Method, request.URL.Path, request.Header)
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`{"enabled":true,"min_response_chars":150,"timeout_seconds":15}`))
	}))
	defer server.Close()
	resolver, err := NewNextInputSuggestionResolver(server.URL, issuer, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	policy, err := resolver.ResolveNextInputSuggestionPolicy(context.Background(), 7, 11)
	if err != nil {
		t.Fatal(err)
	}
	if issuer.actorID != 11 || string(policy) != `{"enabled":true,"min_response_chars":150,"timeout_seconds":15}` {
		t.Fatalf("actor=%d policy=%s", issuer.actorID, policy)
	}
}

func TestNextInputSuggestionResolverFailsClosed(t *testing.T) {
	for name, test := range map[string]struct {
		issuer *actorTokenIssuerStub
		status int
		body   string
	}{
		"issuer failure": {issuer: &actorTokenIssuerStub{err: errors.New("unavailable")}, status: http.StatusOK, body: `{}`},
		"forbidden":      {issuer: &actorTokenIssuerStub{token: "actor-pat"}, status: http.StatusForbidden, body: `denied`},
		"unknown field":  {issuer: &actorTokenIssuerStub{token: "actor-pat"}, status: http.StatusOK, body: `{"enabled":true,"min_response_chars":150,"timeout_seconds":15,"extra":true}`},
		"invalid bounds": {issuer: &actorTokenIssuerStub{token: "actor-pat"}, status: http.StatusOK, body: `{"enabled":true,"min_response_chars":0,"timeout_seconds":15}`},
		"oversized":      {issuer: &actorTokenIssuerStub{token: "actor-pat"}, status: http.StatusOK, body: `{"enabled":true,"min_response_chars":150,"timeout_seconds":15,"padding":"` + strings.Repeat("x", maxNextInputSuggestionPolicyBytes) + `"}`},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
				writer.WriteHeader(test.status)
				_, _ = writer.Write([]byte(test.body))
			}))
			defer server.Close()
			resolver, err := NewNextInputSuggestionResolver(server.URL, test.issuer, server.Client())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := resolver.ResolveNextInputSuggestionPolicy(context.Background(), 7, 11); !errors.Is(err, ErrNextInputSuggestionPolicyUnavailable) {
				t.Fatalf("error=%v", err)
			}
		})
	}
}

func TestNextInputSuggestionResolverRejectsRedirects(t *testing.T) {
	destinationCalled := false
	destination := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		destinationCalled = true
	}))
	defer destination.Close()
	server := httptest.NewTLSServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, destination.URL, http.StatusFound)
	}))
	defer server.Close()
	resolver, err := NewNextInputSuggestionResolver(
		server.URL,
		&actorTokenIssuerStub{token: "actor-pat"},
		server.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.ResolveNextInputSuggestionPolicy(context.Background(), 7, 11); !errors.Is(err, ErrNextInputSuggestionPolicyUnavailable) {
		t.Fatalf("error=%v", err)
	}
	if destinationCalled {
		t.Fatal("redirect destination received the actor bearer token")
	}
}

func TestNextInputSuggestionResolverRejectsUnsafeOriginsAndTokens(t *testing.T) {
	client := &http.Client{Transport: http.DefaultTransport}
	issuer := &actorTokenIssuerStub{token: "actor-pat"}
	for _, raw := range []string{"http://current-main", "https://user@current-main", "https://current-main/path", " https://current-main"} {
		if _, err := NewNextInputSuggestionResolver(raw, issuer, client); err == nil {
			t.Fatalf("unsafe origin accepted: %q", raw)
		}
	}
	server := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("request made with invalid bearer token")
	}))
	defer server.Close()
	resolver, err := NewNextInputSuggestionResolver(
		server.URL,
		&actorTokenIssuerStub{token: "token\nsmuggled"},
		server.Client(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := resolver.ResolveNextInputSuggestionPolicy(context.Background(), 7, 11); !errors.Is(err, ErrNextInputSuggestionPolicyUnavailable) {
		t.Fatalf("error=%v", err)
	}
}

func TestPolicyJSONShapeIsStable(t *testing.T) {
	raw, err := json.Marshal(struct {
		Enabled          bool `json:"enabled"`
		MinResponseChars int  `json:"min_response_chars"`
		TimeoutSeconds   int  `json:"timeout_seconds"`
	}{true, 150, 15})
	if err != nil || string(raw) != `{"enabled":true,"min_response_chars":150,"timeout_seconds":15}` {
		t.Fatalf("policy=%s err=%v", raw, err)
	}
}
