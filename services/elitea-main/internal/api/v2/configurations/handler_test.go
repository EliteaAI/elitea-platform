package configurations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/configurations"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type permissionResolverFunc func(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error)

func (f permissionResolverFunc) ResolvePermissions(
	ctx context.Context,
	principal auth.User,
	mode string,
	projectID string,
) (auth.PermissionResolution, error) {
	return f(ctx, principal, mode, projectID)
}

// setupConfigRouter creates a router that mounts the handler routes under the given base path.
// Because configurations.NewHandler requires a *pgxpool.Pool (no Repository interface),
// we can only test the pool-independent handlers (Available, CheckConnection,
// BatchCheckConnections, ListModels, SetDefaultModel, ListTypes, TTSVoices) and confirm
// that DB-backed handlers return a graceful response when the pool is nil (they recover
// internally via error checks and return empty results or 404).
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

func TestConfigurationCRUDRoutesRequireLegacyPermissions(t *testing.T) {
	resolver := permissionResolverFunc(func(
		_ context.Context,
		_ auth.User,
		mode string,
		projectID string,
	) (auth.PermissionResolution, error) {
		if mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("resolver called with mode=%q project=%q", mode, projectID)
		}
		return auth.PermissionResolution{UserID: 1, Permissions: []string{}}, nil
	})
	h := handler.NewHandler(nil, handler.WithPermissionResolver(resolver))
	router := chi.NewRouter()
	router.Mount("/api/v2/configurations", h.ProductionRoutes())

	for _, test := range []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v2/configurations/configurations/7"},
		{method: http.MethodPost, path: "/api/v2/configurations/configurations/7"},
		{method: http.MethodGet, path: "/api/v2/configurations/configuration/7/11"},
		{method: http.MethodPut, path: "/api/v2/configurations/configuration/7/11"},
		{method: http.MethodDelete, path: "/api/v2/configurations/configuration/7/11"},
	} {
		t.Run(test.method+" "+test.path, func(t *testing.T) {
			req := httptest.NewRequest(test.method, test.path, bytes.NewBufferString(`{}`))
			req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: "1"}))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
			}
		})
	}
}

func TestConfigurationCRUDRoutesUseExactLegacyPermissionNames(t *testing.T) {
	pool, err := pgxpool.New(context.Background(), "postgres://unused:unused@127.0.0.1:1/unused")
	if err != nil {
		t.Fatal(err)
	}
	pool.Close()

	for _, test := range []struct {
		method     string
		path       string
		permission string
	}{
		{method: http.MethodGet, path: "/api/v2/configurations/configurations/7", permission: "configurations.configurations.list"},
		{method: http.MethodPost, path: "/api/v2/configurations/configurations/7", permission: "configurations.configuration.create"},
		{method: http.MethodGet, path: "/api/v2/configurations/configuration/7/11", permission: "configurations.configuration.details"},
		{method: http.MethodPut, path: "/api/v2/configurations/configuration/7/11", permission: "configurations.configuration.update"},
		{method: http.MethodDelete, path: "/api/v2/configurations/configuration/7/11", permission: "configurations.configuration.delete"},
	} {
		t.Run(test.permission, func(t *testing.T) {
			resolver := permissionResolverFunc(func(
				_ context.Context,
				_ auth.User,
				_ string,
				_ string,
			) (auth.PermissionResolution, error) {
				return auth.PermissionResolution{UserID: 1, Permissions: []string{test.permission}}, nil
			})
			h := handler.NewHandler(pool, handler.WithPermissionResolver(resolver))
			router := chi.NewRouter()
			router.Mount("/api/v2/configurations", h.ProductionRoutes())

			req := httptest.NewRequest(test.method, test.path, bytes.NewBufferString(`{}`))
			req = req.WithContext(auth.ContextWithUser(req.Context(), auth.User{ID: "1"}))
			rec := httptest.NewRecorder()
			router.ServeHTTP(rec, req)
			if rec.Code == http.StatusForbidden {
				t.Fatalf("exact legacy permission %q did not pass its route gate", test.permission)
			}
		})
	}
}

// ---- Available ---------------------------------------------------------------

func TestAvailable_Success(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/available/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var types []handler.ConfigurationType
	if err := json.NewDecoder(rec.Body).Decode(&types); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(types) == 0 {
		t.Error("expected non-empty list of available configuration types")
	}

	// Verify well-known types are present.
	found := make(map[string]bool)
	for _, ct := range types {
		found[ct.Type] = true
	}
	for _, want := range []string{"openai", "anthropic", "chroma"} {
		if !found[want] {
			t.Errorf("expected type %q in available list", want)
		}
	}
}

func TestAvailable_ContainsRequiredFields(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/available/", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	var types []handler.ConfigurationType
	json.NewDecoder(rec.Body).Decode(&types)

	for _, ct := range types {
		if ct.Type == "" {
			t.Error("ConfigurationType.Type must not be empty")
		}
		if ct.DisplayName == "" {
			t.Errorf("ConfigurationType.DisplayName must not be empty for type %q", ct.Type)
		}
		if ct.Section == "" {
			t.Errorf("ConfigurationType.Section must not be empty for type %q", ct.Type)
		}
	}
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
	json.NewDecoder(rec.Body).Decode(&result)
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
	json.NewDecoder(rec.Body).Decode(&results)
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
	json.NewDecoder(rec.Body).Decode(&results)
	if len(results) != 2 {
		t.Errorf("expected 2 results, got %d", len(results))
	}
	for _, res := range results {
		if success, _ := res["success"].(bool); !success {
			t.Errorf("expected success=true for item %v", res["id"])
		}
	}
}

func TestBatchCheckConnectionsRejectsOversizedBody(t *testing.T) {
	router := setupConfigRouter()
	body := `[{"id":"` + strings.Repeat("x", (1<<20)+1) + `"}]`
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connections/7", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusRequestEntityTooLarge)
	}
}

func TestBatchCheckConnectionsRejectsTrailingJSON(t *testing.T) {
	router := setupConfigRouter()
	req := httptest.NewRequest(
		http.MethodPost,
		"/api/v2/check_connections/7",
		strings.NewReader(`[] {}`),
	)
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()

	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
}

// ---- ListModels -------------------------------------------------------------

func TestListModels_Success(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/models/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var body map[string]any
	json.NewDecoder(rec.Body).Decode(&body)
	if _, ok := body["items"]; !ok {
		t.Error("expected 'items' key in ListModels response")
	}
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
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/types/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}

	var types []handler.TypeDescriptor
	if err := json.NewDecoder(rec.Body).Decode(&types); err != nil {
		t.Fatalf("failed to decode type descriptors: %v", err)
	}
	if types == nil {
		t.Error("expected an empty JSON array, got null")
	}
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
	json.NewDecoder(rec.Body).Decode(&body)
	if _, ok := body["voices"]; !ok {
		t.Error("expected 'voices' key in TTSVoices response")
	}
}

// ---- Content-Type header checks ---------------------------------------------

func TestContentTypeJSON(t *testing.T) {
	r := setupConfigRouter()

	endpoints := []struct {
		method string
		path   string
		body   string
	}{
		{http.MethodGet, "/api/v2/available/", ""},
		{http.MethodGet, "/api/v2/types/proj-1", ""},
		{http.MethodGet, "/api/v2/tts_voices/proj-1", ""},
		{http.MethodGet, "/api/v2/models/proj-1", ""},
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
