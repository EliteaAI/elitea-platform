package browserauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/identity"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/browserflow"
	sessionstate "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth/session"
)

func TestOIDCBeginAdmitsBeforeAllocatingBoundState(t *testing.T) {
	handler, dependencies := newTestOIDCHandler(t)
	request := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginPath+"?target_to=%2Fprojects%2F7%3Ftab%3Dartifacts",
		nil,
	)
	recorder := httptest.NewRecorder()

	mountOIDC(handler).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusFound {
		t.Fatalf("status = %d, body = %q", recorder.Code, recorder.Body.String())
	}
	location, err := url.Parse(recorder.Header().Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if location.Scheme != "https" || location.Host != "issuer.example" ||
		location.Query().Get("state") != dependencies.flow.beginResult.TransactionID {
		t.Fatalf("authorization redirect = %q", location.String())
	}
	if strings.Join(*dependencies.events, ",") != "client-key,admit,new-authorization,begin,authorization-url" {
		t.Fatalf("events = %v", *dependencies.events)
	}
	if dependencies.admitter.attempt != (BrowserAttempt{
		ClientKey: "client-7",
		Stage:     BrowserAttemptOIDCBegin,
	}) {
		t.Fatalf("attempt = %+v", dependencies.admitter.attempt)
	}
	if dependencies.flow.beginRequest.Provider != "oidc" ||
		dependencies.flow.beginRequest.ReturnTarget != "/projects/7?tab=artifacts" ||
		dependencies.flow.beginRequest.Correlation != dependencies.protocol.authorization.Correlation ||
		dependencies.flow.beginRequest.ProviderState != dependencies.protocol.authorization.ProviderState {
		t.Fatalf("begin request = %+v", dependencies.flow.beginRequest)
	}
	if dependencies.protocol.authorization.PKCEChallengeMethod != OIDCPKCEChallengeS256 {
		t.Fatalf("PKCE method = %q", dependencies.protocol.authorization.PKCEChallengeMethod)
	}
	cookies := recorder.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Value != CookieValuePrefix+dependencies.flow.beginResult.SessionID {
		t.Fatalf("cookies = %+v", cookies)
	}
	requireSecurityHeaders(t, recorder.Header())
}

func TestOIDCBeginAdmissionFailureHasNoProtocolOrStateEffects(t *testing.T) {
	handler, dependencies := newTestOIDCHandler(t)
	dependencies.admitter.err = ErrAttemptLimited
	dependencies.admitter.retryAfter = 1500 * time.Millisecond
	recorder := httptest.NewRecorder()

	mountOIDC(handler).ServeHTTP(
		recorder,
		httptest.NewRequest(http.MethodGet, BasePath+OIDCLoginPath, nil),
	)

	if recorder.Code != http.StatusTooManyRequests || recorder.Header().Get("Retry-After") != "2" {
		t.Fatalf("status = %d Retry-After = %q", recorder.Code, recorder.Header().Get("Retry-After"))
	}
	if dependencies.protocol.newAuthorizationCalls != 0 || dependencies.flow.beginCalls != 0 ||
		dependencies.flow.logoutCalls != 0 {
		t.Fatalf("protocol=%d begin=%d logout=%d", dependencies.protocol.newAuthorizationCalls, dependencies.flow.beginCalls, dependencies.flow.logoutCalls)
	}
	if strings.Join(*dependencies.events, ",") != "client-key,admit" {
		t.Fatalf("events = %v", *dependencies.events)
	}
}

func TestOIDCCallbackSupportsCurrentGETAndPOSTShapes(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			handler, dependencies := newTestOIDCHandler(t)
			state := dependencies.flow.beginResult.TransactionID
			values := url.Values{"state": {state}, "code": {"authorization-code"}}
			var request *http.Request
			if method == http.MethodGet {
				request = httptest.NewRequest(method, BasePath+OIDCLoginCallbackPath+"?"+values.Encode(), nil)
			} else {
				request = httptest.NewRequest(method, BasePath+OIDCLoginCallbackPath, strings.NewReader(values.Encode()))
				request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			}
			request.AddCookie(sessionCookie(dependencies.flow.beginResult.SessionID))
			recorder := httptest.NewRecorder()

			mountOIDC(handler).ServeHTTP(recorder, request)

			if recorder.Code != http.StatusFound ||
				recorder.Header().Get("Location") != dependencies.flow.completeResult.ReturnTarget {
				t.Fatalf("status = %d location = %q", recorder.Code, recorder.Header().Get("Location"))
			}
			if strings.Join(*dependencies.events, ",") != "client-key,admit,new-verifier,complete" {
				t.Fatalf("events = %v", *dependencies.events)
			}
			if dependencies.admitter.attempt.Stage != BrowserAttemptOIDCCallback ||
				dependencies.protocol.code != "authorization-code" {
				t.Fatalf("attempt = %+v code = %q", dependencies.admitter.attempt, dependencies.protocol.code)
			}
			if dependencies.flow.completeRequest != (browserapp.CompleteRequest{
				SessionID:     dependencies.flow.beginResult.SessionID,
				TransactionID: state,
				Provider:      "oidc",
			}) {
				t.Fatalf("complete request = %+v", dependencies.flow.completeRequest)
			}
			cookies := recorder.Result().Cookies()
			if len(cookies) != 1 ||
				cookies[0].Value != CookieValuePrefix+dependencies.flow.completeResult.SessionID {
				t.Fatalf("rotated cookies = %+v", cookies)
			}
			requireSecurityHeaders(t, recorder.Header())
		})
	}
}

func TestOIDCCallbackRejectsAmbiguousInputsAfterAdmissionWithoutProviderWork(t *testing.T) {
	state := canonicalSessionID(2)
	tests := []struct {
		name        string
		method      string
		target      string
		body        string
		contentType string
		wantStatus  int
	}{
		{name: "duplicate state", method: http.MethodGet, target: "?state=" + state + "&state=" + state + "&code=c", wantStatus: http.StatusBadRequest},
		{name: "code and error", method: http.MethodGet, target: "?state=" + state + "&code=c&error=denied", wantStatus: http.StatusBadRequest},
		{name: "ignored issuer forbidden", method: http.MethodGet, target: "?state=" + state + "&code=c&iss=https%3A%2F%2Fother.example", wantStatus: http.StatusBadRequest},
		{name: "implicit id token forbidden", method: http.MethodGet, target: "?state=" + state + "&id_token=unsigned", wantStatus: http.StatusBadRequest},
		{name: "unknown parameter", method: http.MethodGet, target: "?state=" + state + "&code=c&token=secret", wantStatus: http.StatusBadRequest},
		{name: "malformed query", method: http.MethodGet, target: "?state=%zz&code=c", wantStatus: http.StatusBadRequest},
		{name: "success with error description", method: http.MethodGet, target: "?state=" + state + "&code=c&error_description=no", wantStatus: http.StatusBadRequest},
		{name: "post query ambiguity", method: http.MethodPost, target: "?state=" + state, body: "state=" + state + "&code=c", contentType: "application/x-www-form-urlencoded", wantStatus: http.StatusBadRequest},
		{name: "post wrong media", method: http.MethodPost, body: `{"state":"` + state + `"}`, contentType: "application/json", wantStatus: http.StatusUnsupportedMediaType},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, dependencies := newTestOIDCHandler(t)
			request := httptest.NewRequest(test.method, BasePath+OIDCLoginCallbackPath+test.target, strings.NewReader(test.body))
			if test.contentType != "" {
				request.Header.Set("Content-Type", test.contentType)
			}
			request.AddCookie(sessionCookie(dependencies.flow.beginResult.SessionID))
			recorder := httptest.NewRecorder()
			mountOIDC(handler).ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus {
				t.Fatalf("status = %d, want %d", recorder.Code, test.wantStatus)
			}
			if dependencies.admitter.calls != 1 ||
				dependencies.admitter.attempt.Stage != BrowserAttemptOIDCCallback ||
				dependencies.flow.completeCalls != 0 ||
				dependencies.protocol.newVerifierCalls != 0 {
				t.Fatalf("admit=%d complete=%d verifier=%d", dependencies.admitter.calls, dependencies.flow.completeCalls, dependencies.protocol.newVerifierCalls)
			}
		})
	}
}

func TestOIDCCallbackGatesOversizedAndBodySmugglingAttemptsBeforeParsing(t *testing.T) {
	t.Run("limited oversized body is not parsed", func(t *testing.T) {
		handler, dependencies := newTestOIDCHandler(t)
		dependencies.admitter.err = ErrAttemptLimited
		request := httptest.NewRequest(
			http.MethodPost,
			BasePath+OIDCLoginCallbackPath,
			strings.NewReader(strings.Repeat("x", int(DefaultMaxOIDCCallbackBytes+1))),
		)
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusTooManyRequests || dependencies.admitter.calls != 1 ||
			dependencies.flow.completeCalls != 0 {
			t.Fatalf("status=%d admit=%d complete=%d", recorder.Code, dependencies.admitter.calls, dependencies.flow.completeCalls)
		}
	})

	t.Run("admitted oversized body is bounded", func(t *testing.T) {
		handler, dependencies := newTestOIDCHandler(t)
		request := httptest.NewRequest(
			http.MethodPost,
			BasePath+OIDCLoginCallbackPath,
			strings.NewReader(strings.Repeat("x", int(DefaultMaxOIDCCallbackBytes+1))),
		)
		request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusRequestEntityTooLarge || dependencies.admitter.calls != 1 ||
			dependencies.flow.completeCalls != 0 {
			t.Fatalf("status=%d admit=%d complete=%d", recorder.Code, dependencies.admitter.calls, dependencies.flow.completeCalls)
		}
	})

	t.Run("duplicate content type", func(t *testing.T) {
		handler, dependencies := newTestOIDCHandler(t)
		request := httptest.NewRequest(http.MethodPost, BasePath+OIDCLoginCallbackPath, strings.NewReader("state=x"))
		request.Header.Add("Content-Type", "application/x-www-form-urlencoded")
		request.Header.Add("Content-Type", "application/json")
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusUnsupportedMediaType || dependencies.admitter.calls != 1 {
			t.Fatalf("status=%d admit=%d", recorder.Code, dependencies.admitter.calls)
		}
	})

	t.Run("GET transfer encoding body", func(t *testing.T) {
		handler, dependencies := newTestOIDCHandler(t)
		request := httptest.NewRequest(http.MethodGet, BasePath+OIDCLoginCallbackPath, nil)
		request.Body = io.NopCloser(strings.NewReader("state=hidden"))
		request.ContentLength = -1
		request.TransferEncoding = []string{"chunked"}
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, request)
		if recorder.Code != http.StatusBadRequest || dependencies.admitter.calls != 1 ||
			dependencies.flow.completeCalls != 0 {
			t.Fatalf("status=%d admit=%d complete=%d", recorder.Code, dependencies.admitter.calls, dependencies.flow.completeCalls)
		}
	})
}

func TestOIDCCallbackAdmissionPrecedesCookieAndProviderWork(t *testing.T) {
	handler, dependencies := newTestOIDCHandler(t)
	dependencies.admitter.err = ErrAttemptLimited
	state := dependencies.flow.beginResult.TransactionID
	request := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginCallbackPath+"?state="+state+"&code=authorization-code",
		nil,
	)
	// Deliberately omit the cookie: a well-formed attempt is limited before
	// cookie decoding and before verifier/token/JWKS work.
	recorder := httptest.NewRecorder()

	mountOIDC(handler).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusTooManyRequests || dependencies.admitter.calls != 1 ||
		dependencies.protocol.newVerifierCalls != 0 || dependencies.flow.completeCalls != 0 {
		t.Fatalf("status=%d admit=%d verifier=%d complete=%d", recorder.Code, dependencies.admitter.calls, dependencies.protocol.newVerifierCalls, dependencies.flow.completeCalls)
	}
	if strings.Join(*dependencies.events, ",") != "client-key,admit" {
		t.Fatalf("events = %v", *dependencies.events)
	}
}

func TestOIDCProviderErrorConsumesThroughTheOneTimeFlow(t *testing.T) {
	handler, dependencies := newTestOIDCHandler(t)
	dependencies.flow.completeErr = browserapp.ErrUnauthenticated
	state := dependencies.flow.beginResult.TransactionID
	request := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginCallbackPath+"?state="+state+"&error=access_denied&error_description=cancelled",
		nil,
	)
	request.AddCookie(sessionCookie(dependencies.flow.beginResult.SessionID))
	recorder := httptest.NewRecorder()

	mountOIDC(handler).ServeHTTP(recorder, request)

	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != BasePath+LoginPath+"?error=true" {
		t.Fatalf("status = %d location = %q", recorder.Code, recorder.Header().Get("Location"))
	}
	if dependencies.protocol.newVerifierCalls != 0 || dependencies.flow.completeCalls != 1 {
		t.Fatalf("verifier=%d complete=%d", dependencies.protocol.newVerifierCalls, dependencies.flow.completeCalls)
	}
	assertion, err := dependencies.flow.completeVerifier.Verify(context.Background(), browserflow.VerificationContext{})
	if !errors.Is(err, errOIDCCallbackRejected) || assertion.Provider != "" {
		t.Fatalf("rejected verifier = %+v, %v", assertion, err)
	}
}

func TestOIDCCallbackMapsAuthenticationAndDependencyFailures(t *testing.T) {
	tests := []struct {
		name       string
		flowErr    error
		wantStatus int
		location   string
	}{
		{name: "invalid token", flowErr: browserapp.ErrUnauthenticated, wantStatus: http.StatusFound, location: BasePath + LoginPath + "?error=true"},
		{name: "provider outage", flowErr: browserapp.ErrDependencyUnavailable, wantStatus: http.StatusServiceUnavailable},
		{name: "consumed state", flowErr: browserapp.ErrTransactionRejected, wantStatus: http.StatusBadRequest},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			handler, dependencies := newTestOIDCHandler(t)
			dependencies.flow.completeErr = test.flowErr
			request := callbackRequest(dependencies, "authorization-code")
			recorder := httptest.NewRecorder()
			mountOIDC(handler).ServeHTTP(recorder, request)
			if recorder.Code != test.wantStatus || recorder.Header().Get("Location") != test.location {
				t.Fatalf("status = %d location = %q", recorder.Code, recorder.Header().Get("Location"))
			}
		})
	}
}

func TestOIDCRoutesPreservePathsAndRejectMutatingHEADWithoutProductionMount(t *testing.T) {
	handler, dependencies := newTestOIDCHandler(t)
	for path, allow := range map[string]string{
		OIDCLoginPath:         "GET, OPTIONS",
		OIDCLoginCallbackPath: "GET, POST, OPTIONS",
	} {
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodOptions, BasePath+path, nil))
		if recorder.Code != http.StatusOK || recorder.Header().Get("Allow") != allow {
			t.Fatalf("%s: status = %d Allow = %q", path, recorder.Code, recorder.Header().Get("Allow"))
		}
	}
	for path, allow := range map[string]string{
		OIDCLoginPath:         "GET, OPTIONS",
		OIDCLoginCallbackPath: "GET, POST, OPTIONS",
	} {
		recorder := httptest.NewRecorder()
		mountOIDC(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodHead, BasePath+path, nil))
		if recorder.Code != http.StatusMethodNotAllowed || recorder.Header().Get("Allow") != allow ||
			recorder.Body.Len() != 0 {
			t.Fatalf("%s HEAD: status=%d Allow=%q body=%q", path, recorder.Code, recorder.Header().Get("Allow"), recorder.Body.String())
		}
	}
	recorder := httptest.NewRecorder()
	mountOIDC(handler).ServeHTTP(recorder, httptest.NewRequest(http.MethodPut, BasePath+OIDCLoginPath, nil))
	if recorder.Code != http.StatusBadRequest || dependencies.admitter.calls != 0 ||
		dependencies.flow.beginCalls != 0 || dependencies.flow.completeCalls != 0 {
		t.Fatalf("status=%d admit=%d begin=%d complete=%d", recorder.Code, dependencies.admitter.calls, dependencies.flow.beginCalls, dependencies.flow.completeCalls)
	}
}

func TestOIDCLifecycleAcrossRealHTTPAndApplicationBoundaries(t *testing.T) {
	sessions := &componentSessionStore{records: make(map[string]sessionstate.State)}
	transactions := &componentTransactionStore{records: make(map[string]browserflow.Transaction)}
	provisioner := &componentProvisioner{result: identity.ProvisionResult{UserID: 71}}
	flow, err := browserapp.NewService(
		sessions,
		transactions,
		provisioner,
		componentPrincipalValidator{},
		5*time.Minute,
	)
	if err != nil {
		t.Fatal(err)
	}
	events := make([]string, 0, 8)
	protocol := newOIDCProtocolStub(&events)
	protocol.verify = func(_ context.Context, verification browserflow.VerificationContext, code string) (browserflow.VerifiedAssertion, error) {
		if code != "authorization-code" {
			return browserflow.VerifiedAssertion{}, errors.New("invalid authorization code")
		}
		expiresAt := time.Now().Add(time.Hour).UTC()
		return browserflow.VerifiedAssertion{
			Provider:            "oidc",
			ProviderReference:   "admin",
			Email:               "admin@example.test",
			GivenName:           "Ada",
			FamilyName:          "Lovelace",
			Name:                "Ada Lovelace",
			ProviderAttributes:  json.RawMessage(`{"nameid":"admin","attributes":{"picture":"https://images.example/avatar.png"},"sessionindex":""}`),
			Expiration:          &expiresAt,
			ProtocolCorrelation: verification.Correlation,
		}, nil
	}
	cookies, err := NewCookiePolicy(CookieConfig{
		Name: "centry_auth_session", Secure: true,
		SameSite: http.SameSiteLaxMode, Lifetime: 7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewOIDCHandler(
		flow,
		protocol,
		&attemptAdmitterStub{events: &events},
		&clientKeyResolverStub{events: &events, key: "client-7"},
		cookies,
		OIDCHandlerConfig{DefaultLoginTarget: "/"},
	)
	if err != nil {
		t.Fatal(err)
	}

	beginRecorder := httptest.NewRecorder()
	mountOIDC(handler).ServeHTTP(
		beginRecorder,
		httptest.NewRequest(http.MethodGet, BasePath+OIDCLoginPath+"?target_to=%2Fafter", nil),
	)
	if beginRecorder.Code != http.StatusFound {
		t.Fatalf("begin status = %d", beginRecorder.Code)
	}
	beginCookies := beginRecorder.Result().Cookies()
	location, err := url.Parse(beginRecorder.Header().Get("Location"))
	if err != nil || len(beginCookies) != 1 {
		t.Fatalf("begin location=%q cookies=%d err=%v", beginRecorder.Header().Get("Location"), len(beginCookies), err)
	}
	transactionID := location.Query().Get("state")
	if browserflow.ValidateTransactionID(transactionID) != nil {
		t.Fatalf("transaction ID = %q", transactionID)
	}
	callback := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginCallbackPath+"?state="+transactionID+"&code=authorization-code",
		nil,
	)
	callback.AddCookie(beginCookies[0])
	callbackRecorder := httptest.NewRecorder()
	mountOIDC(handler).ServeHTTP(callbackRecorder, callback)
	if callbackRecorder.Code != http.StatusFound || callbackRecorder.Header().Get("Location") != "/after" {
		t.Fatalf("callback status=%d location=%q body=%q", callbackRecorder.Code, callbackRecorder.Header().Get("Location"), callbackRecorder.Body.String())
	}
	if provisioner.request.Assertion.Provider != "oidc" ||
		provisioner.request.Assertion.ProviderReference != "admin" ||
		provisioner.request.Assertion.Email != "admin@example.test" {
		t.Fatalf("provision request = %+v", provisioner.request)
	}
	if protocol.verification.Correlation != protocol.authorization.Correlation ||
		protocol.verification.ProviderState != protocol.authorization.ProviderState {
		t.Fatalf("verification = %+v", protocol.verification)
	}
	authenticatedCookies := callbackRecorder.Result().Cookies()
	if len(authenticatedCookies) != 1 || authenticatedCookies[0].Value == beginCookies[0].Value {
		t.Fatalf("authenticated cookies = %+v", authenticatedCookies)
	}

	// The callback transaction is one-time even when the browser replays the
	// exact bounded response.
	replay := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginCallbackPath+"?state="+transactionID+"&code=authorization-code",
		nil,
	)
	replay.AddCookie(beginCookies[0])
	replayRecorder := httptest.NewRecorder()
	mountOIDC(handler).ServeHTTP(replayRecorder, replay)
	if replayRecorder.Code != http.StatusBadRequest {
		t.Fatalf("replay status = %d", replayRecorder.Code)
	}
}

func TestNewOIDCHandlerRejectsIncompleteOrUnsafeConfiguration(t *testing.T) {
	_, dependencies := newTestOIDCHandler(t)
	valid := OIDCHandlerConfig{DefaultLoginTarget: "/", MaxCallbackBytes: 4096}
	tests := []struct {
		name       string
		flow       Flow
		protocol   OIDCProtocol
		attempts   AttemptAdmitter
		clientKeys ClientKeyResolver
		cookies    *CookiePolicy
		config     OIDCHandlerConfig
	}{
		{name: "missing flow", protocol: dependencies.protocol, attempts: dependencies.admitter, clientKeys: dependencies.resolver, cookies: dependencies.cookies, config: valid},
		{name: "missing protocol", flow: dependencies.flow, attempts: dependencies.admitter, clientKeys: dependencies.resolver, cookies: dependencies.cookies, config: valid},
		{name: "missing admission", flow: dependencies.flow, protocol: dependencies.protocol, clientKeys: dependencies.resolver, cookies: dependencies.cookies, config: valid},
		{name: "missing client policy", flow: dependencies.flow, protocol: dependencies.protocol, attempts: dependencies.admitter, cookies: dependencies.cookies, config: valid},
		{name: "missing cookie policy", flow: dependencies.flow, protocol: dependencies.protocol, attempts: dependencies.admitter, clientKeys: dependencies.resolver, config: valid},
		{name: "external target", flow: dependencies.flow, protocol: dependencies.protocol, attempts: dependencies.admitter, clientKeys: dependencies.resolver, cookies: dependencies.cookies, config: OIDCHandlerConfig{DefaultLoginTarget: "https://attacker.example", MaxCallbackBytes: 4096}},
		{name: "unbounded callback", flow: dependencies.flow, protocol: dependencies.protocol, attempts: dependencies.admitter, clientKeys: dependencies.resolver, cookies: dependencies.cookies, config: OIDCHandlerConfig{DefaultLoginTarget: "/", MaxCallbackBytes: maxMaxOIDCCallbackBytes + 1}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			_, err := NewOIDCHandler(test.flow, test.protocol, test.attempts, test.clientKeys, test.cookies, test.config)
			if !errors.Is(err, ErrInvalidHandlerConfiguration) {
				t.Fatalf("error = %v", err)
			}
		})
	}
}

type oidcTestDependencies struct {
	flow     *flowStub
	protocol *oidcProtocolStub
	admitter *attemptAdmitterStub
	resolver *clientKeyResolverStub
	cookies  *CookiePolicy
	events   *[]string
}

func newTestOIDCHandler(t *testing.T) (*OIDCHandler, *oidcTestDependencies) {
	t.Helper()
	events := make([]string, 0, 8)
	flow := &flowStub{
		events: &events,
		beginResult: browserapp.BeginResult{
			SessionID:     canonicalSessionID(1),
			TransactionID: canonicalSessionID(2),
			ExpiresAt:     time.Now().Add(5 * time.Minute),
		},
		completeResult: browserapp.CompleteResult{
			SessionID:    canonicalSessionID(3),
			ReturnTarget: "/after-login?auth_state=popup-7",
		},
	}
	protocol := newOIDCProtocolStub(&events)
	admitter := &attemptAdmitterStub{events: &events}
	resolver := &clientKeyResolverStub{events: &events, key: "client-7"}
	cookies, err := NewCookiePolicy(CookieConfig{
		Name: "centry_auth_session", Secure: true,
		SameSite: http.SameSiteLaxMode, Lifetime: 7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewOIDCHandler(flow, protocol, admitter, resolver, cookies, OIDCHandlerConfig{
		DefaultLoginTarget: "/safe-default",
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler, &oidcTestDependencies{
		flow: flow, protocol: protocol, admitter: admitter, resolver: resolver,
		cookies: cookies, events: &events,
	}
}

func mountOIDC(handler *OIDCHandler) http.Handler {
	router := chi.NewRouter()
	router.Mount(BasePath, handler.Routes())
	return router
}

func callbackRequest(dependencies *oidcTestDependencies, code string) *http.Request {
	request := httptest.NewRequest(
		http.MethodGet,
		BasePath+OIDCLoginCallbackPath+"?"+url.Values{
			"state": {dependencies.flow.beginResult.TransactionID},
			"code":  {code},
		}.Encode(),
		nil,
	)
	request.AddCookie(sessionCookie(dependencies.flow.beginResult.SessionID))
	return request
}

type oidcProtocolStub struct {
	events                 *[]string
	authorization          OIDCAuthorization
	authorizationErr       error
	authorizationURLErr    error
	unsafeAuthorizationURL string
	code                   string
	verification           browserflow.VerificationContext
	verify                 func(context.Context, browserflow.VerificationContext, string) (browserflow.VerifiedAssertion, error)
	newAuthorizationCalls  int
	authorizationURLCalls  int
	newVerifierCalls       int
}

func newOIDCProtocolStub(events *[]string) *oidcProtocolStub {
	return &oidcProtocolStub{
		events: events,
		authorization: OIDCAuthorization{
			Correlation:         browserflow.ProtocolCorrelation{Nonce: canonicalSessionID(9)},
			ProviderState:       browserflow.ProviderState{PKCEVerifier: strings.Repeat("v", browserflow.MinPKCEVerifierBytes)},
			PKCEChallengeMethod: OIDCPKCEChallengeS256,
		},
	}
}

func (stub *oidcProtocolStub) NewAuthorization(context.Context) (OIDCAuthorization, error) {
	stub.newAuthorizationCalls++
	*stub.events = append(*stub.events, "new-authorization")
	return stub.authorization, stub.authorizationErr
}

func (stub *oidcProtocolStub) AuthorizationURL(state string, _ OIDCAuthorization) (string, error) {
	stub.authorizationURLCalls++
	*stub.events = append(*stub.events, "authorization-url")
	if stub.unsafeAuthorizationURL != "" {
		return stub.unsafeAuthorizationURL, stub.authorizationURLErr
	}
	return "https://issuer.example/authorize?" + url.Values{
		"client_id":             {"elitea"},
		"code_challenge_method": {OIDCPKCEChallengeS256},
		"nonce":                 {stub.authorization.Correlation.Nonce},
		"state":                 {state},
	}.Encode(), stub.authorizationURLErr
}

func (stub *oidcProtocolStub) NewVerifier(code string) browserapp.AssertionVerifier {
	stub.newVerifierCalls++
	stub.code = code
	*stub.events = append(*stub.events, "new-verifier")
	return &oidcVerifierStub{protocol: stub, code: code}
}

type oidcVerifierStub struct {
	protocol *oidcProtocolStub
	code     string
}

func (stub *oidcVerifierStub) Verify(
	ctx context.Context,
	verification browserflow.VerificationContext,
) (browserflow.VerifiedAssertion, error) {
	stub.protocol.verification = verification
	if stub.protocol.verify == nil {
		return browserflow.VerifiedAssertion{}, fmt.Errorf("test verifier has no implementation")
	}
	return stub.protocol.verify(ctx, verification, stub.code)
}
