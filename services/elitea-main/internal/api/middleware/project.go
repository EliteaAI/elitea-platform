package middleware

import (
	"context"
	"fmt"
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

// Project selector headers on the /llm edge (issue #318, ADR-0018).
//
// /llm is a documented external endpoint. The caller authenticates with a
// personal access token, so the token names the user and not the project. A
// caller that works on a team must therefore name the project to bill, or all
// team spend lands on the caller's personal project budget.
//
// Two header names are accepted: X-Project-Id, then OpenAI-Organization. The
// legacy runtime accepted both (runtime_interface_litellm proxy.prepare_request).
const (
	// HeaderProjectSelector is the primary, semantic selector name.
	HeaderProjectSelector = "X-Project-Id"
	// HeaderProjectSelectorOpenAIProject is NOT a selector, and MUST NOT
	// become one. See projectSelectorHeaders for the reason.
	HeaderProjectSelectorOpenAIProject = "OpenAI-Project"
	// HeaderProjectSelectorOpenAIOrg is the legacy OpenAI-compatible name.
	HeaderProjectSelectorOpenAIOrg = "OpenAI-Organization"
)

// Error codes on the /llm project-resolution path (spec-llm-project-scope §8).
// The envelope is the OpenAI-compatible {"error":{"message","type","code"}}
// produced by writeJSONError.
const (
	// errTypeInvalidRequest is the OpenAI-compatible error type for both codes.
	errTypeInvalidRequest = "invalid_request_error"
	// codeProjectNotResolved reports that no project could be determined.
	codeProjectNotResolved = "project_not_resolved"
	// codeProjectScopeConflict reports a selector that contradicts a bound
	// token. It is the only refusal on this path.
	codeProjectScopeConflict = "project_scope_conflict"
)

// projectSelectorHeaders lists the accepted selector headers in precedence
// order. The first header that carries a non-blank value wins.
//
// OpenAI-Project is absent on purpose, and MUST stay absent (ADR-0018,
// spec-llm-project-scope §6.1). The web UI fills that header from
// model.project_id — the project that OWNS THE MODEL, not the project that
// pays (apps/elitea-web/src/features/settings/lib/ai-configuration/useCodePreview.ts
// and codeExamples.helpers.ts). The models query passes includeShared, so that
// value is frequently the public or shared project. Reading it as the billing
// selector would bill the shared project for every user who copies the UI's own
// generated sample.
var projectSelectorHeaders = []string{
	HeaderProjectSelector,
	HeaderProjectSelectorOpenAIOrg,
}

// projectHeadersStrippedOutbound lists every project header the proxy deletes
// from the outbound request. It is a superset of the accepted selectors:
// OpenAI-Project is never read for billing, but it must not travel onward
// either, because a real provider reads that name.
var projectHeadersStrippedOutbound = []string{
	HeaderProjectSelector,
	HeaderProjectSelectorOpenAIProject,
	HeaderProjectSelectorOpenAIOrg,
}

// ProjectSelectorHeaders returns the accepted selector header names, in
// precedence order.
func ProjectSelectorHeaders() []string {
	names := make([]string, len(projectSelectorHeaders))
	copy(names, projectSelectorHeaders)
	return names
}

// ProjectHeadersStrippedOutbound returns the project headers the proxy deletes
// from the outbound request. The edge consumes the selector, so it must not
// also travel to the gateway and onward to a provider.
func ProjectHeadersStrippedOutbound() []string {
	names := make([]string, len(projectHeadersStrippedOutbound))
	copy(names, projectHeadersStrippedOutbound)
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
	// admits no selector that names a project other than the caller's own: the
	// request proceeds on the resolved project instead.
	Membership ProjectMembershipChecker
}

// Project resolves the project id from the authenticated caller and injects a
// ProjectContext into the request context.
//
// Resolution follows spec-llm-project-scope §5, and no other algorithm:
//
//  1. Token bound, no usable selector → the bound project.
//  2. Token bound, selector equal to the binding → the bound project.
//  3. Token bound, selector naming a different project → HTTP 400
//     project_scope_conflict.
//  4. Token unbound → the caller's own project (system project-user name, else
//     the personal-project lookup), which a selector header may then replace
//     after a membership check (issue #318). See admitProjectSelector.
//
// The binding is read BEFORE the personal-project lookup, so a bound token
// whose owner has no resolvable personal project still succeeds on its binding.
// A bound token also runs no membership query: membership was checked when the
// token was created (spec §4), and the binding is deleted when the owner loses
// membership (spec §7.3).
//
// When no authenticated user is present the request passes through unchanged
// (the Auth middleware is responsible for rejecting unauthenticated callers).
// When a user is present but no project can be resolved, the request is rejected
// with HTTP 400, matching pylon's behaviour.
//
// Row 3 is the only refusal here. Every other inadmissible selector is ignored
// in silence. See admitProjectSelector for why.
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

			projectID, ok := resolveEdgeProject(ctx, w, r, cfg, user)
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

// resolveEdgeProject returns the project to bill, or false when it has already
// written the refusal to w.
//
// The two arms are exclusive on purpose. A bound token takes the bound project
// and consults neither the resolver nor the membership checker, because both
// questions are already answered: the binding names the project, and membership
// was verified at token creation.
func resolveEdgeProject(
	ctx context.Context,
	w http.ResponseWriter,
	r *http.Request,
	cfg ProjectConfig,
	user auth.User,
) (int, bool) {
	if boundID, bound := boundProjectID(user); bound {
		return admitSelectorAgainstBinding(w, r, boundID)
	}

	projectID, err := resolveProjectID(ctx, cfg.Resolver, user)
	if err != nil || projectID <= 0 {
		writeJSONError(w, http.StatusBadRequest, errTypeInvalidRequest, codeProjectNotResolved,
			"could not resolve project for caller")
		return 0, false
	}
	return admitProjectSelector(ctx, r, cfg.Membership, user, projectID), true
}

// boundProjectID returns the project the caller's access token is bound to.
//
// Only a credential validator that read the binding from storage may set this
// field (spec §3.2). It is never derived from a header, from the token name, or
// from the principal name, so a bound value is a statement the platform made
// and not one the caller made.
//
// A binding outside the int4 project-id range names no project, so it reads as
// unbound. The stored column is an integer and cannot hold such a value; the
// guard exists so an out-of-range value can only cost the caller a fallback to
// its own project, never a claim on somebody else's.
func boundProjectID(user auth.User) (int, bool) {
	if user.TokenProjectID == nil {
		return 0, false
	}
	id := *user.TokenProjectID
	if id <= 0 || id > math.MaxInt32 {
		return 0, false
	}
	return int(id), true
}

// admitSelectorAgainstBinding applies spec §5 rows 1-3 for a bound token.
//
//   - No usable selector: proceed on the binding (row 1).
//   - Selector equal to the binding: proceed on the binding (row 2).
//   - Selector naming a different project: refuse with HTTP 400 (row 3).
//
// Row 3 is the only refusal the /llm project path produces, and it fires only
// when the caller actually named a project. A selector that parses to nothing —
// blank, non-numeric, non-positive, wider than int4, or a repeated header — is
// absent by §6.2, for a bound token exactly as for an unbound one. No project
// was named, so there is nothing to contradict.
//
// The refusal exists because ignoring the header would bill the bound project
// while the caller believes it redirected the spend. That divergence surfaces
// later as an accounting discrepancy nobody can attribute (ADR-0018). A 400 is
// legible at the call site.
func admitSelectorAgainstBinding(w http.ResponseWriter, r *http.Request, boundID int) (int, bool) {
	requestedID, present := projectSelectorFromHeaders(r.Header)
	if !present || requestedID == boundID {
		return boundID, true
	}

	// The message names both projects, because the whole reason this rejects
	// instead of ignoring is that the caller learns which two statements
	// disagreed (spec §8). It says nothing about whether the caller belongs to
	// the selector project: no membership query ran, and the answer would tell
	// an unbound-token holder which projects exist and who is in them.
	writeJSONError(w, http.StatusBadRequest, errTypeInvalidRequest, codeProjectScopeConflict,
		fmt.Sprintf(
			"the access token is bound to project %d, and the request selects project %d. "+
				"Send no project selector, or select project %d.",
			boundID, requestedID, boundID,
		))
	return 0, false
}

// admitProjectSelector applies the caller-supplied project selector to
// resolvedID and returns the project to bill. It never fails the request.
//
// The outcomes, from spec-llm-project-scope §5 rows 4-7:
//   - No selector: return resolvedID unchanged. This is the whole behaviour of
//     the path before issue #318, so a caller that sends no selector sees no
//     change at all.
//   - Selector names the caller's own resolved project: admit it without a
//     membership query. The caller is already entitled to that project.
//   - Selector names another project the caller belongs to: admit it.
//   - Selector names a project the caller does NOT belong to: return resolvedID,
//     in silence.
//   - The membership check cannot run, or it errors: return resolvedID, in
//     silence.
//
// An inadmissible selector is ignored and is never refused. Issue #318 requires
// this: its "done means" says a non-member selector must be "not honoured, not
// 500", because the fix must not add a failure mode for an existing caller. The
// UI's Node and Python samples pass the OpenAI SDK "project" option today, and
// both SDKs send that option as the OpenAI-Project header. Every caller of those
// samples would break on a 403.
//
// The silent path always falls back to the CALLER'S OWN project, never to the
// selector. A membership check that times out must not authorize spend on an
// arbitrary project (spec §7 invariant 5).
//
// Refusal is reserved for one case, which this function never reaches: a token
// explicitly BOUND to a project, plus a selector that contradicts the binding
// (spec §5 row 3). That is a conflict between two explicit statements, and
// admitSelectorAgainstBinding handles it. A bound token never arrives here.
func admitProjectSelector(
	ctx context.Context,
	r *http.Request,
	membership ProjectMembershipChecker,
	user auth.User,
	resolvedID int,
) int {
	requestedID, present := projectSelectorFromHeaders(r.Header)
	if !present {
		return resolvedID
	}
	if requestedID == resolvedID {
		return resolvedID
	}
	if membership == nil {
		return resolvedID
	}

	// Membership is a property of the owning user, never of the token. A token
	// principal whose owner was not resolved cannot be checked, so it cannot
	// name a project. OwningUserID refuses to answer for such a principal.
	owningUserID, resolved := user.OwningUserID()
	if !resolved {
		return resolvedID
	}

	member, err := membership.IsProjectMember(ctx, owningUserID, requestedID)
	if err != nil || !member {
		return resolvedID
	}
	return requestedID
}

// projectSelectorFromHeaders returns the project named by the first accepted
// selector header that is present.
//
// A selector that does not name a project is reported as absent (spec §6.2):
// a blank value, a value that is not a positive int32, or a header that appears
// more than once. The repeated-header rule follows uniqueForwardedIdentityHeader
// in auth.go, the posture this service already applies to an identity-bearing
// header: when two copies disagree, no rule can say which copy the caller meant.
//
// A present header that names no project does not fall through to the next
// header. §6.1 picks the selector by the first header present, and §6.2 then
// judges that one value.
func projectSelectorFromHeaders(h http.Header) (int, bool) {
	for _, name := range projectSelectorHeaders {
		value, present, unique := uniqueProjectSelectorHeader(h, name)
		if !present {
			continue
		}
		if !unique {
			return 0, false
		}
		return positiveProjectID(value)
	}
	return 0, false
}

// uniqueProjectSelectorHeader returns the single trimmed value of the header
// name, whether the header is present, and whether it appears exactly once. A
// blank value counts as absent.
func uniqueProjectSelectorHeader(h http.Header, name string) (string, bool, bool) {
	var values []string
	for key, current := range h {
		if strings.EqualFold(key, name) {
			values = append(values, current...)
		}
	}
	if len(values) > 1 {
		return "", true, false
	}
	if len(values) == 0 {
		return "", false, true
	}
	value := strings.TrimSpace(values[0])
	if value == "" {
		return "", false, true
	}
	return value, true, true
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
