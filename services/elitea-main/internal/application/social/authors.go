package social

import (
	"context"
	"errors"
	"fmt"
	"time"
)

var ErrInvalidCurrentAuthorsRequest = errors.New("invalid current authors request")

// CurrentAuthor is the current public.auth_core__user shape enriched with the
// optional avatar from centry.social_users.
type CurrentAuthor struct {
	ID        int32
	Email     *string
	Name      *string
	LastLogin *time.Time
	Suspended bool
	Avatar    *string
}

// CurrentAuthorsRepository lists users assigned to one project. Implementations
// must exclude the per-project system account and preserve members without a
// centry.social_users row.
type CurrentAuthorsRepository interface {
	ListCurrentProjectAuthors(context.Context, int32) ([]CurrentAuthor, error)
}

type CurrentAuthorsService struct {
	repository CurrentAuthorsRepository
}

func NewCurrentAuthorsService(
	repository CurrentAuthorsRepository,
) (*CurrentAuthorsService, error) {
	if repository == nil {
		return nil, errors.New("current authors repository is required")
	}
	return &CurrentAuthorsService{repository: repository}, nil
}

func (service *CurrentAuthorsService) ListCurrentProjectAuthors(
	ctx context.Context,
	projectID int32,
) ([]CurrentAuthor, error) {
	if ctx == nil || projectID <= 0 {
		return nil, ErrInvalidCurrentAuthorsRequest
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	authors, err := service.repository.ListCurrentProjectAuthors(ctx, projectID)
	if err != nil {
		return nil, fmt.Errorf("list current project authors: %w", err)
	}
	if authors == nil {
		return []CurrentAuthor{}, nil
	}
	return authors, nil
}
