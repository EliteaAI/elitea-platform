package repos

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidCurrentSocialAvatarRequest = errors.New("current social avatar request is invalid")

const CurrentSocialAvatarQueryTimeout = 5 * time.Second

// CurrentSocialAvatarRepository reads and upserts the current user's own
// avatar URL in the shared centry.social_users table. Storage is per-user
// (user_id is UNIQUE), matching the legacy UpdateAuthor upsert this repository
// narrows to the avatar field alone.
type CurrentSocialAvatarRepository struct {
	pool *pgxpool.Pool
}

func NewCurrentSocialAvatarRepository(pool *pgxpool.Pool) (*CurrentSocialAvatarRepository, error) {
	if pool == nil {
		return nil, errors.New("current social avatar database is required")
	}
	return &CurrentSocialAvatarRepository{pool: pool}, nil
}

func (repository *CurrentSocialAvatarRepository) GetCurrentAvatar(
	ctx context.Context,
	userID int64,
) (*string, error) {
	if ctx == nil || userID <= 0 {
		return nil, ErrInvalidCurrentSocialAvatarRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	queryContext, cancel := context.WithTimeout(ctx, CurrentSocialAvatarQueryTimeout)
	defer cancel()
	var avatar *string
	err := repository.pool.QueryRow(
		queryContext,
		`SELECT avatar FROM centry.social_users WHERE user_id = $1`,
		userID,
	).Scan(&avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query current social avatar: %w", err)
	}
	return avatar, nil
}

func (repository *CurrentSocialAvatarRepository) SetCurrentAvatar(
	ctx context.Context,
	userID int64,
	avatarURL string,
) error {
	if ctx == nil || userID <= 0 || avatarURL == "" {
		return ErrInvalidCurrentSocialAvatarRequest
	}
	if err := ctx.Err(); err != nil {
		return err
	}

	queryContext, cancel := context.WithTimeout(ctx, CurrentSocialAvatarQueryTimeout)
	defer cancel()
	if _, err := repository.pool.Exec(
		queryContext,
		`
INSERT INTO centry.social_users (user_id, avatar)
VALUES ($1, $2)
ON CONFLICT (user_id) DO UPDATE SET avatar = EXCLUDED.avatar
`,
		userID, avatarURL,
	); err != nil {
		return fmt.Errorf("set current social avatar: %w", err)
	}
	return nil
}
