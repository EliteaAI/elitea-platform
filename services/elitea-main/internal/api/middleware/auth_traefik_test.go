package middleware_test

// Traefik header-trust tests: verify that X-Auth-Type / X-Auth-Id are only
// accepted from sources whose RemoteAddr falls within a configured trusted-proxy
// CIDR, and are ignored (falling through to normal 401) from all other sources.

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/redis/go-redis/v9"
)

func newAuthClientForTraefikTest() *authsvc.Client {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	return authsvc.New(rdb)
}

// captureUserHandler writes 200 and stores the authenticated user in *got.
func captureUserHandler(t *testing.T, got *auth.User) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := auth.UserFromContext(r.Context())
		if !ok {
			t.Error("captureUserHandler: no user in context")
			return
		}
		*got = u
		w.WriteHeader(http.StatusOK)
	})
}

// TestAuth_TraefikHeaders_TrustedSource verifies that X-Auth-Type / X-Auth-Id
// headers are honoured when the request arrives from a CIDR-trusted source.
// httptest.NewRequest sets RemoteAddr = "192.0.2.1:1234" so we trust 192.0.2.0/24.
func TestAuth_TraefikHeaders_TrustedSource(t *testing.T) {
	var gotUser auth.User
	handler := middleware.Auth(middleware.AuthConfig{
		Client:            newAuthClientForTraefikTest(),
		TrustedProxyCIDRs: []string{"192.0.2.0/24"},
	})(captureUserHandler(t, &gotUser))

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("X-Auth-Type", "jwt")
	req.Header.Set("X-Auth-Id", "user-trusted")
	req.Header.Set("X-Auth-Reference", "trusted@example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("trusted source: status = %d, want 200", rec.Code)
	}
	if gotUser.ID != "user-trusted" {
		t.Errorf("trusted source: user.ID = %q, want user-trusted", gotUser.ID)
	}
	if gotUser.AuthType != "jwt" {
		t.Errorf("trusted source: user.AuthType = %q, want jwt", gotUser.AuthType)
	}
	if gotUser.Email != "trusted@example.com" {
		t.Errorf("trusted source: user.Email = %q, want trusted@example.com", gotUser.Email)
	}
}

// TestAuth_TraefikHeaders_UntrustedSource verifies that identical X-Auth-Type /
// X-Auth-Id headers from a source NOT in the trusted CIDR list are ignored.
// The middleware falls through to normal auth, which returns 401 without a valid
// Authorization header.
func TestAuth_TraefikHeaders_UntrustedSource(t *testing.T) {
	// 10.0.0.0/8 does NOT include 192.0.2.1 (httptest default RemoteAddr).
	called := false
	handler := middleware.Auth(middleware.AuthConfig{
		Client:            newAuthClientForTraefikTest(),
		TrustedProxyCIDRs: []string{"10.0.0.0/8"},
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("X-Auth-Type", "jwt")
	req.Header.Set("X-Auth-Id", "attacker-42")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("untrusted source: handler was called despite no valid auth; headers should have been ignored")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("untrusted source: status = %d, want 401", rec.Code)
	}
}

// TestAuth_TraefikHeaders_NoCIDRsConfigured verifies the safe-by-default
// behaviour: when TrustedProxyCIDRs is empty and TRUSTED_PROXY_CIDRS env var is
// not set, Traefik headers are never honoured regardless of source address.
func TestAuth_TraefikHeaders_NoCIDRsConfigured(t *testing.T) {
	// Explicitly do not set TrustedProxyCIDRs. The test process has no
	// TRUSTED_PROXY_CIDRS env var set (or if it is set, clear it for this test).
	t.Setenv("TRUSTED_PROXY_CIDRS", "")

	called := false
	handler := middleware.Auth(middleware.AuthConfig{
		Client: newAuthClientForTraefikTest(),
		// TrustedProxyCIDRs intentionally omitted.
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		called = true
		w.WriteHeader(http.StatusOK)
	}))

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("X-Auth-Type", "jwt")
	req.Header.Set("X-Auth-Id", "user-123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if called {
		t.Fatal("no CIDRs: handler was called; Traefik headers should be disabled")
	}
	if rec.Code != http.StatusUnauthorized {
		t.Errorf("no CIDRs: status = %d, want 401", rec.Code)
	}
}
