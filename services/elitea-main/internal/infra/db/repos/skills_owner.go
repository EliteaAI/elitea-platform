package repos

import "fmt"

// createSkillSQL builds the INSERT that SkillsRepo.Create runs.
//
// # Why owner_id is a placeholder and not the literal 1
//
// p_<id>.skills.owner_id is the OWNING PROJECT (issue #533). This statement
// wrote the literal 1 into it, so every skill created through the Go service
// claimed to belong to project 1 whatever schema it landed in. Project 1 is the
// seeded Default Project (internal/infra/db/migrations/001_initial.sql:919), so
// the value satisfied every constraint the table has and named the wrong
// project in silence.
//
// The meaning is measured, not read off the name. Every other writer of this
// column already stores a project:
//
//   - internal/api/v2/skillpublish/attach.go:193 writes the number it takes
//     from the schema name itself.
//   - internal/api/v2/skillpublish/publish.go:311 writes the public project id
//     into the public project's schema, which is the same rule.
//   - The legacy runtime overwrites the payload with the route's project before
//     it validates a create: `raw["owner_id"] = project_id`
//     (legacy/plugins/elitea_core/api/v2/skills.py:95), and every read filters
//     with `Skill.owner_id == project_id` (utils/skill_utils.py:1066).
//
// # Why author_id is still the literal 1
//
// author_id holds the USER, and this repository call has no principal in scope:
// v2skills.Repository.Create takes a project id and a skill, and no caller
// supplies the caller's identity. Writing the project id there as well would
// put a project number in a user column — the exact defect #533 names — so the
// value stays as it was and the column keeps one kind of number. The principal
// has to reach the repository before author_id can be true, which is a change
// to the handler and to the interface, not to this statement.
func createSkillSQL(schema string) string {
	return fmt.Sprintf(`
		INSERT INTO %s.skills (name, description, owner_id, author_id, uuid, meta)
		VALUES ($1, $2, $3, 1, gen_random_uuid(), '{}')
		RETURNING id, name, COALESCE(description, ''), created_at`, schema)
}
