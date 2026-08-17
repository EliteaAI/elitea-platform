package configurations_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
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

// checkerCall records one invocation of fakeConnectionChecker.Check, so tests
// can assert not just the HTTP response but that a real round trip actually
// happened — the property #319 requires ("must FAIL if the implementation
// reports success without a provider round trip").
type checkerCall struct {
	configType string
	data       map[string]any
}

// fakeConnectionChecker is a test double for handler.ConnectionChecker. A
// handler bug that reports success without calling Check (the exact defect
// #319 fixes) is caught by asserting len(calls) rather than trusting the
// canned result field.
type fakeConnectionChecker struct {
	calls  []checkerCall
	result handler.ConnectionCheckResult
	err    error
}

func (f *fakeConnectionChecker) Check(_ context.Context, configType string, data map[string]any) (handler.ConnectionCheckResult, error) {
	f.calls = append(f.calls, checkerCall{configType: configType, data: data})
	return f.result, f.err
}

func setupConfigRouterWithChecker(checker handler.ConnectionChecker) *chi.Mux {
	h := handler.NewHandler(nil, handler.WithConnectionChecker(checker))
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

// availableEntry mirrors the wire shape of one /configurations/available/ row.
// It is deliberately declared here rather than reusing an exported handler
// type: the response contract is what the credential type picker parses
// (features/credentials/api/configurations.ts ConfigurationTypeDescriptor),
// and a test that decodes into the handler's own struct cannot notice a field
// being renamed on both sides at once.
type availableEntry struct {
	Type              string          `json:"type"`
	Section           string          `json:"section"`
	ConfigSchema      json.RawMessage `json:"config_schema"`
	HasTestConnection bool            `json:"has_test_connection"`
}

func decodeAvailable(t *testing.T, query string) []availableEntry {
	t.Helper()
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/available/"+query, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	var types []availableEntry
	if err := json.NewDecoder(rec.Body).Decode(&types); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	return types
}

// The route must serve the pinned registry snapshot, not the hardcoded
// eight-row list it used to (#131). The type names below are the snapshot's
// (`open_ai`), not the old list's (`openai`), so a regression to the hardcoded
// payload fails here rather than only in the browser.
func TestAvailableServesPinnedRegistrySnapshot(t *testing.T) {
	types := decodeAvailable(t, "")

	found := make(map[string]availableEntry, len(types))
	for _, ct := range types {
		found[ct.Type] = ct
	}
	for _, want := range []string{"open_ai", "azure_open_ai", "vertex_ai", "llm_model", "github"} {
		if _, ok := found[want]; !ok {
			t.Errorf("expected type %q in available list", want)
		}
	}
	// The old payload had eight static rows plus whatever the DB happened to
	// hold; the snapshot is a fixed 49.
	if len(types) != 49 {
		t.Errorf("expected the 49 pinned entries, got %d", len(types))
	}
	if got := found["open_ai"].Section; got != "ai_credentials" {
		t.Errorf("open_ai section = %q, want ai_credentials", got)
	}
	if !found["open_ai"].HasTestConnection {
		t.Error("open_ai must advertise has_test_connection; the form renders Test connection from it")
	}
}

// Every entry must carry a usable `config_schema`. Its absence is what crashed
// CredentialTypeSelector and made credential creation unreachable (#131).
func TestAvailableEntriesCarryConfigSchema(t *testing.T) {
	types := decodeAvailable(t, "")

	for _, ct := range types {
		if ct.Type == "" {
			t.Error("entry type must not be empty")
		}
		if ct.Section == "" {
			t.Errorf("entry section must not be empty for type %q", ct.Type)
		}
		var schema struct {
			Title      string                     `json:"title"`
			Properties map[string]json.RawMessage `json:"properties"`
		}
		if err := json.Unmarshal(ct.ConfigSchema, &schema); err != nil {
			t.Errorf("config_schema for %q is not a JSON object: %v", ct.Type, err)
			continue
		}
		if schema.Title == "" {
			t.Errorf("config_schema.title must not be empty for %q; it is the picker's tile label", ct.Type)
		}
		if _, ok := schema.Properties["data"]; !ok {
			t.Errorf("config_schema.properties.data missing for %q; the form is built from it", ct.Type)
		}
	}
}

func TestAvailableFiltersBySection(t *testing.T) {
	types := decodeAvailable(t, "?section=ai_credentials")

	if len(types) == 0 {
		t.Fatal("expected at least one ai_credentials entry")
	}
	for _, ct := range types {
		if ct.Section != "ai_credentials" {
			t.Errorf("type %q has section %q, want only ai_credentials", ct.Type, ct.Section)
		}
	}
	if len(types) == len(decodeAvailable(t, "")) {
		t.Error("section filter returned the whole catalog")
	}
}

// ---- CheckConnection --------------------------------------------------------

// TestCheckConnection_ReportsSuccessOnlyWhenCheckerCalled is the test #319
// requires: the handler must not be able to report success without actually
// invoking the connection checker (the real provider round trip). Before this
// fix, CheckConnection returned success:true unconditionally, ignoring the
// request body and never calling anything — that stub would fail this
// assertion (len(checker.calls) would stay 0).
func TestCheckConnection_ReportsSuccessOnlyWhenCheckerCalled(t *testing.T) {
	checker := &fakeConnectionChecker{
		result: handler.ConnectionCheckResult{Success: true, Message: "Connection successful"},
	}
	r := setupConfigRouterWithChecker(checker)

	body := `{"api_base":"https://api.openai.com/v1","api_key":"sk-good"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/open_ai", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one checker call, got %d — success must come from a real round trip", len(checker.calls))
	}
	if checker.calls[0].configType != "open_ai" {
		t.Errorf("checker called with type %q, want open_ai", checker.calls[0].configType)
	}
	if apiBase, _ := checker.calls[0].data["api_base"].(string); apiBase != "https://api.openai.com/v1" {
		t.Errorf("checker called with api_base %q, want the request body's value", apiBase)
	}

	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if success, _ := result["success"].(bool); !success {
		t.Error("expected success=true in CheckConnection response")
	}
}

// TestCheckConnection_BadCredentialReportsFailure asserts the second half of
// #319's bar: a credential the provider rejects must surface as a failure.
// The browser (useCreateConfiguration.onTestConnection) keys its
// success/failure toast off the HTTP status, so this must be a non-2xx —
// matching legacy's check_connection.py contract exactly (400 with
// {"success":false,"message":...}).
func TestCheckConnection_BadCredentialReportsFailure(t *testing.T) {
	checker := &fakeConnectionChecker{
		result: handler.ConnectionCheckResult{Success: false, Message: "The provider rejected the credential."},
	}
	r := setupConfigRouterWithChecker(checker)

	body := `{"api_base":"https://api.openai.com/v1","api_key":"sk-bad"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/open_ai", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d; body: %s", rec.Code, rec.Body.String())
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one checker call, got %d", len(checker.calls))
	}

	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if success, _ := result["success"].(bool); success {
		t.Fatal("a credential the provider rejects must not report success")
	}
	if msg, _ := result["message"].(string); msg == "" {
		t.Error("expected a non-empty, safe failure message")
	}
}

// TestCheckConnection_CheckerTransportErrorNeverReportsSuccess proves a
// gateway-unreachable/transport failure never falls back to success — the
// exact "the routes exist, but always claim success" defect the issue
// describes must not resurface when the gateway itself is unreachable.
func TestCheckConnection_CheckerTransportErrorNeverReportsSuccess(t *testing.T) {
	checker := &fakeConnectionChecker{err: errors.New("gateway unreachable")}
	r := setupConfigRouterWithChecker(checker)

	body := `{"api_base":"https://api.openai.com/v1","api_key":"sk-x"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/open_ai", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("a transport-level checker error must never report HTTP 200 success, got body: %s", rec.Body.String())
	}
	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if success, _ := result["success"].(bool); success {
		t.Fatal("must not report success when the checker itself errors")
	}
}

// TestCheckConnection_NoCheckerConfiguredNeverReportsSuccess covers a Handler
// wired without WithConnectionChecker (e.g. LLM_GATEWAY_URL unset) — it must
// report an honest failure, not silently behave like the old stub.
func TestCheckConnection_NoCheckerConfiguredNeverReportsSuccess(t *testing.T) {
	r := setupConfigRouter() // no WithConnectionChecker

	body := `{"api_base":"https://api.openai.com/v1","api_key":"sk-x"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/open_ai", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("no checker configured must never report success, got 200: %s", rec.Body.String())
	}
}

// TestCheckConnection_UnknownTypeReturns404WithoutCallingChecker matches
// legacy's check_connection.py: a type absent from the registry entirely is
// a 404, and nothing is called to check it.
func TestCheckConnection_UnknownTypeReturns404WithoutCallingChecker(t *testing.T) {
	checker := &fakeConnectionChecker{result: handler.ConnectionCheckResult{Success: true}}
	r := setupConfigRouterWithChecker(checker)

	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/not_a_real_type", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rec.Code, rec.Body.String())
	}
	if len(checker.calls) != 0 {
		t.Fatalf("checker must not be called for an unknown type, got %d calls", len(checker.calls))
	}
}

// TestCheckConnection_KnownButUncheckableTypeReturns400WithoutCallingChecker
// covers every type this Go build still cannot really check (toolkit
// credential types, amazon_bedrock, vertex_ai, ...): it must report the
// honest "not supported yet" failure legacy's own registry fallback used —
// never the previous unconditional success.
func TestCheckConnection_KnownButUncheckableTypeReturns400WithoutCallingChecker(t *testing.T) {
	checker := &fakeConnectionChecker{result: handler.ConnectionCheckResult{Success: true}}
	r := setupConfigRouterWithChecker(checker)

	// "github" is a real pinned catalogue type (credentials section) but not
	// one of this build's checkable ai_credentials provider types.
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connection/1/github", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rec.Code, rec.Body.String())
	}
	if len(checker.calls) != 0 {
		t.Fatalf("checker must not be called for a not-yet-checkable type, got %d calls", len(checker.calls))
	}
	var result map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&result); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if success, _ := result["success"].(bool); success {
		t.Fatal("a not-yet-checkable type must never report success")
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
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(results) != 0 {
		t.Errorf("expected empty results, got %d items", len(results))
	}
}

// TestBatchCheckConnections_MixedItems proves per-item that (a) a checkable
// type reports success ONLY via a real checker call, and (b) an unknown type
// gets the legacy-parity unsupported:true flag WITHOUT any checker call —
// the batch equivalent of the single-check tests above.
func TestBatchCheckConnections_MixedItems(t *testing.T) {
	checker := &fakeConnectionChecker{
		result: handler.ConnectionCheckResult{Success: true, Message: "Connection successful"},
	}
	r := setupConfigRouterWithChecker(checker)

	payload, err := json.Marshal([]map[string]any{
		{"id": "cfg-1", "type": "open_ai", "data": map[string]any{"api_base": "https://api.openai.com/v1", "api_key": "sk-good"}},
		{"id": "cfg-2", "type": "not_a_real_type", "data": map[string]any{}},
	})
	if err != nil {
		t.Fatalf("failed to encode request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connections/proj-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}

	var results []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&results); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(results) != 2 {
		t.Fatalf("expected 2 results, got %d", len(results))
	}
	if success, _ := results[0]["success"].(bool); !success {
		t.Errorf("expected success=true for cfg-1 (checkable type + real checker success)")
	}
	if success, _ := results[1]["success"].(bool); success {
		t.Errorf("expected success=false for cfg-2 (unknown type)")
	}
	if unsupported, _ := results[1]["unsupported"].(bool); !unsupported {
		t.Errorf("expected unsupported=true for cfg-2 (unknown type), got %v", results[1])
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one checker call (cfg-1 only), got %d — success must come from a real round trip", len(checker.calls))
	}
}

// TestBatchCheckConnections_BadCredentialReportsFailure is the batch-path
// twin of TestCheckConnection_BadCredentialReportsFailure.
func TestBatchCheckConnections_BadCredentialReportsFailure(t *testing.T) {
	checker := &fakeConnectionChecker{
		result: handler.ConnectionCheckResult{Success: false, Message: "The provider rejected the credential."},
	}
	r := setupConfigRouterWithChecker(checker)

	payload, err := json.Marshal([]map[string]any{
		{"id": "cfg-1", "type": "open_ai", "data": map[string]any{"api_base": "https://api.openai.com/v1", "api_key": "sk-bad"}},
	})
	if err != nil {
		t.Fatalf("failed to encode request: %v", err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v2/check_connections/proj-1", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200 (batch is always 200), got %d", rec.Code)
	}
	var results []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&results); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if len(results) != 1 {
		t.Fatalf("expected 1 result, got %d", len(results))
	}
	if success, _ := results[0]["success"].(bool); success {
		t.Fatal("a credential the provider rejects must not report success")
	}
	if len(checker.calls) != 1 {
		t.Fatalf("expected exactly one checker call, got %d", len(checker.calls))
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
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	if _, ok := body["items"]; !ok {
		t.Error("expected 'items' key in ListModels response")
	}
}

// ---- SetDefaultModel --------------------------------------------------------

func TestSetDefaultModel_Success(t *testing.T) {
	r := setupConfigRouter()

	payload, err := json.Marshal(map[string]string{"model": "gpt-4", "section": "llm"})
	if err != nil {
		t.Fatalf("failed to encode request: %v", err)
	}
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
//
// Both directions of #466. The route answered 200 with `{"voices": []}` for
// every project and every model, and the test below asserted only that the
// `voices` key was present — so it passed on the defect. The route now reports
// the missing capability: this platform serves no audio route to any provider
// (#323), and no code path fills the `meta.voices` cache the reference reads.

// TestTTSVoicesReportsTheMissingCapability — direction one. The refusal must
// carry a reason the caller can act on, not a bare status.
func TestTTSVoicesReportsTheMissingCapability(t *testing.T) {
	r := setupConfigRouter()

	for _, path := range []string{
		"/api/v2/tts_voices/proj-1",
		"/api/v2/tts_voices/default/proj-1",
	} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if rec.Code != http.StatusNotImplemented {
			t.Fatalf("%s: expected 501, got %d; body: %s", path, rec.Code, rec.Body.String())
		}

		var body map[string]any
		if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
			t.Fatalf("%s: failed to decode response: %v", path, err)
		}
		reason, _ := body["error"].(string)
		if reason == "" {
			t.Fatalf("%s: the refusal names no reason: %v", path, body)
		}
		if !strings.Contains(reason, "audio route") {
			t.Errorf("%s: the reason does not say why the voices are missing: %q", path, reason)
		}
	}
}

// TestTTSVoicesNeverAnswersAnEmptyVoiceList — direction two, and the guard.
//
// A caller cannot tell "this project has no voices" from "this route does no
// work" when both answers are 200 with an empty list. This fails if the stub
// comes back, whatever status it uses.
func TestTTSVoicesNeverAnswersAnEmptyVoiceList(t *testing.T) {
	r := setupConfigRouter()

	req := httptest.NewRequest(http.MethodGet, "/api/v2/tts_voices/proj-1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code == http.StatusOK {
		t.Fatalf("the route answers 200 again; body: %s", rec.Body.String())
	}

	var body map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&body); err != nil {
		t.Fatalf("failed to decode response: %v", err)
	}
	voices, present := body["voices"]
	if !present {
		return
	}
	list, isList := voices.([]any)
	if isList && len(list) == 0 {
		t.Error("the route offers an empty voice list again; a caller cannot tell that from a project with no voices")
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
