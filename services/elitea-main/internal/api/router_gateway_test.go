package api_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api"
	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

func buildGatewayRouterConfig(t *testing.T, validator apimw.TokenValidator, resolver apimw.PersonalProjectResolver, proxy http.Handler) api.RouterConfig {
	t.Helper()
	return api.RouterConfig{
		AuthClient:             newTestAuthClient(t),
		AuthValidator:          validator,
		GatewayProxy:           proxy,
		GatewayProjectResolver: resolver,
	}
}

func TestGatewayProxy_NotMountedWhenNil(t *testing.T) {
	cfg := buildGatewayRouterConfig(t, nil, nil, nil)
	r := api.NewRouter(cfg)

	req := httptest.NewRequest(http.MethodGet, "/llm/v1/models", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404 when GatewayProxy is nil, got %d", rec.Code)
	}
}

func TestGatewayProxy_UnauthenticatedReturns401(t *testing.T) {
	proxy := &recordingHandler{}
	cfg := buildGatewayRouterConfig(t, nil, nil, proxy)
	r := api.NewRouter(cfg)

	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 for unauthenticated request, got %d", rec.Code)
	}
	if proxy.reached {
		t.Error("proxy must not be reached for unauthenticated requests")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q, want application/json (spec §2.5)", ct)
	}
	var body struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("response body is not valid JSON: %v (body: %s)", err, rec.Body.String())
	}
	if body.Error.Message == "" || body.Error.Type == "" || body.Error.Code == "" {
		t.Errorf("expected nested error{message,type,code} all populated, got %+v", body.Error)
	}
}

func TestGatewayProxy_AuthenticatedWithProjectContext(t *testing.T) {
	systemUser := auth.User{
		ID:       "100",
		Name:     ":system:project:42:",
		AuthType: "token",
	}
	validator := &stubTokenValidator{user: systemUser}
	resolver := &stubProjectResolver{id: 999}
	proxy := &recordingHandler{}

	cfg := buildGatewayRouterConfig(t, validator, resolver, proxy)
	r := api.NewRouter(cfg)

	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer test-token")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if !proxy.reached {
		t.Fatal("proxy was not reached for authenticated /llm request")
	}
	if proxy.project.ProjectID != 42 {
		t.Errorf("expected ProjectID 42, got %d", proxy.project.ProjectID)
	}
	if resolver.called {
		t.Error("resolver must not be consulted for system project-user names")
	}
}

// TestGatewayProxy_PersonalProjectFallback verifies that for a regular
// (non-system) user the Project middleware consults the
// DBPersonalProjectResolver and injects the returned id, mirroring
// TestLLMRoute_PersonalProjectFallback for the GatewayProxy mount.
func TestGatewayProxy_PersonalProjectFallback(t *testing.T) {
	regularUser := auth.User{
		ID:       "55",
		Name:     "alice@example.com",
		AuthType: "token",
	}
	validator := &stubTokenValidator{user: regularUser}
	resolver := &stubProjectResolver{id: 77}
	proxy := &recordingHandler{}

	cfg := buildGatewayRouterConfig(t, validator, resolver, proxy)
	r := api.NewRouter(cfg)

	req := httptest.NewRequest(http.MethodPost, "/llm/v1/chat/completions", nil)
	req.Header.Set("Authorization", "Bearer test-regular-token")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d (body: %s)", rec.Code, rec.Body.String())
	}
	if !proxy.reached {
		t.Fatal("proxy was not reached")
	}
	if !resolver.called {
		t.Error("personal project resolver should be called for non-system user")
	}
	if proxy.project.ProjectID != 77 {
		t.Errorf("expected ProjectID 77 in proxy context, got %d", proxy.project.ProjectID)
	}
}

func TestGatewayProxy_SubpathsReachProxy(t *testing.T) {
	user := auth.User{ID: "1", Name: ":system:project:5:"}
	validator := &stubTokenValidator{user: user}
	proxy := &recordingHandler{}

	cfg := buildGatewayRouterConfig(t, validator, nil, proxy)
	r := api.NewRouter(cfg)

	for _, path := range []string{"/llm/v1/models", "/llm/v1/chat/completions", "/llm/v1/embeddings", "/llm/v1/messages"} {
		proxy.reached = false
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("Authorization", "Bearer tok")
		rec := httptest.NewRecorder()
		r.ServeHTTP(rec, req)

		if !proxy.reached {
			t.Errorf("proxy not reached for path %s (status %d)", path, rec.Code)
		}
	}
}
