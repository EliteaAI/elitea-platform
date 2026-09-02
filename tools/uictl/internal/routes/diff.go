package routes

import (
	"strings"

	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/manifest"
)

// baselineSourcePrefix marks evidence that comes from the pinned apps/elitea-ui
// baseline, which is the only tree this route diff can speak about.
const baselineSourcePrefix = "apps/elitea-ui/"

// fromBaseline reports whether ANY of an item's evidence is a claim about the
// pinned baseline.
//
// ANY rather than ALL, deliberately. An item citing both trees is still making
// a claim about the baseline, and skipping it would let a real route drop out
// of the diff by adding one unrelated reference.
func fromBaseline(it manifest.Item) bool {
	for _, src := range it.Source {
		if strings.HasPrefix(src, baselineSourcePrefix) {
			return true
		}
	}
	return false
}

// DiffManifest adapts a loaded manifest to DiffPatterns.
func DiffManifest(ext *Extraction, m *manifest.Manifest) []string {
	var titles []string
	for _, it := range m.Items {
		if it.Kind != "route" {
			continue
		}
		// A WAIVED route item is not a claim that the baseline mounts the
		// pattern — it records a route the baseline RETIRED, and ids are
		// immutable so the item cannot simply be deleted. Requiring it to
		// match a mounted pattern would make the retirement unrepresentable.
		// The bar is deliberately both fields: a waiver alone (which several
		// live items carry for unrelated reasons) must not remove a route
		// from the diff.
		if it.Status == "waived" && it.Waiver != nil {
			continue
		}
		// A route item whose evidence is entirely OUTSIDE the pinned baseline
		// is not a claim about the baseline's router, and this diff has
		// nothing to say about it.
		//
		// The DeepWiki route is the case that forced this: it is served by a
		// separate SPA behind elitea-main, and apps/elitea-ui never mounted it.
		// Left in, it produced `manifest claims route "/deepwiki/:projectId"
		// which the baseline does not mount` — true, and not a defect.
		//
		// This is the same shape as the waived carve-out above, and it is
		// bounded the same way: the manifest schema admits exactly two source
		// trees, so "not the baseline" can only mean apps/deepwiki-ui. It is
		// not a general escape hatch, and it cannot silently drop an
		// elitea-ui route — see fromBaseline's ANY rule.
		if !fromBaseline(it) {
			continue
		}
		titles = append(titles, it.Title)
	}
	return DiffPatterns(ext, titles)
}
