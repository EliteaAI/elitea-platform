package skillpublish

// Publish / unpublish — legacy publish_skill.py, unpublish_skill.py and the
// user_/admin_ halves of utils/skill_publish_utils.py.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

type publishRequest struct {
	VersionName     string `json:"version_name"`
	ValidationToken string `json:"validation_token"`
	Category        string `json:"category"`
}

// Publish publishes one skill version to the public catalog.
//
// Two paths, as in the reference:
//
//   - from an ordinary project, the version is snapshotted into a new source
//     version and copied into the public project's schema as a twin skill's
//     version;
//   - from the public project itself ("admin publish"), the version is
//     published in place, because source and catalog are the same schema.
func (h *Handler) Publish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")
	versionID := chi.URLParam(r, "versionID")
	schema, ok := projectSchema(projectID)
	if !ok || !isPositiveInt(skillID) || !isPositiveInt(versionID) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project, skill or version id"})
		return
	}
	ctx := r.Context()
	publicID := publicProjectID()
	isAdminPublish := projectID == publicID

	// The guardrail is checked FIRST, before the body is read and before any
	// row is looked up, for the reason the application publish path documents:
	// a refusal that arrives after validation tells a caller which version ids
	// exist, after the platform has already decided they may not publish.
	if !isAdminPublish && h.publishBlocked(ctx, projectID) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "publishing_blocked",
			"msg":   "Skill publishing is blocked for this project by platform policy.",
		})
		return
	}

	var body publishRequest
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid request body"})
		return
	}
	body.VersionName = strings.TrimSpace(body.VersionName)
	if body.VersionName == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": []map[string]any{
				{"loc": []string{"body", "version_name"}, "msg": "field required", "type": "value_error.missing"},
			},
		})
		return
	}
	if !versionNamePattern.MatchString(body.VersionName) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": []map[string]any{
				{"loc": []string{"body", "version_name"}, "msg": "string does not match regex \"^[a-zA-Z0-9._-]{1,50}$\"", "type": "value_error.str.regex"},
			},
		})
		return
	}

	row, found := h.readSkillVersion(ctx, schema, skillID, versionID)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": fmt.Sprintf("Skill version %s not found", versionID)})
		return
	}
	if !isAdminPublish && row.Status == "published" {
		writeJSON(w, http.StatusConflict, map[string]any{
			"error": "already_published",
			"msg":   "This skill version is already published.",
		})
		return
	}
	if body.Category != "" && resolveCategory(body.Category) == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "invalid_category",
			"msg":   fmt.Sprintf("Category '%s' is not a valid skill category.", body.Category),
		})
		return
	}

	// The validation gate. A caller who has just validated presents the token
	// and skips it; anyone else validates inline and is refused on FAIL.
	if !isAdminPublish {
		if body.ValidationToken != "" {
			if !h.verifyValidationToken(body.ValidationToken, strconv.Itoa(row.VersionID),
				contentHash(row.SkillName, row.SkillDescription, row.Instructions)) {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error": "validation_token_invalid",
					"msg":   "Validation token is invalid or the skill changed after it was issued. Re-run /publish_skill_validate.",
				})
				return
			}
		} else {
			result := h.validate(ctx, schema, row, body.VersionName, body.Category)
			if result.Status == "FAIL" {
				writeJSON(w, http.StatusBadRequest, map[string]any{
					"error":             "validation_token_invalid",
					"msg":               "Skill failed pre-publish validation. Use /publish_skill_validate first.",
					"validation_result": result,
				})
				return
			}
		}
	}

	userID := actingUserID(ctx, row.AuthorID)
	if isAdminPublish {
		h.adminPublish(ctx, w, schema, row, body, userID)
		return
	}
	h.userPublish(ctx, w, projectID, schema, publicID, row, body, userID)
}

// publishedVersionCount counts what the catalog already carries for a skill —
// the number the max-versions cap is applied to.
func (h *Handler) publishedVersionCount(ctx context.Context, schema string, skillID int) int {
	var count int
	_ = h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COUNT(*) FROM %q.skill_versions WHERE skill_id = $1 AND status = 'published'`, schema),
		skillID).Scan(&count) // a failed count leaves 0; the INSERT's own constraints still apply
	return count
}

// guardAdditionalPublish is the pair of pre-write refusals a skill that already
// has a public presence must pass: no duplicate version name, no exceeding the
// published-version cap.
func (h *Handler) guardAdditionalPublish(ctx context.Context, w http.ResponseWriter, schema string, skillID int, versionName string) bool {
	if h.versionNameTaken(ctx, schema, skillID, versionName) {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "version_name_exists",
			"msg":   fmt.Sprintf("Version name '%s' already exists on this skill", versionName),
		})
		return false
	}
	if count := h.publishedVersionCount(ctx, schema, skillID); count >= maxPublishedVersionsPerSkill {
		writeJSON(w, http.StatusBadRequest, map[string]any{
			"error": "limit_reached",
			"msg":   fmt.Sprintf("Maximum %d published versions reached (current: %d)", maxPublishedVersionsPerSkill, count),
		})
		return false
	}
	return true
}

// publishedMeta is the lineage every published version carries. Unpublish reads
// it back to find the source version to revert, so these keys are load-bearing
// and not decoration.
func publishedMeta(sourceProjectID string, row skillVersionRow, publishedBy int) map[string]any {
	projectID, _ := strconv.Atoi(sourceProjectID)
	return map[string]any{
		"source_project_id": projectID,
		"source_skill_id":   row.SkillID,
		"source_version_id": row.VersionID,
		"source_author_id":  row.AuthorID,
		"published_by":      publishedBy,
	}
}

// insertVersion writes one skill_versions row and its tags.
func insertVersion(ctx context.Context, tx queryExecer, schema string, skillID int, name, instructions string, authorID int, status string, meta map[string]any, tags []string) (int, error) {
	encodedMeta, err := json.Marshal(meta)
	if err != nil {
		return 0, err
	}
	var versionID int
	if err := tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %q.skill_versions (skill_id, name, instructions, author_id, status, meta)
		VALUES ($1, $2, $3, $4, $5, $6::jsonb)
		RETURNING id`, schema),
		skillID, name, instructions, authorID, status, string(encodedMeta)).Scan(&versionID); err != nil {
		return 0, err
	}
	if err := applyTags(ctx, tx, schema, versionID, tags); err != nil {
		return 0, err
	}
	return versionID, nil
}

func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "SQLSTATE 23505")
}

// setDefaultVersionIfUnset points skills.meta.default_version_id at a version
// when the skill has none. Skills have no implicit fallback the way agents do,
// so a catalog skill without this key resolves no version at all for
// fork/export.
func setDefaultVersionIfUnset(ctx context.Context, tx queryExecer, schema string, skillID, versionID int) error {
	_, err := tx.Exec(ctx, fmt.Sprintf(`
		UPDATE %q.skills
		SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('default_version_id', $2::int)
		WHERE id = $1
		  AND COALESCE(meta->>'default_version_id', '') = ''`, schema), skillID, versionID)
	return err
}

// adminPublish publishes in place, inside the public project.
func (h *Handler) adminPublish(ctx context.Context, w http.ResponseWriter, schema string, row skillVersionRow, body publishRequest, userID int) {
	if !h.guardAdditionalPublish(ctx, w, schema, row.SkillID, body.VersionName) {
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	projectID := strings.TrimPrefix(schema, "p_")
	publishedID, err := insertVersion(ctx, tx, schema, row.SkillID, body.VersionName, row.Instructions,
		userID, "published", publishedMeta(projectID, row, userID),
		applyCategoryToTags(row.Tags, body.Category))
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "version_name_exists",
				"msg":   fmt.Sprintf("Version name '%s' already exists on this skill", body.VersionName),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	if err := setDefaultVersionIfUnset(ctx, tx, schema, row.SkillID, publishedID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"msg":               "Successfully published",
		"public_skill_id":   row.SkillID,
		"public_version_id": publishedID,
		"version_name":      body.VersionName,
		"source_version_id": row.VersionID,
	})
}

// userPublish snapshots the source version and copies it into the public
// project's schema.
func (h *Handler) userPublish(ctx context.Context, w http.ResponseWriter, projectID, schema, publicID string, row skillVersionRow, body publishRequest, userID int) {
	publicSchema := "p_" + publicID

	twinID, twinExists := h.findPublicTwin(ctx, publicSchema, projectID, row.SkillID)
	if twinExists && !h.guardAdditionalPublish(ctx, w, publicSchema, twinID, body.VersionName) {
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// (1) The source snapshot. The version the user is editing is left alone;
	// the published content is a NEW source version carrying the requested
	// name, so a later edit of the draft cannot change what the catalog serves.
	snapshotTags := applyCategoryToTags(row.Tags, body.Category)
	sourceVersionID, err := insertVersion(ctx, tx, schema, row.SkillID, body.VersionName, row.Instructions,
		userID, "published", map[string]any{"published_by": userID}, snapshotTags)
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "version_name_conflict",
				"msg":   fmt.Sprintf("Version name '%s' already exists on this skill", body.VersionName),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}

	// (2) The catalog twin, created on first publish and reused after.
	sourceProjectNumeric, _ := strconv.Atoi(projectID)
	if !twinExists {
		err = tx.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.skills (name, description, owner_id, author_id, meta, shared_owner_id, shared_id)
			VALUES ($1, $2, $3, $4, '{}'::jsonb, $5, $6)
			ON CONFLICT (shared_owner_id, shared_id) WHERE shared_owner_id IS NOT NULL DO NOTHING
			RETURNING id`, publicSchema),
			row.SkillName, row.SkillDescription, publicIDInt(publicID), userID,
			sourceProjectNumeric, row.SkillID).Scan(&twinID)
		if errors.Is(err, pgx.ErrNoRows) {
			// Lost a concurrent first publish: the twin now exists, so append
			// to it instead of failing the request.
			var found bool
			twinID, found = h.findTwinTx(ctx, tx, publicSchema, projectID, row.SkillID)
			if !found {
				writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": "public skill twin could not be resolved"})
				return
			}
			err = nil
		}
		if err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
			return
		}
	}

	// (3) The catalog version.
	publishedRow := row
	publishedRow.VersionID = sourceVersionID
	publicVersionID, err := insertVersion(ctx, tx, publicSchema, twinID, body.VersionName, row.Instructions,
		userID, "published", publishedMeta(projectID, publishedRow, userID), snapshotTags)
	if err != nil {
		if isUniqueViolation(err) {
			writeJSON(w, http.StatusBadRequest, map[string]any{
				"error": "version_name_exists",
				"msg":   fmt.Sprintf("Version name '%s' already exists on this skill", body.VersionName),
			})
			return
		}
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	if err := setDefaultVersionIfUnset(ctx, tx, publicSchema, twinID, publicVersionID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"msg":               "Successfully published",
		"public_skill_id":   twinID,
		"public_version_id": publicVersionID,
		"version_name":      body.VersionName,
		"source_version_id": sourceVersionID,
	})
}

func publicIDInt(publicID string) int {
	parsed, _ := strconv.Atoi(publicID)
	return parsed
}

func (h *Handler) findPublicTwin(ctx context.Context, publicSchema, sourceProjectID string, sourceSkillID int) (int, bool) {
	return h.findTwinTx(ctx, h.pool, publicSchema, sourceProjectID, sourceSkillID)
}

func (h *Handler) findTwinTx(ctx context.Context, q queryExecer, publicSchema, sourceProjectID string, sourceSkillID int) (int, bool) {
	numericProjectID, err := strconv.Atoi(sourceProjectID)
	if err != nil {
		return 0, false
	}
	var id int
	err = q.QueryRow(ctx, fmt.Sprintf(
		`SELECT id FROM %q.skills WHERE shared_owner_id = $1 AND shared_id = $2`, publicSchema),
		numericProjectID, sourceSkillID).Scan(&id)
	if err != nil {
		return 0, false
	}
	return id, true
}

/* ── unpublish ────────────────────────────────────────────────────────────── */

// Unpublish removes a published skill version from the catalog.
//
// Legacy: unpublish_skill.py. The public copy is DELETED (the catalog carries no
// tombstones) and the source version reverts to draft, so republishing later is
// an ordinary publish rather than a special case.
func (h *Handler) Unpublish(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	skillID := chi.URLParam(r, "skillID")
	versionID := chi.URLParam(r, "versionID")
	schema, ok := projectSchema(projectID)
	if !ok || !isPositiveInt(skillID) || !isPositiveInt(versionID) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project, skill or version id"})
		return
	}
	ctx := r.Context()

	var body struct {
		Reason string `json:"reason"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // optional body

	if projectID == publicProjectID() {
		h.adminUnpublish(ctx, w, schema, skillID, versionID)
		return
	}
	h.userUnpublish(ctx, w, projectID, schema, skillID, versionID)
}

// deletePublicVersionResult is what a catalog deletion tells its caller.
type deletePublicVersionResult struct {
	NotPublished bool
	ShellDeleted bool
	Meta         map[string]any
}

// deletePublicVersion removes one published catalog version and repairs the
// skill around it: a twin with nothing published left is removed entirely, and a
// default_version_id pointing at the deleted row is repointed.
func deletePublicVersion(ctx context.Context, tx queryExecer, schema string, publicVersionID int) (deletePublicVersionResult, error) {
	var skillID int
	var status, metaText string
	err := tx.QueryRow(ctx, fmt.Sprintf(
		`SELECT skill_id, status, COALESCE(meta::text, '{}') FROM %q.skill_versions WHERE id = $1`, schema),
		publicVersionID).Scan(&skillID, &status, &metaText)
	if err != nil || status != "published" {
		return deletePublicVersionResult{NotPublished: true}, nil
	}
	var meta map[string]any
	_ = json.Unmarshal([]byte(metaText), &meta) // DB jsonb column; malformed means nil meta

	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`DELETE FROM %q.skill_versions WHERE id = $1`, schema), publicVersionID); err != nil {
		return deletePublicVersionResult{}, err
	}

	var remainingPublished int
	if err := tx.QueryRow(ctx, fmt.Sprintf(
		`SELECT COUNT(*) FROM %q.skill_versions WHERE skill_id = $1 AND status = 'published'`, schema),
		skillID).Scan(&remainingPublished); err != nil {
		return deletePublicVersionResult{}, err
	}

	var sharedOwner *int
	var skillMetaText string
	if err := tx.QueryRow(ctx, fmt.Sprintf(
		`SELECT shared_owner_id, COALESCE(meta::text, '{}') FROM %q.skills WHERE id = $1`, schema),
		skillID).Scan(&sharedOwner, &skillMetaText); err != nil {
		return deletePublicVersionResult{}, err
	}
	var skillMeta map[string]any
	_ = json.Unmarshal([]byte(skillMetaText), &skillMeta) // DB jsonb column

	result := deletePublicVersionResult{Meta: meta}
	if remainingPublished == 0 && sharedOwner != nil {
		// A twin exists only to carry published versions; with none left it is
		// an empty catalog entry. An in-place original (no shared link) is NOT
		// deleted — that would take the author's own drafts with it.
		if _, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.skills WHERE id = $1`, schema), skillID); err != nil {
			return deletePublicVersionResult{}, err
		}
		result.ShellDeleted = true
		return result, nil
	}

	if fmt.Sprint(skillMeta["default_version_id"]) == strconv.Itoa(publicVersionID) {
		// Repoint at the newest surviving version, of any status; skills have
		// no implicit 'base' fallback, so leaving the key dangling would make
		// the skill resolve no version at all.
		var replacement *int
		_ = tx.QueryRow(ctx, fmt.Sprintf(
			`SELECT id FROM %q.skill_versions WHERE skill_id = $1 ORDER BY id DESC LIMIT 1`, schema),
			skillID).Scan(&replacement) // no surviving version leaves nil, handled below
		if replacement != nil {
			if _, err := tx.Exec(ctx, fmt.Sprintf(`
				UPDATE %q.skills SET meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object('default_version_id', $2::int)
				WHERE id = $1`, schema), skillID, *replacement); err != nil {
				return deletePublicVersionResult{}, err
			}
		} else if _, err := tx.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.skills SET meta = COALESCE(meta, '{}'::jsonb) - 'default_version_id' WHERE id = $1`, schema),
			skillID); err != nil {
			return deletePublicVersionResult{}, err
		}
	}
	return result, nil
}

func (h *Handler) userUnpublish(ctx context.Context, w http.ResponseWriter, projectID, schema, skillID, versionID string) {
	publicSchema := "p_" + publicProjectID()
	sourceSkillID, _ := strconv.Atoi(skillID)
	sourceVersionID, _ := strconv.Atoi(versionID)

	twinID, ok := h.findPublicTwin(ctx, publicSchema, projectID, sourceSkillID)
	if !ok {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_published", "msg": "Skill version is not published"})
		return
	}

	// The catalog row is found by lineage, not by name: the same version name
	// can exist on several skills, and only the source_version_id stamped at
	// publish identifies the copy that belongs to THIS source version.
	var publicVersionID int
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(`
		SELECT id FROM %q.skill_versions
		WHERE skill_id = $1 AND status = 'published' AND meta->>'source_version_id' = $2`, publicSchema),
		twinID, versionID).Scan(&publicVersionID); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_published", "msg": "Skill version is not published"})
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := deletePublicVersion(ctx, tx, publicSchema, publicVersionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	if result.NotPublished {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "not_published", "msg": "Skill version is not published"})
		return
	}

	if _, err := tx.Exec(ctx, fmt.Sprintf(
		`UPDATE %q.skill_versions SET status = 'draft' WHERE id = $1 AND skill_id = $2`, schema),
		sourceVersionID, sourceSkillID); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"msg": "Successfully unpublished", "status": "deleted"})
}

func (h *Handler) adminUnpublish(ctx context.Context, w http.ResponseWriter, schema, skillID, versionID string) {
	publicVersionID, _ := strconv.Atoi(versionID)

	// The version must belong to the skill in the path; otherwise an
	// unpublish addressed to skill A could delete skill B's version.
	var ownerSkillID int
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT skill_id FROM %q.skill_versions WHERE id = $1`, schema), publicVersionID).Scan(&ownerSkillID); err != nil ||
		strconv.Itoa(ownerSkillID) != skillID {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "not_published", "msg": "Skill version is not currently published"})
		return
	}

	tx, err := h.pool.Begin(ctx)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	result, err := deletePublicVersion(ctx, tx, schema, publicVersionID)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	if result.NotPublished {
		writeJSON(w, http.StatusConflict, map[string]any{"error": "not_published", "msg": "Skill version is not currently published"})
		return
	}

	// A version published FROM another project reverts that project's source
	// row to draft, so the author's studio stops showing it as published.
	// An in-place admin publish has source == public and needs no such hop.
	sourceProjectID := metaInt(result.Meta, "source_project_id")
	sourceVersionID := metaInt(result.Meta, "source_version_id")
	publicProject, _ := strconv.Atoi(strings.TrimPrefix(schema, "p_"))
	if sourceProjectID > 0 && sourceVersionID > 0 && sourceProjectID != publicProject {
		if _, err := tx.Exec(ctx, fmt.Sprintf(
			`UPDATE %q.skill_versions SET status = 'draft' WHERE id = $1`, fmt.Sprintf("p_%d", sourceProjectID)),
			sourceVersionID); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "internal_error", "msg": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"msg": "Successfully unpublished", "status": "deleted"})
}

// metaInt reads a numeric lineage key. JSON numbers arrive as float64; a key
// written by an older path as a string is read too, so lineage stamped either
// way still resolves.
func metaInt(meta map[string]any, key string) int {
	switch value := meta[key].(type) {
	case float64:
		return int(value)
	case string:
		parsed, err := strconv.Atoi(value)
		if err != nil {
			return 0
		}
		return parsed
	}
	return 0
}
