package repos

import (
	"context"
	"fmt"

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

func (r *SkillsRepo) List(ctx context.Context, projectID string, page, pageSize int) (skills.ListResponse, error) {
	s := schema(projectID)

	var total int
	countQ := fmt.Sprintf(`SELECT COUNT(*) FROM %q.skills`, s)
	if err := r.pool.QueryRow(ctx, countQ).Scan(&total); err != nil {
		return skills.ListResponse{Items: []skills.Skill{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}

	offset := (page - 1) * pageSize
	q := fmt.Sprintf(`
		SELECT id, name, COALESCE(description, ''), owner_id, created_at, uuid, meta
		FROM %q.skills ORDER BY created_at DESC LIMIT $1 OFFSET $2`, s)

	rows, err := r.pool.Query(ctx, q, pageSize, offset)
	if err != nil {
		return skills.ListResponse{Items: []skills.Skill{}, Total: 0, Page: page, PageSize: pageSize}, nil
	}
	defer rows.Close()

	var items []skills.Skill
	for rows.Next() {
		var sk skills.Skill
		var ownerID int
		var uuid string
		var meta []byte
		if err := rows.Scan(&sk.ID, &sk.Name, &sk.Description, &ownerID, &sk.CreatedAt, &uuid, &meta); err != nil {
			continue
		}
		sk.ProjectID = projectID
		sk.Type = "skill"
		items = append(items, sk)
	}
	if items == nil {
		items = []skills.Skill{}
	}

	totalPages := total / pageSize
	if total%pageSize > 0 {
		totalPages++
	}

	return skills.ListResponse{
		Items:      items,
		Total:      total,
		Page:       page,
		PageSize:   pageSize,
		TotalPages: totalPages,
	}, nil
}

func (r *SkillsRepo) Get(ctx context.Context, projectID, skillID string) (skills.Skill, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		SELECT id, name, COALESCE(description, ''), owner_id, created_at, uuid, meta
		FROM %q.skills WHERE id = $1`, s)

	var sk skills.Skill
	var ownerID int
	var uuid string
	var meta []byte
	err := r.pool.QueryRow(ctx, q, skillID).Scan(&sk.ID, &sk.Name, &sk.Description, &ownerID, &sk.CreatedAt, &uuid, &meta)
	if err != nil {
		if err == pgx.ErrNoRows {
			return skills.Skill{}, apierr.NotFound("skill not found")
		}
		return skills.Skill{}, fmt.Errorf("skills: get: %w", err)
	}
	sk.ProjectID = projectID
	sk.Type = "skill"
	return sk, nil
}

func (r *SkillsRepo) Create(ctx context.Context, projectID string, skill skills.Skill) (skills.Skill, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		INSERT INTO %q.skills (name, description, owner_id, author_id, uuid, meta)
		VALUES ($1, $2, 1, 1, gen_random_uuid(), '{}')
		RETURNING id, name, COALESCE(description, ''), created_at, uuid`, s)

	var sk skills.Skill
	var uuid string
	err := r.pool.QueryRow(ctx, q, skill.Name, skill.Description).Scan(
		&sk.ID, &sk.Name, &sk.Description, &sk.CreatedAt, &uuid,
	)
	if err != nil {
		return skills.Skill{}, fmt.Errorf("skills: create: %w", err)
	}
	sk.ProjectID = projectID
	sk.Type = "skill"
	return sk, nil
}

func (r *SkillsRepo) Update(ctx context.Context, projectID, skillID string, skill skills.Skill) (skills.Skill, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		UPDATE %q.skills SET name = $1, description = $2
		WHERE id = $3
		RETURNING id, name, COALESCE(description, ''), created_at, uuid`, s)

	var sk skills.Skill
	var uuid string
	err := r.pool.QueryRow(ctx, q, skill.Name, skill.Description, skillID).Scan(
		&sk.ID, &sk.Name, &sk.Description, &sk.CreatedAt, &uuid,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return skills.Skill{}, apierr.NotFound("skill not found")
		}
		return skills.Skill{}, fmt.Errorf("skills: update: %w", err)
	}
	sk.ProjectID = projectID
	sk.Type = "skill"
	return sk, nil
}

func (r *SkillsRepo) Delete(ctx context.Context, projectID, skillID string) error {
	s := schema(projectID)
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
