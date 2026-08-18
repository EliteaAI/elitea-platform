package api

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
)

// Two registrations own POST /api/v2/configurations/configurations/{projectID}.
//
//   - router.go mounts the compatibility handler on /api/v2/configurations
//     inside the authenticated /api/v2 group. Nothing gates that mount.
//   - production_router.go registers the reviewed mutation route on the same
//     full path, on the root router. cmd/elitea-main composes that route only
//     when ELITEA_CONFIGURATIONS_MUTATION_ENABLED is true.
//
// Issues #457 and #460 both ask which of the two answers, because a remedy has
// to land on the route that serves real traffic. This test answers it by
// running both compositions, not by reading the chi trie.
func TestConfigurationWriteRouteWinnerDependsOnTheMutationComposition(t *testing.T) {
	const path = "/api/v2/configurations/configurations/7"
	reviewed := http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusTeapot)
	})

	// 1. Both composed. The reviewed route wins, and it wins on every method
	// it registers. It also answers without the /api/v2 group's credential,
	// because it carries its own authentication.
	both := NewRouter(RouterConfig{CurrentConfigurationMutation: reviewed})
	for _, target := range []struct {
		method string
		path   string
	}{
		{method: http.MethodPost, path: path},
		{method: http.MethodPut, path: "/api/v2/configurations/configuration/7/11"},
		{method: http.MethodDelete, path: "/api/v2/configurations/configuration/7/11"},
	} {
		recorder := httptest.NewRecorder()
		both.ServeHTTP(recorder, httptest.NewRequest(target.method, target.path, nil))
		if recorder.Code != http.StatusTeapot {
			t.Fatalf("both composed: %s %s status=%d, want the reviewed route (%d)",
				target.method, target.path, recorder.Code, http.StatusTeapot)
		}
	}

	// 2. The composition every deployment file ships: the mutation flag is
	// off, so the reviewed route is not composed at all. The compatibility
	// mount is the only owner of the path. It sits inside the /api/v2 group,
	// so an unauthenticated request stops at that group's 401 — which proves
	// the path is served, and served by the mount, rather than absent.
	shipped := NewRouter(RouterConfig{})
	recorder := httptest.NewRecorder()
	shipped.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, path, nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("mutation route absent: POST %s status=%d, want %d from the compatibility mount",
			path, recorder.Code, http.StatusUnauthorized)
	}

	// 3. The compatibility mount is present in composition 1 as well; the
	// reviewed route did not replace it. Its {mode} variant is a path the
	// reviewed route never registers, so only the mount can serve it.
	recorder = httptest.NewRecorder()
	both.ServeHTTP(recorder, httptest.NewRequest(http.MethodPost, "/api/v2/configurations/configurations/default/7", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("both composed: POST the {mode} variant status=%d, want %d from the compatibility mount",
			recorder.Code, http.StatusUnauthorized)
	}

	// 4. Record the collision itself, so a later reader does not have to
	// rediscover it: the same method and path really are registered twice.
	registrations := 0
	if err := chi.Walk(both, func(method, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if method == http.MethodPost && route == "/api/v2/configurations/configurations/{projectID}" {
			registrations++
		}
		return nil
	}); err != nil {
		t.Fatalf("walk routes: %v", err)
	}
	if registrations != 2 {
		t.Fatalf("POST %s registrations = %d, want 2 (the compatibility mount and the reviewed route)",
			"/api/v2/configurations/configurations/{projectID}", registrations)
	}
}
