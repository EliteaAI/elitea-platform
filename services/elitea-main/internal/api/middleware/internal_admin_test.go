package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
)

func TestRequireInternalAdminToken(t *testing.T) {
	token := strings.Repeat("a", middleware.MinimumInternalAdminTokenBytes)
	handler := middleware.RequireInternalAdminToken(token)(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))

	for _, test := range []struct {
		name          string
		authorization string
		wantStatus    int
	}{
		{name: "missing", wantStatus: http.StatusUnauthorized},
		{name: "wrong scheme", authorization: "Basic " + token, wantStatus: http.StatusUnauthorized},
		{name: "wrong token", authorization: "Bearer " + strings.Repeat("b", len(token)), wantStatus: http.StatusUnauthorized},
		{name: "exact token", authorization: "Bearer " + token, wantStatus: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/", nil)
			if test.authorization != "" {
				req.Header.Set("Authorization", test.authorization)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", rec.Code, test.wantStatus)
			}
			if rec.Header().Get("Cache-Control") != "no-store" {
				t.Fatalf("Cache-Control = %q, want no-store", rec.Header().Get("Cache-Control"))
			}
		})
	}
}

func TestRequireInternalAdminTokenRejectsShortConfiguration(t *testing.T) {
	handler := middleware.RequireInternalAdminToken("short")(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		t.Fatal("handler should not run with a weak configured token")
	}))
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer short")
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusUnauthorized)
	}
}
