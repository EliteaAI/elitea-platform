package skills_test

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

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// mockSkillRepo implements skills.Repository.
type mockSkillRepo struct {
	skills []handler.Skill
	err    error
}

func (m *mockSkillRepo) List(_ context.Context, _ string, page, pageSize int) (handler.ListResponse, error) {
	if m.err != nil {
		return handler.ListResponse{}, m.err
	}
	total := len(m.skills)
	totalPages := 1
	if pageSize > 0 && total > 0 {
		totalPages = (total + pageSize - 1) / pageSize
	}
	return handler.ListResponse{
		Items:      m.skills,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (m *mockSkillRepo) Get(_ context.Context, _, skillID string) (handler.Skill, error) {
	if m.err != nil {
		return handler.Skill{}, m.err
	}
	for _, s := range m.skills {
		if s.ID == skillID {
			return s, nil
		}
	}
	return handler.Skill{}, apierr.NotFound("skill not found")
}

func (m *mockSkillRepo) Create(_ context.Context, projectID string, skill handler.Skill) (handler.Skill, error) {
	if m.err != nil {
		return handler.Skill{}, m.err
	}
	skill.ID = "new-skill-id"
	skill.ProjectID = projectID
	skill.CreatedAt = time.Now()
	skill.UpdatedAt = time.Now()
	return skill, nil
}

func (m *mockSkillRepo) Update(_ context.Context, projectID, skillID string, skill handler.Skill) (handler.Skill, error) {
	if m.err != nil {
		return handler.Skill{}, m.err
	}
	skill.ID = skillID
	skill.ProjectID = projectID
	skill.UpdatedAt = time.Now()
	return skill, nil
}

func (m *mockSkillRepo) Delete(_ context.Context, _, _ string) error {
	return m.err
}

func setupSkillsRouter(repo handler.Repository) *chi.Mux {
	r := chi.NewRouter()
	h := handler.NewHandler(repo)
	r.Route("/api/v2/projects/{projectID}/skills", func(r chi.Router) {
		r.Mount("/", h.Routes())
	})
	return r
}

// ---- List -------------------------------------------------------------------

func TestSkillList_Success(t *testing.T) {
	repo := &mockSkillRepo{
		skills: []handler.Skill{
			{ID: "s-1", ProjectID: "proj-1", Name: "Skill A", Type: "tool"},
			{ID: "s-2", ProjectID: "proj-1", Name: "Skill B", Type: "tool"},
		},
	}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/?page=1&page_size=20", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp handler.ListResponse
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(resp.Items) != 2 {
		t.Errorf("expected 2 skills, got %d", len(resp.Items))
	}
	if resp.Total != 2 {
		t.Errorf("expected total=2, got %d", resp.Total)
	}
}

func TestSkillList_DefaultPagination(t *testing.T) {
	repo := &mockSkillRepo{skills: []handler.Skill{}}
	r := setupSkillsRouter(repo)

	// No page/page_size query params → defaults applied in handler (page=1, pageSize=20)
	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp handler.ListResponse
	_ = json.NewDecoder(rec.Body).Decode(&resp)
	if resp.Page != 1 {
		t.Errorf("expected default page=1, got %d", resp.Page)
	}
	if resp.PageSize != 20 {
		t.Errorf("expected default page_size=20, got %d", resp.PageSize)
	}
}

func TestSkillList_Error(t *testing.T) {
	repo := &mockSkillRepo{err: errors.New("db failure")}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Get --------------------------------------------------------------------

func TestSkillGet_Success(t *testing.T) {
	repo := &mockSkillRepo{
		skills: []handler.Skill{
			{ID: "s-1", ProjectID: "proj-1", Name: "Skill A", Type: "tool"},
		},
	}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/s-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var skill handler.Skill
	if err := json.NewDecoder(rec.Body).Decode(&skill); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if skill.ID != "s-1" {
		t.Errorf("expected ID 's-1', got %q", skill.ID)
	}
}

func TestSkillGet_NotFound(t *testing.T) {
	repo := &mockSkillRepo{skills: nil}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/nonexistent", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillGet_Error(t *testing.T) {
	repo := &mockSkillRepo{err: apierr.Internal("db error")}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/s-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Create -----------------------------------------------------------------

func TestSkillCreate_Success(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	payload, _ := json.Marshal(handler.Skill{Name: "New Skill", Type: "tool"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var skill handler.Skill
	if err := json.NewDecoder(rec.Body).Decode(&skill); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if skill.ID != "new-skill-id" {
		t.Errorf("expected ID 'new-skill-id', got %q", skill.ID)
	}
	if skill.Name != "New Skill" {
		t.Errorf("expected Name 'New Skill', got %q", skill.Name)
	}
}

func TestSkillCreate_InvalidBody(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillCreate_RepoError(t *testing.T) {
	repo := &mockSkillRepo{err: apierr.Internal("create failed")}
	r := setupSkillsRouter(repo)

	payload, _ := json.Marshal(handler.Skill{Name: "X", Type: "tool"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Update -----------------------------------------------------------------

func TestSkillUpdate_Success(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	payload, _ := json.Marshal(handler.Skill{Name: "Updated Skill", Type: "tool"})
	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/skills/s-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var skill handler.Skill
	if err := json.NewDecoder(rec.Body).Decode(&skill); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if skill.ID != "s-1" {
		t.Errorf("expected ID 's-1', got %q", skill.ID)
	}
	if skill.Name != "Updated Skill" {
		t.Errorf("expected updated name, got %q", skill.Name)
	}
}

func TestSkillUpdate_NotFound(t *testing.T) {
	repo := &mockSkillRepo{err: apierr.NotFound("skill not found")}
	r := setupSkillsRouter(repo)

	payload, _ := json.Marshal(handler.Skill{Name: "X", Type: "tool"})
	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/skills/missing", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillUpdate_InvalidBody(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodPut, "/api/v2/projects/proj-1/skills/s-1", bytes.NewReader([]byte("{bad")))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Delete -----------------------------------------------------------------

func TestSkillDelete_Success(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/skills/s-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillDelete_NotFound(t *testing.T) {
	repo := &mockSkillRepo{err: apierr.NotFound("skill not found")}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/skills/missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillDelete_Error(t *testing.T) {
	repo := &mockSkillRepo{err: apierr.Internal("db error")}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodDelete, "/api/v2/projects/proj-1/skills/s-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Content-Type -----------------------------------------------------------

func TestSkillHandlers_ContentTypeJSON(t *testing.T) {
	repo := &mockSkillRepo{skills: []handler.Skill{}}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	ct := rec.Header().Get("Content-Type")
	if ct == "" {
		t.Error("expected Content-Type header to be set")
	}
}
