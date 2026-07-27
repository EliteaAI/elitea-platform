package routes

import (
	"github.com/EliteaAI/elitea-platform/tools/uictl/internal/manifest"
)

// DiffManifest adapts a loaded manifest to DiffPatterns.
func DiffManifest(ext *Extraction, m *manifest.Manifest) []string {
	var titles []string
	for _, it := range m.Items {
		if it.Kind == "route" {
			titles = append(titles, it.Title)
		}
	}
	return DiffPatterns(ext, titles)
}
