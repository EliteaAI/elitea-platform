package browserauth

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	browserapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/browserauth"
	forwardapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/forwardauth"
)

func TestMainHandlerTraversesRejectedCredentialIntoBrowserSession(t *testing.T) {
	sessionID := canonicalSessionID(21)
	handler := newMainTestHandler(t,
		coreCredentialFunc(func(context.Context, forwardapp.Source, forwardapp.CredentialInput) (forwardapp.CredentialResult, error) {
			return forwardapp.CredentialResult{Resolution: forwardapp.CredentialRejected}, nil
		}),
		coreSessionFunc(func(_ context.Context, got string) (browserapp.Authorization, error) {
			if got != sessionID {
				t.Fatalf("session ID = %q, want %q", got, sessionID)
			}
			return validCoreBrowserAuthorization(), nil
		}),
		nil,
	)
	request := mainRequest("/api/v2/social/author")
	request.Header.Set("Authorization", "Bearer rejected")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "999999")
	request.AddCookie(&http.Cookie{Name: "centry_auth_session", Value: CookieValuePrefix + sessionID})
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	requireCoreOK(t, recorder)
	requireHeaders(t, recorder.Header(), map[string]string{
		"X-Auth-Type":      "user",
		"X-Auth-ID":        "7",
		"X-Auth-User-ID":   "7",
		"X-Auth-Reference": "-",
	})
}

func TestMainHandlerProjectsAcceptedPATAndBoundsDecisionTime(t *testing.T) {
	handler := newMainTestHandler(t,
		coreCredentialFunc(func(ctx context.Context, _ forwardapp.Source, _ forwardapp.CredentialInput) (forwardapp.CredentialResult, error) {
			deadline, ok := ctx.Deadline()
			remaining := time.Until(deadline)
			if !ok || remaining <= 0 || remaining > mainDecisionTimeout {
				t.Fatalf("authorization deadline ok=%v remaining=%s", ok, remaining)
			}
			return acceptedCoreToken(), nil
		}),
		panicCoreSession(t),
		nil,
	)
	request := mainRequest("/api/v2/private")
	request.Header.Set("Authorization", "Bearer accepted")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	requireCoreOK(t, recorder)
	requireHeaders(t, recorder.Header(), map[string]string{
		"X-Auth-Type":      "token",
		"X-Auth-ID":        "42",
		"X-Auth-User-ID":   "7",
		"X-Auth-Reference": "-",
	})
}

func TestMainHandlerRedirectsRejectedCredentialToAccessDenied(t *testing.T) {
	handler := newMainTestHandler(t,
		coreCredentialFunc(func(context.Context, forwardapp.Source, forwardapp.CredentialInput) (forwardapp.CredentialResult, error) {
			return forwardapp.CredentialResult{Resolution: forwardapp.CredentialRejected}, nil
		}),
		panicCoreSession(t),
		nil,
	)
	request := mainRequest("/api/v2/private")
	request.Header.Set("Authorization", "Bearer rejected")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusFound || recorder.Header().Get("Location") != "/app/access_denied" {
		t.Fatalf("response = %d location=%q", recorder.Code, recorder.Header().Get("Location"))
	}
}

func TestMainHandlerEmitsCompletePublicIdentityFromExactPolicy(t *testing.T) {
	handler := newMainTestHandler(t, panicCoreCredential(t), panicCoreSession(t), []forwardapp.PublicRule{{
		Name:       "public health",
		Conditions: []forwardapp.RuleCondition{{Field: forwardapp.SourceURI, Pattern: `/healthz`}},
	}})
	request := mainRequest("/healthz")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "999999")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	requireCoreOK(t, recorder)
	requireHeaders(t, recorder.Header(), map[string]string{
		"X-Auth-Type":      "public",
		"X-Auth-ID":        "-",
		"X-Auth-User-ID":   "-",
		"X-Auth-Reference": "-",
	})
}

func TestMainHandlerFixesRPCProjectionAndRejectsCallerQuery(t *testing.T) {
	handler := newMainTestHandler(t, panicCoreCredential(t), panicCoreSession(t), nil)
	for _, rawQuery := range []string{"target=header", "target=rpc", "scope=admin"} {
		t.Run(rawQuery, func(t *testing.T) {
			request := mainRequest("/private")
			request.URL.RawQuery = rawQuery
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
			}
		})
	}
}

func TestMainHandlerFailsClosedAtGatewayAndDependencies(t *testing.T) {
	wantDependency := errors.New("credential database unavailable")
	handler := newMainTestHandler(t,
		coreCredentialFunc(func(context.Context, forwardapp.Source, forwardapp.CredentialInput) (forwardapp.CredentialResult, error) {
			return forwardapp.CredentialResult{}, wantDependency
		}),
		panicCoreSession(t),
		nil,
	)
	dependency := mainRequest("/private")
	dependency.Header.Set("Authorization", "Bearer unavailable")
	dependencyRecorder := httptest.NewRecorder()
	handler.ServeHTTP(dependencyRecorder, dependency)
	if dependencyRecorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("dependency status = %d, want %d", dependencyRecorder.Code, http.StatusServiceUnavailable)
	}

	untrusted := mainRequest("/private")
	untrusted.RemoteAddr = "203.0.113.8:43210"
	untrusted.Header.Set("X-Auth-Type", "user")
	untrusted.Header.Set("X-Auth-ID", "7")
	untrustedRecorder := httptest.NewRecorder()
	handler.ServeHTTP(untrustedRecorder, untrusted)
	if untrustedRecorder.Code != http.StatusForbidden || untrustedRecorder.Header().Get("X-Auth-Type") != "" {
		t.Fatalf("untrusted response = %d headers=%v", untrustedRecorder.Code, untrustedRecorder.Header())
	}
}

func TestMainHandlerNeverDowngradesSessionDependencyFailureToPublic(t *testing.T) {
	wantDependency := errors.New("session store unavailable")
	handler := newMainTestHandler(t,
		panicCoreCredential(t),
		coreSessionFunc(func(context.Context, string) (browserapp.Authorization, error) {
			return browserapp.Authorization{}, wantDependency
		}),
		[]forwardapp.PublicRule{{
			Name:       "public health",
			Conditions: []forwardapp.RuleCondition{{Field: forwardapp.SourceURI, Pattern: `/healthz`}},
		}},
	)
	request := mainRequest("/healthz")
	request.AddCookie(&http.Cookie{
		Name:  "centry_auth_session",
		Value: CookieValuePrefix + canonicalSessionID(22),
	})
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable || recorder.Header().Get("X-Auth-Type") != "" {
		t.Fatalf("dependency response = %d headers=%v", recorder.Code, recorder.Header())
	}
}

func TestMainHandlerRedirectsPrivateAnonymousRequestToFormLogin(t *testing.T) {
	handler := newMainTestHandler(t, panicCoreCredential(t), panicCoreSession(t), nil)
	request := mainRequest("/api/v2/projects/7?view=full")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "999999")
	request.Header.Set("X-Auth-Reference", "forged")
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusFound)
	}
	location, err := url.Parse(recorder.Header().Get("Location"))
	if err != nil || location.Path != "/forward-auth/login" ||
		location.Query().Get("target_to") != "/api/v2/projects/7?view=full" {
		t.Fatalf("location = %q, parse error=%v", recorder.Header().Get("Location"), err)
	}
	if recorder.Header().Get("X-Auth-Type") != "" || recorder.Header().Get("X-Auth-ID") != "" ||
		recorder.Header().Get("X-Auth-Reference") != "" {
		t.Fatalf("forged inbound identity escaped into response: %v", recorder.Header())
	}
}

func newMainTestHandler(
	t *testing.T,
	credentialAuthenticator forwardapp.CredentialAuthenticator,
	sessionAuthorizer forwardapp.SessionAuthorizer,
	rules []forwardapp.PublicRule,
) *MainHandler {
	t.Helper()
	policy, err := forwardapp.NewPublicPolicy(rules)
	if err != nil {
		t.Fatal(err)
	}
	kernel, err := forwardapp.NewKernel(credentialAuthenticator, sessionAuthorizer, policy)
	if err != nil {
		t.Fatal(err)
	}
	resolver, err := NewTrustedProxyResolver(TrustedProxyConfig{
		TrustedProxyCIDRs: []string{"10.0.0.0/8"},
		PublicOrigin:      "https://elitea.example.test",
	})
	if err != nil {
		t.Fatal(err)
	}
	cookies, err := NewCookiePolicy(CookieConfig{
		Name:     "centry_auth_session",
		Secure:   true,
		SameSite: http.SameSiteLaxMode,
		Lifetime: 7 * 24 * time.Hour,
	})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewMainHandler(kernel, resolver, cookies, MainConfig{
		CredentialHeaders:  []CredentialHeader{{Name: "X-API-Key", Type: "bearer"}},
		AccessDeniedTarget: "/app/access_denied",
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func mainRequest(uri string) *http.Request {
	request := httptest.NewRequest(http.MethodGet, MainForwardAuthPath, nil)
	request.RemoteAddr = "10.1.2.3:43120"
	request.Header.Set("X-Forwarded-Method", http.MethodGet)
	request.Header.Set("X-Forwarded-Proto", "https")
	request.Header.Set("X-Forwarded-Host", "elitea.example.test")
	request.Header.Set("X-Forwarded-Uri", uri)
	request.Header.Set("X-Forwarded-For", "198.51.100.8")
	return request
}
