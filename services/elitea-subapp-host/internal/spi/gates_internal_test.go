package spi

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// What the identity gate leaves for the handler behind it: never the raw
// headers (a forged X-Elitea-Project-Id must not survive into anything that
// proxies or logs them), and the verified identity in the context — which is
// the only identity the runner receives.

func gateServer(t *testing.T, secret string) *Server {
	t.Helper()
	s, err := SettingsFromEnv("ELITEA_T_", func(key string) (string, bool) {
		if key == "ELITEA_T_IDENTITY_SECRET" && secret != "" {
			return secret, true
		}
		return "", false
	})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewServer(s, App{Name: "t", Version: "0", Descriptor: func(string) any { return nil },
		Toolkits: Toolkits{Families: []Family{{Name: "main", Aliases: []string{"T"}, Tools: []string{"t"}}}, Advertised: []string{"T"}},
		Runner:   EchoRunner{}}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return server
}

func TestIdentityGateStripsTheHeadersAndLeavesOnlyTheVerifiedIdentity(t *testing.T) {
	const secret = "shared"
	var leaked []string
	var seen Identity
	probe := gateServer(t, secret).identityGate(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		for _, name := range IdentityHeaders {
			if r.Header.Get(name) != "" {
				leaked = append(leaked, name)
			}
		}
		seen = IdentityFromContext(r.Context())
	}))
	r := httptest.NewRequest(http.MethodGet, "/slots", nil)
	SignHeaders(r.Header, Identity{ProjectID: "1", UserID: "7", TenantID: "acme", ExecutionID: "e"}, []byte(secret))
	probe.ServeHTTP(httptest.NewRecorder(), r)
	if len(leaked) != 0 {
		t.Fatalf("identity headers reached the handler: %v", leaked)
	}
	if seen != (Identity{ProjectID: "1", UserID: "7", TenantID: "acme", ExecutionID: "e"}) {
		t.Fatalf("identity in context %+v", seen)
	}

	// No shared secret: the headers are still stripped, and nothing is
	// derived from them — a forged id is dropped, not believed.
	leaked, seen = nil, Identity{}
	unverified := gateServer(t, "").identityGate(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		for _, name := range IdentityHeaders {
			if r.Header.Get(name) != "" {
				leaked = append(leaked, name)
			}
		}
		seen = IdentityFromContext(r.Context())
	}))
	r = httptest.NewRequest(http.MethodGet, "/slots", nil)
	r.Header.Set(HeaderProjectID, "999")
	unverified.ServeHTTP(httptest.NewRecorder(), r)
	if len(leaked) != 0 || seen != (Identity{}) {
		t.Fatalf("an unverified hop leaked %v and derived %+v", leaked, seen)
	}
}

type identityRunner struct{ got chan Identity }

func (identityRunner) Name() string { return "identity" }
func (r identityRunner) Invoke(_ context.Context, call Invoke, tc *Context) (map[string]any, error) {
	r.got <- call.Identity
	return Completed(tc.InvocationID()), nil
}

func TestTheRunnerReceivesTheVerifiedIdentityNotTheHeaders(t *testing.T) {
	const secret = "shared"
	runner := identityRunner{got: make(chan Identity, 1)}
	s, _ := SettingsFromEnv("ELITEA_T_", func(key string) (string, bool) {
		if key == "ELITEA_T_IDENTITY_SECRET" {
			return secret, true
		}
		return "", false
	})
	server, err := NewServer(s, App{Name: "t", Version: "0", Descriptor: func(string) any { return nil },
		Toolkits: Toolkits{Families: []Family{{Name: "main", Aliases: []string{"T"}, Tools: []string{"t"}}}, Advertised: []string{"T"}},
		Runner:   runner}, nil)
	if err != nil {
		t.Fatal(err)
	}
	server.Start(context.Background())
	defer server.Stop()
	r := httptest.NewRequest(http.MethodPost, "/tools/T/t/invoke", strings.NewReader(`{}`))
	r.Header.Set("Content-Type", "application/json")
	SignHeaders(r.Header, Identity{ProjectID: "42", UserID: "7"}, []byte(secret))
	w := httptest.NewRecorder()
	server.ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("invoke %d %s", w.Code, w.Body.String())
	}
	select {
	case got := <-runner.got:
		if got != (Identity{ProjectID: "42", UserID: "7"}) {
			t.Fatalf("runner saw %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the runner was never invoked")
	}
	// A forged header alongside the signed set: the signature no longer
	// matches, so — without mTLS — the whole set is dropped and the runner
	// sees an empty identity, not "42" and not "999".
	r2 := httptest.NewRequest(http.MethodPost, "/tools/T/t/invoke", strings.NewReader(`{}`))
	r2.Header.Set("Content-Type", "application/json")
	SignHeaders(r2.Header, Identity{ProjectID: "42", UserID: "7"}, []byte(secret))
	r2.Header.Set(HeaderProjectID, "999")
	server.ServeHTTP(httptest.NewRecorder(), r2)
	select {
	case got := <-runner.got:
		if got != (Identity{}) {
			t.Fatalf("a forged hop reached the runner as %+v", got)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("the runner was never invoked for the forged hop")
	}
}
