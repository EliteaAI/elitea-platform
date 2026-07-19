package middleware

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestOtelMiddleware_SetsStatusCode(t *testing.T) {
	handler := OtelMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusCreated)
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", rec.Code)
	}
}

func TestOtelMiddleware_DefaultStatus200(t *testing.T) {
	handler := OtelMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("ok"))
	}))

	req := httptest.NewRequest("GET", "/test", nil)
	rec := httptest.NewRecorder()

	handler.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rec.Code)
	}
}

func TestMatchedRoutePatternUsesRegisteredPatternNotRequestIdentifiers(t *testing.T) {
	var observed string
	router := chi.NewRouter()
	router.Use(OtelMiddleware)
	router.Get("/api/v2/executions/{projectID}/{executionID}/events", func(w http.ResponseWriter, r *http.Request) {
		observed = matchedRoutePattern(r)
		w.WriteHeader(http.StatusNoContent)
	})

	rawPath := "/api/v2/executions/tenant-secret-42/execution-secret-99/events"
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, rawPath, nil))

	want := "/api/v2/executions/{projectID}/{executionID}/events"
	if observed != want {
		t.Fatalf("route pattern = %q, want %q", observed, want)
	}
	if observed == rawPath {
		t.Fatal("route pattern retained request identifiers")
	}
}

func TestMatchedRoutePatternUsesBoundedUnmatchedFallback(t *testing.T) {
	request := httptest.NewRequest(http.MethodGet, "/"+strings.Repeat("a", 4096), nil)
	if got := matchedRoutePattern(request); got != unmatchedRoutePattern {
		t.Fatalf("route pattern = %q, want %q", got, unmatchedRoutePattern)
	}
}

func TestStatusRecorderKeepsFirstStatusCode(t *testing.T) {
	underlying := httptest.NewRecorder()
	recorder := &statusRecorder{ResponseWriter: underlying, status: http.StatusOK}
	recorder.WriteHeader(http.StatusCreated)
	recorder.WriteHeader(http.StatusInternalServerError)

	if recorder.status != http.StatusCreated || underlying.Code != http.StatusCreated {
		t.Fatalf("recorded status = %d, response status = %d", recorder.status, underlying.Code)
	}
}

func TestNormalizedHTTPMethodBoundsAttackerControlledValues(t *testing.T) {
	if got := normalizedHTTPMethod(http.MethodPost); got != http.MethodPost {
		t.Fatalf("known method = %q", got)
	}
	if got := normalizedHTTPMethod("ATTACKER-UNIQUE-METHOD-123"); got != "_OTHER" {
		t.Fatalf("unknown method = %q, want _OTHER", got)
	}
}
