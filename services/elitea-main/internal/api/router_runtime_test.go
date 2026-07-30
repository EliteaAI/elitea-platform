package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

func TestMountRuntimeRoutesRequiresCompletePair(t *testing.T) {
	called := 0
	handler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		called++
		w.WriteHeader(http.StatusNoContent)
	})

	incomplete := chi.NewRouter()
	mountRuntimeRoutes(incomplete, RuntimeRoutes{Validation: handler})
	response := httptest.NewRecorder()
	incomplete.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/configurations/validation/42/revision-1", nil))
	if response.Code != http.StatusNotFound || called != 0 {
		t.Fatalf("partial routes status=%d calls=%d", response.Code, called)
	}

	complete := chi.NewRouter()
	mountRuntimeRoutes(complete, RuntimeRoutes{Validation: handler, ExecutionEvents: handler})
	response = httptest.NewRecorder()
	complete.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/configurations/validation/42/revision-1", nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("validation route status = %d", response.Code)
	}
	response = httptest.NewRecorder()
	complete.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/executions/42/execution-1/events", nil))
	if response.Code != http.StatusNoContent || called != 2 {
		t.Fatalf("event route status=%d calls=%d", response.Code, called)
	}
}
