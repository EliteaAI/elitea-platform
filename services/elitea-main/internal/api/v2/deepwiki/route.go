package deepwiki

import (
	"errors"
	"log/slog"
	"math"
	"net/http"
	"strconv"
	"strings"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/go-chi/chi/v5"
)

// Facade paths, matching api/openapi/v2.yaml.
const (
	SlotsPath      = "/api/v2/deepwiki/slots/{project_id}"
	InvokePath     = "/api/v2/deepwiki/tools/{project_id}/{toolkit_name}/{tool_name}/invoke"
	InvocationPath = "/api/v2/deepwiki/invocations/{project_id}/{toolkit_name}/{tool_name}/{invocation_id}"
)

// Permissions.
//
// Reading capacity and starting a generation are deliberately NOT the same
// grant: `/slots` is what the UI polls to decide whether to offer the button,
// and gating it behind the write permission would make the page 403 for
// everyone who may look but not generate.
const (
	Mode = auth.PermissionModeDefault

	// ReadPermission covers /slots and polling an invocation.
	ReadPermission = "models.applications.deepwiki.read"
	// GeneratePermission covers starting and cancelling one.
	GeneratePermission = "models.applications.deepwiki.generate"
)

// ErrInvalidRoute reports missing route dependencies.
var ErrInvalidRoute = errors.New("invalid DeepWiki route dependencies")

// Route serves the DeepWiki facade.
//
// Nil-safe by construction: production composition mounts it only when the
// feature is enabled AND configured, and a nil Route still answers rather than
// panicking, because a mount that half-happened must not take the process
// down with it.
type Route struct {
	handler http.Handler
}

// NewRoute builds the facade.
//
// Every dependency is checked, PrincipalValidator included. That check is not
// ceremony: a nil validator at a composition root is the recurring shape of
// authentication bypass in this codebase, and it is invisible at runtime
// because the route serves perfectly well without one — it just does not
// authenticate.
func NewRoute(
	cfg Config,
	authConfig apimw.AuthConfig,
	permissions auth.PermissionResolver,
	credentials *CredentialResolver,
	minter CallbackMinter,
	logger *slog.Logger,
) (*Route, error) {
	if authConfig.PrincipalValidator == nil ||
		authConfig.ForwardedIdentityVerifier == nil ||
		permissions == nil {
		return nil, ErrInvalidRoute
	}

	proxy, err := NewProxy(cfg, logger)
	if err != nil {
		return nil, err
	}

	// The rewriter is not optional. Without it the facade would forward a
	// body naming a configuration id the provider cannot read, so every
	// generation would fail on a payload the caller wrote correctly — and it
	// would do so having already passed authentication and permissions, which
	// is the point at which a defect stops looking like a defect.
	rewriter, err := NewInvokeRewriter(
		credentials, minter, cfg.CallbackBaseURL, cfg.CallbackTokenTTL)
	if err != nil {
		return nil, err
	}
	if logger == nil {
		logger = slog.Default()
	}

	projectFromPath := func(request *http.Request) (string, bool) {
		projectID := chi.URLParam(request, "project_id")
		return projectID, validProjectID(projectID)
	}

	guard := func(permission string) func(http.Handler) http.Handler {
		return func(next http.Handler) http.Handler {
			endpoint := apimw.RequireResolvedPermissionsForProject(
				permissions, Mode, projectFromPath, permission,
			)(next)
			return apimw.Auth(authConfig)(endpoint)
		}
	}

	router := chi.NewRouter()

	router.Method(http.MethodGet, SlotsPath, guard(ReadPermission)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			proxy.Forward(w, r, providerSlotsPath,
				chi.URLParam(r, "project_id"), userIDFrom(r))
		})))

	router.Method(http.MethodPost, InvokePath, guard(GeneratePermission)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			toolkit := chi.URLParam(r, "toolkit_name")
			tool := chi.URLParam(r, "tool_name")
			invoke(w, r, proxy, rewriter, logger,
				providerInvokePath(toolkit, tool))
		})))

	router.Method(http.MethodGet, InvocationPath, guard(ReadPermission)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			proxy.Forward(w, r, invocationPathFrom(r),
				chi.URLParam(r, "project_id"), userIDFrom(r))
		})))

	// Cancelling is a write. Polling is not, and they share a path — so the
	// two methods carry different permissions on the same route.
	router.Method(http.MethodDelete, InvocationPath, guard(GeneratePermission)(
		http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			proxy.Forward(w, r, invocationPathFrom(r),
				chi.URLParam(r, "project_id"), userIDFrom(r))
		})))

	return &Route{handler: router}, nil
}

func invocationPathFrom(r *http.Request) string {
	return providerInvocationPath(
		chi.URLParam(r, "toolkit_name"),
		chi.URLParam(r, "tool_name"),
		chi.URLParam(r, "invocation_id"),
	)
}

// ServeHTTP answers even when the route was never built, so a deployment with
// DeepWiki disabled returns a readable 503 rather than a nil-pointer panic.
func (route *Route) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if route == nil || route.handler == nil {
		writeError(w, http.StatusServiceUnavailable,
			"DeepWiki is not enabled in this deployment.")
		return
	}
	route.handler.ServeHTTP(w, r)
}

// validProjectID accepts only a positive decimal id that fits an int32.
//
// The value reaches the permission resolver and the provider, so a
// non-numeric one must be rejected before either sees it rather than being
// passed along to fail somewhere less obvious.
//
// THE UPPER BOUND IS NOT COSMETIC, and it is the same aliasing bug
// agentexecution/route.go documents at length. The id is narrowed to int32 to
// read a configuration (the underlying columns are Postgres `integer`), and in
// Go that narrowing is a silent truncation: without this bound `4294967301`
// truncates to `5`, so a caller could name an out-of-range project and have
// the facade resolve project 5's stored credentials — and push them to the
// provider. CodeQL found the conversion (go/incorrect-integer-conversion);
// the bound belongs here, at the only parse in this request path, rather than
// at each narrowing downstream.
//
// Rejecting rather than clamping: an id above MaxInt32 cannot correspond to
// any row in an `integer` column, so "no such project" is the honest answer.
func validProjectID(raw string) bool {
	if raw == "" || strings.HasPrefix(raw, "0") && raw != "0" {
		return false
	}
	value, err := strconv.ParseInt(raw, 10, 64)
	return err == nil && value > 0 && value <= math.MaxInt32
}

// userIDFrom reads the authenticated user for the signed identity.
//
// RuntimePrincipalFromContext, not UserFromContext: the former requires the
// server-derived provenance marker that only the authentication middleware
// sets, so a context carrying a user placed there by some other path yields
// nothing rather than an identity this facade would then sign.
//
// Empty is acceptable and is what the signer receives for a caller whose
// principal carries no owning user; llmproxy omits the header rather than
// signing a blank one.
func userIDFrom(r *http.Request) string {
	principal, ok := auth.RuntimePrincipalFromContext(r.Context())
	if !ok {
		return ""
	}
	if owner, ok := principal.OwningUserID(); ok {
		return strconv.FormatInt(owner, 10)
	}
	return ""
}
