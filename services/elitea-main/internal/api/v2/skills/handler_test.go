package skills_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/predict"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

// mockSkillRepo implements skills.Repository.
type mockSkillRepo struct {
	skills []handler.Skill
	err    error

	// lastListParams records the ListParams passed to the most recent List
	// call so tests can assert query/sort_by/sort_order are actually wired
	// through from the HTTP layer.
	lastListParams handler.ListParams
}

func (m *mockSkillRepo) List(_ context.Context, _ string, params handler.ListParams) (handler.ListResponse, error) {
	m.lastListParams = params
	if m.err != nil {
		return handler.ListResponse{}, m.err
	}
	total := len(m.skills)
	totalPages := 1
	if params.PageSize > 0 && total > 0 {
		totalPages = (total + params.PageSize - 1) / params.PageSize
	}
	return handler.ListResponse{
		Items:      m.skills,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
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

func (m *mockSkillRepo) GetByName(_ context.Context, _, name string) (handler.Skill, bool, error) {
	if m.err != nil {
		return handler.Skill{}, false, m.err
	}
	for _, s := range m.skills {
		if s.Name == name {
			return s, true, nil
		}
	}
	return handler.Skill{}, false, nil
}

func (m *mockSkillRepo) Create(_ context.Context, projectID string, skill handler.Skill) (handler.Skill, error) {
	if m.err != nil {
		return handler.Skill{}, m.err
	}
	skill.ID = "new-skill-id"
	skill.ProjectID = projectID
	skill.CreatedAt = time.Now()
	skill.UpdatedAt = time.Now()
	m.skills = append(m.skills, skill)
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
		r.Post("/import", h.Import)
		r.Get("/export/{skillID}", h.Export)
	})
	return r
}

// mockPredictor implements skills.Predictor.
type mockPredictor struct {
	content string
	err     error
}

func (m *mockPredictor) Predict(_ context.Context, _ predict.Request) (predict.Response, error) {
	if m.err != nil {
		return predict.Response{}, m.err
	}
	return predict.Response{Content: m.content}, nil
}

func setupDraftRouter(predictor handler.Predictor) *chi.Mux {
	r := chi.NewRouter()
	h := handler.NewDraftHandler(predictor)
	r.Route("/api/v2/projects/{projectID}/generate_skill_draft", func(r chi.Router) {
		r.Post("/", h.GenerateDraft)
	})
	return r
}

func multipartFileBody(t *testing.T, filename, content string) (*bytes.Buffer, string) {
	t.Helper()
	buf := &bytes.Buffer{}
	w := multipart.NewWriter(buf)
	fw, err := w.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := fw.Write([]byte(content)); err != nil {
		t.Fatalf("write form file: %v", err)
	}
	if err := w.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	return buf, w.FormDataContentType()
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

// ---- Search / sort passthrough -----------------------------------------------

func TestSkillList_QueryAndSortPassthrough(t *testing.T) {
	repo := &mockSkillRepo{skills: []handler.Skill{}}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/?query=%20foo%20&sort_by=name&sort_order=asc", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if repo.lastListParams.Query != "foo" {
		t.Errorf("expected query 'foo' (trimmed), got %q", repo.lastListParams.Query)
	}
	if repo.lastListParams.SortBy != "name" {
		t.Errorf("expected sort_by 'name', got %q", repo.lastListParams.SortBy)
	}
	if repo.lastListParams.SortOrder != "asc" {
		t.Errorf("expected sort_order 'asc', got %q", repo.lastListParams.SortOrder)
	}
}

// ---- Instructions / tags on Create & Update ----------------------------------

func TestSkillCreate_VersionsShapePopulatesInstructionsAndTags(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	// Matches skillsApi.ts createSkill(): {name, description, versions: [{name, instructions, tags}]}.
	payload, _ := json.Marshal(map[string]any{
		"name":        "New Skill",
		"description": "desc",
		"versions": []map[string]any{
			{"name": "base", "instructions": "Be helpful", "tags": []string{"quality", "support"}},
		},
	})
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
	if skill.Instructions != "Be helpful" {
		t.Errorf("expected instructions from versions[0], got %q", skill.Instructions)
	}
	if len(skill.Tags) != 2 || skill.Tags[0] != "quality" || skill.Tags[1] != "support" {
		t.Errorf("expected tags from versions[0], got %v", skill.Tags)
	}
}

func TestSkillUpdate_FlatShapePopulatesInstructionsAndTags(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	// Matches skillsApi.ts updateSkill(): {name, description, instructions, tags} flat.
	payload, _ := json.Marshal(map[string]any{
		"name":         "Updated Skill",
		"description":  "desc",
		"instructions": "Stay on topic",
		"tags":         []string{"focus"},
	})
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
	if skill.Instructions != "Stay on topic" {
		t.Errorf("expected instructions 'Stay on topic', got %q", skill.Instructions)
	}
	if len(skill.Tags) != 1 || skill.Tags[0] != "focus" {
		t.Errorf("expected tags ['focus'], got %v", skill.Tags)
	}
}

// ---- Import -------------------------------------------------------------------

const validSkillMD = "---\nname: Code Reviewer\ndescription: Reviews code for bugs\ntags:\n  - quality\n  - review\n---\nAlways check for security issues."

func TestSkillImport_MultipartSuccess(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	body, contentType := multipartFileBody(t, "reviewer.md", validSkillMD)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var skill handler.Skill
	if err := json.NewDecoder(rec.Body).Decode(&skill); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if skill.Name != "Code Reviewer" || skill.Description != "Reviews code for bugs" {
		t.Errorf("unexpected skill: %+v", skill)
	}
	if skill.Instructions != "Always check for security issues." {
		t.Errorf("unexpected instructions: %q", skill.Instructions)
	}
	if len(skill.Tags) != 2 {
		t.Errorf("expected 2 tags, got %v", skill.Tags)
	}
}

func TestSkillImport_JSONBodySuccess(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	payload, _ := json.Marshal(map[string]string{"content": validSkillMD, "filename": "reviewer.md"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/import", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillImport_WrongExtension(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	body, contentType := multipartFileBody(t, "reviewer.txt", validSkillMD)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillImport_MissingFrontmatter(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	body, contentType := multipartFileBody(t, "reviewer.md", "just some text with no frontmatter")
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestSkillImport_DuplicateNameReusesAndNotices(t *testing.T) {
	repo := &mockSkillRepo{skills: []handler.Skill{
		{ID: "existing-1", Name: "Code Reviewer", Description: "old desc"},
	}}
	r := setupSkillsRouter(repo)

	body, contentType := multipartFileBody(t, "reviewer.md", validSkillMD)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/skills/import", body)
	req.Header.Set("Content-Type", contentType)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (reused, not created), got %d; body: %s", rec.Code, rec.Body.String())
	}

	var resp struct {
		ID     string `json:"id"`
		Notice string `json:"notice"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&resp); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if resp.ID != "existing-1" {
		t.Errorf("expected the existing skill to be reused, got id %q", resp.ID)
	}
	if resp.Notice == "" {
		t.Error("expected a notice explaining the skill was reused")
	}
}

// ---- Export -------------------------------------------------------------------

func TestSkillExport_Success(t *testing.T) {
	repo := &mockSkillRepo{skills: []handler.Skill{
		{
			ID: "s-1", Name: "Code Reviewer", Description: "Reviews code for bugs",
			Instructions: "Always check for security issues.", Tags: []string{"quality", "review"},
		},
	}}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/export/s-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); ct != "text/markdown" {
		t.Errorf("expected text/markdown content type, got %q", ct)
	}
	cd := rec.Header().Get("Content-Disposition")
	if cd == "" || !bytes.Contains([]byte(cd), []byte("Code Reviewer.md")) {
		t.Errorf("expected Content-Disposition with a Code Reviewer.md filename, got %q", cd)
	}

	body := rec.Body.String()
	if !bytes.Contains([]byte(body), []byte("name: Code Reviewer")) {
		t.Errorf("expected frontmatter with skill name, got: %s", body)
	}
	if !bytes.Contains([]byte(body), []byte("Always check for security issues.")) {
		t.Errorf("expected instructions in body, got: %s", body)
	}
}

func TestSkillExport_NotFound(t *testing.T) {
	repo := &mockSkillRepo{}
	r := setupSkillsRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/api/v2/projects/proj-1/skills/export/missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- Generate draft -------------------------------------------------------------

func TestGenerateSkillDraft_Success(t *testing.T) {
	predictor := &mockPredictor{content: `{"name":"Reviewer","description":"Reviews PRs","instructions":"Be thorough","tags":["quality"]}`}
	r := setupDraftRouter(predictor)

	payload, _ := json.Marshal(map[string]string{"user_description": "a skill that reviews pull requests"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/generate_skill_draft/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var draft handler.SkillDraft
	if err := json.NewDecoder(rec.Body).Decode(&draft); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if draft.Name != "Reviewer" || draft.Description != "Reviews PRs" || draft.Instructions != "Be thorough" {
		t.Errorf("unexpected draft: %+v", draft)
	}
	if len(draft.Tags) != 1 || draft.Tags[0] != "quality" {
		t.Errorf("unexpected tags: %v", draft.Tags)
	}
}

func TestGenerateSkillDraft_TolerantOfCodeFencedResponse(t *testing.T) {
	predictor := &mockPredictor{content: "```json\n{\"name\":\"X\",\"description\":\"Y\",\"instructions\":\"Z\",\"tags\":[]}\n```"}
	r := setupDraftRouter(predictor)

	payload, _ := json.Marshal(map[string]string{"user_description": "anything"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/generate_skill_draft/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGenerateSkillDraft_MissingUserDescription(t *testing.T) {
	r := setupDraftRouter(&mockPredictor{})

	payload, _ := json.Marshal(map[string]string{"user_description": "  "})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/generate_skill_draft/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGenerateSkillDraft_NotConfigured(t *testing.T) {
	r := setupDraftRouter(nil)

	payload, _ := json.Marshal(map[string]string{"user_description": "anything"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/generate_skill_draft/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

func TestGenerateSkillDraft_PredictorError(t *testing.T) {
	r := setupDraftRouter(&mockPredictor{err: errors.New("llm unavailable")})

	payload, _ := json.Marshal(map[string]string{"user_description": "anything"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/projects/proj-1/generate_skill_draft/", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d; body: %s", rec.Code, rec.Body.String())
	}
}
