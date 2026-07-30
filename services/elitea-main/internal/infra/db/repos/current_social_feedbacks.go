package repos

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

const insertCurrentSocialFeedbackSQL = `
	INSERT INTO centry.social_feedbacks (
		user_id,
		referrer,
		description,
		rating,
		user_agent
	)
	VALUES ($1, $2, $3, $4, $5)
	RETURNING id`

// CurrentSocialFeedbacksRepository preserves the current shared-table storage
// contract. Project membership belongs to the authorized HTTP route; feedback
// rows remain in centry.social_feedbacks and are never routed through p_N.
type CurrentSocialFeedbacksRepository struct {
	store sqlExecutor
}

func NewCurrentSocialFeedbacksRepository(
	pool *pgxpool.Pool,
) (*CurrentSocialFeedbacksRepository, error) {
	store, err := newPostgresSharedStore(pool)
	if err != nil {
		return nil, err
	}
	return newCurrentSocialFeedbacksRepository(store)
}

func newCurrentSocialFeedbacksRepository(
	store sqlExecutor,
) (*CurrentSocialFeedbacksRepository, error) {
	if store == nil {
		return nil, errors.New("current social feedback database is required")
	}
	return &CurrentSocialFeedbacksRepository{store: store}, nil
}

func (repository *CurrentSocialFeedbacksRepository) CreateCurrentFeedback(
	ctx context.Context,
	userID int64,
	description string,
	rating int,
	referrer *string,
	userAgent string,
) (int64, error) {
	if ctx == nil || userID <= 0 || rating < 0 || rating > 5 {
		return 0, errors.New("invalid current social feedback")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}

	var id int64
	if err := repository.store.QueryRow(
		ctx,
		insertCurrentSocialFeedbackSQL,
		userID,
		referrer,
		description,
		rating,
		userAgent,
	).Scan(&id); err != nil {
		return 0, fmt.Errorf("insert current social feedback: %w", err)
	}
	if id <= 0 {
		return 0, errors.New("insert current social feedback returned an invalid ID")
	}
	return id, nil
}
