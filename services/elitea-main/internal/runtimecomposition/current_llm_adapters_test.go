package runtimecomposition

import (
	"context"
	"errors"
	"math"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type currentPersonalProjectResolverStub struct {
	userID    int32
	projectID int32
	err       error
}

func (stub *currentPersonalProjectResolverStub) PersonalProjectID(_ context.Context, userID int32) (int32, error) {
	stub.userID = userID
	return stub.projectID, stub.err
}

func TestCurrentLLMCallerUsesAuthenticatedOwnerAndCurrentPersonalProject(t *testing.T) {
	personal := &currentPersonalProjectResolverStub{projectID: 7}
	resolver, err := NewCurrentLLMCallerResolver(personal)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest("POST", "/llm/v1/embeddings", nil)
	request = request.WithContext(auth.ContextWithAuthenticatedUser(
		request.Context(),
		auth.User{ID: "91", UserID: "11", TokenID: "91", AuthType: "token"},
		auth.AuthenticationSourceToken,
	))

	caller, err := resolver.ResolveCurrentCaller(request.Context(), request)
	if err != nil || caller.UserID != 11 || caller.DefaultProjectID != 7 || personal.userID != 11 {
		t.Fatalf("caller=%+v err=%v resolved_user=%d", caller, err, personal.userID)
	}
}

func TestCurrentLLMCallerFailsClosedWithoutTrustedIdentityOrProject(t *testing.T) {
	for name, test := range map[string]struct {
		context  context.Context
		personal *currentPersonalProjectResolverStub
	}{
		"plain context identity": {
			context:  auth.ContextWithUser(context.Background(), auth.User{ID: "11", UserID: "11"}),
			personal: &currentPersonalProjectResolverStub{projectID: 7},
		},
		"development provenance": {
			context: auth.ContextWithAuthenticatedUser(
				context.Background(), auth.User{ID: "11", UserID: "11"}, auth.AuthenticationSourceDevelopment,
			),
			personal: &currentPersonalProjectResolverStub{projectID: 7},
		},
		"token has no personal project": {
			context: auth.ContextWithAuthenticatedUser(
				context.Background(), auth.User{ID: "11", UserID: "11"}, auth.AuthenticationSourceToken,
			),
			personal: &currentPersonalProjectResolverStub{},
		},
		"owner exceeds current id range": {
			context: auth.ContextWithAuthenticatedUser(
				context.Background(),
				auth.User{ID: "2147483648", UserID: "2147483648"},
				auth.AuthenticationSourceToken,
			),
			personal: &currentPersonalProjectResolverStub{projectID: 7},
		},
	} {
		t.Run(name, func(t *testing.T) {
			resolver, err := NewCurrentLLMCallerResolver(test.personal)
			if err != nil {
				t.Fatal(err)
			}
			request := httptest.NewRequest("POST", "/llm/v1/embeddings", nil).WithContext(test.context)
			if _, err := resolver.ResolveCurrentCaller(test.context, request); !errors.Is(err, ErrCurrentLLMCallerUnavailable) {
				t.Fatalf("error=%v", err)
			}
		})
	}

	tooLarge := &currentPersonalProjectResolverStub{projectID: 7}
	resolver, _ := NewCurrentLLMCallerResolver(tooLarge)
	ctx := auth.ContextWithAuthenticatedUser(
		context.Background(),
		auth.User{ID: "2147483648", UserID: "2147483648"},
		auth.AuthenticationSourceToken,
	)
	request := httptest.NewRequest("POST", "/llm/v1/embeddings", nil).WithContext(ctx)
	if _, err := resolver.ResolveCurrentCaller(ctx, request); !errors.Is(err, ErrCurrentLLMCallerUnavailable) || math.MaxInt32 != 2147483647 {
		t.Fatalf("large owner error=%v", err)
	}
	if _, err := NewCurrentLLMCallerResolver(nil); !errors.Is(err, ErrCurrentLLMCallerUnavailable) {
		t.Fatalf("nil dependency error=%v", err)
	}
}

func TestCurrentLLMPublicProjectIsExplicitAndContextAware(t *testing.T) {
	resolver, err := NewCurrentLLMPublicProjectResolver(41)
	if err != nil {
		t.Fatal(err)
	}
	if projectID, err := resolver.CurrentPublicProjectID(context.Background()); err != nil || projectID != 41 {
		t.Fatalf("project=%d err=%v", projectID, err)
	}
	cancelled, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := resolver.CurrentPublicProjectID(cancelled); !errors.Is(err, context.Canceled) {
		t.Fatalf("cancel error=%v", err)
	}
	if _, err := NewCurrentLLMPublicProjectResolver(0); err == nil {
		t.Fatal("invalid public project was accepted")
	}
}
