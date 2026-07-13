package applications_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/applications"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type mockRepo struct {
	apps     []applications.Application
	versions []applications.Version
	err      error
}

func (m *mockRepo) List(_ context.Context, req applications.ListRequest) (applications.ListResponse, error) {
	if m.err != nil {
		return applications.ListResponse{}, m.err
	}
	return applications.ListResponse{
		Items:      m.apps,
		Total:      len(m.apps),
		Page:       req.Page,
		PageSize:   req.PageSize,
		TotalPages: 1,
	}, nil
}

func (m *mockRepo) Get(_ context.Context, _, _ string) (applications.Application, error) {
	if m.err != nil {
		return applications.Application{}, m.err
	}
	if len(m.apps) == 0 {
		return applications.Application{}, apierr.NotFound("application not found")
	}
	return m.apps[0], nil
}

func (m *mockRepo) Create(_ context.Context, req applications.CreateRequest) (applications.Application, error) {
	if m.err != nil {
		return applications.Application{}, m.err
	}
	return applications.Application{
		ID:        "new-id",
		ProjectID: req.ProjectID,
		Name:      req.Name,
		Type:      req.Type,
		Status:    "active",
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}, nil
}

func (m *mockRepo) Update(_ context.Context, req applications.UpdateRequest) (applications.Application, error) {
	if m.err != nil {
		return applications.Application{}, m.err
	}
	app := m.apps[0]
	if req.Name != nil {
		app.Name = *req.Name
	}
	return app, nil
}

func (m *mockRepo) Delete(_ context.Context, _, _ string) error {
	return m.err
}

func (m *mockRepo) GetVersion(_ context.Context, _, _, _ string) (applications.Version, error) {
	if m.err != nil {
		return applications.Version{}, m.err
	}
	if len(m.versions) == 0 {
		return applications.Version{}, apierr.NotFound("version not found")
	}
	return m.versions[0], nil
}

func (m *mockRepo) ListVersions(_ context.Context, _, _ string) ([]applications.Version, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.versions, nil
}

func (m *mockRepo) CreateVersion(_ context.Context, _, _ string, v applications.Version) (applications.Version, error) {
	if m.err != nil {
		return applications.Version{}, m.err
	}
	v.ID = "new-ver-id"
	return v, nil
}

func (m *mockRepo) UpdateVersion(_ context.Context, _, _, _ string, v applications.Version) (applications.Version, error) {
	if m.err != nil {
		return applications.Version{}, m.err
	}
	if len(m.versions) == 0 {
		return applications.Version{}, apierr.NotFound("version not found")
	}
	m.versions[0].Name = v.Name
	return m.versions[0], nil
}

func (m *mockRepo) DeleteVersion(_ context.Context, _, _, _ string) error {
	return m.err
}

func (m *mockRepo) SetDefaultVersion(_ context.Context, _, _, _ string) error {
	return m.err
}

func (m *mockRepo) BatchReplaceVersion(_ context.Context, _, _, _ string, _ bool) error {
	return m.err
}

func setupRouter(repo applications.Repository) *chi.Mux {
	r := chi.NewRouter()
	h := handler.NewHandler(repo)
	r.Route("/api/v2/projects/{projectID}/applications", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})
	return r
}

func TestList_Success(t *testing.T) {
	repo := &mockRepo{
		apps: []applications.Application{
			{ID: "app-1", Name: "Agent 1", Status: "active"},
			{ID: "app-2", Name: "Agent 2", Status: "active"},
		},
	}
	r := setupRouter(repo)

	req := httptest.NewRequest("GET", "/api/v2/projects/proj-1/applications?page=1&page_size=20", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp applications.ListResponse
	json.NewDecoder(rec.Body).Decode(&resp)
	if len(resp.Rows) != 2 {
		t.Errorf("expected 2 items, got %d", len(resp.Rows))
	}
	if resp.Total != 2 {
		t.Errorf("expected total 2, got %d", resp.Total)
	}
}

func TestGet_Success(t *testing.T) {
	repo := &mockRepo{
		apps: []applications.Application{
			{ID: "app-1", Name: "Agent 1", ProjectID: "proj-1"},
		},
	}
	r := setupRouter(repo)

	req := httptest.NewRequest("GET", "/api/v2/projects/proj-1/applications/app-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var app applications.Application
	json.NewDecoder(rec.Body).Decode(&app)
	if app.ID != "app-1" {
		t.Errorf("expected ID app-1, got %q", app.ID)
	}
}

func TestGet_NotFound(t *testing.T) {
	repo := &mockRepo{apps: nil}
	r := setupRouter(repo)

	req := httptest.NewRequest("GET", "/api/v2/projects/proj-1/applications/nonexistent", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rec.Code)
	}
}

func TestCreate_Success(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	body, _ := json.Marshal(map[string]string{"name": "New Agent", "type": "chat"})
	req := httptest.NewRequest("POST", "/api/v2/projects/proj-1/applications", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var app applications.Application
	json.NewDecoder(rec.Body).Decode(&app)
	if app.Name != "New Agent" {
		t.Errorf("expected name 'New Agent', got %q", app.Name)
	}
}

func TestCreate_InvalidBody(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	req := httptest.NewRequest("POST", "/api/v2/projects/proj-1/applications", bytes.NewReader([]byte("not json")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestDelete_Success(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	req := httptest.NewRequest("DELETE", "/api/v2/projects/proj-1/applications/app-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rec.Code)
	}
}

func TestUpdate_Success(t *testing.T) {
	name := "Updated Name"
	repo := &mockRepo{
		apps: []applications.Application{
			{ID: "app-1", Name: "Original", ProjectID: "proj-1"},
		},
	}
	r := setupRouter(repo)

	body, _ := json.Marshal(map[string]*string{"name": &name})
	req := httptest.NewRequest("PUT", "/api/v2/projects/proj-1/applications/app-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var app applications.Application
	json.NewDecoder(rec.Body).Decode(&app)
	if app.Name != "Updated Name" {
		t.Errorf("expected updated name, got %q", app.Name)
	}
}
