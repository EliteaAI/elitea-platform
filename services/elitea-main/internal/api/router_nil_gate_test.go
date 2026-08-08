package api_test

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// TestNilGatedRouterFieldsAreWiredOrDeclared is a source-level gate, not a
// behavioural test.
//
// router.go registers whole route groups behind `if cfg.X != nil`. When X is
// never populated, those routes are never registered and the API answers 404 —
// a 404 that is indistinguishable from a typo'd path, from a client bug, or from
// a route that was never specified. Nothing fails, nothing logs, and the gap can
// survive an entire replatform.
//
// It already has, three times independently:
//
//	AppsRepo   — a complete 425-line repository existed and nothing called its
//	             constructor. Agent creation 404'd in every deployment (#115).
//	ConvsRepo  — no implementation at all; 23 conversation/message routes absent
//	             (#123).
//	admin UI   — a different shape of the same class: the E2E image substitutes a
//	             placeholder for the real admin SPA, so those journeys could never
//	             have tested it (#122).
//
// Each was found by accident, late, by someone chasing an unrelated symptom.
// This test makes the fourth one fail immediately and by name.
//
// It deliberately reads the SOURCE rather than constructing a router: the defect
// is "this field is never assigned anywhere in the composition root", which is a
// property of the wiring, not of any runtime behaviour a unit test could observe.
func TestNilGatedRouterFieldsAreWiredOrDeclared(t *testing.T) {
	t.Parallel()

	// Fields that are nil-gated on purpose and are NOT expected to be wired in
	// the default composition root. Each needs a reason, and a reason that names
	// a tracking issue where the absence is a gap rather than a design choice.
	//
	// This is not a dumping ground: an entry here asserts "the routes behind this
	// field are knowingly absent". Adding one to silence the test, without
	// meaning it, reintroduces exactly the invisibility this guards against.
	declaredAbsent := map[string]string{
		"ConvsRepo":      "#123 — no conversations.Repository implementation exists; 23 routes absent",
		"SkillsRepo":     "#126 — no skills repository implementation; 12 routes absent",
		"FoldersRepo":    "#126 — no folders repository implementation; 6 routes absent",
		"TagsRepo":       "#126 — no tags repository implementation; 3 routes absent",
		"AnalyticsRepo":  "#126 — no analytics repository implementation; 7 routes absent",
		"ChatService":    "#126 — chat service not implemented in the Go stack",
		"Predictor":      "#126 — prediction/completion service not implemented in the Go stack",
		"PipelineRunner": "#126 — pipeline execution not implemented in the Go stack",
		"MCPSyncer":      "#126 — MCP syncer not implemented; 30 routes absent",
		"WebhookRepo":    "#126 — webhooks not implemented in the Go stack",
		"LLMProxy":       "optional by design: the LLM proxy is a separate deployment (services/elitea-llm-gateway)",
		"EventSource":    "optional by design: falls back to RedisClient, see router.go's else-if",
		"RedisClient":    "optional by design: the EventSource fallback",
		"Shadow":         "cutover machinery, enabled per-deployment",
		"ShadowMetrics":  "cutover machinery, enabled per-deployment",
		"CutoverRouter":  "cutover machinery, enabled per-deployment",
		"CutoverTracker": "cutover machinery, enabled per-deployment",
	}

	root := repoRootFrom(t)
	routerSrc := readFile(t, filepath.Join(root, "internal/api/router.go"))
	mainSrc := readFile(t, filepath.Join(root, "cmd/elitea-main/main.go"))

	gated := regexp.MustCompile(`cfg\.([A-Za-z][A-Za-z0-9]*) != nil`)
	seen := map[string]bool{}
	for _, m := range gated.FindAllStringSubmatch(routerSrc, -1) {
		seen[m[1]] = true
	}
	if len(seen) == 0 {
		t.Fatal("found no `cfg.X != nil` gates in router.go — this test's premise no longer holds; " +
			"either the pattern changed or the regex is wrong. Do not delete this test without replacing the guarantee.")
	}

	var unwired, staleAllowlist []string
	for field := range seen {
		// Assigned in the RouterConfig literal, e.g. "\tAppsRepo:  appsRepo,"
		assigned := regexp.MustCompile(`(?m)^\s*` + regexp.QuoteMeta(field) + `:\s`).MatchString(mainSrc)
		_, declared := declaredAbsent[field]

		switch {
		case assigned && declared:
			staleAllowlist = append(staleAllowlist, field)
		case !assigned && !declared:
			unwired = append(unwired, field)
		}
	}
	sort.Strings(unwired)
	sort.Strings(staleAllowlist)

	for _, f := range unwired {
		t.Errorf("RouterConfig.%s gates routes in router.go but is never assigned in cmd/elitea-main/main.go.\n"+
			"  Those routes are silently unregistered and answer 404 in every deployment.\n"+
			"  Either wire it, or add it to declaredAbsent in this test WITH an issue reference —\n"+
			"  so the gap is visible instead of being discovered by someone debugging a 404.", f)
	}
	for _, f := range staleAllowlist {
		t.Errorf("RouterConfig.%s is now wired in main.go but is still listed in declaredAbsent.\n"+
			"  Remove the entry: a stale allowlist hides the next real regression for this field.", f)
	}
}

func repoRootFrom(t *testing.T) string {
	t.Helper()
	// This test lives in internal/api/, so the service root is two levels up.
	root, err := filepath.Abs("../..")
	if err != nil {
		t.Fatalf("resolve service root: %v", err)
	}
	return root
}

func readFile(t *testing.T, path string) string {
	t.Helper()
	b, err := os.ReadFile(path) //nolint:gosec // fixed, test-local path
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if strings.TrimSpace(string(b)) == "" {
		t.Fatalf("%s is empty", path)
	}
	return string(b)
}
