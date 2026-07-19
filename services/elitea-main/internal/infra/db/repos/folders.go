package repos

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/folders"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/pkg/apierr"
)

type FoldersRepo struct {
	pool *pgxpool.Pool
}

func NewFoldersRepo(pool *pgxpool.Pool) *FoldersRepo {
	return &FoldersRepo{pool: pool}
}

func (r *FoldersRepo) List(ctx context.Context, projectID string) ([]folders.Folder, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		SELECT id::text, name, COALESCE(uuid::text, ''), owner_id, position, created_at, COALESCE(updated_at, created_at)
		FROM %q.chat_conversation_folders ORDER BY position, name`, s)

	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return []folders.Folder{}, nil
	}
	defer rows.Close()

	var items []folders.Folder
	for rows.Next() {
		var f folders.Folder
		var ownerID int
		var position int
		if err := rows.Scan(&f.ID, &f.Name, &f.ParentID, &ownerID, &position, &f.CreatedAt, &f.UpdatedAt); err != nil {
			continue
		}
		f.ProjectID = projectID
		f.ParentID = "" // flat structure for now
		items = append(items, f)
	}
	if items == nil {
		items = []folders.Folder{}
	}
	return items, nil
}

func (r *FoldersRepo) Create(ctx context.Context, projectID string, folder folders.Folder) (folders.Folder, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		INSERT INTO %q.chat_conversation_folders (name, owner_id, position, uuid, meta)
		VALUES ($1, 1, 0, gen_random_uuid(), '{}'::jsonb)
		RETURNING id::text, name, created_at, COALESCE(updated_at, created_at)`, s)

	var f folders.Folder
	err := r.pool.QueryRow(ctx, q, folder.Name).Scan(&f.ID, &f.Name, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return folders.Folder{}, fmt.Errorf("folders: create: %w", err)
	}
	f.ProjectID = projectID
	return f, nil
}

func (r *FoldersRepo) Update(ctx context.Context, projectID, folderID string, folder folders.Folder) (folders.Folder, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		UPDATE %q.chat_conversation_folders SET name = $1, updated_at = now()
		WHERE id = $2
		RETURNING id::text, name, created_at, COALESCE(updated_at, created_at)`, s)

	var f folders.Folder
	err := r.pool.QueryRow(ctx, q, folder.Name, folderID).Scan(&f.ID, &f.Name, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return folders.Folder{}, apierr.NotFound("folder not found")
		}
		return folders.Folder{}, fmt.Errorf("folders: update: %w", err)
	}
	f.ProjectID = projectID
	return f, nil
}

func (r *FoldersRepo) Delete(ctx context.Context, projectID, folderID string) error {
	s := schema(projectID)
	q := fmt.Sprintf(`DELETE FROM %q.chat_conversation_folders WHERE id = $1`, s)
	ct, err := r.pool.Exec(ctx, q, folderID)
	if err != nil {
		return fmt.Errorf("folders: delete: %w", err)
	}
	if ct.RowsAffected() == 0 {
		return apierr.NotFound("folder not found")
	}
	return nil
}
