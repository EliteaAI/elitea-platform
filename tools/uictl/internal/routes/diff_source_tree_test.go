package routes

import (
	"strings"
	"testing"

	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/manifest"
)

// A route item that does not cite the pinned baseline is not a claim about the
// baseline's router.
//
// WHAT THIS PROTECTS, in both directions. The carve-out exists for the DeepWiki
// route, which is served by a separate SPA behind elitea-main and was never in
// apps/elitea-ui. Without it, parity-routes reports `manifest claims route
// "/deepwiki/:projectId" which the baseline does not mount` — true, and not a
// defect.
//
// The direction that matters more is the other one. A carve-out on "source
// tree" is one careless edit away from letting a REAL elitea-ui route vanish
// from the diff, which would be silent: the route simply stops being compared.
// The second and third tests below are what stop that.

func routeItem(id string, title string, sources ...string) manifest.Item {
	return manifest.Item{
		ID:     id,
		Kind:   "route",
		Title:  title,
		Status: "todo",
		Source: sources,
	}
}

func TestADeepWikiRouteIsNotComparedAgainstTheEliteaUIBaseline(t *testing.T) {
	ext := &Extraction{Mounted: map[string]bool{"/chat": true}, DeclaredOnly: map[string]string{}}
	m := &manifest.Manifest{Items: []manifest.Item{
		routeItem("ROUTE-001", "Route `/chat` renders Chat", "apps/elitea-ui/src/routes.js:10"),
		routeItem("DWIKI-001", "Route `/deepwiki/:projectId` renders the wiki browser",
			"apps/deepwiki-ui/src/main.jsx:3-7"),
	}}

	problems := DiffManifest(ext, m)
	for _, p := range problems {
		if strings.Contains(p, "deepwiki") {
			t.Fatalf("the DeepWiki route was diffed against the elitea-ui baseline: %s", p)
		}
	}
	if len(problems) != 0 {
		t.Fatalf("expected no problems, got %v", problems)
	}
}

func TestABaselineRouteIsStillCompared(t *testing.T) {
	// The mutation this kills: a carve-out that skipped too much would let this
	// missing route pass unnoticed.
	ext := &Extraction{Mounted: map[string]bool{"/chat": true}, DeclaredOnly: map[string]string{}}
	m := &manifest.Manifest{Items: []manifest.Item{
		routeItem("ROUTE-001", "Route `/agents` renders Agents", "apps/elitea-ui/src/routes.js:10"),
	}}

	problems := DiffManifest(ext, m)
	if len(problems) == 0 {
		t.Fatal("a manifest route the baseline does not mount was not reported")
	}
	joined := strings.Join(problems, "\n")
	if !strings.Contains(joined, "/agents") || !strings.Contains(joined, "/chat") {
		t.Fatalf("expected both the unmounted claim and the uncovered baseline route, got:\n%s", joined)
	}
}

func TestAnItemCitingBothTreesIsStillCompared(t *testing.T) {
	// fromBaseline uses ANY, not ALL. Otherwise adding one deepwiki-ui
	// reference to a real elitea-ui route item would quietly remove it from the
	// diff — a way to silence this gate that looks like adding evidence.
	ext := &Extraction{Mounted: map[string]bool{}, DeclaredOnly: map[string]string{}}
	m := &manifest.Manifest{Items: []manifest.Item{
		routeItem("ROUTE-001", "Route `/agents` renders Agents",
			"apps/deepwiki-ui/src/DeepWikiApp.jsx:1",
			"apps/elitea-ui/src/routes.js:10"),
	}}

	problems := DiffManifest(ext, m)
	if len(problems) == 0 {
		t.Fatal("an item citing the baseline was skipped because it also cited another tree")
	}
}
