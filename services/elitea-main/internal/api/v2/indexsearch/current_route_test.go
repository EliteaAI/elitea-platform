package indexsearch_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	handler "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/indexsearch"
	searchapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexsearch"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type searchPrincipalValidatorFunc func(context.Context, auth.User) (auth.User, error)

func (function searchPrincipalValidatorFunc) ValidatePrincipal(ctx context.Context, user auth.User) (auth.User, error) {
	return function(ctx, user)
}

type searchForwardedPeerVerifierFunc func(*http.Request) error

func (function searchForwardedPeerVerifierFunc) VerifyForwardedIdentityPeer(request *http.Request) error {
	return function(request)
}

type searchPermissionResolverFunc func(context.Context, auth.User, string, string) (auth.PermissionResolution, error)

func (function searchPermissionResolverFunc) ResolvePermissions(ctx context.Context, user auth.User, mode, projectID string) (auth.PermissionResolution, error) {
	return function(ctx, user, mode, projectID)
}

type searchUseCaseStub struct {
	calls   int
	request handler.CurrentRequest
	outcome handler.CurrentOutcome
	err     error
}

func (stub *searchUseCaseStub) StartCurrentIndexSearch(_ context.Context, request handler.CurrentRequest) (handler.CurrentOutcome, error) {
	stub.calls++
	stub.request = request.Clone()
	return stub.outcome, stub.err
}

type searchCancellerStub struct {
	calls   int
	request handler.CurrentRequest
	taskID  string
	err     error
}

func (stub *searchCancellerStub) CancelCurrentIndexSearch(_ context.Context, request handler.CurrentRequest, taskID string) error {
	stub.calls++
	stub.request = request.Clone()
	stub.taskID = taskID
	return stub.err
}

type searchTrackingBody struct {
	io.Reader
	read bool
}

func (body *searchTrackingBody) Read(value []byte) (int, error) {
	body.read = true
	return body.Reader.Read(value)
}

func TestCurrentIndexSearchRouteUsesExactCurrentRBACBoundaryAndPreservesAsyncEnvelope(t *testing.T) {
	if handler.CurrentIndexSearchPath != "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/{projectID}" ||
		handler.CurrentIndexSearchPermission != "models.applications.tool.patch" ||
		handler.CurrentIndexSearchMode != auth.PermissionModeDefault ||
		handler.CurrentIndexSearchSIOEvent != "test_toolkit_tool" {
		t.Fatalf("current route constants drifted: path=%q permission=%q mode=%q event=%q", handler.CurrentIndexSearchPath, handler.CurrentIndexSearchPermission, handler.CurrentIndexSearchMode, handler.CurrentIndexSearchSIOEvent)
	}
	useCase := &searchUseCaseStub{outcome: handler.CurrentOutcome{Response: []byte(`{"task_id":"search-17","queue":"indexer"}`)}}
	canceller := &searchCancellerStub{}
	permissionCalls := 0
	route := newCurrentSearchRoute(t, useCase, canceller, func(_ context.Context, user auth.User, mode, projectID string) (auth.PermissionResolution, error) {
		permissionCalls++
		if user.UserID != "11" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("permission input user=%+v mode=%q project=%q", user, mode, projectID)
		}
		// The resolver, not a static Go role list, implements the current role
		// and project-specific overrides. This accepted user deliberately has no
		// role name in the test fixture.
		return auth.PermissionResolution{UserID: 11, Permissions: []string{"models.applications.tool.patch"}}, nil
	})
	body := &searchTrackingBody{Reader: strings.NewReader(searchRequestJSON("search_index"))}
	request := currentSearchHTTPRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", body)
	response := httptest.NewRecorder()
	route.ServeHTTP(response, request)

	if response.Code != http.StatusOK || !body.read || permissionCalls != 1 || useCase.calls != 1 || canceller.calls != 0 {
		t.Fatalf("status=%d read=%v permissions=%d starts=%d cancels=%d body=%s", response.Code, body.read, permissionCalls, useCase.calls, canceller.calls, response.Body.String())
	}
	if response.Body.String() != `{"task_id":"search-17","queue":"indexer"}` {
		t.Fatalf("async response changed: %s", response.Body.String())
	}
	if useCase.request.ProjectID != 7 || useCase.request.ActorUserID != 11 || useCase.request.Operation != searchapp.SearchIndex || useCase.request.SIOEvent != "test_toolkit_tool" || useCase.request.AwaitResult || useCase.request.WaitSeconds != -1 {
		t.Fatalf("request drifted: %+v", useCase.request)
	}
	if string(useCase.request.CallerExtras["legacy_extension"]) != `{"preserve":true}` {
		t.Fatalf("current extra field was dropped: %#v", useCase.request.CallerExtras)
	}
}

func TestCurrentIndexSearchRoutePreservesAwaitedEnvelopeAndTimeoutCancellation(t *testing.T) {
	for name, test := range map[string]struct {
		response      string
		status        int
		body          string
		cancellations int
	}{
		"completed response": {
			response: `{"task_id":"search-18","result":{"success":true,"result":[{"page_content":"a"}]}}`,
			status:   http.StatusOK,
			body:     `{"task_id":"search-18","result":{"success":true,"result":[{"page_content":"a"}]}}`,
		},
		"empty result retains current timeout branch": {
			response:      `{"task_id":"search-19","result":[ ]}`,
			status:        http.StatusBadRequest,
			body:          `{"error":"Timeout"}` + "\n",
			cancellations: 1,
		},
	} {
		t.Run(name, func(t *testing.T) {
			useCase := &searchUseCaseStub{outcome: handler.CurrentOutcome{Response: []byte(test.response)}}
			canceller := &searchCancellerStub{}
			route := newCurrentSearchRoute(t, useCase, canceller, allowSearchPermission)
			request := currentSearchHTTPRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7", strings.NewReader(searchRequestJSON("stepback_search_index")))
			response := httptest.NewRecorder()
			route.ServeHTTP(response, request)

			if response.Code != test.status || response.Body.String() != test.body || canceller.calls != test.cancellations {
				t.Fatalf("status=%d body=%s cancels=%d", response.Code, response.Body.String(), canceller.calls)
			}
			if test.cancellations == 1 && canceller.taskID != "search-19" {
				t.Fatalf("timeout cancellation task=%q", canceller.taskID)
			}
		})
	}
}

func TestCurrentIndexSearchRouteDeniesBeforeReadingBodyAndRejectsOtherTools(t *testing.T) {
	useCase := &searchUseCaseStub{outcome: handler.CurrentOutcome{Response: []byte(`{"task_id":"must-not-run"}`)}}
	canceller := &searchCancellerStub{}
	route := newCurrentSearchRoute(t, useCase, canceller, func(context.Context, auth.User, string, string) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{UserID: 11}, nil
	})
	body := &searchTrackingBody{Reader: strings.NewReader(searchRequestJSON("search_index"))}
	request := currentSearchHTTPRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", body)
	response := httptest.NewRecorder()
	route.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden || body.read || useCase.calls != 0 {
		t.Fatalf("denied status=%d read=%v calls=%d body=%s", response.Code, body.read, useCase.calls, response.Body.String())
	}

	route = newCurrentSearchRoute(t, useCase, canceller, allowSearchPermission)
	request = currentSearchHTTPRequest(http.MethodPost, "/api/v2/elitea_core/test_toolkit_tool/prompt_lib/7?await_response=false", strings.NewReader(searchRequestJSON("delete_index")))
	response = httptest.NewRecorder()
	route.ServeHTTP(response, request)
	if response.Code != http.StatusBadRequest || useCase.calls != 0 {
		t.Fatalf("other tool status=%d calls=%d body=%s", response.Code, useCase.calls, response.Body.String())
	}
}

func TestCurrentIndexSearchRouteRejectsIncompleteComposition(t *testing.T) {
	useCase := &searchUseCaseStub{}
	canceller := &searchCancellerStub{}
	principal := searchPrincipalValidatorFunc(func(_ context.Context, user auth.User) (auth.User, error) { return user, nil })
	peer := searchForwardedPeerVerifierFunc(func(*http.Request) error { return nil })
	permissions := searchPermissionResolverFunc(allowSearchPermission)
	for name, test := range map[string]struct {
		useCase     handler.CurrentSearchUseCase
		canceller   handler.TimeoutCanceller
		authConfig  apimw.AuthConfig
		permissions auth.PermissionResolver
	}{
		"missing use case":     {canceller: canceller, authConfig: apimw.AuthConfig{PrincipalValidator: principal, ForwardedIdentityVerifier: peer}, permissions: permissions},
		"missing cancellation": {useCase: useCase, authConfig: apimw.AuthConfig{PrincipalValidator: principal, ForwardedIdentityVerifier: peer}, permissions: permissions},
		"missing principal":    {useCase: useCase, canceller: canceller, authConfig: apimw.AuthConfig{ForwardedIdentityVerifier: peer}, permissions: permissions},
		"missing peer proof":   {useCase: useCase, canceller: canceller, authConfig: apimw.AuthConfig{PrincipalValidator: principal}, permissions: permissions},
		"missing permissions":  {useCase: useCase, canceller: canceller, authConfig: apimw.AuthConfig{PrincipalValidator: principal, ForwardedIdentityVerifier: peer}},
	} {
		t.Run(name, func(t *testing.T) {
			if _, err := handler.NewCurrentIndexSearchRoute(test.useCase, test.canceller, test.authConfig, test.permissions); !errors.Is(err, handler.ErrInvalidCurrentSearchRoute) {
				t.Fatalf("error=%v, want %v", err, handler.ErrInvalidCurrentSearchRoute)
			}
		})
	}
}

func newCurrentSearchRoute(t *testing.T, useCase handler.CurrentSearchUseCase, canceller handler.TimeoutCanceller, permission func(context.Context, auth.User, string, string) (auth.PermissionResolution, error)) *handler.CurrentIndexSearchRoute {
	t.Helper()
	principal := searchPrincipalValidatorFunc(func(_ context.Context, user auth.User) (auth.User, error) {
		if user.ID != "11" || user.UserID != "11" || user.AuthType != "user" {
			t.Fatalf("untrusted principal shape: %+v", user)
		}
		return user, nil
	})
	peer := searchForwardedPeerVerifierFunc(func(request *http.Request) error {
		if request.RemoteAddr != "10.0.0.8:43120" {
			return errors.New("untrusted peer")
		}
		return nil
	})
	route, err := handler.NewCurrentIndexSearchRoute(useCase, canceller, apimw.AuthConfig{
		PrincipalValidator:        principal,
		ForwardedIdentityVerifier: peer,
	}, searchPermissionResolverFunc(permission))
	if err != nil {
		t.Fatal(err)
	}
	return route
}

func allowSearchPermission(_ context.Context, _ auth.User, _ string, _ string) (auth.PermissionResolution, error) {
	return auth.PermissionResolution{UserID: 11, Permissions: []string{"models.applications.tool.patch"}}, nil
}

func currentSearchHTTPRequest(method, target string, body io.Reader) *http.Request {
	request := httptest.NewRequest(method, target, body)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "11")
	request.RemoteAddr = "10.0.0.8:43120"
	return request
}

func searchRequestJSON(operation string) string {
	return `{"toolkit_config":{"toolkit_id":9,"type":"github"},"tool_name":"` + operation + `","tool_params":{"query":"release","search_top":5},"runtime_config":{},"legacy_extension":{"preserve":true}}`
}
