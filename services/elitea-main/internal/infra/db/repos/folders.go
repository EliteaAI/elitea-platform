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

// listOrder is the sidebar's own order: highest position first, oldest first
// among equal positions. It matches the legacy runtime's
// `order_by(desc(position), created_at)` (elitea_core/api/v2/folder.py:325-328),
// and the `created_at` tiebreaker is what keeps the order stable across the
// rebalance in Rebalance below.
const listOrder = `ORDER BY position DESC, created_at ASC, id ASC`

func (r *FoldersRepo) List(ctx context.Context, projectID string) ([]folders.Folder, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		SELECT id::text, name, COALESCE(uuid::text, ''), owner_id, position, created_at, COALESCE(updated_at, created_at)
		FROM %q.chat_conversation_folders %s`, s, listOrder)

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
		f.Position = &position
		items = append(items, f)
	}
	if items == nil {
		items = []folders.Folder{}
	}
	return items, nil
}

func (r *FoldersRepo) Create(ctx context.Context, projectID string, folder folders.Folder) (folders.Folder, error) {
	s := schema(projectID)
	// A new folder goes to the TOP, so its position is one gap above the
	// current maximum — the legacy runtime's own rule (folder.py:583-590).
	// An explicit `position` in the create body still wins.
	q := fmt.Sprintf(`
		INSERT INTO %q.chat_conversation_folders (name, owner_id, position, uuid, meta)
		VALUES ($1, 1,
			COALESCE($2::int, (SELECT COALESCE(MAX(position), 0) + %d FROM %q.chat_conversation_folders)),
			gen_random_uuid(), '{}'::jsonb)
		RETURNING id::text, name, position, created_at, COALESCE(updated_at, created_at)`,
		s, folders.PositionGap, s)

	var f folders.Folder
	var position int
	err := r.pool.QueryRow(ctx, q, folder.Name, folder.Position).Scan(&f.ID, &f.Name, &position, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		return folders.Folder{}, fmt.Errorf("folders: create: %w", err)
	}
	f.ProjectID = projectID
	f.Position = &position
	return f, nil
}

func (r *FoldersRepo) Update(ctx context.Context, projectID, folderID string, folder folders.Folder) (folders.Folder, error) {
	s := schema(projectID)
	// `position = COALESCE($2, position)` is what lets a rename PUT — the
	// `{"name": …}` body useFolderUpdateMutation sends — leave the sidebar
	// order alone, while a reorder PUT rewrites it.
	q := fmt.Sprintf(`
		UPDATE %q.chat_conversation_folders
		SET name = COALESCE(NULLIF($1, ''), name),
		    position = COALESCE($2::int, position),
		    updated_at = now()
		WHERE id = $3
		RETURNING id::text, name, position, created_at, COALESCE(updated_at, created_at)`, s)

	var f folders.Folder
	var position int
	err := r.pool.QueryRow(ctx, q, folder.Name, folder.Position, folderID).Scan(&f.ID, &f.Name, &position, &f.CreatedAt, &f.UpdatedAt)
	if err != nil {
		if err == pgx.ErrNoRows {
			return folders.Folder{}, apierr.NotFound("folder not found")
		}
		return folders.Folder{}, fmt.Errorf("folders: update: %w", err)
	}
	f.ProjectID = projectID
	f.Position = &position
	return f, nil
}

// Rebalance respaces every folder by folders.PositionGap while preserving the
// current display order, so a drop between two folders that had run out of
// integers between them has room again.
func (r *FoldersRepo) Rebalance(ctx context.Context, projectID string) ([]folders.Folder, error) {
	s := schema(projectID)
	q := fmt.Sprintf(`
		WITH ordered AS (
			SELECT id,
			       ROW_NUMBER() OVER (%s) AS rn,
			       COUNT(*) OVER () AS n
			FROM %q.chat_conversation_folders
		)
		UPDATE %q.chat_conversation_folders f
		SET position = ((o.n - o.rn) + 1) * %d
		FROM ordered o
		WHERE f.id = o.id`, listOrder, s, s, folders.PositionGap)

	if _, err := r.pool.Exec(ctx, q); err != nil {
		return nil, fmt.Errorf("folders: rebalance: %w", err)
	}
	return r.List(ctx, projectID)
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
