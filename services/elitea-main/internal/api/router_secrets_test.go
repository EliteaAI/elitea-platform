package api

import (
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"

	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
)

// secretsRoutes is the URL surface the secrets domain must expose, taken from
// the only client of it — apps/elitea-web/src/entities/secret/api/secretApi.ts
// (`secretsBasePath` / `secretPath` / `hidePath`, resolved against the
// `/api/v2` base in shared/api/http.ts). Three sibling prefixes, only one of
// which is "secrets".
var secretsRoutes = []struct {
	method string
	route  string
}{
	{http.MethodGet, "/api/v2/secrets/{mode}/{projectID}"},
	{http.MethodPost, "/api/v2/secrets/{mode}/{projectID}"},
	{http.MethodGet, "/api/v2/secret/{mode}/{projectID}/{name}"},
	{http.MethodPut, "/api/v2/secret/{mode}/{projectID}/{name}"},
	{http.MethodDelete, "/api/v2/secret/{mode}/{projectID}/{name}"},
	{http.MethodPost, "/api/v2/hide/{mode}/{projectID}/{name}"},
}

func walkRoutes(t *testing.T, router chi.Router) map[string]struct{} {
	t.Helper()
	got := make(map[string]struct{})
	if err := chi.Walk(router, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		got[method+" "+route] = struct{}{}
		return nil
	}); err != nil {
		t.Fatal(err)
	}
	return got
}

// serveStatus runs one request through the router and reports its status. A
// panic from a handler entered with a nil pool is reported as 500, the same
// answer apimw.Recover produces, so callers can treat it as "the route
// matched" without depending on which middleware stack is in front.
func serveStatus(t *testing.T, router chi.Router, method, path string) int {
	t.Helper()
	recorder := httptest.NewRecorder()
	code := http.StatusInternalServerError
	func() {
		defer func() {
			if recovered := recover(); recovered != nil {
				return
			}
			code = recorder.Code
		}()
		router.ServeHTTP(recorder, httptest.NewRequest(method, path, nil))
	}()
	return code
}

// TestRouterRegistersSecretsRoutesAtTheV2Root pins the fix for #137. The
// handler's patterns are absolute and span /secrets, /secret and /hide, so it
// is Register(r)ed onto the /api/v2 router; mounting it under "/secrets"
// prefixed all three and made every secrets call in the product 404
// (measured: GET /api/v2/secrets/prompt_lib/1 -> 404, while
// /api/v2/secrets/secrets/prompt_lib/1 -> 200).
func TestRouterRegistersSecretsRoutesAtTheV2Root(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")
	router := NewRouter(RouterConfig{SkillsRepo: struct{ v2skills.Repository }{}})

	got := walkRoutes(t, router)

	// Control: the walk really does report /api/v2 patterns in this shape, so
	// a "missing" verdict below cannot come from a mismatched control string.
	if _, ok := got["GET /api/v2/elitea_core/skills/{mode}/{projectID}"]; !ok {
		t.Fatalf("the prototype group is not walked in the expected shape; this test proves nothing")
	}

	for _, want := range secretsRoutes {
		key := want.method + " " + want.route
		if _, ok := got[key]; !ok {
			var registered []string
			for route := range got {
				if strings.Contains(route, "secret") || strings.Contains(route, "/hide/") {
					registered = append(registered, route)
				}
			}
			sort.Strings(registered)
			t.Errorf("route %q is not registered; secrets-ish routes present: %v", key, registered)
		}
	}
}

// TestRouterDoesNotDoubleMountSecrets is the other half: the defect shape
// itself must be absent. Re-mounting the handler under "/secrets" reintroduces
// the doubled segment, which this catches even if the correct routes were
// additionally registered alongside it.
func TestRouterDoesNotDoubleMountSecrets(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")
	router := NewRouter(RouterConfig{SkillsRepo: struct{ v2skills.Repository }{}})

	for route := range walkRoutes(t, router) {
		for _, doubled := range []string{"/secrets/secrets/", "/secrets/secret/", "/secrets/hide/"} {
			if strings.Contains(route, doubled) {
				t.Errorf("route %q carries the doubled prefix %q (#137)", route, doubled)
			}
		}
	}
}

// TestSecretsRoutesAnswerRequests proves the registration is reachable through
// the real router, not merely present in the route table: an unregistered
// sibling path 404s while every secrets path resolves to its handler. A nil
// pool makes the handlers panic once entered, which apimw.Recover turns into a
// 500 — a 500 is proof the route matched, and is what this asserts.
func TestSecretsRoutesAnswerRequests(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")
	router := NewRouter(RouterConfig{SkillsRepo: struct{ v2skills.Repository }{}})

	requests := []struct {
		method string
		path   string
	}{
		{http.MethodGet, "/api/v2/secrets/prompt_lib/1"},
		{http.MethodPost, "/api/v2/secrets/prompt_lib/1"},
		{http.MethodGet, "/api/v2/secret/prompt_lib/1/token"},
		{http.MethodPut, "/api/v2/secret/prompt_lib/1/token"},
		{http.MethodDelete, "/api/v2/secret/prompt_lib/1/token"},
		{http.MethodPost, "/api/v2/hide/prompt_lib/1/token"},
	}

	// Control: an unregistered path in the same namespace still 404s.
	if code := serveStatus(t, router, http.MethodGet, "/api/v2/secrets_not_a_route/prompt_lib/1"); code != http.StatusNotFound {
		t.Fatalf("an unregistered path answers %d, so the assertions below cannot detect a missing route", code)
	}

	for _, request := range requests {
		t.Run(request.method+" "+request.path, func(t *testing.T) {
			code := serveStatus(t, router, request.method, request.path)
			if code == http.StatusNotFound || code == http.StatusMethodNotAllowed {
				t.Errorf("status = %d: the path the client calls is not routed", code)
			}
		})
	}
}
