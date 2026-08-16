package api

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"

	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
)

// The `admin/system_info` surface (#219), asserted on the ROUTER.
//
// A handler test alone cannot close this issue. This repository has a recurring
// class of handlers that answer well and are reached from nowhere, so the answer
// only matters once the route is shown to carry a request to it. These tests
// therefore drive the same router a deployment builds.
func newSystemInfoTestRouter(t *testing.T) chi.Router {
	t.Helper()
	return NewRouter(RouterConfig{
		SkillsRepo:    struct{ v2skills.Repository }{},
		AuthValidator: testTokenValidator{user: authenticatedTestUser()},
	})
}

// TestSystemInfoRoutesStayRegistered pins both routes. `prompt_lib` is a STATIC
// segment that chi matches ahead of the `{mode}` parameter, and it is the
// Help Center's ungated read. Losing either registration turns an explicit
// refusal into a 404, which reads as a broken deployment.
func TestSystemInfoRoutesStayRegistered(t *testing.T) {
	got := walkRoutes(t, newSystemInfoTestRouter(t))

	for _, required := range []string{
		"GET /api/v2/admin/system_info/prompt_lib",
		"GET /api/v2/admin/system_info/{mode}",
	} {
		if _, ok := got[required]; !ok {
			t.Errorf("%s is not registered", required)
		}
	}
}

// TestSystemInfoReportsNoFabricatedPluginsOverTheRouter is the regression guard
// for the defect itself, taken through the route an operator's browser uses.
//
// The caller is authenticated and holds no permissions, so the gated `{mode}`
// route answers 403 and the ungated `prompt_lib` route reaches the handler. The
// assertion is on the BODY, not on the status: a 200 whose body invents a plugin
// list is what this issue is about, and every status-only check passes against
// it.
func TestSystemInfoReportsNoFabricatedPluginsOverTheRouter(t *testing.T) {
	recorder := serveResponse(t, newSystemInfoTestRouter(t), http.MethodGet, "/api/v2/admin/system_info/prompt_lib")

	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d (body %q)", recorder.Code, http.StatusNotImplemented, recorder.Body.String())
	}

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("the response is not a JSON object: %v (%q)", err, recorder.Body.String())
	}
	if _, present := body["plugins"]; present {
		t.Errorf("the route still reports a plugin inventory: %v", body["plugins"])
	}
	if reason, _ := body["error"].(string); reason == "" {
		t.Errorf("the refusal carries no reason: %v", body)
	}
}

// TestSystemInfoAdministrationModeKeepsItsGate — `/system_info/{mode}` declares
// `["runtime.plugins"]` in pylon and the router gates it on that permission.
// Answering 501 from the handler must not become a reason to drop the gate: the
// refusal is a statement about this platform's architecture, and an unprivileged
// caller has no business learning it from an administration-mode route.
func TestSystemInfoAdministrationModeKeepsItsGate(t *testing.T) {
	status := serveStatus(t, newSystemInfoTestRouter(t), http.MethodGet, "/api/v2/admin/system_info/administration")

	switch status {
	case http.StatusForbidden:
		// The gate ran and refused, which is correct for a caller with no grants.
	case http.StatusNotImplemented:
		t.Error("GET /api/v2/admin/system_info/administration reached the handler for a caller with " +
			"no permissions; the route lost its runtime.plugins gate")
	case http.StatusNotFound:
		t.Error("GET /api/v2/admin/system_info/administration is not routed at all")
	default:
		t.Errorf("GET /api/v2/admin/system_info/administration status = %d, want 403", status)
	}
}
