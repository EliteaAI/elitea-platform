package skillpublish

// skill_export_fork.py — the JSON fork payload, as distinct from the plain
// `skill_export` markdown download that already exists in
// internal/api/v2/skills/handler.go.
//
// The copied version is always emitted as the target's single 'base' version:
// a fork produces a new skill in another project, and that skill starts with
// one version like every other newly created skill does.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
)

// ExportFork builds the fork payload for a skill version.
func (h *Handler) ExportFork(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	schema, ok := projectSchema(projectID)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}
	skillID := chi.URLParam(r, "skillID")
	versionID := chi.URLParam(r, "versionID")
	if !isPositiveInt(skillID) || (versionID != "" && !isPositiveInt(versionID)) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid skill or version id"})
		return
	}
	ctx := r.Context()

	var skillName, skillDescription, skillMetaText string
	var authorID int
	var createdAt time.Time
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, ''), author_id, created_at, COALESCE(meta::text, '{}')
		FROM %s.skills WHERE id = $1`, schema), skillID).
		Scan(&skillName, &skillDescription, &authorID, &createdAt, &skillMetaText); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": fmt.Sprintf("Skill %s not found", skillID)})
		return
	}
	var skillMeta map[string]any
	_ = json.Unmarshal([]byte(skillMetaText), &skillMeta) // DB jsonb column

	source, found := h.resolveExportVersion(ctx, schema, skillID, versionID, skillMeta)
	if !found {
		// A named version that does not exist is a 404, as is a skill with no
		// resolvable version at all — the reference collapses both.
		writeJSON(w, http.StatusNotFound, map[string]any{"error": fmt.Sprintf("Skill %s not found", skillID)})
		return
	}

	tags := make([]map[string]any, 0, len(source.Tags))
	for _, name := range source.Tags {
		tags = append(tags, map[string]any{"name": name, "data": map[string]any{}})
	}

	numericSkillID, _ := strconv.Atoi(skillID)
	numericProjectID, _ := strconv.Atoi(projectID)
	payload := map[string]any{
		"id":          numericSkillID,
		"name":        skillName,
		"description": skillDescription,
		"owner_id":    numericProjectID,
		"project_id":  numericProjectID,
		"user_id":     authorID,
		"entity":      "skills",
		"created_at":  createdAt,
		"meta":        skillMeta,
		// Deterministic per (project, skill, name), so re-forking the same
		// skill is idempotent on the import side rather than producing a second
		// copy each time.
		"import_uuid": uuid.NewSHA1(uuid.NameSpaceOID,
			[]byte(fmt.Sprintf("skill_fork:%d:%d:%s", numericProjectID, numericSkillID, skillName))).String(),
		"versions": []map[string]any{{
			"id":           source.VersionID,
			"name":         defaultVersionName,
			"instructions": source.Instructions,
			"author_id":    source.AuthorID,
			"tags":         tags,
			"meta":         source.Meta,
		}},
	}
	writeJSON(w, http.StatusOK, map[string]any{"skills": []any{payload}})
}

// resolveExportVersion picks the version to copy: the one named in the path, or
// the skill's default, or its 'base' version, or its oldest — the reference's
// get_default_version fallback chain.
func (h *Handler) resolveExportVersion(ctx context.Context, schema, skillID, versionID string, skillMeta map[string]any) (skillVersionRow, bool) {
	if versionID != "" {
		return h.readSkillVersion(ctx, schema, skillID, versionID)
	}
	if defaultID := metaInt(skillMeta, "default_version_id"); defaultID > 0 {
		if row, ok := h.readSkillVersion(ctx, schema, skillID, strconv.Itoa(defaultID)); ok {
			return row, true
		}
	}
	var resolvedID int
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id FROM %s.skill_versions
		WHERE skill_id = $1
		ORDER BY (name = $2) DESC, created_at ASC, id ASC
		LIMIT 1`, schema), skillID, defaultVersionName).Scan(&resolvedID); err != nil {
		return skillVersionRow{}, false
	}
	return h.readSkillVersion(ctx, schema, skillID, strconv.Itoa(resolvedID))
}
