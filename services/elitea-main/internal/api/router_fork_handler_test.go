package api

import (
	"net/http"
	"reflect"
	"runtime"
	"strings"
	"testing"

	"github.com/go-chi/chi/v5"
)

// The fork route must reach the fork handler (#505).
//
// `POST /api/v2/elitea_core/fork/prompt_lib/{projectID}` was registered on
// `ExportImportPost`, so `eliteacore.Handler.Fork` was code with no caller and
// a fork ran the import. The route table lists BOTH patterns, and the snapshot
// in production_router_test.go lists both as well, so nothing that counted
// routes could see it. Only the handler behind the pattern shows it.
//
// The test walks the router that every deployment gets and reads the endpoint
// each pattern resolves to. `chi.Walk` hands back the whole chain when a route
// carries inline middleware, and `chi.ChainHandler.Endpoint` is the handler at
// the end of it.
func TestForkRouteReachesTheForkHandler(t *testing.T) {
	t.Parallel()

	for _, expected := range []struct {
		pattern string
		handler string
	}{
		{"/api/v2/elitea_core/fork/prompt_lib/{projectID}", "eliteacore.(*Handler).Fork"},
		{"/api/v2/elitea_core/import_wizard/prompt_lib/{projectID}", "eliteacore.(*Handler).ExportImportPost"},
		{"/api/v2/elitea_core/export_import/prompt_lib/{projectID}/{entityID}", "eliteacore.(*Handler).ExportImportPost"},
	} {
		name := routeEndpointName(t, http.MethodPost, expected.pattern)
		if !strings.Contains(name, expected.handler) {
			t.Errorf("POST %s is served by %s, want %s", expected.pattern, name, expected.handler)
		}
	}
}

// routeEndpointName returns the name of the function one route pattern ends at.
func routeEndpointName(t *testing.T, method, pattern string) string {
	t.Helper()
	router := NewRouter(RouterConfig{})

	var found http.Handler
	walk := func(walkedMethod string, route string, handler http.Handler, _ ...func(http.Handler) http.Handler) error {
		if walkedMethod == method && route == pattern {
			found = handler
		}
		return nil
	}
	if err := chi.Walk(router, walk); err != nil {
		t.Fatalf("walk router: %v", err)
	}
	if found == nil {
		t.Fatalf("%s %s is not registered at all", method, pattern)
	}
	if chained, ok := found.(*chi.ChainHandler); ok {
		found = chained.Endpoint
	}
	return runtime.FuncForPC(reflect.ValueOf(found).Pointer()).Name()
}
