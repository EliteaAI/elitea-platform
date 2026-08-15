package middleware

import (
	"context"
	"math"
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

// Project selector headers accepted on the /llm edge (issue #318).
//
// /llm is a documented external endpoint. The caller authenticates with a
// personal access token, so the token names the user and not the project. A
// caller that works on a team must therefore name the project to bill, or all
// team spend lands on the caller's personal project budget.
//
// Three header names are accepted. Legacy accepted X-Project-Id and
// OpenAI-Organization (legacy runtime_interface_litellm proxy.prepare_request).
// The AI-configuration page advertises OpenAI-Project. Accepting all three
// makes the advertised header and the legacy headers both work.
const (
	// HeaderProjectSelector is the primary, semantic selector name.
	HeaderProjectSelector = "X-Project-Id"
	// HeaderProjectSelectorOpenAIProject is the name the UI advertises.
	HeaderProjectSelectorOpenAIProject = "OpenAI-Project"
	// HeaderProjectSelectorOpenAIOrg is the legacy OpenAI-compatible name.
	HeaderProjectSelectorOpenAIOrg = "OpenAI-Organization"
)

// projectSelectorHeaders lists the selector headers in precedence order. The
// first header that carries a non-empty value wins.
var projectSelectorHeaders = []string{
	HeaderProjectSelector,
	HeaderProjectSelectorOpenAIProject,
	HeaderProjectSelectorOpenAIOrg,
}

// ProjectSelectorHeaders returns the accepted selector header names. The proxy
// deletes them from the outbound request: the edge consumes the selector, so it
// must not also travel to the gateway and onward to a provider.
func ProjectSelectorHeaders() []string {
	names := make([]string, len(projectSelectorHeaders))
	copy(names, projectSelectorHeaders)
	return names
}

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
	// Membership admits a caller-supplied project selector. A nil checker
	// refuses every selector that names a project other than the caller's own.
	Membership ProjectMembershipChecker
}

// Project resolves the project id from the authenticated caller and injects a
// ProjectContext into the request context.
//
// Resolution mirrors pylon runtime_interface_litellm proxy.prepare_request:
//  1. If the caller's user name carries the ":system:project:<id>:" prefix, the
//     project id is parsed directly from the name.
//  2. Otherwise the caller's personal project is looked up via the resolver.
//  3. A project selector header then overrides the result, but only after a
//     membership check against the authenticated user (issue #318).
//
// When no authenticated user is present the request passes through unchanged
// (the Auth middleware is responsible for rejecting unauthenticated callers).
// When a user is present but no project can be resolved, the request is rejected
// with HTTP 400, matching pylon's behaviour.
//
// The resolved project becomes the signed identity forwarded to the gateway,
// and the gateway bills strictly on it. A selector the caller may not use is
// therefore refused, never downgraded to the caller's own project: a silent
// downgrade moves team spend onto a personal budget without telling anybody,
// which is the exact defect this path had.
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
				writeJSONError(w, http.StatusBadRequest, "invalid_request_error", "project_not_resolved", "could not resolve project for caller")
				return
			}

			projectID, ok = admitProjectSelector(ctx, w, r, cfg.Membership, user, projectID)
			if !ok {
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

// admitProjectSelector applies the caller-supplied project selector to
// resolvedID. It returns the project to bill and true when the request may
// continue. It writes the error response and returns false when it refuses.
//
// The four outcomes:
//   - No selector header: return resolvedID unchanged. This is the whole
//     behaviour of the path before issue #318, so an existing caller that sends
//     no selector sees no change at all.
//   - Selector names the caller's own resolved project: admit it without a
//     membership query. The caller is already entitled to that project.
//   - Selector names another project the caller belongs to: admit it.
//   - Selector is malformed, unauthorized, or unverifiable: refuse.
func admitProjectSelector(
	ctx context.Context,
	w http.ResponseWriter,
	r *http.Request,
	membership ProjectMembershipChecker,
	user auth.User,
	resolvedID int,
) (int, bool) {
	selector, header, present := projectSelectorFromHeaders(r.Header)
	if !present {
		return resolvedID, true
	}

	requestedID, valid := positiveProjectID(selector)
	if !valid {
		writeJSONError(w, http.StatusBadRequest, "invalid_request_error", "invalid_project_selector",
			"header "+header+" must carry a positive Elitea project id")
		return 0, false
	}
	if requestedID == resolvedID {
		return resolvedID, true
	}

	// Fail closed. An unconfigured checker cannot admit a selector, and
	// answering with the caller's own project would hide the misconfiguration.
	if membership == nil {
		writeJSONError(w, http.StatusServiceUnavailable, "api_error", "project_authorization_unavailable",
			"project authorization is unavailable")
		return 0, false
	}

	// Membership is a property of the owning user, never of the token. A token
	// principal whose owner was not resolved cannot be checked, so it cannot
	// name a project. OwningUserID refuses to answer for such a principal.
	owningUserID, resolved := user.OwningUserID()
	if !resolved {
		writeJSONError(w, http.StatusForbidden, "invalid_request_error", "project_forbidden",
			"the caller identity carries no owning user, so no project selector is admitted")
		return 0, false
	}

	member, err := membership.IsProjectMember(ctx, owningUserID, requestedID)
	if err != nil {
		writeJSONError(w, http.StatusServiceUnavailable, "api_error", "project_authorization_unavailable",
			"project authorization is unavailable")
		return 0, false
	}
	if !member {
		writeJSONError(w, http.StatusForbidden, "invalid_request_error", "project_forbidden",
			"the caller has no access to the project named by "+header)
		return 0, false
	}
	return requestedID, true
}

// projectSelectorFromHeaders returns the first project selector present and the
// header that carried it. A blank value counts as absent.
func projectSelectorFromHeaders(h http.Header) (string, string, bool) {
	for _, name := range projectSelectorHeaders {
		if value := strings.TrimSpace(h.Get(name)); value != "" {
			return value, name, true
		}
	}
	return "", "", false
}

// positiveProjectID parses a selector as a positive project id. Project ids are
// int4 in PostgreSQL, so a larger value is invalid and never reaches the query.
func positiveProjectID(value string) (int, bool) {
	id, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || id <= 0 || id > math.MaxInt32 {
		return 0, false
	}
	return id, true
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
