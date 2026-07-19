package configurations_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
)

// setupConfigRouter creates a router that mounts the handler routes under the given base path.
// Because configurations.NewHandler requires a *pgxpool.Pool (no Repository interface),
// we can only test the pool-independent handlers (CheckConnection,
// BatchCheckConnections, SetDefaultModel, TTSVoices) without a live database.
//
// The following handlers call h.pool.Query() directly without a nil guard; passing nil
// causes a nil pointer dereference panic (not a graceful error return), so those tests are
// skipped — integration tests cover those paths:
//   - Available     (tertiary DB-discovery step at handler.go:95)
//   - ListModels    (handler.go:918)
//   - ListTypes     (handler.go:973)
//
// DB-backed endpoints (List, Get, Create, Update, Delete) are not tested here because
// they require a live or mock pgxpool.Pool; integration tests cover those paths.
func setupConfigRouter() *chi.Mux {
	// NewHandler panics if pool is nil only when it tries to use it.
	// For static handlers the pool is never accessed, so we can safely pass nil.
	h := handler.NewHandler(nil)
	r := chi.NewRouter()
	r.Mount("/api/v2", h.Routes())
	return r
}

// ---- Available ---------------------------------------------------------------

func TestAvailable_Success(t *testing.T) {
	t.Skip("Available handler calls h.pool.Query without nil guard; nil pool causes a panic — integration test required for full coverage")
}

func TestAvailable_ContainsRequiredFields(t *testing.T) {
	t.Skip("Available handler calls h.pool.Query without nil guard; nil pool causes a panic — integration test required for full coverage")
}

// ---- CheckConnection --------------------------------------------------------

func TestCheckConnection_Success(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/proj-1/openai", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if success, _ := result["success"].(bool); !success {
		t.Error("expected success=true in CheckConnection response")
	}
}

// ---- BatchCheckConnections --------------------------------------------------

func TestBatchCheckConnections_Empty(t *testing.T) {
	r := setupConfigRouter()

	body := bytes.NewBufferString(`[]`)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connections/proj-1", body)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var results []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&results); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected empty results, got %d items", len(results))
	}
}

func TestBatchCheckConnections_MultiplItems(t *testing.T) {
	r := setupConfigRouter()

	payload, _ := json.Marshal([]map[string]any{
		{"id": "cfg-1"},
		{"id": "cfg-2"},
	})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connections/proj-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var results []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&results); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}
	for _, res := range results {
		if success, _ := res["success"].(bool); !success {
			t.Errorf("expected success=true for item %v", res["id"])
		}
	}
}

// ---- ListModels -------------------------------------------------------------

func TestListModels_Success(t *testing.T) {
	t.Skip("ListModels handler calls h.pool.Query without nil guard; nil pool causes a panic — integration test required")
}

// ---- SetDefaultModel --------------------------------------------------------

func TestSetDefaultModel_Success(t *testing.T) {
	r := setupConfigRouter()

	payload, _ := json.Marshal(map[string]string{"model": "gpt-4", "section": "llm"})
	req := httptest.NewRequest(http.MethodPost, "/api/v2/models/proj-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
}

// ---- ListTypes --------------------------------------------------------------

func TestListTypes_Success(t *testing.T) {
	t.Skip("ListTypes handler calls h.pool.Query without nil guard; nil pool causes a panic — integration test required")
}

// ---- TTSVoices --------------------------------------------------------------

func TestTTSVoices_Success(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/tts_voices/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response body: %v", err)
	}
	if _, ok := body["voices"]; !ok {
		t.Error("expected 'voices' key in TTSVoices response")
	}
}

// ---- Content-Type header checks ---------------------------------------------

func TestContentTypeJSON(t *testing.T) {
	r := setupConfigRouter()

	// Only pool-independent endpoints are tested here.
	// Available (/available/), ListTypes (/types/), and ListModels (/models/) call
	// h.pool.Query() without a nil guard and will panic with a nil pool —
	// those are covered by integration tests.
	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v2/tts_voices/proj-1", ""},
		{http.MethodPost, "/api/v2/check_connection/proj-1/openai", ""},
		{http.MethodPost, "/api/v2/check_connections/proj-1", "[]"},
	}

	for _, ep := range endpoints {
		var b *bytes.Reader
		if ep.body != "" {
			b = bytes.NewReader([]byte(ep.body))
		} else {
			b = bytes.NewReader(nil)
		}
		req := httptest.NewRequest(ep.method, ep.path, b)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		ct := rec.Header().Get("Content-Type")
		if ct == "" {
			t.Errorf("%s %s: expected Content-Type header, got empty", ep.method, ep.path)
		}
	}
}
