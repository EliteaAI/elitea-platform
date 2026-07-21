package browserauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"time"

	"golang.org/x/net/http/httpguts"

	forwardapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/forwardauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
)

// MainForwardAuthPath is an internal gateway address, not a browser-facing
// compatibility alias. The gateway calls it before forwarding every request
// to the current Main during the incremental cutover.
const MainForwardAuthPath = "/internal/forward-auth/main"

const mainDecisionTimeout = 15 * time.Second

type MainAuthorizer interface {
	Authorize(context.Context, forwardapp.Request) (forwardapp.Decision, error)
}

type MainConfig struct {
	CredentialHeaders  []CredentialHeader
	AccessDeniedTarget string
}

// MainHandler translates one trusted gateway request into the typed in-process
// Main authorization call. It intentionally does not accept target/scope query
// selection: the only supported output is the canonical RPC identity header
// projection consumed by the current Main traefik mode.
type MainHandler struct {
	authorizer         MainAuthorizer
	sources            *TrustedProxyResolver
	cookies            *CookiePolicy
	credentialHeaders  []CredentialHeader
	accessDeniedTarget string
}

func NewMainHandler(
	authorizer MainAuthorizer,
	sources *TrustedProxyResolver,
	cookies *CookiePolicy,
	config MainConfig,
) (*MainHandler, error) {
	if authorizer == nil || sources == nil || cookies == nil ||
		len(config.CredentialHeaders) >= forwardapp.MaxCredentials {
		return nil, ErrInvalidHandlerConfiguration
	}
	if config.AccessDeniedTarget == "" {
		config.AccessDeniedTarget = "/app/access_denied"
	}
	if browserflow.ValidateReturnTarget(config.AccessDeniedTarget) != nil {
		return nil, ErrInvalidHandlerConfiguration
	}

	seen := make(map[string]struct{}, len(config.CredentialHeaders))
	headers := append([]CredentialHeader(nil), config.CredentialHeaders...)
	for _, header := range headers {
		name := http.CanonicalHeaderKey(header.Name)
		if !httpguts.ValidHeaderFieldName(header.Name) ||
			strings.EqualFold(name, "Authorization") || header.Type != "bearer" && header.Type != "basic" {
			return nil, ErrInvalidHandlerConfiguration
		}
		if _, duplicate := seen[name]; duplicate {
			return nil, ErrInvalidHandlerConfiguration
		}
		seen[name] = struct{}{}
	}

	return &MainHandler{
		authorizer:         authorizer,
		sources:            sources,
		cookies:            cookies,
		credentialHeaders:  headers,
		accessDeniedTarget: config.AccessDeniedTarget,
	}, nil
}

func (h *MainHandler) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	securityHeaders(writer)
	if request.URL.RawQuery != "" {
		writeProblem(writer, http.StatusBadRequest)
		return
	}
	forwarded, err := h.sources.Resolve(request)
	if err != nil {
		writeProblem(writer, http.StatusForbidden)
		return
	}

	// Main always consumes the fixed RPC projection. Caller-selected mappers
	// would turn an internal gateway edge into a second public Auth Core API.
	forwarded.Target = "rpc"
	forwarded.TargetPresent = true
	forwarded.Scope = ""
	forwarded.ScopePresent = false

	browserSession := forwardapp.BrowserSessionInput{}
	sessionID, readErr := h.cookies.Read(request)
	switch {
	case readErr == nil:
		browserSession = forwardapp.BrowserSessionInput{Present: true, ID: sessionID, Reference: "-"}
	case errors.Is(readErr, ErrSessionCookieMissing):
	case errors.Is(readErr, ErrSessionCookieInvalid):
		if clearErr := h.cookies.Clear(writer); clearErr != nil {
			writeProblem(writer, http.StatusServiceUnavailable)
			return
		}
	default:
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}

	decisionContext, cancelDecision := context.WithTimeout(request.Context(), mainDecisionTimeout)
	defer cancelDecision()
	decision, err := h.authorizer.Authorize(decisionContext, forwardapp.Request{
		Source:         applicationSource(forwarded),
		Credentials:    credentials(request.Header, h.credentialHeaders),
		BrowserSession: browserSession,
		Traversal:      forwardapp.MainTraversal,
	})
	if err != nil {
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}

	if browserSession.Present && (decision.Kind == forwardapp.DecisionLogin ||
		decision.Authentication.Type == forwardapp.AuthenticationPublic) {
		if clearErr := h.cookies.Clear(writer); clearErr != nil {
			writeProblem(writer, http.StatusServiceUnavailable)
			return
		}
	}

	switch decision.Kind {
	case forwardapp.DecisionAllow:
		if !writeMainIdentity(writer, decision) {
			writeProblem(writer, http.StatusServiceUnavailable)
		}
	case forwardapp.DecisionDeny:
		http.Redirect(writer, request, h.accessDeniedTarget, http.StatusFound)
	case forwardapp.DecisionLogin:
		query := url.Values{"target_to": {forwarded.URI}}
		http.Redirect(writer, request, BasePath+LoginPath+"?"+query.Encode(), http.StatusFound)
	case forwardapp.DecisionDependencyFailure:
		writeProblem(writer, http.StatusServiceUnavailable)
	default:
		writeProblem(writer, http.StatusServiceUnavailable)
	}
}

func writeMainIdentity(writer http.ResponseWriter, decision forwardapp.Decision) bool {
	switch decision.Authentication.Type {
	case forwardapp.AuthenticationToken:
		writer.Header().Set("X-Auth-Type", "token")
		writer.Header().Set("X-Auth-ID", decision.Authentication.Principal.TokenID)
		writer.Header().Set("X-Auth-User-ID", decision.Authentication.Principal.UserID)
	case forwardapp.AuthenticationUser:
		writer.Header().Set("X-Auth-Type", "user")
		writer.Header().Set("X-Auth-ID", decision.Authentication.Principal.UserID)
		writer.Header().Set("X-Auth-User-ID", decision.Authentication.Principal.UserID)
	case forwardapp.AuthenticationPublic:
		writer.Header().Set("X-Auth-Type", "public")
		writer.Header().Set("X-Auth-ID", "-")
		writer.Header().Set("X-Auth-User-ID", "-")
	default:
		return false
	}
	writer.Header().Set("X-Auth-Reference", "-")
	writeForwardAuthOK(writer)
	return true
}
