package runtimecomposition

import (
	"context"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/authsvc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type currentProjectSystemTokenSource interface {
	IssueProjectToken(context.Context, int64) (authsvc.ProjectSystemToken, error)
}

// currentProjectSystemTokenAdapter keeps authsvc's redacted token value behind
// storage's narrow runtime-context port. It does not cache or persist bearer
// material.
type currentProjectSystemTokenAdapter struct {
	source currentProjectSystemTokenSource
}

func (a currentProjectSystemTokenAdapter) IssueProjectToken(
	ctx context.Context,
	projectID int64,
) (storage.ProjectSystemToken, error) {
	token, err := a.source.IssueProjectToken(ctx, projectID)
	if err != nil {
		return storage.ProjectSystemToken{}, err
	}
	return storage.NewProjectSystemToken(
		token.ProjectID(),
		token.UserID(),
		token.Token(),
	), nil
}
