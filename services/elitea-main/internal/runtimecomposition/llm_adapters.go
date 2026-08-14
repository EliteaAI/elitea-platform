package runtimecomposition

import (
	"context"
	"errors"
	"math"
	"net/http"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/llmproxy"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

var ErrCurrentLLMCallerUnavailable = errors.New("current LLM caller is unavailable")

type currentPersonalProjectResolver interface {
	PersonalProjectID(context.Context, int32) (int32, error)
}

// CurrentLLMCallerResolver derives the selected caller's default project from
// the current project tables. Request headers are deliberately ignored here;
// the facade separately accepts an explicit project only after membership is
// checked.
type CurrentLLMCallerResolver struct {
	personal currentPersonalProjectResolver
}

func NewCurrentLLMCallerResolver(personal currentPersonalProjectResolver) (*CurrentLLMCallerResolver, error) {
	if personal == nil {
		return nil, ErrCurrentLLMCallerUnavailable
	}
	return &CurrentLLMCallerResolver{personal: personal}, nil
}

func (resolver *CurrentLLMCallerResolver) ResolveCurrentCaller(
	ctx context.Context,
	request *http.Request,
) (llmproxy.CallerContext, error) {
	if ctx == nil || request == nil {
		return llmproxy.CallerContext{}, ErrCurrentLLMCallerUnavailable
	}
	if err := ctx.Err(); err != nil {
		return llmproxy.CallerContext{}, err
	}
	principal, ok := auth.RuntimePrincipalFromContext(ctx)
	if !ok {
		return llmproxy.CallerContext{}, ErrCurrentLLMCallerUnavailable
	}
	userID, ok := principal.OwningUserID()
	if !ok || userID > math.MaxInt32 {
		return llmproxy.CallerContext{}, ErrCurrentLLMCallerUnavailable
	}
	projectID, err := resolver.personal.PersonalProjectID(ctx, int32(userID))
	if err != nil || projectID <= 0 {
		if contextErr := ctx.Err(); contextErr != nil {
			return llmproxy.CallerContext{}, contextErr
		}
		return llmproxy.CallerContext{}, ErrCurrentLLMCallerUnavailable
	}
	return llmproxy.CallerContext{UserID: userID, DefaultProjectID: int64(projectID)}, nil
}

type CurrentLLMPublicProjectResolver struct {
	projectID int64
}

func NewCurrentLLMPublicProjectResolver(projectID int32) (*CurrentLLMPublicProjectResolver, error) {
	if projectID <= 0 {
		return nil, errors.New("current LLM public project is required")
	}
	return &CurrentLLMPublicProjectResolver{projectID: int64(projectID)}, nil
}

func (resolver *CurrentLLMPublicProjectResolver) CurrentPublicProjectID(ctx context.Context) (int64, error) {
	if ctx == nil {
		return 0, errors.New("current LLM public project context is required")
	}
	if err := ctx.Err(); err != nil {
		return 0, err
	}
	return resolver.projectID, nil
}

var _ llmproxy.CallerContextResolver = (*CurrentLLMCallerResolver)(nil)
var _ llmproxy.PublicProjectResolver = (*CurrentLLMPublicProjectResolver)(nil)
