package skillpublish

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

// defaultSkillCategories is the predefined list the reference seeds skills with
// (legacy/plugins/elitea_core/utils/constants.py DEFAULT_SKILL_CATEGORIES). It
// is currently identical to the agent list, but it is a SEPARATE constant on
// purpose: the reference manages the two independently, and aliasing them here
// would make a future divergence a silent behaviour change on the agent side.
var defaultSkillCategories = []string{
	"Business Analyst",
	"Quality Assurance",
	"Development",
	"DevOps",
	"Project Management",
	"Knowledge & Documentation",
	"Elitea",
	"Epam",
	"Other",
}

// fallbackCategory is the permanent bucket an uncategorised publish lands in.
// The catalog's category filter matches a real tag, so a publish with no
// category must still carry one or it is unreachable through the filter.
const fallbackCategory = "Other"

// resolveCategory returns the canonical spelling of a category, or "" when the
// name is not one. Matching is case-insensitive, as in the reference.
func resolveCategory(name string) string {
	trimmed := strings.TrimSpace(name)
	if trimmed == "" {
		return ""
	}
	for _, active := range defaultSkillCategories {
		if strings.EqualFold(active, trimmed) {
			return active
		}
	}
	return ""
}

// applyCategoryToTags returns the tag list a published snapshot should carry:
// every category-looking tag replaced by exactly one canonical category.
//
// When the caller names no category, an existing category tag on the version is
// kept and only a version with none gets the fallback — the same precedence the
// reference applies, and the reason an already-categorised republish does not
// silently drop into "Other".
func applyCategoryToTags(tags []string, category string) []string {
	resolved := resolveCategory(category)
	if resolved == "" {
		for _, tag := range tags {
			if resolveCategory(tag) != "" {
				return tags
			}
		}
		resolved = fallbackCategory
	}

	result := make([]string, 0, len(tags)+1)
	for _, tag := range tags {
		if resolveCategory(tag) == "" {
			result = append(result, tag)
		}
	}
	return append(result, resolved)
}

// SkillCategories serves the predefined skill category list.
//
// Legacy: skill_categories.py. Admin-added extras are not ported — see the
// package doc.
func (h *Handler) SkillCategories(w http.ResponseWriter, r *http.Request) {
	if _, ok := projectSchema(chi.URLParam(r, "projectID")); !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}
	categories := make([]map[string]any, 0, len(defaultSkillCategories))
	for _, name := range defaultSkillCategories {
		categories = append(categories, map[string]any{"name": name, "is_default": true})
	}
	writeJSON(w, http.StatusOK, map[string]any{"categories": categories, "total": len(categories)})
}
