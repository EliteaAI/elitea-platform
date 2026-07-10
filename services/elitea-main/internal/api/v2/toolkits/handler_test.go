package toolkits_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/toolkits"
)

// mockRepo implements toolkits.Repository for testing.
type mockRepo struct {
	types []string
	tools []toolkits.Tool
	valid bool
	tool  toolkits.Tool
	err   error
}

func (m *mockRepo) ListTypes(_ context.Context, _ string) ([]string, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.types, nil
}

func (m *mockRepo) AvailableTools(_ context.Context, _, _ string) ([]toolkits.Tool, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.tools, nil
}

func (m *mockRepo) DiscoverTools(_ context.Context, _, _ string) ([]toolkits.Tool, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.tools, nil
}

func (m *mockRepo) ValidateToolkit(_ context.Context, _, _ string) (bool, error) {
	if m.err != nil {
		return false, m.err
	}
	return m.valid, nil
}

func (m *mockRepo) ForkToolkit(_ context.Context, _ string, _ map[string]any) (toolkits.Tool, error) {
	if m.err != nil {
		return toolkits.Tool{}, m.err
	}
	return m.tool, nil
}

// setupRouter wires up a chi router with the given mock repo attached at the
// URL patterns matching router.go.
func setupRouter(repo toolkits.Repository) *chi.Mux {
	r := chi.NewRouter()
	h := toolkits.NewHandlerWithRepo(repo)
	r.Get("/toolkit_types/prompt_lib/{projectID}", h.ListTypes)
	r.Get("/toolkit_available_tools/prompt_lib/{projectID}/{toolkitID}", h.AvailableTools)
	r.Post("/toolkit_discover_tools/prompt_lib/{projectID}/{toolkitType}", h.DiscoverTools)
	r.Post("/toolkit_validator/prompt_lib/{projectID}/{toolkitID}", h.ValidateToolkit)
	r.Post("/fork_toolkit/prompt_lib/{projectID}", h.ForkToolkit)
	r.Post("/test_tool/prompt_lib/{projectID}/{toolID}", h.TestTool)
	r.Post("/test_toolkit_tool/prompt_lib/{projectID}", h.TestToolkitTool)
	r.Get("/index_types/prompt_lib/{projectID}", h.IndexTypes)
	return r
}

// --- ListTypes ---

func TestListTypes_Success(t *testing.T) {
	repo := &mockRepo{types: []string{"openai", "langchain", "custom"}}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/toolkit_types/prompt_lib/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	types, ok := resp["toolkit_types"].([]any)
	if !ok {
		t.Fatalf("expected toolkit_types array, got %T", resp["toolkit_types"])
	}
	if len(types) != 3 {
		t.Errorf("expected 3 types, got %d", len(types))
	}
	total := resp["total"].(float64)
	if int(total) != 3 {
		t.Errorf("expected total 3, got %v", total)
	}
}

func TestListTypes_DBError(t *testing.T) {
	repo := &mockRepo{err: errors.New("db error")}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/toolkit_types/prompt_lib/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Handler returns 200 with empty list on error
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	types, ok := resp["toolkit_types"].([]any)
	if !ok {
		t.Fatalf("expected toolkit_types array, got %T", resp["toolkit_types"])
	}
	if len(types) != 0 {
		t.Errorf("expected 0 types on error, got %d", len(types))
	}
	total := resp["total"].(float64)
	if int(total) != 0 {
		t.Errorf("expected total 0 on error, got %v", total)
	}
}

// --- AvailableTools ---

func TestAvailableTools_Success(t *testing.T) {
	repo := &mockRepo{
		tools: []toolkits.Tool{
			{ID: "tool-1", Name: "Tool One", Type: "openai"},
			{ID: "tool-2", Name: "Tool Two", Type: "langchain"},
		},
	}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/toolkit_available_tools/prompt_lib/proj-1/toolkit-abc", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	tools, ok := resp["tools"].([]any)
	if !ok {
		t.Fatalf("expected tools array, got %T", resp["tools"])
	}
	if len(tools) != 2 {
		t.Errorf("expected 2 tools, got %d", len(tools))
	}
	total := resp["total"].(float64)
	if int(total) != 2 {
		t.Errorf("expected total 2, got %v", total)
	}
}

func TestAvailableTools_Empty(t *testing.T) {
	repo := &mockRepo{tools: []toolkits.Tool{}}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/toolkit_available_tools/prompt_lib/proj-1/toolkit-none", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	tools, ok := resp["tools"].([]any)
	if !ok {
		t.Fatalf("expected tools array, got %T", resp["tools"])
	}
	if len(tools) != 0 {
		t.Errorf("expected 0 tools, got %d", len(tools))
	}
}

// --- DiscoverTools ---

func TestDiscoverTools_Success(t *testing.T) {
	repo := &mockRepo{
		tools: []toolkits.Tool{
			{ID: "tool-3", Name: "Discovered Tool", Type: "custom"},
		},
	}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/toolkit_discover_tools/prompt_lib/proj-1/custom", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	tools, ok := resp["tools"].([]any)
	if !ok {
		t.Fatalf("expected tools array, got %T", resp["tools"])
	}
	if len(tools) != 1 {
		t.Errorf("expected 1 tool, got %d", len(tools))
	}
	total := resp["total"].(float64)
	if int(total) != 1 {
		t.Errorf("expected total 1, got %v", total)
	}
}

func TestDiscoverTools_Empty(t *testing.T) {
	repo := &mockRepo{tools: []toolkits.Tool{}}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/toolkit_discover_tools/prompt_lib/proj-1/nonexistent", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	tools, ok := resp["tools"].([]any)
	if !ok {
		t.Fatalf("expected tools array, got %T", resp["tools"])
	}
	if len(tools) != 0 {
		t.Errorf("expected 0 tools, got %d", len(tools))
	}
}

// --- ValidateToolkit ---

func TestValidateToolkit_Valid(t *testing.T) {
	repo := &mockRepo{valid: true}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/toolkit_validator/prompt_lib/proj-1/toolkit-exists", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	valid, ok := resp["valid"].(bool)
	if !ok {
		t.Fatalf("expected valid bool, got %T", resp["valid"])
	}
	if !valid {
		t.Error("expected valid=true")
	}
}

func TestValidateToolkit_Invalid(t *testing.T) {
	repo := &mockRepo{valid: false}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/toolkit_validator/prompt_lib/proj-1/toolkit-missing", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	valid, ok := resp["valid"].(bool)
	if !ok {
		t.Fatalf("expected valid bool, got %T", resp["valid"])
	}
	if valid {
		t.Error("expected valid=false")
	}
}

func TestValidateToolkit_DBError(t *testing.T) {
	repo := &mockRepo{err: errors.New("connection reset")}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/toolkit_validator/prompt_lib/proj-1/toolkit-any", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	// Handler returns 200 with valid=false on error
	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	valid, ok := resp["valid"].(bool)
	if !ok {
		t.Fatalf("expected valid bool, got %T", resp["valid"])
	}
	if valid {
		t.Error("expected valid=false on error")
	}
}

// --- ForkToolkit ---

func TestForkToolkit_Success(t *testing.T) {
	forked := toolkits.Tool{ID: "forked-1", Name: "My Tool (copy)", Type: "openai"}
	repo := &mockRepo{tool: forked}
	r := setupRouter(repo)

	body, _ := json.Marshal(map[string]string{"source_id": "original-1"})
	req := httptest.NewRequest(http.MethodPost, "/fork_toolkit/prompt_lib/proj-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var tool toolkits.Tool
	json.NewDecoder(rec.Body).Decode(&tool)
	if tool.ID != "forked-1" {
		t.Errorf("expected ID forked-1, got %q", tool.ID)
	}
	if tool.Name != "My Tool (copy)" {
		t.Errorf("expected name 'My Tool (copy)', got %q", tool.Name)
	}
}

func TestForkToolkit_Error(t *testing.T) {
	repo := &mockRepo{err: errors.New("source not found")}
	r := setupRouter(repo)

	body, _ := json.Marshal(map[string]string{"source_id": "bad-id"})
	req := httptest.NewRequest(http.MethodPost, "/fork_toolkit/prompt_lib/proj-1", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	ok, exists := resp["ok"].(bool)
	if !exists || ok {
		t.Error("expected ok=false in error response")
	}
	if _, hasErr := resp["error"]; !hasErr {
		t.Error("expected error field in error response")
	}
}

// --- TestTool ---

func TestTestTool_NoTester_Returns503(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/test_tool/prompt_lib/proj-1/tool-99", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

// --- TestToolkitTool ---

func TestTestToolkitTool_NoTester_Returns503(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodPost, "/test_toolkit_tool/prompt_lib/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("expected 503, got %d", rec.Code)
	}
}

// --- IndexTypes ---

func TestIndexTypes_StaticResponse(t *testing.T) {
	repo := &mockRepo{}
	r := setupRouter(repo)

	req := httptest.NewRequest(http.MethodGet, "/index_types/prompt_lib/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var resp map[string]any
	json.NewDecoder(rec.Body).Decode(&resp)

	indexTypes, ok := resp["index_types"].([]any)
	if !ok {
		t.Fatalf("expected index_types array, got %T", resp["index_types"])
	}
	if len(indexTypes) != 3 {
		t.Errorf("expected 3 index types, got %d", len(indexTypes))
	}

	total := resp["total"].(float64)
	if int(total) != 3 {
		t.Errorf("expected total 3, got %v", total)
	}

	// Verify expected names are present
	expected := map[string]bool{"vector": false, "keyword": false, "hybrid": false}
	for _, item := range indexTypes {
		entry, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := entry["name"].(string); name != "" {
			expected[name] = true
		}
	}
	for name, found := range expected {
		if !found {
			t.Errorf("missing index type %q in response", name)
		}
	}
}
