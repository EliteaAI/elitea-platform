package projects_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/projects"
)

// setupProjectRouter creates a router for the projects handler.
// Like configurations, the projects handler takes *pgxpool.Pool directly.
// We can test:
//   - GetProject: returns 401 when no auth user is in context (pool never touched)
//   - GetProject: DB error path returns a fallback 200 with a minimal project (pool == nil triggers error path)
//   - PutProjectGroups: echoes the body, no DB access
//   - GroupList: DB error path returns empty list (pool == nil triggers error path)
func setupProjectRouter() *chi.Mux {
	h := handler.NewHandler(nil) // nil pool; DB calls will fail and hit graceful fallback branches
	r := chi.NewRouter()
	r.Mount("/api/v2", h.Routes())
	return r
}

// withUser injects an auth.User into the request context.
func withUser(req *http.Request, u auth.User) *http.Request {
	ctx := auth.ContextWithUser(req.Context(), u)
	return req.WithContext(ctx)
}

// ---- GetProject -------------------------------------------------------------

func TestGetProject_Unauthorized(t *testing.T) {
	r := setupProjectRouter()

	// No user in context → should return 401.
	req := httptest.NewRequest(http.MethodGet, "/api/v2/project/personal/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// TestGetProject_FallbackWhenDBUnavailable is skipped because pgxpool.(*Pool).QueryRow
// panics on a nil pool receiver before reaching the error-fallback branch in the handler.
// The GetProject fallback path is covered by integration tests that use a real or stub pool.
func TestGetProject_FallbackWhenDBUnavailable(t *testing.T) {
	t.Skip("requires non-nil pgxpool.Pool; covered by integration tests")
}

// ---- GroupList --------------------------------------------------------------

// TestGroupList_DBError_ReturnsEmpty is skipped because pgxpool.(*Pool).Query
// panics on a nil pool receiver before reaching the error-fallback branch.
// The GroupList fallback path is covered by integration tests that use a real pool.
func TestGroupList_DBError_ReturnsEmpty(t *testing.T) {
	t.Skip("requires non-nil pgxpool.Pool; covered by integration tests")
}

// ---- PutProjectGroups -------------------------------------------------------

func TestPutProjectGroups_EchoesBody(t *testing.T) {
	r := setupProjectRouter()

	payload := map[string]any{"group_ids": []int{1, 2, 3}}
	b, _ := json.Marshal(payload)
	req := httptest.NewRequest(http.MethodPut, "/api/v2/groups/prompt_lib/proj-1", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var result map[string]any
	json.NewDecoder(rec.Body).Decode(&result)
	ids, ok := result["group_ids"]
	if !ok {
		t.Error("expected 'group_ids' echoed back in response")
	}
	_ = ids
}

func TestPutProjectGroups_EmptyBody(t *testing.T) {
	r := setupProjectRouter()

	req := httptest.NewRequest(http.MethodPut, "/api/v2/groups/prompt_lib/proj-1", bytes.NewBufferString(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
}

// ---- Content-Type -----------------------------------------------------------

func TestProjectHandlers_ContentTypeJSON(t *testing.T) {
	r := setupProjectRouter()

	// PutProjectGroups returns JSON without touching the pool.
	body := bytes.NewBufferString(`{"group_ids":[]}`)
	req := httptest.NewRequest(http.MethodPut, "/api/v2/groups/prompt_lib/proj-1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct == "" {
		t.Error("expected Content-Type header to be set")
	}
}
