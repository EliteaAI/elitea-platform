package skillpublish

// The public catalog reads — legacy public_skills.py and public_skill.py.
//
// Both read the PUBLIC project's schema and both show only `published`
// versions. That filter is the catalog's whole contract: a twin skill can carry
// draft rows (an admin editing in place), and a listing that leaked them would
// publish content nobody published.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

type publicVersion struct {
	ID        int       `json:"id"`
	Name      string    `json:"name"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	Tags      []string  `json:"tags"`
}

type publicVersionDetail struct {
	ID           int            `json:"id"`
	Name         string         `json:"name"`
	Instructions string         `json:"instructions"`
	Status       string         `json:"status"`
	AuthorID     int            `json:"author_id"`
	Tags         []string       `json:"tags"`
	CreatedAt    time.Time      `json:"created_at"`
	Meta         map[string]any `json:"meta"`
}

// PublicSkills lists the catalog.
//
// Legacy: public_skills.py. `my_liked` and the trend window are not ported (see
// the package doc); `query`, `category`, `tags`, paging and sorting are.
func (h *Handler) PublicSkills(w http.ResponseWriter, r *http.Request) {
	if h.pool == nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}
	ctx := r.Context()
	schema := "p_" + publicProjectID()
	query := r.URL.Query()

	conditions := []string{`EXISTS (SELECT 1 FROM ` + fmt.Sprintf("%q", schema) + `.skill_versions v WHERE v.skill_id = sk.id AND v.status = 'published')`}
	var args []any

	if search := strings.TrimSpace(query.Get("query")); search != "" {
		args = append(args, "%"+search+"%")
		conditions = append(conditions, fmt.Sprintf(`(sk.name ILIKE $%d OR sk.description ILIKE $%d)`, len(args), len(args)))
	}
	if category := strings.TrimSpace(query.Get("category")); category != "" {
		args = append(args, category)
		conditions = append(conditions, fmt.Sprintf(`EXISTS (
			SELECT 1 FROM %[1]q.skill_versions v
			JOIN %[1]q.skill_version_tag_association a ON a.version_id = v.id
			JOIN %[1]q.tags t ON t.id = a.tag_id
			WHERE v.skill_id = sk.id AND v.status = 'published' AND t.name = $%[2]d)`, schema, len(args)))
	}
	if tagIDs := parseIDList(query.Get("tags")); len(tagIDs) > 0 {
		// Each tag id is its own EXISTS, so `tags=1,2` means "carries BOTH",
		// which is what the reference's per-tag filter loop does.
		for _, tagID := range tagIDs {
			args = append(args, tagID)
			conditions = append(conditions, fmt.Sprintf(`EXISTS (
				SELECT 1 FROM %[1]q.skill_versions v
				JOIN %[1]q.skill_version_tag_association a ON a.version_id = v.id
				WHERE v.skill_id = sk.id AND v.status = 'published' AND a.tag_id = $%[2]d)`, schema, len(args)))
		}
	}
	where := " WHERE " + strings.Join(conditions, " AND ")

	var total int
	if err := h.pool.QueryRow(ctx,
		fmt.Sprintf(`SELECT COUNT(*) FROM %q.skills sk`, schema)+where, args...).Scan(&total); err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}
	if total == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"total": 0, "rows": []any{}})
		return
	}

	// limit=0 would drop the clause downstream in the reference and dump the
	// whole catalog; a non-positive limit falls back to the default there and
	// here.
	limit := 10
	if parsed, err := strconv.Atoi(query.Get("limit")); err == nil && parsed > 0 {
		limit = parsed
	}
	if limit > 100 {
		limit = 100
	}
	offset := 0
	if parsed, err := strconv.Atoi(query.Get("offset")); err == nil && parsed > 0 {
		offset = parsed
	}

	sortColumn := "sk.created_at"
	if query.Get("sort_by") == "name" {
		sortColumn = "sk.name"
	}
	sortDirection := "DESC"
	if strings.EqualFold(query.Get("sort_order"), "asc") {
		sortDirection = "ASC"
	}

	args = append(args, limit, offset)
	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT sk.id, sk.name, COALESCE(sk.description, ''), sk.owner_id, sk.created_at,
		       COALESCE(sk.meta::text, '{}')
		FROM %q.skills sk`, schema)+where+
		fmt.Sprintf(` ORDER BY %s %s LIMIT $%d OFFSET $%d`, sortColumn, sortDirection, len(args)-1, len(args)),
		args...)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"total": total, "rows": []any{}})
		return
	}
	defer rows.Close()

	type listRow struct {
		id                int
		name, description string
		ownerID           int
		createdAt         time.Time
		meta              map[string]any
	}
	var collected []listRow
	for rows.Next() {
		var item listRow
		var metaText string
		if rows.Scan(&item.id, &item.name, &item.description, &item.ownerID, &item.createdAt, &metaText) != nil {
			continue
		}
		_ = json.Unmarshal([]byte(metaText), &item.meta) // DB jsonb column
		collected = append(collected, item)
	}
	rows.Close()

	skillIDs := make([]int, 0, len(collected))
	for _, item := range collected {
		skillIDs = append(skillIDs, item.id)
	}
	versionsBySkill := h.publishedVersionsFor(ctx, schema, skillIDs)

	items := make([]map[string]any, 0, len(collected))
	for _, item := range collected {
		versions := versionsBySkill[item.id]
		if versions == nil {
			versions = []publicVersion{}
		}
		tagNames := map[string]bool{}
		var tags []string
		for _, version := range versions {
			for _, tag := range version.Tags {
				if !tagNames[tag] {
					tagNames[tag] = true
					tags = append(tags, tag)
				}
			}
		}
		if tags == nil {
			tags = []string{}
		}
		items = append(items, map[string]any{
			"id":                    item.id,
			"name":                  item.name,
			"description":           item.description,
			"owner_id":              item.ownerID,
			"created_at":            item.createdAt,
			"meta":                  item.meta,
			"tags":                  tags,
			"versions":              versions,
			"has_published_version": len(versions) > 0,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"total": total, "rows": items})
}

func parseIDList(raw string) []int {
	var ids []int
	for _, part := range strings.Split(raw, ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		if parsed, err := strconv.Atoi(part); err == nil {
			ids = append(ids, parsed)
		}
	}
	return ids
}

func (h *Handler) publishedVersions(ctx context.Context, schema string, skillID int) []publicVersion {
	versions := h.publishedVersionsFor(ctx, schema, []int{skillID})[skillID]
	if versions == nil {
		return []publicVersion{}
	}
	return versions
}

// publishedVersionsFor resolves the published versions, with their tags, for a
// whole page of skills in two queries.
//
// Per-skill lookups would make a listing O(rows × versions) round trips — a
// 100-row page of 3-version skills is ~400 sequential queries for one browse
// of the catalog, which is the listing's hottest path.
func (h *Handler) publishedVersionsFor(ctx context.Context, schema string, skillIDs []int) map[int][]publicVersion {
	result := make(map[int][]publicVersion, len(skillIDs))
	if len(skillIDs) == 0 {
		return result
	}

	rows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT skill_id, id, name, status, created_at FROM %q.skill_versions
		WHERE skill_id = ANY($1) AND status = 'published'
		ORDER BY skill_id, created_at DESC, id DESC`, schema), skillIDs)
	if err != nil {
		return result
	}
	defer rows.Close()

	byVersionID := make(map[int]*publicVersion)
	var versionIDs []int
	for rows.Next() {
		var skillID int
		var version publicVersion
		if rows.Scan(&skillID, &version.ID, &version.Name, &version.Status, &version.CreatedAt) != nil {
			continue
		}
		version.Tags = []string{}
		result[skillID] = append(result[skillID], version)
		versionIDs = append(versionIDs, version.ID)
	}
	rows.Close()
	if len(versionIDs) == 0 {
		return result
	}
	// Index the slice entries AFTER every append: appends reallocate, so a
	// pointer taken during the loop above could address a stale backing array.
	for skillID := range result {
		for index := range result[skillID] {
			byVersionID[result[skillID][index].ID] = &result[skillID][index]
		}
	}

	tagRows, err := h.pool.Query(ctx, fmt.Sprintf(`
		SELECT a.version_id, t.name
		FROM %q.skill_version_tag_association a
		JOIN %q.tags t ON t.id = a.tag_id
		WHERE a.version_id = ANY($1)
		ORDER BY a.version_id, t.name`, schema, schema), versionIDs)
	if err != nil {
		return result
	}
	defer tagRows.Close()
	for tagRows.Next() {
		var versionID int
		var name string
		if tagRows.Scan(&versionID, &name) != nil {
			continue
		}
		if version, ok := byVersionID[versionID]; ok {
			version.Tags = append(version.Tags, name)
		}
	}
	return result
}

// PublicSkill serves one catalog skill, optionally pinned to a version name.
//
// Legacy: public_skill.py.
func (h *Handler) PublicSkill(w http.ResponseWriter, r *http.Request) {
	skillID := chi.URLParam(r, "skillID")
	versionName := chi.URLParam(r, "versionName")
	if !isPositiveInt(skillID) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid skill id"})
		return
	}
	ctx := r.Context()
	schema := "p_" + publicProjectID()

	selector := fmt.Sprintf(`
		SELECT id, name, instructions, status, author_id, created_at, COALESCE(meta::text, '{}')
		FROM %q.skill_versions
		WHERE skill_id = $1 AND status = 'published'`, schema)
	args := []any{skillID}
	if versionName != "" {
		selector += ` AND name = $2`
		args = append(args, versionName)
	}
	selector += ` ORDER BY created_at DESC, id DESC LIMIT 1`

	var detail publicVersionDetail
	var metaText string
	if err := h.pool.QueryRow(ctx, selector, args...).Scan(
		&detail.ID, &detail.Name, &detail.Instructions, &detail.Status,
		&detail.AuthorID, &detail.CreatedAt, &metaText); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": fmt.Sprintf("No skill found with id '%s' or no published version", skillID),
		})
		return
	}
	_ = json.Unmarshal([]byte(metaText), &detail.Meta) // DB jsonb column

	// Lineage keys stamped at publish name the source project and version. The
	// catalog is world-readable within the deployment, so the public payload
	// carries presentation keys only — the same filter public_skill.py applies.
	for key := range detail.Meta {
		if strings.HasPrefix(key, "source_") || strings.HasPrefix(key, "parent_") || key == "published_by" {
			delete(detail.Meta, key)
		}
	}
	detail.Tags = h.readVersionTags(ctx, schema, detail.ID)
	if detail.Tags == nil {
		detail.Tags = []string{}
	}

	var skillName, skillDescription, skillMetaText string
	var ownerID int
	var createdAt time.Time
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT name, COALESCE(description, ''), owner_id, created_at, COALESCE(meta::text, '{}')
		FROM %q.skills WHERE id = $1`, schema), skillID).
		Scan(&skillName, &skillDescription, &ownerID, &createdAt, &skillMetaText); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{
			"error": fmt.Sprintf("No skill found with id '%s' or no published version", skillID),
		})
		return
	}
	var skillMeta map[string]any
	_ = json.Unmarshal([]byte(skillMetaText), &skillMeta) // DB jsonb column

	numericID, _ := strconv.Atoi(skillID)
	writeJSON(w, http.StatusOK, map[string]any{
		"id":              numericID,
		"name":            skillName,
		"description":     skillDescription,
		"owner_id":        ownerID,
		"created_at":      createdAt,
		"meta":            skillMeta,
		"versions":        h.publishedVersions(ctx, schema, numericID),
		"version_details": detail,
	})
}
