package auth_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/middleware"
	v2auth "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/auth"
	identity "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type tokenValidatorFunc func(context.Context, string) (identity.User, error)

func (f tokenValidatorFunc) ValidateToken(ctx context.Context, token string) (identity.User, error) {
	return f(ctx, token)
}

type principalValidatorFunc func(context.Context, identity.User) (identity.User, error)

func (f principalValidatorFunc) ValidatePrincipal(ctx context.Context, user identity.User) (identity.User, error) {
	return f(ctx, user)
}

func TestForwardAuthPreservesTokenRowAndOwningUserAcrossHeaders(t *testing.T) {
	forward := v2auth.NewForwardAuthHandler(nil, tokenValidatorFunc(func(_ context.Context, token string) (identity.User, error) {
		if token != "signed-token" {
			t.Fatalf("validated token = %q", token)
		}
		// Token row 42 and user row 42 both exist in this scenario, but token
		// row 42 deliberately belongs to user 7.
		return identity.User{
			ID:       "7",
			TokenID:  "42",
			UserID:   "7",
			Email:    "owner@example.test",
			AuthType: "token",
		}, nil
	}))
	forwardReq := httptest.NewRequest(http.MethodGet, "/auth", nil)
	forwardReq.Header.Set("Authorization", "Bearer signed-token")
	forwardRec := httptest.NewRecorder()
	forward.ServeHTTP(forwardRec, forwardReq)
	if forwardRec.Code != http.StatusOK {
		t.Fatalf("forward-auth status = %d, body=%s", forwardRec.Code, forwardRec.Body.String())
	}
	if got := forwardRec.Header().Get("X-Auth-ID"); got != "42" {
		t.Fatalf("X-Auth-ID = %q, want token row 42", got)
	}
	if got := forwardRec.Header().Get("X-Auth-User-ID"); got != "7" {
		t.Fatalf("X-Auth-User-ID = %q, want owner 7", got)
	}

	var downstream identity.User
	authMiddleware := middleware.Auth(middleware.AuthConfig{
		TrustForwardedIdentity: true,
		PrincipalValidator: principalValidatorFunc(func(_ context.Context, user identity.User) (identity.User, error) {
			if user.ID != "42" || user.TokenID != "42" || user.UserID != "7" {
				t.Fatalf("principal validator received %+v", user)
			}
			return user, nil
		}),
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var ok bool
		downstream, ok = identity.UserFromContext(r.Context())
		if !ok {
			t.Fatal("missing downstream identity")
		}
		w.WriteHeader(http.StatusNoContent)
	}))
	downstreamReq := httptest.NewRequest(http.MethodGet, "/api/v2/configurations/7", nil)
	for _, header := range []string{"X-Auth-Type", "X-Auth-ID", "X-Auth-User-ID", "X-Auth-Reference"} {
		downstreamReq.Header.Set(header, forwardRec.Header().Get(header))
	}
	downstreamRec := httptest.NewRecorder()
	authMiddleware.ServeHTTP(downstreamRec, downstreamReq)
	if downstreamRec.Code != http.StatusNoContent {
		t.Fatalf("downstream status = %d, body=%s", downstreamRec.Code, downstreamRec.Body.String())
	}
	if downstream.TokenID != "42" || downstream.UserID != "7" {
		t.Fatalf("downstream identity = %+v", downstream)
	}
}

func TestForwardAuthFailsClosedWhenValidatorOmitsTokenRowID(t *testing.T) {
	forward := v2auth.NewForwardAuthHandler(nil, tokenValidatorFunc(func(context.Context, string) (identity.User, error) {
		return identity.User{ID: "7", UserID: "7", AuthType: "token"}, nil
	}))
	req := httptest.NewRequest(http.MethodGet, "/auth", nil)
	req.Header.Set("Authorization", "Bearer signed-token")
	rec := httptest.NewRecorder()
	forward.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}
