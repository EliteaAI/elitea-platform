package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	identity "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
)

type tokenRepositoryStub struct {
	listFunc   func(context.Context, int64) ([]tokenRecord, error)
	getFunc    func(context.Context, int64, string) (tokenRecord, error)
	createFunc func(context.Context, int64, string, *time.Time) (tokenRecord, error)
	deleteFunc func(context.Context, int64, string) error
}

func (s tokenRepositoryStub) List(ctx context.Context, userID int64) ([]tokenRecord, error) {
	return s.listFunc(ctx, userID)
}

func (s tokenRepositoryStub) GetOwned(ctx context.Context, userID int64, tokenUUID string) (tokenRecord, error) {
	return s.getFunc(ctx, userID, tokenUUID)
}

func (s tokenRepositoryStub) Create(ctx context.Context, userID int64, name string, expires *time.Time) (tokenRecord, error) {
	return s.createFunc(ctx, userID, name, expires)
}

func (s tokenRepositoryStub) DeleteOwned(ctx context.Context, userID int64, tokenUUID string) error {
	return s.deleteFunc(ctx, userID, tokenUUID)
}

func TestTokenCreatePersistsCurrentBaselineContractForOwningUser(t *testing.T) {
	const tokenUUID = "8ce4be49-0d10-4f05-a63f-d6d46f99a3f0"
	secret := []byte("test-secret")
	var gotOwnerID int64
	var gotName string
	var gotExpires *time.Time
	handler := &Handler{
		tokenSigningKey: secret,
		tokens: tokenRepositoryStub{
			createFunc: func(_ context.Context, ownerID int64, name string, expires *time.Time) (tokenRecord, error) {
				gotOwnerID, gotName, gotExpires = ownerID, name, expires
				return tokenRecord{ID: 11, UUID: tokenUUID, Expires: expires, UserID: ownerID, Name: name}, nil
			},
		},
	}

	req := authenticatedTokenRequest(http.MethodPost, "/token/", `{"name":"ci-token","expires":{"measure":"hours","value":24}}`)
	rec := httptest.NewRecorder()
	handler.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "no-store" {
		t.Fatalf("Cache-Control = %q, want no-store", got)
	}
	if gotOwnerID != 7 {
		t.Fatalf("persisted owner = %d, want 7; token row ID 42 must not be treated as user ID", gotOwnerID)
	}
	if gotName != "ci-token" || gotExpires == nil {
		t.Fatalf("persisted token name=%q expires=%v", gotName, gotExpires)
	}
	remaining := time.Until(*gotExpires)
	if remaining < 23*time.Hour+59*time.Minute || remaining > 24*time.Hour+time.Minute {
		t.Fatalf("expiry remaining = %s, want approximately 24h", remaining)
	}

	var response map[string]json.RawMessage
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	for _, required := range []string{"id", "uuid", "expires", "user_id", "name", "token"} {
		if _, ok := response[required]; !ok {
			t.Fatalf("response is missing current-baseline field %q: %v", required, response)
		}
	}
	for _, obsolete := range []string{"created_at", "prefix"} {
		if _, ok := response[obsolete]; ok {
			t.Fatalf("response contains non-baseline field %q", obsolete)
		}
	}
	var encoded string
	if err := json.Unmarshal(response["token"], &encoded); err != nil {
		t.Fatal(err)
	}
	parsed, err := jwt.ParseWithClaims(encoded, &baselineTokenClaims{}, func(token *jwt.Token) (any, error) {
		if token.Method.Alg() != jwt.SigningMethodHS512.Alg() {
			t.Fatalf("signing algorithm = %s, want HS512", token.Method.Alg())
		}
		return secret, nil
	})
	if err != nil || !parsed.Valid {
		t.Fatalf("created token is not a valid current-baseline HS512 JWT: valid=%v err=%v", parsed.Valid, err)
	}
	claims := parsed.Claims.(*baselineTokenClaims)
	if claims.UUID != tokenUUID || claims.Expires == nil {
		t.Fatalf("claims = %+v", claims)
	}
}

func TestTokenCreateRejectsTrailingJSONDocument(t *testing.T) {
	createCalls := 0
	handler := &Handler{
		tokenSigningKey: []byte("test-secret"),
		tokens: tokenRepositoryStub{
			createFunc: func(context.Context, int64, string, *time.Time) (tokenRecord, error) {
				createCalls++
				return tokenRecord{}, nil
			},
		},
	}

	req := authenticatedTokenRequest(http.MethodPost, "/token/", `{"name":"first"}{"name":"second"}`)
	rec := httptest.NewRecorder()
	handler.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d, body = %s", rec.Code, http.StatusBadRequest, rec.Body.String())
	}
	if createCalls != 0 {
		t.Fatalf("repository create calls = %d, want 0", createCalls)
	}
}

func TestTokenListMasksReconstructedTokensAndScopesByOwner(t *testing.T) {
	const tokenUUID = "8ce4be49-0d10-4f05-a63f-d6d46f99a3f0"
	var gotOwnerID int64
	handler := &Handler{
		tokenSigningKey: []byte("test-secret"),
		tokens: tokenRepositoryStub{
			listFunc: func(_ context.Context, ownerID int64) ([]tokenRecord, error) {
				gotOwnerID = ownerID
				return []tokenRecord{{ID: 11, UUID: tokenUUID, UserID: ownerID, Name: "ci-token"}}, nil
			},
		},
	}

	req := authenticatedTokenRequest(http.MethodGet, "/token/", "")
	rec := httptest.NewRecorder()
	handler.Routes().ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if gotOwnerID != 7 {
		t.Fatalf("listed owner = %d, want 7", gotOwnerID)
	}
	var response []Token
	if err := json.NewDecoder(rec.Body).Decode(&response); err != nil {
		t.Fatal(err)
	}
	if len(response) != 1 || len(response[0].Token) != 10 || !strings.HasPrefix(response[0].Token, "...") {
		t.Fatalf("masked response = %+v", response)
	}
}

func TestTokenDeletePreservesNotFoundAndOwnershipFailures(t *testing.T) {
	const tokenUUID = "8ce4be49-0d10-4f05-a63f-d6d46f99a3f0"
	for _, test := range []struct {
		name   string
		err    error
		status int
	}{
		{name: "missing", err: errTokenNotFound, status: http.StatusBadRequest},
		{name: "different owner", err: errTokenForbidden, status: http.StatusForbidden},
		{name: "deleted", status: http.StatusNoContent},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler := &Handler{
				tokenSigningKey: []byte("test-secret"),
				tokens: tokenRepositoryStub{
					deleteFunc: func(_ context.Context, ownerID int64, gotUUID string) error {
						if ownerID != 7 || gotUUID != tokenUUID {
							t.Fatalf("delete owner=%d uuid=%q", ownerID, gotUUID)
						}
						return test.err
					},
				},
			}
			req := authenticatedTokenRequest(http.MethodDelete, "/token/"+tokenUUID, "")
			rec := httptest.NewRecorder()
			handler.Routes().ServeHTTP(rec, req)
			if rec.Code != test.status {
				t.Fatalf("status = %d, want %d, body=%s", rec.Code, test.status, rec.Body.String())
			}
		})
	}
}

func TestTokenServiceFailsClosedWithoutDatabaseOrSigningKey(t *testing.T) {
	for _, handler := range []*Handler{
		{tokenSigningKey: []byte("configured")},
		{tokens: tokenRepositoryStub{listFunc: func(context.Context, int64) ([]tokenRecord, error) { return nil, errors.New("unused") }}},
	} {
		req := authenticatedTokenRequest(http.MethodGet, "/token/", "")
		rec := httptest.NewRecorder()
		handler.Routes().ServeHTTP(rec, req)
		if rec.Code != http.StatusServiceUnavailable {
			t.Fatalf("status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
		}
	}
}

func authenticatedTokenRequest(method, target, body string) *http.Request {
	req := httptest.NewRequest(method, target, bytes.NewBufferString(body))
	principal := identity.User{
		ID:       "42",
		TokenID:  "42",
		UserID:   "7",
		AuthType: "token",
	}
	return req.WithContext(identity.ContextWithUser(req.Context(), principal))
}
