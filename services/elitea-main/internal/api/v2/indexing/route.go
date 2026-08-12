package indexing

import (
	"errors"
	"net/http"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	CurrentIndexStartPath       = "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}"
	CurrentIndexStartMode       = auth.PermissionModeDefault
	CurrentIndexStartPermission = "models.applications.tool.patch"
)

var ErrInvalidCurrentIndexStartRoute = errors.New("invalid current index-start route dependencies")

// CurrentIndexStartRoute binds the exact current path and method to trusted
// authentication and project RBAC. Production composition mounts it only when
// durable index admission and delivery are enabled together.
type CurrentIndexStartRoute struct {
	handler http.Handler
}

func NewCurrentIndexStartRoute(
	useCase StartUseCase,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentIndexStartRoute, error) {
	if useCase == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentIndexStartRoute
	}
	start, err := NewStartHandler(useCase)
	if err != nil {
		return nil, ErrInvalidCurrentIndexStartRoute
	}

	endpoint := http.Handler(http.HandlerFunc(start.Start))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentIndexStartMode,
		func(request *http.Request) (string, bool) {
			projectID := chi.URLParam(request, "projectID")
			_, valid := positiveCanonicalID(projectID)
			return projectID, valid
		},
		CurrentIndexStartPermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)

	router := chi.NewRouter()
	router.Method(http.MethodPost, CurrentIndexStartPath, endpoint)
	return &CurrentIndexStartRoute{handler: router}, nil
}

func (route *CurrentIndexStartRoute) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if route == nil || route.handler == nil {
		http.NotFound(w, r)
		return
	}
	route.handler.ServeHTTP(w, r)
}
