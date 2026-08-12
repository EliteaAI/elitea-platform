package repos

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/skills"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type SkillsRepo struct {
	pool *pgxpool.Pool
}

func NewSkillsRepo(pool *pgxpool.Pool) *SkillsRepo {
	return &SkillsRepo{pool: pool}
}

// skillsListColumns is the SELECT list shared by List/Get: skill fields plus
// the base version and its aggregated tag names. sv is a LEFT JOIN so a
// skill created before this join existed (or with no base version yet)
// still returns a row, just with a NULL version id and empty tags.
const skillsSelectColumns = `
	sk.id, sk.name, COALESCE(sk.description, ''), sk.owner_id, sk.created_at,
	sv.id, COALESCE(sv.instructions, ''),
	COALESCE(array_agg(t.name ORDER BY t.name) FILTER (WHERE t.name IS NOT NULL), '{}')`

func skillsFromJoin(s string) string {
	return fmt.Sprintf(`FROM %q.skills sk
		LEFT JOIN %q.skill_versions sv ON sv.skill_id = sk.id AND sv.name = 'base'
		LEFT JOIN %q.skill_version_tag_association svta ON svta.version_id = sv.id
		LEFT JOIN %q.tags t ON t.id = svta.tag_id`, s, s, s, s)
}

func scanSkillRow(row pgx.Row, projectID string) (skills.Skill, error) {
	var sk skills.Skill
	var ownerID int
	var versionID *int
	var instructions string
	var tags []string
	if err := row.Scan(&sk.ID, &sk.Name, &sk.Description, &ownerID, &sk.CreatedAt, &versionID, &instructions, &tags); err != nil {
		return skills.Skill{}, err
	}
	sk.ProjectID = projectID
	sk.Type = "skill"
	sk.Instructions = instructions
	sk.Tags = tags
	if versionID != nil {
		v := skills.SkillVersion{ID: strconv.Itoa(*versionID), Name: "base", Instructions: instructions, Tags: tags}
		sk.Versions = []skills.SkillVersion{v}
		sk.VersionDetails = &v
	}
	return sk, nil
}

func (r *SkillsRepo) List(ctx context.Context, projectID string, params skills.ListParams) (skills.ListResponse, error) {
	s := schema(projectID)

	var args []any
	where := ""
	if params.Query != "" {
		where = ` WHERE (sk.name ILIKE $1 OR sk.description ILIKE $1)`
		args = append(args, "%"+params.Query+"%")
	}

	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.skills sk`, s) + where
	var total int
	if err := r.pool.QueryRow(ctx, countQ, args...).Scan(&total); err != nil {
		return skills.ListResponse{Items: []skills.Skill{}, Total: 0, Page: params.Page, PageSize: params.PageSize}, nil
	}

	sortColumn := "sk.created_at"
	switch params.SortBy {
	case "name":
		sortColumn = "sk.name"
	}
	sortDir := "DESC"
	if strings.EqualFold(params.SortOrder, "asc") {
		sortDir = "ASC"
	}

	offset := (params.Page - 1) * params.PageSize
	limitIdx := len(args) + 1
	offsetIdx := len(args) + 2

	q := fmt.Sprintf(`SELECT %s %s`, skillsSelectColumns, skillsFromJoin(s)) + where +
		fmt.Sprintf(` GROUP BY sk.id, sv.id ORDER BY %s %s LIMIT $%d OFFSET $%d`, sortColumn, sortDir, limitIdx, offsetIdx)

	queryArgs := append(append([]any{}, args...), params.PageSize, offset)
	rows, err := r.pool.Query(ctx, q, queryArgs...)
	if err != nil {
		return skills.ListResponse{Items: []skills.Skill{}, Total: 0, Page: params.Page, PageSize: params.PageSize}, nil
	}
	defer rows.Close()

	var items []skills.Skill
	for rows.Next() {
		sk, err := scanSkillRow(rows, projectID)
		if err != nil {
			continue
		}
		items = append(items, sk)
	}
	if items == nil {
		items = []skills.Skill{}
	}

	totalPages := total / params.PageSize
	if total%params.PageSize > 0 {
		totalPages++
	}

	return skills.ListResponse{
		Items:      items,
		Total:      total,
		Page:       params.Page,
		PageSize:   params.PageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *SkillsRepo) Get(ctx context.Context, projectID, skillID string) (skills.Skill, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`SELECT %s %s WHERE sk.id = $1 GROUP BY sk.id, sv.id`, skillsSelectColumns, skillsFromJoin(s))

	sk, err := scanSkillRow(r.pool.QueryRow(ctx, q, skillID), projectID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return skills.Skill{}, apierr.NotFound("skill not found")
		}
		return skills.Skill{}, fmt.Errorf("skills: get: %w", err)
	}
	return sk, nil
}

func (r *SkillsRepo) GetByName(ctx context.Context, projectID, name string) (skills.Skill, bool, error) {
	s := schema(projectID)
	var id string
	err := r.pool.QueryRow(ctx, fmt.Sprintf(`SELECT id FROM %q.skills WHERE name = $1 ORDER BY id LIMIT 1`, s), name).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return skills.Skill{}, false, nil
		}
		return skills.Skill{}, false, fmt.Errorf("skills: get by name: %w", err)
	}
	sk, err := r.Get(ctx, projectID, id)
	if err != nil {
		return skills.Skill{}, false, err
	}
	return sk, true, nil
}

func (r *SkillsRepo) Create(ctx context.Context, projectID string, skill skills.Skill) (skills.Skill, error) {
	s := schema(projectID)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return skills.Skill{}, fmt.Errorf("skills: create: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var sk skills.Skill
	err = tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %q.skills (name, description, owner_id, author_id, uuid, meta)
		VALUES ($1, $2, 1, 1, gen_random_uuid(), '{}')
		RETURNING id, name, COALESCE(description, ''), created_at`, s),
		skill.Name, skill.Description).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.CreatedAt)
	if err != nil {
		return skills.Skill{}, fmt.Errorf("skills: create: %w", err)
	}

	version, err := upsertBaseSkillVersion(ctx, tx, s, sk.ID, skill.Instructions, skill.Tags)
	if err != nil {
		return skills.Skill{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return skills.Skill{}, fmt.Errorf("skills: create: commit: %w", err)
	}

	sk.ProjectID = projectID
	sk.Type = "skill"
	sk.Instructions = version.Instructions
	sk.Tags = version.Tags
	sk.Versions = []skills.SkillVersion{version}
	sk.VersionDetails = &version
	return sk, nil
}

func (r *SkillsRepo) Update(ctx context.Context, projectID, skillID string, skill skills.Skill) (skills.Skill, error) {
	s := schema(projectID)
	tx, err := r.pool.Begin(ctx)
	if err != nil {
		return skills.Skill{}, fmt.Errorf("skills: update: begin: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var sk skills.Skill
	err = tx.QueryRow(ctx, fmt.Sprintf(`
		UPDATE %q.skills SET name = $1, description = $2
		WHERE id = $3
		RETURNING id, name, COALESCE(description, ''), created_at`, s),
		skill.Name, skill.Description, skillID).Scan(&sk.ID, &sk.Name, &sk.Description, &sk.CreatedAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return skills.Skill{}, apierr.NotFound("skill not found")
		}
		return skills.Skill{}, fmt.Errorf("skills: update: %w", err)
	}

	version, err := upsertBaseSkillVersion(ctx, tx, s, skillID, skill.Instructions, skill.Tags)
	if err != nil {
		return skills.Skill{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return skills.Skill{}, fmt.Errorf("skills: update: commit: %w", err)
	}

	sk.ProjectID = projectID
	sk.Type = "skill"
	sk.Instructions = version.Instructions
	sk.Tags = version.Tags
	sk.Versions = []skills.SkillVersion{version}
	sk.VersionDetails = &version
	return sk, nil
}

// upsertBaseSkillVersion upserts the skill's single "base" skill_versions row
// (unique on (skill_id, name), see 001_initial.sql) and replaces its tag
// associations by delete-then-reinsert — mirrors applications.go's own
// delete-cascade pattern for the equivalent application_version_tag_association
// table. Tags are upserted by name (tags.name is UNIQUE) so repeated tag
// names across skills share one tags row.
func upsertBaseSkillVersion(ctx context.Context, tx pgx.Tx, schema, skillID, instructions string, tags []string) (skills.SkillVersion, error) {
	v := skills.SkillVersion{Name: "base", Instructions: instructions, Tags: []string{}}

	var versionID int
	err := tx.QueryRow(ctx, fmt.Sprintf(`
		INSERT INTO %q.skill_versions (skill_id, name, instructions, author_id)
		VALUES ($1, 'base', $2, 1)
		ON CONFLICT (skill_id, name) DO UPDATE SET instructions = EXCLUDED.instructions
		RETURNING id`, schema), skillID, instructions).Scan(&versionID)
	if err != nil {
		return skills.SkillVersion{}, fmt.Errorf("skills: upsert version: %w", err)
	}
	v.ID = strconv.Itoa(versionID)

	if _, err := tx.Exec(ctx, fmt.Sprintf(`DELETE FROM %q.skill_version_tag_association WHERE version_id = $1`, schema), versionID); err != nil {
		return skills.SkillVersion{}, fmt.Errorf("skills: clear tags: %w", err)
	}

	seen := make(map[string]bool, len(tags))
	for _, tagName := range tags {
		tagName = strings.TrimSpace(tagName)
		if tagName == "" || seen[tagName] {
			continue
		}
		seen[tagName] = true

		var tagID int
		err := tx.QueryRow(ctx, fmt.Sprintf(`
			INSERT INTO %q.tags (name) VALUES ($1)
			ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
			RETURNING id`, schema), tagName).Scan(&tagID)
		if err != nil {
			return skills.SkillVersion{}, fmt.Errorf("skills: upsert tag %q: %w", tagName, err)
		}

		if _, err := tx.Exec(ctx, fmt.Sprintf(`
			INSERT INTO %q.skill_version_tag_association (version_id, tag_id) VALUES ($1, $2)
			ON CONFLICT DO NOTHING`, schema), versionID, tagID); err != nil {
			return skills.SkillVersion{}, fmt.Errorf("skills: link tag %q: %w", tagName, err)
		}
		v.Tags = append(v.Tags, tagName)
	}

	return v, nil
}

func (r *SkillsRepo) Delete(ctx context.Context, projectID, skillID string) error {
	s := schema(projectID)

	// Guard: a skill with a published version cannot be deleted (#249).
	//
	// The cascade below would take the source rows with it while the copy in
	// the public catalog survived — and unpublishing is keyed off the source
	// skill, so the author would be left with an entry they can see in the
	// catalog and no longer have any way to retract. Same guard, same reason
	// and same wording as applications
	// (internal/api/v2/applications/handler.go:669-681).
	var publishedCount int
	if err := r.pool.QueryRow(ctx, fmt.Sprintf(
		`SELECT COUNT(*) FROM %q.skill_versions WHERE skill_id = $1 AND status = 'published'`, s),
		skillID).Scan(&publishedCount); err != nil {
		return fmt.Errorf("skills: delete: check published versions: %w", err)
	}
	if publishedCount > 0 {
		return apierr.BadRequest("Unpublish first. Cannot delete skill with published versions.")
	}

	// skill_versions and skill_version_tag_association both cascade on
	// delete (001_initial.sql), so no manual child cleanup is needed here
	// (unlike applications.go, whose equivalent tables lack ON DELETE CASCADE).
	q := fmt.Sprintf(`DELETE FROM %q.skills WHERE id = $1`, s)
	ct, err := r.pool.Exec(ctx, q, skillID)
	if err != nil {
		return fmt.Errorf("skills: delete: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return apierr.NotFound("skill not found")
	}
	return nil
}
