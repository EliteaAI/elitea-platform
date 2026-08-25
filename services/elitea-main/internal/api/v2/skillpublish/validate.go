package skillpublish

// Pre-publish validation — legacy publish_skill_validate.py plus the
// deterministic half of utils/skill_publish_utils.py.
//
// The checkers, their severities and their wording are ported one-for-one from
// the reference's `_SKILL_CHAIN`, minus the icon checker (see the package doc).
// The AI half is absent and the payload says so, rather than reporting
// `ai_validation_available: true` for checks that never ran.

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
)

var (
	versionNamePattern = regexp.MustCompile(`^[a-zA-Z0-9._-]{1,50}$`)
	placeholderPattern = regexp.MustCompile(`(?i)TODO|TBD|Lorem|FIXME|\[REPLACE\]|placeholder|insert here`)
	secretPattern      = regexp.MustCompile(`(?i)sk-[a-zA-Z0-9]{20,}|password\s*=|Bearer\s+[a-zA-Z0-9]{10,}|api[_\-]?key\s*[:=]|secret[_\-]?key\s*[:=]`)
	actionVerbPattern  = regexp.MustCompile(`(?i)\b(helps?|analyzes?|generates?|creates?|manages?|monitors?|provides?|assists?|automates?|processes?)\b`)
	semverHintPattern  = regexp.MustCompile(`^v?\d+\.\d+`)
)

var (
	genericNames    = map[string]bool{"test agent": true, "my agent": true, "new agent": true, "agent": true, "test": true, "untitled": true, "demo": true, "example": true, "sample": true}
	genericTags     = map[string]bool{"agent": true, "assistant": true, "ai": true, "bot": true, "helper": true}
	genericVersions = map[string]bool{"v1": true, "v2": true, "v3": true, "1": true, "2": true, "test": true, "draft": true}
)

const (
	minDescriptionLength  = 50
	minInstructionsLength = 100
)

type issue struct {
	Field string `json:"field"`
	Issue string `json:"issue"`
	Fix   string `json:"fix"`
}

type recommendation struct {
	Field      string `json:"field"`
	Suggestion string `json:"suggestion"`
}

// validationResult is the payload both the validate endpoint and a failing
// publish return.
type validationResult struct {
	Status          string           `json:"status"` // PASS | WARN | FAIL
	CriticalIssues  []issue          `json:"critical_issues"`
	Warnings        []issue          `json:"warnings"`
	Recommendations []recommendation `json:"recommendations"`
	Summary         string           `json:"summary"`
	Counts          map[string]int   `json:"counts"`
	AIValidationRun bool             `json:"ai_validation_available"`
	ValidationToken string           `json:"validation_token,omitempty"`
}

// runDeterministicChecks is the whole validation gate. `nameTaken` reports
// whether the requested version name is already used on the skill; it is passed
// in rather than queried here so the checks stay a pure function of their
// inputs and can be tested without a database.
func runDeterministicChecks(row skillVersionRow, versionName, category string, activeCategories []string, nameTaken bool) validationResult {
	var critical, warnings []issue
	var recs []recommendation

	addCritical := func(field, what, fix string) { critical = append(critical, issue{field, what, fix}) }
	addWarning := func(field, what, fix string) { warnings = append(warnings, issue{field, what, fix}) }

	// Name
	name := strings.TrimSpace(row.SkillName)
	if name == "" {
		addCritical("name", "Skill name is missing", "Provide a descriptive name")
	} else {
		if len(name) < 3 || len(name) > 32 {
			addWarning("name", "Name length should be 3-32 characters", fmt.Sprintf("Current length is %d", len(name)))
		}
		if genericNames[strings.ToLower(name)] {
			addWarning("name", "Name is too generic for a public marketplace", "Choose a more descriptive, unique name")
		}
		if placeholderPattern.MatchString(name) {
			addCritical("name", "Name contains placeholder text", "Replace placeholder with actual name")
		}
	}

	// Description
	description := strings.TrimSpace(row.SkillDescription)
	if description == "" {
		addCritical("description", "Description is missing", fmt.Sprintf("Add a description of at least %d characters", minDescriptionLength))
	} else {
		if len(description) < minDescriptionLength {
			addCritical("description",
				fmt.Sprintf("Description is too short (min %d chars)", minDescriptionLength),
				fmt.Sprintf("Expand description (currently %d chars)", len(description)))
		}
		if !actionVerbPattern.MatchString(description) {
			addWarning("description", "Description lacks action verbs describing purpose", "Add verbs like 'helps', 'analyzes', 'generates'")
		}
		if placeholderPattern.MatchString(description) {
			addCritical("description", "Description contains placeholder text", "Replace placeholder text with actual description")
		}
	}

	// Tags
	if len(row.Tags) == 0 {
		addCritical("tags", "No tags defined", "Add at least one relevant tag")
	} else {
		allGeneric := true
		for _, tag := range row.Tags {
			if !genericTags[strings.ToLower(tag)] {
				allGeneric = false
				break
			}
		}
		if allGeneric {
			addWarning("tags", "All tags are generic", "Add domain-specific tags")
		}
		if len(row.Tags) > 2 {
			recs = append(recs, recommendation{"tags", "Recommend 1-2 tags for optimal discoverability"})
		}
	}

	// Category
	if strings.TrimSpace(category) != "" && resolveCategory(activeCategories, category) == "" {
		addCritical("category",
			fmt.Sprintf("Category '%s' is not a recognised category", strings.TrimSpace(category)),
			"Select a valid skill category from the list")
	}

	// Instructions
	instructions := strings.TrimSpace(row.Instructions)
	if instructions == "" {
		addCritical("instructions", "Instructions are missing", fmt.Sprintf("Add detailed instructions (min %d characters)", minInstructionsLength))
	} else {
		if len(instructions) < minInstructionsLength {
			addCritical("instructions",
				fmt.Sprintf("Instructions are too short (min %d chars)", minInstructionsLength),
				fmt.Sprintf("Expand instructions (currently %d chars)", len(instructions)))
		}
		if placeholderPattern.MatchString(instructions) {
			addCritical("instructions", "Instructions contain placeholder text", "Replace placeholder text with actual instructions")
		}
		if secretPattern.MatchString(instructions) {
			addWarning("instructions", "Instructions may reference a secret or API key in prose",
				"Remove secrets from instructions — use environment variables or vault")
		}
	}

	// Version name
	trimmedVersion := strings.TrimSpace(versionName)
	switch {
	case trimmedVersion == "":
		addCritical("version_name", "Version name is required", "Provide a version name")
	case !versionNamePattern.MatchString(trimmedVersion):
		addCritical("version_name", "Invalid version name format",
			"Use only letters, digits, dots, hyphens, underscores (max 50 chars)")
	case nameTaken:
		addCritical("version_name", "Version name already exists on this skill", "Choose a different version name")
	}
	if trimmedVersion != "" {
		if genericVersions[strings.ToLower(trimmedVersion)] {
			addWarning("version_name", "Version name is not descriptive", "Use a meaningful name like 'v1.0-initial-release'")
		}
		if !semverHintPattern.MatchString(trimmedVersion) {
			recs = append(recs, recommendation{"version_name", "Consider semantic versioning (e.g. v1.0, v2.1)"})
		}
	}

	status := "PASS"
	summary := "Skill meets all publishing requirements."
	switch {
	case len(critical) > 0:
		status = "FAIL"
		summary = fmt.Sprintf("Skill has %d critical issue(s) that must be fixed before publishing.", len(critical))
	case len(warnings) > 0:
		status = "WARN"
		summary = fmt.Sprintf("Skill meets requirements but has %d warning(s) for improvement.", len(warnings))
	}

	if critical == nil {
		critical = []issue{}
	}
	if warnings == nil {
		warnings = []issue{}
	}
	if recs == nil {
		recs = []recommendation{}
	}

	return validationResult{
		Status:          status,
		CriticalIssues:  critical,
		Warnings:        warnings,
		Recommendations: recs,
		Summary:         summary,
		Counts: map[string]int{
			"critical":    len(critical),
			"warnings":    len(warnings),
			"suggestions": len(recs),
		},
		AIValidationRun: false,
	}
}

// versionNameTaken reports whether the skill already carries a version of this
// name. The unique constraint _skill_version_name_uc makes this the collision
// the INSERT would hit later.
func (h *Handler) versionNameTaken(ctx context.Context, schema string, skillID int, versionName string) bool {
	var exists bool
	if err := h.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT EXISTS(SELECT 1 FROM %q.skill_versions WHERE skill_id = $1 AND name = $2)`, schema),
		skillID, versionName).Scan(&exists); err != nil {
		return false
	}
	return exists
}

// validate runs the gate and mints a token when it passes.
// It takes the active category list rather than reading it, so one request
// cannot judge the same `category` against two separately-loaded lists: the
// publish path already resolved it before deciding the category was valid, and
// an administrator saving Skill Categories between the two reads would
// otherwise make the gate refuse a category the same request had just accepted.
func (h *Handler) validate(ctx context.Context, schema string, row skillVersionRow, versionName, category string, activeCategories []string) validationResult {
	result := runDeterministicChecks(row, versionName, category, activeCategories,
		h.versionNameTaken(ctx, schema, row.SkillID, versionName))
	if result.Status != "FAIL" {
		result.ValidationToken = h.issueValidationToken(
			fmt.Sprint(row.VersionID),
			contentHash(row.SkillName, row.SkillDescription, row.Instructions))
	}
	return result
}

// PublishValidate runs pre-publish checks without publishing.
//
// Legacy: publish_skill_validate.py — 200 with a validation_token when the gate
// passes or only warns, 422 when it fails.
func (h *Handler) PublishValidate(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	schema, ok := projectSchema(projectID)
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid project id"})
		return
	}
	skillID := chi.URLParam(r, "skillID")
	versionID := chi.URLParam(r, "versionID")
	if !isPositiveInt(skillID) || !isPositiveInt(versionID) {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid skill or version id"})
		return
	}
	ctx := r.Context()

	var body struct {
		VersionName string `json:"version_name"`
		Category    string `json:"category"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // an absent/!json body validates the empty name, as in the reference

	if projectID != publicProjectID() && h.publishBlocked(ctx, projectID) {
		writeJSON(w, http.StatusForbidden, map[string]any{
			"error": "publishing_blocked",
			"msg":   "Skill publishing is blocked for this project by platform policy.",
		})
		return
	}

	row, found := h.readSkillVersion(ctx, schema, skillID, versionID)
	if !found {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": fmt.Sprintf("Skill version %s not found", versionID)})
		return
	}

	result := h.validate(ctx, schema, row, body.VersionName, body.Category, h.activeCategories(ctx))
	status := http.StatusOK
	if result.Status == "FAIL" {
		status = http.StatusUnprocessableEntity
	}
	writeJSON(w, status, result)
}
