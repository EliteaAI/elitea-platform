package tags_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
)

// mockRepo implements tags.Repository for testing.
type mockRepo struct {
	tags []handler.Tag
	err  error
}

func (m *mockRepo) List(_ context.Context, _ string) ([]handler.Tag, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.tags, nil
}

func setupTagsRouter(repo handler.Repository) *chi.Mux {
	r := chi.NewRouter()
	h := handler.NewHandler(repo)
	r.Route("/api/v2/projects/{projectID}/tags", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})
	return r
}

// ---- List -------------------------------------------------------------------

func TestTagList_Success(t *testing.T) {
	repo := &mockRepo{
		tags: []handler.Tag{
			{Name: "go", Count: 5},
			{Name: "python", Count: 3},
		},
	}
	r := setupTagsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/tags/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}

	items, ok := body["items"]
	if !ok {
		t.Fatal("expected 'items' key in response")
	}
	itemSlice, ok := items.([]any)
	if !ok {
		t.Fatalf("expected 'items' to be a slice, got %T", items)
	}
	if len(itemSlice) != 2 {
		t.Errorf("expected 2 tags, got %d", len(itemSlice))
	}
}

func TestTagList_Empty(t *testing.T) {
	repo := &mockRepo{tags: []handler.Tag{}}
	r := setupTagsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/tags/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	items, _ := body["items"].([]any)
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d", len(items))
	}
}

func TestTagList_RepoError(t *testing.T) {
	repo := &mockRepo{err: errors.New("database connection lost")}
	r := setupTagsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/tags/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Non-APIError → internal server error
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Create -----------------------------------------------------------------

func TestTagCreate_Success(t *testing.T) {
	repo := &mockRepo{}

	payload, _ := json.Marshal(handler.Tag{Name: "new-tag"})

	// Note: Create is not wired in Routes(), so we call the handler directly
	// by registering it manually in a test-only router.
	testRouter := chi.NewRouter()
	h := handler.NewHandler(repo)
	testRouter.Post("/tags", h.Create)

	req2 := httptest.NewRequest(http.MethodPost, "/tags", bytes.NewReader(payload))
	req2.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	testRouter.ServeHTTP(rec, req2)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var tag handler.Tag
	if err := json.NewDecoder(rec.Body).Decode(&tag); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if tag.Name != "new-tag" {
		t.Errorf("expected name 'new-tag', got %q", tag.Name)
	}
}

func TestTagCreate_InvalidBody(t *testing.T) {
	repo := &mockRepo{}
	h := handler.NewHandler(repo)
	testRouter := chi.NewRouter()
	testRouter.Post("/tags", h.Create)

	req := httptest.NewRequest(http.MethodPost, "/tags", bytes.NewReader([]byte("not json{")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	testRouter.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Delete -----------------------------------------------------------------

func TestTagDelete_Success(t *testing.T) {
	repo := &mockRepo{}
	h := handler.NewHandler(repo)
	testRouter := chi.NewRouter()
	testRouter.Delete("/tags/{tagName}", h.Delete)

	req := httptest.NewRequest(http.MethodDelete, "/tags/my-tag", nil)
	rec := httptest.NewRecorder()
	testRouter.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Content-Type -----------------------------------------------------------

func TestTagList_ContentTypeJSON(t *testing.T) {
	repo := &mockRepo{tags: []handler.Tag{}}
	r := setupTagsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/tags/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct == "" {
		t.Error("expected Content-Type header")
	}
}
