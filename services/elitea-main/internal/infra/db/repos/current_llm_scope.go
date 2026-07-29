package repos

import (
	"context"
	"errors"
	"math"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/db/sqlcgen"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrInvalidCurrentLLMScope = errors.New("current LLM scope is invalid")

type currentLLMScopeQueries interface {
	IsCurrentUserProjectMember(context.Context, sqlcgen.IsCurrentUserProjectMemberParams) (bool, error)
}

// CurrentLLMScopeRepository checks the active current project membership used
// when the /llm facade accepts an explicit project header. It deliberately
// does not infer authorization from the header itself.
type CurrentLLMScopeRepository struct {
	queries currentLLMScopeQueries
}

func NewCurrentLLMScopeRepository(pool *pgxpool.Pool) (*CurrentLLMScopeRepository, error) {
	if pool == nil {
		return nil, ErrInvalidCurrentLLMScope
	}
	return newCurrentLLMScopeRepository(sqlcgen.New(pool))
}

func newCurrentLLMScopeRepository(queries currentLLMScopeQueries) (*CurrentLLMScopeRepository, error) {
	if queries == nil {
		return nil, ErrInvalidCurrentLLMScope
	}
	return &CurrentLLMScopeRepository{queries: queries}, nil
}

func (repository *CurrentLLMScopeRepository) IsCurrentProjectMember(
	ctx context.Context,
	userID int64,
	projectID int64,
) (bool, error) {
	if ctx == nil || userID <= 0 || userID > math.MaxInt32 || projectID <= 0 || projectID > math.MaxInt32 {
		return false, ErrInvalidCurrentLLMScope
	}
	if err := ctx.Err(); err != nil {
		return false, err
	}
	return repository.queries.IsCurrentUserProjectMember(ctx, sqlcgen.IsCurrentUserProjectMemberParams{
		UserID:    int32(userID),
		ProjectID: int32(projectID),
	})
}
