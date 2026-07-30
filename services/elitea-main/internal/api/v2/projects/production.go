package projects

import (
	"errors"
	"net/http"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

var ErrInvalidCurrentProjectListRoute = errors.New("invalid current project-list route dependencies")

// CurrentProjectListRoute is an opaque production route. Construction binds
// trusted forwarded-identity verification, mutable-principal validation, and
// the current project-view permission before the SQLC-backed handler can run.
type CurrentProjectListRoute struct {
	handler http.Handler
}

func NewCurrentProjectListRoute(
	projects CurrentProjectLister,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentProjectListRoute, error) {
	if projects == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentProjectListRoute
	}

	handler := http.Handler(http.HandlerFunc(NewCurrentProjectListHandler(projects).GetCurrentProjectList))
	handler = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentProjectListMode,
		func(*http.Request) (string, bool) {
			return CurrentProjectListProjectID, true
		},
		CurrentProjectListPermission,
	)(handler)
	handler = apimw.Auth(authConfig)(handler)
	return &CurrentProjectListRoute{handler: handler}, nil
}

func (route *CurrentProjectListRoute) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}
