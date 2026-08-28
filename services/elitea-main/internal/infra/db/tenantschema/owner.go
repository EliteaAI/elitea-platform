package tenantschema

import "strconv"

// OwnerID returns the number a PROJECT-kind `owner_id` column must hold in the
// tenant schema of projectID.
//
// # Why one function answers this for every tenant table
//
// A tenant schema is p_{project_id}. "The project that owns this row" and "the
// project whose schema holds this row" are therefore the same number, and a
// PROJECT-kind owner_id has exactly one correct value per schema. A writer that
// puts any other number there stores a row that claims a different project than
// the schema it lives in.
//
// The rule is measured against the legacy runtime, which owns these tables:
//
//   - `raw["owner_id"] = project_id` before the model validates a create
//     (legacy/plugins/elitea_core/api/v2/applications.py:163 and
//     api/v2/skills.py:95). The applications route states it in prose one line
//     above: "owner_id is current project ID" (applications.py:138).
//   - Every read filters the same way: `Application.owner_id == project_id`
//     (api/v2/recommendations.py:160,201) and `Skill.owner_id == project_id`
//     (utils/skill_utils.py:1066).
//   - Publishing writes `owner_id=public_project_id` into the PUBLIC project's
//     schema (utils/skill_publish_utils.py:786), which is the same rule and not
//     an exception to it.
//
// # owner_id is NOT the user, and author_id is NOT the project
//
// `owner_id` and `author_id` hold different kinds of number, and neither column
// carries a foreign key in either schema. A user id stored in owner_id is
// therefore accepted by the database and is invisible until a reader joins on
// it. migrations/tenant/0128_owner_id_column_meanings.sql carries the full
// table of meanings, one row per column, and records it on the columns
// themselves with COMMENT ON COLUMN.
//
// Use OwnerID for owner_id. Use the authenticated principal for author_id.
func OwnerID(projectID string) (int, error) {
	if !Valid(projectID) {
		return 0, ErrInvalidProjectID
	}
	// Valid already refuses everything that is not a run of digits starting
	// with a non-zero one, so the only failure left is a number too large for
	// int. Report it as the same refusal rather than as a substitute value.
	owner, err := strconv.Atoi(projectID)
	if err != nil || owner <= 0 {
		return 0, ErrInvalidProjectID
	}
	return owner, nil
}
