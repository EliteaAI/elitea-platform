package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	v2skills "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
)

// GET /elitea_core/toolkits/prompt_lib/{projectID} is the toolkit TYPE
// catalogue: a map of toolkit type name -> settings JSON Schema. It is a
// different resource from GET /elitea_core/tools/prompt_lib/{projectID}, the
// INSTANCE list.
//
// Three independent sources agree on that split:
//
//	api/openapi/v2.yaml:6220-6239   listToolkits -> ToolkitTypeSchemas
//	                                (and listToolkitInstances for /tools/)
//	apps/elitea-web/src/shared/api/generated/toolkits/toolkits.ts:562
//	                                getListToolkitsUrl -> /elitea_core/toolkits/...
//	                                typed listToolkitsResponse200.data: ToolkitTypeSchemas
//	legacy elitea_core api/v2/toolkits.py -> get_toolkit_schemas / get_mcp_schemas
//	                                (api/v2/tools.py is the instance list)
//
// Until #129 both /toolkits/ registrations pointed at toolkitHandler.List, so
// the endpoint returned {"rows":[],"total":0} and ListTypeSchemas — a complete
// handler backed by a populated map — had no route anywhere in the binary. The
// MCP create screen filters the response for mcp-flavoured keys, found none in
// an instance envelope, and rendered "Still no local MCP available" forever.
//
// This is the route-level twin of the nil-gate class in #126/#115: a working
// handler that nothing reaches. router_nil_gate_test.go cannot see it, because
// there is no `cfg.X != nil` to inspect — the route is present, it just points
// at the wrong function.
func TestToolkitsRouteServesTheTypeCatalogueNotTheInstanceList(t *testing.T) {
	t.Setenv("AUTH_DEV_MODE", "true")
	// The gated branch's RequireProjectAccess needs a live pool; take the
	// un-gated branch so the response body is observable. The gated branch's
	// registration is covered by the source-level test below.
	t.Setenv("FEATURE_FLAG_TOOLKIT_PROJECT_ACCESS", "false")
	router := NewRouter(RouterConfig{SkillsRepo: struct{ v2skills.Repository }{}})

	response := httptest.NewRecorder()
	router.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/v2/elitea_core/toolkits/prompt_lib/1", nil))
	// ListTypeSchemas serves a package-level map and never touches the pool, so
	// 200 is reachable with no database. A 500 here means the route reached a
	// handler that did query — i.e. it is still pointing at List.
	if response.Code != http.StatusOK {
		t.Fatalf("GET /elitea_core/toolkits/prompt_lib/1 = %d, want 200 (a DB-independent handler): %s",
			response.Code, strings.TrimSpace(response.Body.String()))
	}

	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v (%s)", err, response.Body.String())
	}

	// The instance envelope must not be what came back. This is the assertion
	// that actually fails when the route points at List.
	if _, ok := body["rows"]; ok {
		t.Errorf("response carries the instance-list envelope %q, so /toolkits/ is still wired to List", response.Body.String())
	}

	// And the type catalogue must really be there — not merely "not rows".
	// A single type is enough to pin the shape; "github" is one of the eight
	// entries in toolkits.toolkitTypeSchemas.
	github, ok := body["github"].(map[string]any)
	if !ok {
		t.Fatalf("response has no \"github\" toolkit type: %s", response.Body.String())
	}
	if _, ok := github["properties"].(map[string]any); !ok {
		t.Errorf("the \"github\" entry is not a JSON-Schema-shaped settings descriptor: %v", github)
	}
}

// The instance list keeps its own route. Moving ListTypeSchemas onto /toolkits/
// must not be "fixed" by moving List off /tools/ as well: the web client calls
// both (toolkits.ts:562 and :764).
func TestToolsRouteStillServesTheToolkitInstanceList(t *testing.T) {
	t.Parallel()

	source := readRouterSource(t)
	if !regexp.MustCompile(`r\.Get\("/tools/prompt_lib/\{projectID\}", toolkitHandler\.List\)`).MatchString(source) {
		t.Error("no GET /tools/prompt_lib/{projectID} -> toolkitHandler.List registration remains in router.go")
	}
}

// A source-level guard so BOTH feature-flag branches are covered — the gated
// branch (the production default) cannot be exercised behaviourally without a
// database, and the two blocks are copy-pasted, so a fix applied to one and not
// the other is exactly the mistake to expect.
func TestEveryToolkitsRouteRegistrationNamesListTypeSchemas(t *testing.T) {
	t.Parallel()

	source := readRouterSource(t)
	registrations := regexp.MustCompile(`r\.Get\("/toolkits/prompt_lib/\{projectID\}", toolkitHandler\.(\w+)\)`).
		FindAllStringSubmatch(source, -1)

	// router.go registers the toolkit block twice: once behind
	// RequireProjectAccess, once un-gated.
	if len(registrations) != 2 {
		t.Fatalf("found %d GET /toolkits/prompt_lib/{projectID} registrations in router.go, want 2", len(registrations))
	}
	for _, registration := range registrations {
		if registration[1] != "ListTypeSchemas" {
			t.Errorf("%s routes the type catalogue at the wrong handler: got toolkitHandler.%s, want toolkitHandler.ListTypeSchemas",
				registration[0], registration[1])
		}
	}
}

func readRouterSource(t *testing.T) string {
	t.Helper()
	source, err := os.ReadFile("router.go")
	if err != nil {
		t.Fatalf("read router.go: %v", err)
	}
	return string(source)
}
