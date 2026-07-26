package social

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strconv"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

const (
	CurrentFeedbackCreatePath       = "/api/v2/social/feedbacks/default/{projectID}"
	CurrentFeedbackCreateMode       = auth.PermissionModeDefault
	CurrentFeedbackCreatePermission = "models.social.feedbacks.create"
	MaxCurrentFeedbackBodyBytes     = 64 << 10
)

var ErrInvalidCurrentFeedbackCreateRoute = errors.New("invalid current feedback-create route dependencies")

// CurrentFeedbackCreator is the shared-table persistence boundary used by the
// current feedback endpoint. Project identity is deliberately absent: the
// existing centry.social_feedbacks table is shared, while project membership is
// enforced by the route before the request body is read.
type CurrentFeedbackCreator interface {
	CreateCurrentFeedback(
		ctx context.Context,
		userID int64,
		description string,
		rating int,
		referrer *string,
		userAgent string,
	) (int64, error)
}

// CurrentFeedbackCreateRoute owns only the current feedback POST. It remains a
// standalone route until production composition explicitly mounts the complete
// Social slice.
type CurrentFeedbackCreateRoute struct {
	handler http.Handler
}

func NewCurrentFeedbackCreateRoute(
	creator CurrentFeedbackCreator,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
) (*CurrentFeedbackCreateRoute, error) {
	if creator == nil || authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil || permissions == nil {
		return nil, ErrInvalidCurrentFeedbackCreateRoute
	}

	endpoint := http.Handler(http.HandlerFunc((&currentFeedbackCreateHandler{creator: creator}).create))
	endpoint = apimw.RequireResolvedPermissionsForProject(
		permissions,
		CurrentFeedbackCreateMode,
		currentFeedbackProjectID,
		CurrentFeedbackCreatePermission,
	)(endpoint)
	endpoint = apimw.Auth(authConfig)(endpoint)

	router := chi.NewRouter()
	router.Method(http.MethodPost, CurrentFeedbackCreatePath, endpoint)
	return &CurrentFeedbackCreateRoute{handler: router}, nil
}

func (route *CurrentFeedbackCreateRoute) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	if route == nil || route.handler == nil {
		http.NotFound(writer, request)
		return
	}
	route.handler.ServeHTTP(writer, request)
}

type currentFeedbackCreateHandler struct {
	creator CurrentFeedbackCreator
}

type currentFeedbackCreateRequest struct {
	Description *string `json:"description"`
	Rating      *int    `json:"rating"`
}

type currentFeedbackCreateResponse struct {
	ID int64 `json:"id"`
}

func (handler *currentFeedbackCreateHandler) create(writer http.ResponseWriter, request *http.Request) {
	principal, ok := auth.UserFromContext(request.Context())
	if !ok {
		writeCurrentFeedbackError(writer, http.StatusUnauthorized, "authentication required")
		return
	}
	userID, ok := principal.OwningUserID()
	if !ok {
		writeCurrentFeedbackError(writer, http.StatusUnauthorized, "authentication required")
		return
	}

	request.Body = http.MaxBytesReader(writer, request.Body, MaxCurrentFeedbackBodyBytes)
	var body currentFeedbackCreateRequest
	decoder := json.NewDecoder(request.Body)
	if err := decoder.Decode(&body); err != nil {
		var sizeError *http.MaxBytesError
		if errors.As(err, &sizeError) {
			writeCurrentFeedbackError(writer, http.StatusRequestEntityTooLarge, "request body is too large")
			return
		}
		writeCurrentFeedbackError(writer, http.StatusBadRequest, "invalid request")
		return
	}
	var trailing any
	if err := decoder.Decode(&trailing); !errors.Is(err, io.EOF) {
		writeCurrentFeedbackError(writer, http.StatusBadRequest, "invalid request")
		return
	}
	if body.Description == nil || body.Rating == nil || *body.Rating < 0 || *body.Rating > 5 {
		writeCurrentFeedbackError(writer, http.StatusBadRequest, "invalid request")
		return
	}

	var referrer *string
	if value := request.Referer(); value != "" {
		referrer = &value
	}
	id, err := handler.creator.CreateCurrentFeedback(
		request.Context(),
		userID,
		*body.Description,
		*body.Rating,
		referrer,
		request.UserAgent(),
	)
	if err != nil {
		writeCurrentFeedbackError(writer, http.StatusInternalServerError, "internal server error")
		return
	}

	writeJSON(writer, http.StatusCreated, currentFeedbackCreateResponse{ID: id})
}

func currentFeedbackProjectID(request *http.Request) (string, bool) {
	value := chi.URLParam(request, "projectID")
	projectID, err := strconv.ParseInt(value, 10, 64)
	return value, err == nil && projectID > 0 && strconv.FormatInt(projectID, 10) == value
}

func writeCurrentFeedbackError(writer http.ResponseWriter, status int, message string) {
	writeJSON(writer, status, map[string]string{"error": message})
}
