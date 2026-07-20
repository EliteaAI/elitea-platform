package browserauth

import (
	"context"
	"errors"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"unicode"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
)

const (
	OIDCLoginPath         = "/auth_oidc/login"
	OIDCLoginCallbackPath = "/auth_oidc/login_callback"
	OIDCPKCEChallengeS256 = browserapp.OIDCPKCEChallengeS256

	DefaultMaxOIDCCallbackBytes = int64(8 << 10)
	maxMaxOIDCCallbackBytes     = int64(64 << 10)
	maxOIDCCallbackParameters   = 16
	maxOIDCCallbackKeyBytes     = 128
	maxOIDCCallbackValueBytes   = 4096
	maxOIDCAuthorizationURL     = 16 << 10
)

var errOIDCCallbackRejected = errors.New("OIDC authorization response rejected")

type OIDCAuthorization = browserapp.OIDCAuthorization
type OIDCProtocol = browserapp.OIDCProtocol

type OIDCHandlerConfig struct {
	DefaultLoginTarget string
	MaxCallbackBytes   int64
}

// OIDCHandler preserves the current auth_oidc route boundary without mounting
// it in the production router. Construction requires a trusted client-key
// policy and a cross-replica attempt admitter so admission happens before
// Service.Begin allocates a session or transaction.
type OIDCHandler struct {
	flow               Flow
	protocol           OIDCProtocol
	attempts           AttemptAdmitter
	clientKeys         ClientKeyResolver
	cookies            *CookiePolicy
	defaultLoginTarget string
	maxCallbackBytes   int64
}

func NewOIDCHandler(
	flow Flow,
	protocol OIDCProtocol,
	attempts AttemptAdmitter,
	clientKeys ClientKeyResolver,
	cookies *CookiePolicy,
	config OIDCHandlerConfig,
) (*OIDCHandler, error) {
	if flow == nil || protocol == nil || attempts == nil || clientKeys == nil || cookies == nil {
		return nil, ErrInvalidHandlerConfiguration
	}
	if config.DefaultLoginTarget == "" {
		config.DefaultLoginTarget = "/"
	}
	if browserflow.ValidateReturnTarget(config.DefaultLoginTarget) != nil {
		return nil, ErrInvalidHandlerConfiguration
	}
	if config.MaxCallbackBytes == 0 {
		config.MaxCallbackBytes = DefaultMaxOIDCCallbackBytes
	}
	if config.MaxCallbackBytes < 1024 || config.MaxCallbackBytes > maxMaxOIDCCallbackBytes {
		return nil, ErrInvalidHandlerConfiguration
	}
	return &OIDCHandler{
		flow:               flow,
		protocol:           protocol,
		attempts:           attempts,
		clientKeys:         clientKeys,
		cookies:            cookies,
		defaultLoginTarget: config.DefaultLoginTarget,
		maxCallbackBytes:   config.MaxCallbackBytes,
	}, nil
}

// Routes preserves the current OIDC paths and callback transports. HEAD is an
// intentional security correction: unlike the current Flask boundary it never
// aliases a mutating GET. The router remains unmounted in production.
func (h *OIDCHandler) Routes() chi.Router {
	router := chi.NewRouter()
	router.MethodNotAllowed(func(writer http.ResponseWriter, _ *http.Request) {
		securityHeaders(writer)
		writeProblem(writer, http.StatusBadRequest)
	})
	h.registerReadRoute(router, OIDCLoginPath, h.beginLogin)
	h.registerCallbackRoute(router, OIDCLoginCallbackPath, h.completeLogin)
	return router
}

func (h *OIDCHandler) registerReadRoute(router chi.Router, path string, handler http.HandlerFunc) {
	router.MethodFunc(http.MethodGet, path, handler)
	router.MethodFunc(http.MethodHead, path, head(rejectOIDCHead("GET, OPTIONS")))
	router.MethodFunc(http.MethodOptions, path, options("GET, OPTIONS"))
}

func (h *OIDCHandler) registerCallbackRoute(router chi.Router, path string, handler http.HandlerFunc) {
	router.MethodFunc(http.MethodGet, path, handler)
	router.MethodFunc(http.MethodHead, path, head(rejectOIDCHead("GET, POST, OPTIONS")))
	router.MethodFunc(http.MethodPost, path, handler)
	router.MethodFunc(http.MethodOptions, path, options("GET, POST, OPTIONS"))
}

func (h *OIDCHandler) beginLogin(writer http.ResponseWriter, request *http.Request) {
	securityHeaders(writer)
	if !admitAttempt(writer, request, h.attempts, h.clientKeys, BrowserAttempt{Stage: BrowserAttemptOIDCBegin}) {
		return
	}
	if hasUnexpectedReadBody(request) {
		writeProblem(writer, http.StatusBadRequest)
		return
	}
	authorization, err := h.protocol.NewAuthorization(request.Context())
	if err != nil || !validOIDCAuthorization(authorization) {
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	if !resetSession(writer, request, h.flow, h.cookies) {
		return
	}
	target := queryReturnTarget(request.URL.Query(), h.defaultLoginTarget)
	result, err := h.flow.Begin(request.Context(), browserapp.BeginRequest{
		Provider:      "oidc",
		ReturnTarget:  target,
		Correlation:   authorization.Correlation,
		ProviderState: authorization.ProviderState,
	})
	if err != nil {
		writeOIDCFlowError(writer, err)
		return
	}
	if browserflow.ValidateTransactionID(result.TransactionID) != nil ||
		browserflow.ValidateOpaqueID(result.SessionID) != nil || result.ExpiresAt.IsZero() {
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	authorizationURL, err := h.protocol.AuthorizationURL(result.TransactionID, authorization)
	if err != nil || !validOIDCAuthorizationURL(authorizationURL) {
		_, _ = h.flow.Logout(request.Context(), result.SessionID)
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	if err := h.cookies.Set(writer, result.SessionID); err != nil {
		_, _ = h.flow.Logout(request.Context(), result.SessionID)
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	http.Redirect(writer, request, authorizationURL, http.StatusFound)
}

func (h *OIDCHandler) completeLogin(writer http.ResponseWriter, request *http.Request) {
	securityHeaders(writer)
	// Gate all callback traffic before query/body parsing so malformed floods
	// cannot bypass the shared cross-replica attempt policy.
	if !admitAttempt(writer, request, h.attempts, h.clientKeys, BrowserAttempt{Stage: BrowserAttemptOIDCCallback}) {
		return
	}
	values, status := h.callbackValues(writer, request)
	if status != 0 {
		writeProblem(writer, status)
		return
	}
	response, ok := parseOIDCCallback(values)
	if !ok {
		writeProblem(writer, http.StatusBadRequest)
		return
	}
	sessionID, err := h.cookies.Read(request)
	if err != nil {
		_ = h.cookies.Clear(writer)
		writeProblem(writer, http.StatusBadRequest)
		return
	}
	var verifier browserapp.AssertionVerifier = rejectedOIDCVerifier{}
	if response.code != "" {
		verifier = h.protocol.NewVerifier(response.code)
		if verifier == nil {
			writeProblem(writer, http.StatusServiceUnavailable)
			return
		}
	}
	result, err := h.flow.Complete(request.Context(), browserapp.CompleteRequest{
		SessionID:     sessionID,
		TransactionID: response.state,
		Provider:      "oidc",
	}, verifier)
	if err != nil {
		switch {
		case errors.Is(err, browserapp.ErrUnauthenticated),
			errors.Is(err, browserapp.ErrAuthenticationExpired):
			http.Redirect(writer, request, BasePath+LoginPath+"?error=true", http.StatusFound)
		case errors.Is(err, browserapp.ErrInvalidRequest),
			errors.Is(err, browserapp.ErrTransactionRejected):
			writeProblem(writer, http.StatusBadRequest)
		default:
			writeProblem(writer, http.StatusServiceUnavailable)
		}
		return
	}
	if browserflow.ValidateReturnTarget(result.ReturnTarget) != nil ||
		result.SessionID == sessionID || browserflow.ValidateOpaqueID(result.SessionID) != nil {
		_ = h.cookies.Clear(writer)
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	if err := h.cookies.Set(writer, result.SessionID); err != nil {
		_ = h.cookies.Clear(writer)
		writeProblem(writer, http.StatusServiceUnavailable)
		return
	}
	http.Redirect(writer, request, result.ReturnTarget, http.StatusFound)
}

func (h *OIDCHandler) callbackValues(writer http.ResponseWriter, request *http.Request) (url.Values, int) {
	switch request.Method {
	case http.MethodGet:
		if hasUnexpectedReadBody(request) {
			return nil, http.StatusBadRequest
		}
		if int64(len(request.URL.RawQuery)) > h.maxCallbackBytes {
			return nil, http.StatusRequestURITooLong
		}
		values, err := url.ParseQuery(request.URL.RawQuery)
		if err != nil {
			return nil, http.StatusBadRequest
		}
		return values, 0
	case http.MethodPost:
		if request.URL.RawQuery != "" {
			return nil, http.StatusBadRequest
		}
		contentTypes := request.Header.Values("Content-Type")
		if len(contentTypes) != 1 {
			return nil, http.StatusUnsupportedMediaType
		}
		mediaType, _, err := mime.ParseMediaType(contentTypes[0])
		if err != nil || mediaType != "application/x-www-form-urlencoded" {
			return nil, http.StatusUnsupportedMediaType
		}
		request.Body = http.MaxBytesReader(writer, request.Body, h.maxCallbackBytes)
		if err := request.ParseForm(); err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				return nil, http.StatusRequestEntityTooLarge
			}
			return nil, http.StatusBadRequest
		}
		return request.PostForm, 0
	default:
		return nil, http.StatusBadRequest
	}
}

func rejectOIDCHead(allow string) http.HandlerFunc {
	return func(writer http.ResponseWriter, _ *http.Request) {
		securityHeaders(writer)
		writer.Header().Set("Allow", allow)
		writeProblem(writer, http.StatusMethodNotAllowed)
	}
}

func hasUnexpectedReadBody(request *http.Request) bool {
	return request.ContentLength != 0 || len(request.TransferEncoding) != 0 ||
		(request.Body != nil && request.Body != http.NoBody)
}

type oidcCallback struct {
	state string
	code  string
}

func parseOIDCCallback(values url.Values) (oidcCallback, bool) {
	if len(values) == 0 || len(values) > maxOIDCCallbackParameters {
		return oidcCallback{}, false
	}
	allowed := map[string]struct{}{
		"state": {}, "code": {}, "error": {}, "error_description": {},
		"error_uri": {}, "session_state": {},
	}
	for key, items := range values {
		if _, ok := allowed[key]; !ok || !validOIDCCallbackText(key, maxOIDCCallbackKeyBytes) ||
			len(items) != 1 || !validOIDCCallbackText(items[0], maxOIDCCallbackValueBytes) {
			return oidcCallback{}, false
		}
	}
	state, stateOK := singleValue(values, "state")
	code, codePresent := singleValue(values, "code")
	providerError, errorPresent := singleValue(values, "error")
	if !stateOK || browserflow.ValidateTransactionID(state) != nil || codePresent == errorPresent {
		return oidcCallback{}, false
	}
	if errorPresent {
		if providerError == "" {
			return oidcCallback{}, false
		}
		return oidcCallback{state: state}, true
	}
	if code == "" {
		return oidcCallback{}, false
	}
	if _, present := values["error_description"]; present {
		return oidcCallback{}, false
	}
	if _, present := values["error_uri"]; present {
		return oidcCallback{}, false
	}
	return oidcCallback{state: state, code: code}, true
}

func validOIDCAuthorization(authorization OIDCAuthorization) bool {
	return authorization.Correlation.Nonce != "" && authorization.Correlation.RequestID == "" &&
		authorization.Correlation.Validate() == nil && authorization.ProviderState.PKCEVerifier != "" &&
		authorization.ProviderState.Validate() == nil &&
		authorization.PKCEChallengeMethod == OIDCPKCEChallengeS256
}

func validOIDCAuthorizationURL(value string) bool {
	if value == "" || len(value) > maxOIDCAuthorizationURL || !utf8.ValidString(value) {
		return false
	}
	parsed, err := url.Parse(value)
	return err == nil && parsed.Scheme == "https" && parsed.Host != "" && parsed.User == nil &&
		parsed.Opaque == "" && parsed.Fragment == ""
}

func validOIDCCallbackText(value string, maxBytes int) bool {
	return value != "" && len(value) <= maxBytes && utf8.ValidString(value) &&
		!strings.ContainsFunc(value, unicode.IsControl)
}

func admitAttempt(
	writer http.ResponseWriter,
	request *http.Request,
	attempts AttemptAdmitter,
	clientKeys ClientKeyResolver,
	attempt BrowserAttempt,
) bool {
	clientKey, err := clientKeys.ResolveClientKey(request)
	if err != nil {
		writeProblem(writer, http.StatusServiceUnavailable)
		return false
	}
	attempt.ClientKey = clientKey
	if err := attempt.Validate(); err != nil {
		writeProblem(writer, http.StatusServiceUnavailable)
		return false
	}
	retryAfter, err := attempts.Admit(request.Context(), attempt)
	if err == nil {
		return true
	}
	if errors.Is(err, ErrAttemptLimited) {
		setRetryAfter(writer, retryAfter)
		writeProblem(writer, http.StatusTooManyRequests)
		return false
	}
	writeProblem(writer, http.StatusServiceUnavailable)
	return false
}

func resetSession(
	writer http.ResponseWriter,
	request *http.Request,
	flow Flow,
	cookies *CookiePolicy,
) bool {
	sessionID, err := cookies.Read(request)
	if errors.Is(err, ErrSessionCookieMissing) {
		return true
	}
	if errors.Is(err, ErrSessionCookieInvalid) {
		if clearErr := cookies.Clear(writer); clearErr != nil {
			writeProblem(writer, http.StatusServiceUnavailable)
			return false
		}
		return true
	}
	if err != nil {
		writeProblem(writer, http.StatusServiceUnavailable)
		return false
	}
	if _, err := flow.Logout(request.Context(), sessionID); err != nil {
		_ = cookies.Clear(writer)
		writeProblem(writer, http.StatusServiceUnavailable)
		return false
	}
	return true
}

func writeOIDCFlowError(writer http.ResponseWriter, err error) {
	if errors.Is(err, browserapp.ErrInvalidRequest) {
		writeProblem(writer, http.StatusBadRequest)
		return
	}
	writeProblem(writer, http.StatusServiceUnavailable)
}

type rejectedOIDCVerifier struct{}

func (rejectedOIDCVerifier) Verify(
	context.Context,
	browserflow.VerificationContext,
) (browserflow.VerifiedAssertion, error) {
	return browserflow.VerifiedAssertion{}, errOIDCCallbackRejected
}
