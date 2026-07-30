package indexing_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexing"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type principalValidatorFunc func(context.Context, auth.User) (auth.User, error)

func (function principalValidatorFunc) ValidatePrincipal(ctx context.Context, user auth.User) (auth.User, error) {
	return function(ctx, user)
}

type forwardedPeerVerifierFunc func(*http.Request) error

func (function forwardedPeerVerifierFunc) VerifyForwardedIdentityPeer(request *http.Request) error {
	return function(request)
}

type permissionResolverFunc func(context.Context, auth.User, string, string) (auth.PermissionResolution, error)

func (function permissionResolverFunc) ResolvePermissions(ctx context.Context, user auth.User, mode, projectID string) (auth.PermissionResolution, error) {
	return function(ctx, user, mode, projectID)
}

func TestCurrentIndexStartRouteBindsExactPathPermissionAndSecurityBeforeBody(t *testing.T) {
	if handler.CurrentIndexStartPath != "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}" ||
		handler.CurrentIndexStartPermission != "models.applications.tool.patch" ||
		handler.CurrentIndexStartMode != auth.PermissionModeDefault {
		t.Fatalf("current route constants drifted: path=%q permission=%q mode=%q", handler.CurrentIndexStartPath, handler.CurrentIndexStartPermission, handler.CurrentIndexStartMode)
	}
	useCase := &startUseCaseStub{outcome: indexingapp.StartOutcome{TaskID: "task-secure"}}
	principal := principalValidatorFunc(func(_ context.Context, user auth.User) (auth.User, error) {
		if user.ID != "11" || user.UserID != "11" || user.AuthType != "user" {
			t.Fatalf("untrusted principal shape: %+v", user)
		}
		return user, nil
	})
	peer := forwardedPeerVerifierFunc(func(request *http.Request) error {
		if request.RemoteAddr != "10.0.0.8:43120" {
			return errors.New("untrusted peer")
		}
		return nil
	})
	permissionCalls := 0
	permissions := permissionResolverFunc(func(_ context.Context, user auth.User, mode, projectID string) (auth.PermissionResolution, error) {
		permissionCalls++
		if user.UserID != "11" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("permission input user=%+v mode=%q project=%q", user, mode, projectID)
		}
		return auth.PermissionResolution{UserID: 11, Permissions: []string{"models.applications.tool.patch"}}, nil
	})
	route, err := handler.NewCurrentIndexStartRoute(useCase, apimw.AuthConfig{
		PrincipalValidator:        principal,
		ForwardedIdentityVerifier: peer,
	}, permissions)
	if err != nil {
		t.Fatal(err)
	}

	body := &trackingBody{Reader: strings.NewReader(`{"toolkit_config":{"toolkit_id":9},"tool_name":"index_data","tool_params":{"index_name":"docs"}}`)}
	request := httptest.NewRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", nil)
	request.Body = body
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "11")
	request.RemoteAddr = "10.0.0.8:43120"
	response := httptest.NewRecorder()
	route.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !body.read || permissionCalls != 1 || useCase.calls != 1 {
		t.Fatalf("status=%d read=%v permissions=%d starts=%d body=%s", response.Code, body.read, permissionCalls, useCase.calls, response.Body.String())
	}
}

func TestCurrentIndexStartRouteRejectsUntrustedOrUnauthorizedRequestsWithoutReadingBody(t *testing.T) {
	useCase := &startUseCaseStub{outcome: indexingapp.StartOutcome{TaskID: "must-not-run"}}
	principal := principalValidatorFunc(func(_ context.Context, user auth.User) (auth.User, error) { return user, nil })
	peer := forwardedPeerVerifierFunc(func(request *http.Request) error {
		if request.RemoteAddr != "10.0.0.8:43120" {
			return errors.New("untrusted peer")
		}
		return nil
	})
	permissions := permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{UserID: 11}, nil
	})
	route, err := handler.NewCurrentIndexStartRoute(useCase, apimw.AuthConfig{
		PrincipalValidator:        principal,
		ForwardedIdentityVerifier: peer,
	}, permissions)
	if err != nil {
		t.Fatal(err)
	}

	for name, remoteAddress := range map[string]string{
		"untrusted peer":    "192.0.2.9:443",
		"permission denied": "10.0.0.8:43120",
	} {
		t.Run(name, func(t *testing.T) {
			body := &trackingBody{Reader: strings.NewReader(`{"toolkit_config":{"toolkit_id":9},"tool_name":"index_data"}`)}
			request := httptest.NewRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", nil)
			request.Body = body
			request.Header.Set("Content-Type", "application/json")
			request.Header.Set("X-Auth-Type", "user")
			request.Header.Set("X-Auth-ID", "11")
			request.RemoteAddr = remoteAddress
			response := httptest.NewRecorder()
			route.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized && response.Code != http.StatusForbidden {
				t.Fatalf("status=%d body=%s", response.Code, response.Body.String())
			}
			if body.read {
				t.Fatal("denied request body was read")
			}
		})
	}
	if useCase.calls != 0 {
		t.Fatalf("denied requests reached use case %d times", useCase.calls)
	}
}

func TestCurrentIndexStartRouteRejectsIncompleteCompositionAndOtherMethods(t *testing.T) {
	useCase := &startUseCaseStub{outcome: indexingapp.StartOutcome{TaskID: "task"}}
	principal := principalValidatorFunc(func(_ context.Context, user auth.User) (auth.User, error) { return user, nil })
	peer := forwardedPeerVerifierFunc(func(*http.Request) error { return nil })
	permissions := permissionResolverFunc(func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{}, nil
	})
	for name, test := range map[string]struct {
		useCase     handler.StartUseCase
		authConfig  apimw.AuthConfig
		permissions auth.PermissionResolver
	}{
		"missing use case":    {authConfig: apimw.AuthConfig{PrincipalValidator: principal, ForwardedIdentityVerifier: peer}, permissions: permissions},
		"missing principal":   {useCase: useCase, authConfig: apimw.AuthConfig{ForwardedIdentityVerifier: peer}, permissions: permissions},
		"missing peer proof":  {useCase: useCase, authConfig: apimw.AuthConfig{PrincipalValidator: principal}, permissions: permissions},
		"missing permissions": {useCase: useCase, authConfig: apimw.AuthConfig{PrincipalValidator: principal, ForwardedIdentityVerifier: peer}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := handler.NewCurrentIndexStartRoute(test.useCase, test.authConfig, test.permissions); !errors.Is(err, handler.ErrInvalidCurrentIndexStartRoute) {
				t.Fatalf("error=%v, want %v", err, handler.ErrInvalidCurrentIndexStartRoute)
			}
		})
	}

	route, err := handler.NewCurrentIndexStartRoute(useCase, apimw.AuthConfig{
		PrincipalValidator:        principal,
		ForwardedIdentityVerifier: peer,
	}, permissions)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", nil)
	response := httptest.NewRecorder()
	route.ServeHTTP(response, request)
	if response.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET status=%d want=%d", response.Code, http.StatusMethodNotAllowed)
	}
}
