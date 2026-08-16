package admin

// Handler-level tests for `GET /admin/system_info/{mode}` and its ungated
// `/admin/system_info/prompt_lib` sibling (#219).
//
// The defect these guard against does not look broken. The handler used to
// answer 200 with a plausible plugin list — `elitea_core` and `auth` at version
// "2.0.0" — from a service that loads no plugins. Nothing in a status code, a
// log line or a type check reports that. Only an assertion on the BODY does, so
// these tests assert on the body.

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// systemInfoBody serves the handler once and returns its status and decoded body.
func systemInfoBody(t *testing.T) (int, map[string]any) {
	t.Helper()

	recorder := httptest.NewRecorder()
	NewHandler(nil).SystemInfo(recorder, httptest.NewRequest(http.MethodGet, "/admin/system_info/prompt_lib", nil))

	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatalf("the response is not a JSON object: %v (%q)", err, recorder.Body.String())
	}
	return recorder.Code, body
}

// TestSystemInfoReportsNoPluginInventory is the regression guard. This service
// loads no plugins, so it must not answer with a plugin list of any kind — not a
// fabricated one, and not an empty one either. An empty list says "this
// deployment runs no plugins", which is a different statement from "this
// platform has no plugin concept", and an operator cannot tell the two apart.
func TestSystemInfoReportsNoPluginInventory(t *testing.T) {
	status, body := systemInfoBody(t)

	if status != http.StatusNotImplemented {
		t.Errorf("status = %d, want %d", status, http.StatusNotImplemented)
	}
	if _, present := body["plugins"]; present {
		t.Errorf("the response still carries a plugin inventory: %v", body["plugins"])
	}
}

// TestSystemInfoReportsNoInventedVersion covers the other half of the same
// defect. The handler also invented a top-level `version` "2.0.0" and a `build`
// "elitea-main-go" that no client reads. A version string an operator can read
// off an admin screen must come from the build, not from a literal, so until
// this service has build-version plumbing it must report no version at all.
func TestSystemInfoReportsNoInventedVersion(t *testing.T) {
	_, body := systemInfoBody(t)

	for _, key := range []string{"version", "build", "go_version", "status"} {
		if value, present := body[key]; present {
			t.Errorf("the response still carries an invented %q field: %v", key, value)
		}
	}
}

// TestSystemInfoGivesAReason — a bare 501 tells an operator that the answer is
// missing but not why, which sends them to look for a broken deployment. The
// body must name the Pylon runtime source that has no equivalent here, and it
// must point at the document that decides that.
func TestSystemInfoGivesAReason(t *testing.T) {
	_, body := systemInfoBody(t)

	reason, ok := body["error"].(string)
	if !ok || reason == "" {
		t.Fatalf("the refusal carries no reason: %v", body)
	}
	if !strings.Contains(reason, "Pylon") {
		t.Errorf("the reason does not name the source that is unavailable: %q", reason)
	}
	if !strings.Contains(reason, "AGENTS.md") {
		t.Errorf("the reason does not point at the architecture boundary: %q", reason)
	}
}
