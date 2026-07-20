package api

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/shadow"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/cutover"
)

type productionRoutePolicy struct {
	access string
}

func TestProductionRouterMatchesReviewedRoutePolicy(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	want := map[string]productionRoutePolicy{
		"GET /healthz":  {access: "public health"},
		"GET /readyz":   {access: "public health"},
		"GET /startupz": {access: "public health"},
	}

	router := newCompleteProductionRouter("session-secret")
	got := make(map[string]struct{})
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method != "*" {
			got[method+" "+route] = struct{}{}
		}
		return nil
	}); err != nil {
		t.Fatal(err)
	}

	var missing, unexpected []string
	for route, policy := range want {
		if policy.access == "" {
			t.Fatalf("route %q has no access policy", route)
		}
		if _, ok := got[route]; !ok {
			missing = append(missing, route)
		}
	}
	for route := range got {
		if _, ok := want[route]; !ok {
			unexpected = append(unexpected, route)
		}
	}
	if len(missing) != 0 || len(unexpected) != 0 {
		sort.Strings(missing)
		sort.Strings(unexpected)
		t.Fatalf("production route policy mismatch\nmissing: %v\nunexpected: %v", missing, unexpected)
	}
}

func TestProductionRouterPreservesRawSocketPeer(t *testing.T) {
	router := NewRouter(RouterConfig{})
	router.Get("/__test/raw-peer", func(writer http.ResponseWriter, request *http.Request) {
		_, _ = writer.Write([]byte(request.RemoteAddr))
	})

	request := httptest.NewRequest(http.MethodGet, "/__test/raw-peer", nil)
	request.RemoteAddr = "10.20.30.40:43120"
	request.Header.Set("X-Forwarded-For", "198.51.100.25")
	request.Header.Set("X-Real-IP", "203.0.113.17")
	recorder := httptest.NewRecorder()

	router.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if got, want := recorder.Body.String(), request.RemoteAddr; got != want {
		t.Fatalf("RemoteAddr = %q, want raw socket peer %q", got, want)
	}
}

func TestProductionRouterLeavesUnreviewedPrototypeSurfacesUnmounted(t *testing.T) {
	// Even explicit development identity cannot make a source-only prototype
	// route appear in the production allowlist.
	t.Setenv("AUTH_DEV_MODE", "true")
	router := newCompleteProductionRouter("")

	for _, target := range []string{
		"/socket.io/",
		"/auth",
		"/forward-auth/auth",
		"/forward-auth/info",
		"/forward-auth/logout",
		"/forward-auth/auth_form/logout",
		"/forward-auth/auth_oidc/logout",
		"/forward-auth/auth_oidc/logout_callback",
		"/artifacts/s3/",
		"/admin/app/",
		"/app/application_icon/icon.svg",
		"/forward-auth/login",
		"/forward-auth/auth_form/login",
		"/forward-auth/auth_form/authorize",
		"/forward-auth/auth_oidc/login",
		"/forward-auth/auth_oidc/callback",
		"/forward-auth/auth_oidc/login_callback",
		"/api/v2/projects/7",
		"/api/v2/admin/auth_users/",
		"/api/v2/secrets/7",
		"/api/v2/elitea_core/mcp_oauth_proxy/7",
		"/api/v2/artifacts/7",
		"/api/v2/events/",
		"/api/v2/webhooks/7",
		"/api/v2/configurations/available/",
		"/api/v2/configurations/configurations/7",
		"/api/v2/configurations/configuration/7/11",
		"/api/v2/api/v2/configurations/configurations/7",
		"/api/v2/configurations/validation/7/revision-1",
		"/api/v2/executions/7/execution-1/events",
		"/internal/shadow/config",
		"/internal/cutover/",
		"/api/v2/auth/permissions/prompt_lib/7",
		"/api/v2/auth/token/",
		"/api/v2/auth/token/00000000-0000-0000-0000-000000000001",
	} {
		t.Run(target, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			router.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, target, nil))
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("GET %s status = %d, want %d", target, recorder.Code, http.StatusNotFound)
			}
		})
	}
}

func TestProductionAuthCandidatesRemainUnmountedForEveryCredentialShape(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	router := newCompleteProductionRouter("0123456789abcdef0123456789abcdef")
	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/api/v2/auth/permissions/prompt_lib/7"},
		{method: http.MethodGet, path: "/api/v2/auth/token/"},
		{method: http.MethodGet, path: "/api/v2/auth/token/00000000-0000-0000-0000-000000000001"},
		{method: http.MethodPost, path: "/api/v2/auth/token/"},
		{method: http.MethodDelete, path: "/api/v2/auth/token/00000000-0000-0000-0000-000000000001"},
	}

	for _, route := range routes {
		for _, credential := range []string{"missing", "invalid", "forwarded", "session"} {
			t.Run(route.method+" "+route.path+" "+credential, func(t *testing.T) {
				request := httptest.NewRequest(route.method, route.path, nil)
				switch credential {
				case "invalid":
					request.Header.Set("Authorization", "Bearer invalid")
				case "forwarded":
					request.Header.Set("X-Auth-Type", "user")
					request.Header.Set("X-Auth-Id", "1")
				case "session":
					request.AddCookie(&http.Cookie{Name: "elitea_session", Value: "forged.session"})
				}
				recorder := httptest.NewRecorder()
				router.ServeHTTP(recorder, request)
				if recorder.Code != http.StatusNotFound {
					t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
				}
			})
		}
	}
}

func TestProductionBrowserAuthSurfaceRemainsUnmountedForEffectiveMethods(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "false")
	router := newCompleteProductionRouter("0123456789abcdef0123456789abcdef")
	routes := []struct {
		method string
		path   string
	}{
		{method: http.MethodGet, path: "/forward-auth/auth"},
		{method: http.MethodHead, path: "/forward-auth/auth"},
		{method: http.MethodOptions, path: "/forward-auth/auth"},
		{method: http.MethodGet, path: "/forward-auth/login"},
		{method: http.MethodHead, path: "/forward-auth/login"},
		{method: http.MethodOptions, path: "/forward-auth/login"},
		{method: http.MethodGet, path: "/forward-auth/auth_form/login"},
		{method: http.MethodHead, path: "/forward-auth/auth_form/login"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/login"},
		{method: http.MethodPost, path: "/forward-auth/auth_form/authorize"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/authorize"},
		{method: http.MethodGet, path: "/forward-auth/logout"},
		{method: http.MethodHead, path: "/forward-auth/logout"},
		{method: http.MethodOptions, path: "/forward-auth/logout"},
		{method: http.MethodGet, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodHead, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodOptions, path: "/forward-auth/auth_form/logout"},
		{method: http.MethodGet, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodHead, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodOptions, path: "/forward-auth/auth_oidc/login"},
		{method: http.MethodGet, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodHead, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodPost, path: "/forward-auth/auth_oidc/login_callback"},
		{method: http.MethodOptions, path: "/forward-auth/auth_oidc/login_callback"},
	}

	for _, route := range routes {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			recorder := httptest.NewRecorder()
			request := httptest.NewRequest(route.method, route.path, nil)
			router.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotFound)
			}
		})
	}
}

func newCompleteProductionRouter(sessionSecret string) chi.Router {
	runtimeHandler := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		panic(fmt.Errorf("route coverage test must not execute runtime handler"))
	})
	return NewRouter(RouterConfig{
		SessionHandler: v2auth.NewSessionHandler(nil, sessionSecret),
		OIDCHandler:    &v2auth.OIDCHandler{},
		SessionSecret:  sessionSecret,
		Shadow:         shadow.NewComparator(shadow.Config{Timeout: time.Second}),
		ShadowMetrics:  shadow.NewMetrics(10),
		CutoverTracker: cutover.NewTracker(nil),
		CutoverRouter: cutover.NewRouter(cutover.RouterConfig{
			Tracker:   cutover.NewTracker(nil),
			LegacyURL: "http://127.0.0.1:1",
		}),
		InternalAdminToken: strings.Repeat("i", middleware.MinimumInternalAdminTokenBytes),
		RuntimeRoutes: RuntimeRoutes{
			Validation:      runtimeHandler,
			ExecutionEvents: runtimeHandler,
		},
	})
}
