package middleware

import (
	"context"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

// projectUserNamePrefix mirrors pylon's projects.constants.PROJECT_USER_NAME_PREFIX.
// System project-user tokens carry a name of the form ":system:project:<id>:".
const projectUserNamePrefix = ":system:project:"

// defaultPublicProjectID mirrors pylon's elitea_config "ai_project_id" default (1).
const defaultPublicProjectID = 1

// projectLookupTimeout bounds the personal-project DB lookup so a slow store
// cannot stall the request. Mirrors the intent of pylon's rpc timeout(30) but
// is much tighter for the streaming edge path.
const projectLookupTimeout = 2 * time.Second

// systemUserEmailRe matches pylon's PROJECT_USER_EMAIL_TEMPLATE
// ("system_user_{}@centry.user") used as a fallback source of the project id.
var systemUserEmailRe = regexp.MustCompile(`^system_user_(\d+)@centry\.user$`)

type projectCtxKey struct{}

// ProjectContext holds the project identity resolved at the edge from the
// authenticated caller. It is injected into the request context and later
// surfaced as signed identity headers on the proxied /llm request (BF0.2a).
type ProjectContext struct {
	// ProjectID is the caller's resolved project (virtual-key scope).
	ProjectID int
	// PublicProjectID is the platform's shared/public project used as the
	// model-alias fallback namespace.
	PublicProjectID int
}

// ProjectFromContext returns the resolved project context, if present.
func ProjectFromContext(ctx context.Context) (ProjectContext, bool) {
	pc, ok := ctx.Value(projectCtxKey{}).(ProjectContext)
	return pc, ok
}

// ContextWithProject returns a copy of ctx carrying the resolved project context.
func ContextWithProject(ctx context.Context, pc ProjectContext) context.Context {
	return context.WithValue(ctx, projectCtxKey{}, pc)
}

// PersonalProjectResolver looks up the personal project id for a user, mirroring
// pylon's projects_get_personal_project_id RPC. It returns (0, nil) when no
// personal project can be determined (not an error — the caller decides).
type PersonalProjectResolver interface {
	PersonalProjectID(ctx context.Context, userID string) (int, error)
}

// ProjectConfig configures the Project middleware.
type ProjectConfig struct {
	// Resolver resolves a user's personal project id (DB-backed in production).
	Resolver PersonalProjectResolver
	// PublicProjectID is the platform's shared project id. When zero it is read
	// from the AI_PROJECT_ID environment variable, defaulting to 1.
	PublicProjectID int
}

// Project resolves the project id from the authenticated caller and injects a
// ProjectContext into the request context.
//
// Resolution mirrors pylon runtime_interface_litellm proxy.prepare_request:
//  1. If the caller's user name carries the ":system:project:<id>:" prefix, the
//     project id is parsed directly from the name.
//  2. Otherwise the caller's personal project is looked up via the resolver.
//
// When no authenticated user is present the request passes through unchanged
// (the Auth middleware is responsible for rejecting unauthenticated callers).
// When a user is present but no project can be resolved, the request is rejected
// with HTTP 400, matching pylon's behaviour.
func Project(cfg ProjectConfig) func(http.Handler) http.Handler {
	publicProjectID := cfg.PublicProjectID
	if publicProjectID == 0 {
		publicProjectID = publicProjectIDFromEnv()
	}

	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			user, ok := auth.UserFromContext(r.Context())
			if !ok {
				// Unauthenticated: let downstream auth handling decide.
				next.ServeHTTP(w, r)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), projectLookupTimeout)
			defer cancel()

			projectID, err := resolveProjectID(ctx, cfg.Resolver, user)
			if err != nil || projectID <= 0 {
				http.Error(w, `{"error":"could not resolve project for caller"}`, http.StatusBadRequest)
				return
			}

			pc := ProjectContext{
				ProjectID:       projectID,
				PublicProjectID: publicProjectID,
			}
			next.ServeHTTP(w, r.WithContext(ContextWithProject(r.Context(), pc)))
		})
	}
}

// resolveProjectID derives the caller's project id, mirroring pylon's
// prepare_request token branch:
//   - system project-user name (":system:project:<id>:") → parse id from name
//   - otherwise → personal project lookup via the resolver
//
// It returns 0 (with no error) when the project cannot be determined.
func resolveProjectID(ctx context.Context, resolver PersonalProjectResolver, user auth.User) (int, error) {
	if id, ok := projectIDFromUserName(user.Name); ok {
		return id, nil
	}

	if resolver == nil {
		return 0, nil
	}
	return resolver.PersonalProjectID(ctx, user.ID)
}

// projectIDFromUserName parses the project id from a system project-user name of
// the form ":system:project:<id>:". The trailing colon means the id is the
// second-to-last colon-separated field, matching pylon's name.split(":")[-2].
func projectIDFromUserName(name string) (int, bool) {
	if !strings.HasPrefix(name, projectUserNamePrefix) {
		return 0, false
	}
	parts := strings.Split(name, ":")
	if len(parts) < 2 {
		return 0, false
	}
	id, err := strconv.Atoi(parts[len(parts)-2])
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

func publicProjectIDFromEnv() int {
	if v := os.Getenv("AI_PROJECT_ID"); v != "" {
		if id, err := strconv.Atoi(v); err == nil && id > 0 {
			return id
		}
	}
	return defaultPublicProjectID
}
