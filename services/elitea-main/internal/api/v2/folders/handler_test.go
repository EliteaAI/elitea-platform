package folders_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// mockFolderRepo implements folders.Repository.
type mockFolderRepo struct {
	folders []handler.Folder
	err     error
}

func (m *mockFolderRepo) List(_ context.Context, _ string) ([]handler.Folder, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.folders, nil
}

func (m *mockFolderRepo) Create(_ context.Context, projectID string, f handler.Folder) (handler.Folder, error) {
	if m.err != nil {
		return handler.Folder{}, m.err
	}
	f.ID = "new-folder-id"
	f.ProjectID = projectID
	f.CreatedAt = time.Now()
	f.UpdatedAt = time.Now()
	return f, nil
}

func (m *mockFolderRepo) Update(_ context.Context, projectID, folderID string, f handler.Folder) (handler.Folder, error) {
	if m.err != nil {
		return handler.Folder{}, m.err
	}
	f.ID = folderID
	f.ProjectID = projectID
	f.UpdatedAt = time.Now()
	return f, nil
}

func (m *mockFolderRepo) Delete(_ context.Context, _, _ string) error {
	return m.err
}

func setupFoldersRouter(repo handler.Repository) *chi.Mux {
	r := chi.NewRouter()
	h := handler.NewHandler(repo)
	r.Route("/api/v2/projects/{projectID}/folders", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})
	return r
}

// ---- List -------------------------------------------------------------------

func TestFolderList_Success(t *testing.T) {
	repo := &mockFolderRepo{
		folders: []handler.Folder{
			{ID: "f-1", ProjectID: "proj-1", Name: "Folder A"},
			{ID: "f-2", ProjectID: "proj-1", Name: "Folder B"},
		},
	}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/folders/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	items, ok := body["items"].([]any)
	if !ok {
		t.Fatal("expected 'items' key in response")
	}
	if len(items) != 2 {
		t.Errorf("expected 2 folders, got %d", len(items))
	}
}

func TestFolderList_Empty(t *testing.T) {
	repo := &mockFolderRepo{folders: []handler.Folder{}}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/folders/", nil)
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

func TestFolderList_Error(t *testing.T) {
	repo := &mockFolderRepo{err: errors.New("db failure")}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/folders/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Create -----------------------------------------------------------------

func TestFolderCreate_Success(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	payload, _ := json.Marshal(handler.Folder{Name: "New Folder"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/folders/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var folder handler.Folder
	if err := json.NewDecoder(rec.Body).Decode(&folder); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if folder.ID != "new-folder-id" {
		t.Errorf("expected ID 'new-folder-id', got %q", folder.ID)
	}
	if folder.Name != "New Folder" {
		t.Errorf("expected Name 'New Folder', got %q", folder.Name)
	}
}

func TestFolderCreate_InvalidBody(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/folders/", bytes.NewReader([]byte("bad json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestFolderCreate_RepoError(t *testing.T) {
	repo := &mockFolderRepo{err: apierr.Internal("create failed")}
	r := setupFoldersRouter(repo)

	payload, _ := json.Marshal(handler.Folder{Name: "X"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/folders/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Update (PUT) -----------------------------------------------------------

func TestFolderUpdate_Success(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	payload, _ := json.Marshal(handler.Folder{Name: "Renamed Folder"})
	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/folders/f-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var folder handler.Folder
	if err := json.NewDecoder(rec.Body).Decode(&folder); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if folder.ID != "f-1" {
		t.Errorf("expected ID 'f-1', got %q", folder.ID)
	}
	if folder.Name != "Renamed Folder" {
		t.Errorf("expected updated name, got %q", folder.Name)
	}
}

func TestFolderUpdate_NotFound(t *testing.T) {
	repo := &mockFolderRepo{err: apierr.NotFound("folder not found")}
	r := setupFoldersRouter(repo)

	payload, _ := json.Marshal(handler.Folder{Name: "X"})
	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/folders/f-missing", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestFolderUpdate_InvalidBody(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/folders/f-1", bytes.NewReader([]byte("{{invalid")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Update (PATCH) ---------------------------------------------------------

func TestFolderPatch_Success(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	payload, _ := json.Marshal(handler.Folder{Name: "Patched Folder"})
	req := httptest.NewRequest(http.MethodPatch, "/api/v2/projects/proj-1/folders/f-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Delete -----------------------------------------------------------------

func TestFolderDelete_Success(t *testing.T) {
	repo := &mockFolderRepo{}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/folders/f-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestFolderDelete_NotFound(t *testing.T) {
	repo := &mockFolderRepo{err: apierr.NotFound("folder not found")}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/folders/missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestFolderDelete_Error(t *testing.T) {
	repo := &mockFolderRepo{err: apierr.Internal("db error")}
	r := setupFoldersRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/folders/f-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}
