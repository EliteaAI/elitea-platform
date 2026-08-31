package routes

import (
	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/manifest"
)

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
		titles = append(titles, it.Title)
	}
	return DiffPatterns(ext, titles)
}
