package repos

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/tags"
)

type TagsRepo struct {
	pool *pgxpool.Pool
}

func NewTagsRepo(pool *pgxpool.Pool) *TagsRepo {
	return &TagsRepo{pool: pool}
}

func (r *TagsRepo) List(ctx context.Context, projectID string) ([]tags.Tag, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`SELECT id, name FROM %q.tags ORDER BY name`, s)

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return []tags.Tag{}, nil
	}
	defer rows.Close()

	var items []tags.Tag
	for rows.Next() {
		var t tags.Tag
		var id int
		rows.Scan(&id, &t.Name)
		items = append(items, t)
	}
	if items == nil {
		items = []tags.Tag{}
	}
	return items, nil
}
