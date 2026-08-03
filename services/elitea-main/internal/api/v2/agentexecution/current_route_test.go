package agentexecution

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	apimw "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	agentexecutionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/agentexecution"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type currentStartUseCaseStub struct {
	request agentexecutionapp.CurrentApplicationStartRequest
	outcome agentexecutionapp.CurrentApplicationStartOutcome
	err     error
	calls   int
}

func (stub *currentStartUseCaseStub) StartCurrentApplication(
	_ context.Context,
	request agentexecutionapp.CurrentApplicationStartRequest,
) (agentexecutionapp.CurrentApplicationStartOutcome, error) {
	stub.calls++
	stub.request = request
	return stub.outcome, stub.err
}

type currentStartPrincipalValidatorFunc func(context.Context, auth.User) (auth.User, error)

func (function currentStartPrincipalValidatorFunc) ValidatePrincipal(
	ctx context.Context,
	user auth.User,
) (auth.User, error) {
	return function(ctx, user)
}

type currentStartPeerVerifierFunc func(*http.Request) error

func (function currentStartPeerVerifierFunc) VerifyForwardedIdentityPeer(request *http.Request) error {
	return function(request)
}

type currentStartPermissionResolverFunc func(
	context.Context,
	auth.User,
	string,
	string,
) (auth.PermissionResolution, error)

func (function currentStartPermissionResolverFunc) ResolvePermissions(
	ctx context.Context,
	user auth.User,
	mode,
	projectID string,
) (auth.PermissionResolution, error) {
	return function(ctx, user, mode, projectID)
}

func TestCurrentApplicationStartRoutePreservesPathRBACAndResponseContract(t *testing.T) {
	if CurrentApplicationStartPath != "/api/v2/elitea_core/messages/prompt_lib/{projectID}/{conversationID}" ||
		CurrentApplicationStartPermission != "models.chat.messages.create" ||
		CurrentApplicationStartMode != auth.PermissionModeDefault {
		t.Fatalf("route contract drifted: path=%q permission=%q mode=%q",
			CurrentApplicationStartPath, CurrentApplicationStartPermission, CurrentApplicationStartMode)
	}
	useCase := &currentStartUseCaseStub{outcome: agentexecutionapp.CurrentApplicationStartOutcome{
		ExecutionID: "execution-1", CommandID: "command-1",
		ResponseMessageID: "response-1", Created: true,
	}}
	permissions := currentStartPermissionResolverFunc(func(
		_ context.Context,
		user auth.User,
		mode,
		projectID string,
	) (auth.PermissionResolution, error) {
		if user.UserID != "11" || mode != auth.PermissionModeDefault || projectID != "7" {
			t.Fatalf("permission input user=%+v mode=%q project=%q", user, mode, projectID)
		}
		return auth.PermissionResolution{UserID: 11, Permissions: []string{CurrentApplicationStartPermission}}, nil
	})
	route := newCurrentStartRoute(t, useCase, permissions)

	response := httptest.NewRecorder()
	route.ServeHTTP(response, currentStartRequest(validCurrentStartBody()))

	if response.Code != http.StatusOK || useCase.calls != 1 ||
		useCase.request.ProjectID != 7 || useCase.request.ActorUserID != 11 ||
		useCase.request.ConversationUUID != "8bc66e50-46c4-4e2c-94ec-daec6c596ac0" ||
		useCase.request.TargetParticipantID != 21 ||
		useCase.request.QuestionID != "ee92ccbd-3312-4c72-b20b-fddf224e7c0e" ||
		useCase.request.UserInput != "hello" {
		t.Fatalf("status=%d calls=%d request=%+v body=%s",
			response.Code, useCase.calls, useCase.request, response.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil ||
		body["execution_id"] != "execution-1" || body["task_id"] != "execution-1" ||
		body["response_message_id"] != "response-1" ||
		body["events_url"] != "/api/v2/executions/7/execution-1/events" {
		t.Fatalf("response=%+v error=%v", body, err)
	}
}

func TestCurrentApplicationStartRouteFallsBackBeforeUseCaseForUnsupportedTurn(t *testing.T) {
	useCase := &currentStartUseCaseStub{}
	permissions := allowCurrentStartPermission()
	route := newCurrentStartRoute(t, useCase, permissions)
	body := strings.Replace(validCurrentStartBody(), `"mcp_tokens":{}`, `"mcp_tokens":{"server":{"access_token":"not-forwarded"}}`, 1)

	response := httptest.NewRecorder()
	route.ServeHTTP(response, currentStartRequest(body))

	if response.Code != http.StatusUnprocessableEntity || useCase.calls != 0 ||
		!strings.Contains(response.Body.String(), "unsupported_agent_execution") {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, useCase.calls, response.Body.String())
	}
}

func TestCurrentApplicationStartRouteAuthorizesBeforeExecution(t *testing.T) {
	useCase := &currentStartUseCaseStub{}
	permissions := currentStartPermissionResolverFunc(func(
		context.Context,
		auth.User,
		string,
		string,
	) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{UserID: 11}, nil
	})
	route := newCurrentStartRoute(t, useCase, permissions)

	response := httptest.NewRecorder()
	route.ServeHTTP(response, currentStartRequest(validCurrentStartBody()))

	if response.Code != http.StatusForbidden || useCase.calls != 0 {
		t.Fatalf("status=%d calls=%d body=%s", response.Code, useCase.calls, response.Body.String())
	}
}

func newCurrentStartRoute(
	t *testing.T,
	useCase StartUseCase,
	permissions auth.PermissionResolver,
) *CurrentApplicationStartRoute {
	t.Helper()
	route, err := NewCurrentApplicationStartRoute(
		useCase,
		apimw.AuthConfig{
			PrincipalValidator: currentStartPrincipalValidatorFunc(func(
				_ context.Context,
				user auth.User,
			) (auth.User, error) {
				if user.ID != "11" {
					return auth.User{}, errors.New("unexpected user")
				}
				return user, nil
			}),
			ForwardedIdentityVerifier: currentStartPeerVerifierFunc(func(request *http.Request) error {
				if request.RemoteAddr != "10.0.0.8:43120" {
					return errors.New("untrusted peer")
				}
				return nil
			}),
		},
		permissions,
	)
	if err != nil {
		t.Fatal(err)
	}
	return route
}

func allowCurrentStartPermission() auth.PermissionResolver {
	return currentStartPermissionResolverFunc(func(
		context.Context,
		auth.User,
		string,
		string,
	) (auth.PermissionResolution, error) {
		return auth.PermissionResolution{UserID: 11, Permissions: []string{CurrentApplicationStartPermission}}, nil
	})
}

func currentStartRequest(body string) *http.Request {
	request := httptest.NewRequest(
		http.MethodPost,
		"/api/v2/elitea_core/messages/prompt_lib/7/8bc66e50-46c4-4e2c-94ec-daec6c596ac0?execution_contract="+CurrentApplicationStartContract,
		strings.NewReader(body),
	)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Type", "user")
	request.Header.Set("X-Auth-ID", "11")
	request.RemoteAddr = "10.0.0.8:43120"
	return request
}

func validCurrentStartBody() string {
	return `{"payload":{"user_input":"hello"},"project_id":7,"participant_id":21,"conversation_uuid":"8bc66e50-46c4-4e2c-94ec-daec6c596ac0","question_id":"ee92ccbd-3312-4c72-b20b-fddf224e7c0e","interaction_uuid":"31df012a-300d-4722-9be2-521d987c63a8","attachments_info":[],"mcp_tokens":{}}`
}
