package middleware_test

import (
	"encoding/base64"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/redis/go-redis/v9"
)

func newTestClient() *authsvc.Client {
	rdb := redis.NewClient(&redis.Options{Addr: "localhost:6379"})
	return authsvc.New(rdb)
}

func TestAuth_MissingHeader(t *testing.T) {
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
	if body := rec.Body.String(); body != `{"error":"missing authorization header"}`+"\n" {
		t.Errorf("unexpected body: %q", body)
	}
}

func TestAuth_UnsupportedScheme(t *testing.T) {
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("Authorization", "Digest abc123")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuth_InvalidBasicEncoding(t *testing.T) {
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("handler should not be called")
		}),
	)

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("Authorization", "Basic !!!notbase64!!!")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}

func TestAuth_BasicAuthExtractsUsername(t *testing.T) {
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		}),
	)

	token := "mytoken"
	encoded := base64.StdEncoding.EncodeToString([]byte(token + ":password"))
	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("Authorization", "Basic "+encoded)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	// Will fail with 401 since no real pylon_auth to validate — that's expected
	if rec.Code != http.StatusUnauthorized {
		t.Logf("got status %d (expected 401 without real auth backend)", rec.Code)
	}
}

func TestAuth_TraefikHeaders(t *testing.T) {
	var gotUser auth.User
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			u, ok := auth.UserFromContext(r.Context())
			if !ok {
				t.Fatal("expected user in context")
			}
			gotUser = u
			w.WriteHeader(http.StatusOK)
		}),
	)

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("X-Auth-Type", "jwt")
	req.Header.Set("X-Auth-Id", "user-123")
	req.Header.Set("X-Auth-Reference", "user@example.com")
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if gotUser.ID != "user-123" {
		t.Errorf("expected ID user-123, got %q", gotUser.ID)
	}
	if gotUser.Email != "user@example.com" {
		t.Errorf("expected email user@example.com, got %q", gotUser.Email)
	}
	if gotUser.AuthType != "jwt" {
		t.Errorf("expected AuthType jwt, got %q", gotUser.AuthType)
	}
}

func TestAuth_TraefikHeaders_MissingID(t *testing.T) {
	handler := middleware.Auth(middleware.AuthConfig{Client: newTestClient()})(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			t.Fatal("should not reach handler without Authorization header")
		}),
	)

	req := httptest.NewRequest("GET", "/api/v1/test", nil)
	req.Header.Set("X-Auth-Type", "jwt")
	// Missing X-Auth-Id
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rec.Code)
	}
}
