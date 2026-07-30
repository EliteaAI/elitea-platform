package indextypes

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	CurrentIndexTypesPath       = "/api/v2/elitea_core/index_types/prompt_lib/{projectID}"
	CurrentIndexTypesMode       = auth.PermissionModeDefault
	CurrentIndexTypesPermission = "models.applications.index_types.details"
)

const currentIndexTypesRoutePath = "/api/v2/elitea_core/index_types/prompt_lib/{projectID:[0-9]+}"

var ErrInvalidCurrentIndexTypesRoute = errors.New("invalid current index-types route dependencies")

// CurrentIndexTypes is the exact successful response consumed by the unchanged
// EliteaUI useFileTypes hook. Do not wrap it in an index_types envelope.
type CurrentIndexTypes struct {
	DocumentTypes map[string]string `json:"document_types"`
	ImageTypes    map[string]string `json:"image_types"`
	CodeTypes     map[string]string `json:"code_types"`
}

type CurrentIndexTypesReader interface {
	GetCurrentIndexTypes(context.Context, int32) (CurrentIndexTypes, error)
}

// CurrentIndexTypesRoute owns only the current read-only GET contract.
// Production composition mounts it atomically behind an explicit default-off
// feature gate.
type CurrentIndexTypesRoute struct {
	handler http.Handler
}

func NewCurrentIndexTypesRoute(
	reader CurrentIndexTypesReader,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentIndexTypesRoute, error) {
	if reader == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentIndexTypesRoute
	}

	endpoint := http.Handler(http.HandlerFunc(
		(&currentIndexTypesHandler{reader: reader}).get,
	))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentIndexTypesMode,
		currentIndexTypesProjectID,
		CurrentIndexTypesPermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)

	router := chi.NewRouter()
	router.Method(http.MethodGet, currentIndexTypesRoutePath, endpoint)
	return &CurrentIndexTypesRoute{handler: router}, nil
}

func (route *CurrentIndexTypesRoute) ServeHTTP(
	writer http.ResponseWriter,
	request *http.Request,
) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}

type currentIndexTypesHandler struct {
	reader CurrentIndexTypesReader
}

func (handler *currentIndexTypesHandler) get(
	writer http.ResponseWriter,
	request *http.Request,
) {
	projectID, ok := currentIndexTypesID(chi.URLParam(request, "projectID"))
	if !ok {
		writeCurrentIndexTypesFailure(writer)
		return
	}

	result, err := handler.reader.GetCurrentIndexTypes(request.Context(), projectID)
	if err != nil {
		writeCurrentIndexTypesFailure(writer)
		return
	}
	if result.DocumentTypes == nil {
		result.DocumentTypes = map[string]string{}
	}
	if result.ImageTypes == nil {
		result.ImageTypes = map[string]string{}
	}
	if result.CodeTypes == nil {
		result.CodeTypes = map[string]string{}
	}

	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(writer).Encode(result)
}

func currentIndexTypesProjectID(request *http.Request) (string, bool) {
	projectID, ok := currentIndexTypesID(chi.URLParam(request, "projectID"))
	if !ok {
		return "", false
	}
	return strconv.FormatInt(int64(projectID), 10), true
}

func currentIndexTypesID(value string) (int32, bool) {
	if value == "" {
		return 0, false
	}
	for _, digit := range value {
		if digit < '0' || digit > '9' {
			return 0, false
		}
	}
	parsed, err := strconv.ParseInt(value, 10, 32)
	return int32(parsed), err == nil && parsed > 0
}

func writeCurrentIndexTypesFailure(writer http.ResponseWriter) {
	writer.Header().Set("Content-Type", "application/json")
	writer.WriteHeader(http.StatusInternalServerError)
	_ = json.NewEncoder(writer).Encode(map[string]string{
		"error": "Failed to get index types",
	})
}
