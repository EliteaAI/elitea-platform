package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/stretchr/testify/require"
)

type runtimeContextAuthorizerFunc func(context.Context, ContentClaim) (RuntimeContextAuthorization, error)

func (f runtimeContextAuthorizerFunc) AuthorizeRuntimeContext(ctx context.Context, claim ContentClaim) (RuntimeContextAuthorization, error) {
	return f(ctx, claim)
}

type projectTokenValidatorFunc func(context.Context, string) (auth.User, error)

func (f projectTokenValidatorFunc) ValidateToken(ctx context.Context, token string) (auth.User, error) {
	return f(ctx, token)
}

func TestIndexRuntimeContextReturnsOnlyClaimProjectSystemToken(t *testing.T) {
	t.Parallel()

	const token = "header.payload.signature"
	fence := bytes.Repeat([]byte{4}, sha256.Size)
	certificate := &x509.Certificate{}
	vaults := &fakeSecretVaultLoader{
		projects: map[int64]SecretVault{
			42: &fakeSecretVault{regular: map[string]string{projectAuthTokenSecretName: token}},
		},
		admin:        &fakeSecretVault{regular: map[string]string{projectAuthTokenSecretName: "admin-token"}},
		projectLoads: map[int64]int{},
	}
	service, err := NewEliteaClientTokenService(
		runtimeContextAuthorizerFunc(func(_ context.Context, claim ContentClaim) (RuntimeContextAuthorization, error) {
			require.Equal(t, "execution-1", claim.ExecutionID)
			require.EqualValues(t, 7, claim.Generation)
			require.Equal(t, "claim-1", claim.ClaimID)
			require.Equal(t, fence, claim.FenceToken)
			require.Same(t, certificate, claim.PeerCertificate)
			require.Empty(t, claim.ContentID)
			require.Empty(t, claim.ImmutableVersion)
			return RuntimeContextAuthorization{ResourceProjectID: 42}, nil
		}),
		vaults,
		projectTokenValidatorFunc(func(_ context.Context, got string) (auth.User, error) {
			require.Equal(t, token, got)
			return auth.User{
				ID: "900", UserID: "900", TokenID: "901",
				Email: "system_user_42@centry.user", AuthType: "token",
			}, nil
		}),
	)
	require.NoError(t, err)
	server := newIndexRuntimeContextTestServer(t, service)

	request := httptest.NewRequest(http.MethodPost, "/executions/execution-1/generations/7/runtime-context/elitea-client-token", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{certificate}}}
	request.Header.Set(claimIDHeader, "claim-1")
	request.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(fence))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, "application/json", response.Header().Get("Content-Type"))
	require.Equal(t, "no-store, no-cache, must-revalidate", response.Header().Get("Cache-Control"))
	require.Equal(t, "no-cache", response.Header().Get("Pragma"))
	require.Equal(t, "0", response.Header().Get("Expires"))
	require.Equal(t, "nosniff", response.Header().Get("X-Content-Type-Options"))
	require.NotEmpty(t, response.Header().Get("Content-Length"))
	digest := sha256.Sum256(response.Body.Bytes())
	require.Equal(t, formatSHA256Digest(digest), response.Header().Get("Content-Digest"))

	var value EliteaClientTokenContext
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &value))
	require.Equal(t, EliteaClientTokenSchemaVersion, value.SchemaVersion)
	require.EqualValues(t, 42, value.ProjectID)
	require.Equal(t, token, value.Token)
	require.Equal(t, 1, vaults.projectLoads[42])
	require.Zero(t, vaults.adminLoads)
}

func TestIndexRuntimeContextFailsClosedWithoutAdminFallbackOrOwnedPAT(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name      string
		project   SecretVault
		principal auth.User
		validate  error
	}{
		{
			name:      "missing project token",
			project:   &fakeSecretVault{regular: map[string]string{}},
			principal: validProjectTokenPrincipal(),
		},
		{
			name:      "wrong project system user",
			project:   &fakeSecretVault{regular: map[string]string{projectAuthTokenSecretName: "project-canary"}},
			principal: auth.User{ID: "900", UserID: "900", TokenID: "901", Email: "system_user_7@centry.user", AuthType: "token"},
		},
		{
			name:      "inactive PAT",
			project:   &fakeSecretVault{regular: map[string]string{projectAuthTokenSecretName: "project-canary"}},
			principal: validProjectTokenPrincipal(),
			validate:  errors.New("inactive token details must not escape"),
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			vaults := &fakeSecretVaultLoader{
				projects:     map[int64]SecretVault{42: test.project},
				admin:        &fakeSecretVault{regular: map[string]string{projectAuthTokenSecretName: "admin-canary"}},
				projectLoads: map[int64]int{},
			}
			service, err := NewEliteaClientTokenService(
				runtimeContextAuthorizerFunc(func(context.Context, ContentClaim) (RuntimeContextAuthorization, error) {
					return RuntimeContextAuthorization{ResourceProjectID: 42}, nil
				}),
				vaults,
				projectTokenValidatorFunc(func(context.Context, string) (auth.User, error) {
					return test.principal, test.validate
				}),
			)
			require.NoError(t, err)

			_, err = service.Resolve(context.Background(), ContentClaim{})
			require.ErrorIs(t, err, ErrContentUnavailable)
			require.NotContains(t, err.Error(), "canary")
			require.Zero(t, vaults.adminLoads)
		})
	}
}

func TestIndexRuntimeContextRouteRejectsUntrustedOrNonEmptyRequests(t *testing.T) {
	t.Parallel()

	calls := 0
	service, err := NewEliteaClientTokenService(
		runtimeContextAuthorizerFunc(func(context.Context, ContentClaim) (RuntimeContextAuthorization, error) {
			calls++
			return RuntimeContextAuthorization{}, ErrContentUnauthorized
		}),
		&fakeSecretVaultLoader{projectLoads: map[int64]int{}},
		projectTokenValidatorFunc(func(context.Context, string) (auth.User, error) {
			t.Fatal("validator must not be called")
			return auth.User{}, nil
		}),
	)
	require.NoError(t, err)
	server := newIndexRuntimeContextTestServer(t, service)

	missingTLS := httptest.NewRequest(http.MethodPost, "/executions/e/generations/1/runtime-context/elitea-client-token", nil)
	missingTLS.Header.Set(claimIDHeader, "claim")
	missingTLS.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(make([]byte, sha256.Size)))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, missingTLS)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, calls)
	require.Contains(t, response.Header().Get("Cache-Control"), "no-store")

	nonEmpty := validRuntimeContextRequest(t, bytes.NewBufferString("not-allowed"))
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, nonEmpty)
	require.Equal(t, http.StatusBadRequest, response.Code)
	require.Zero(t, calls)

	nonCanonical := validRuntimeContextRequest(t, nil)
	nonCanonical.URL.Path = "/executions/execution-1/generations/01/runtime-context/elitea-client-token"
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, nonCanonical)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, calls)

	duplicateClaim := validRuntimeContextRequest(t, nil)
	duplicateClaim.Header.Add(claimIDHeader, "claim-2")
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, duplicateClaim)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, calls)

	overflowGeneration := validRuntimeContextRequest(t, nil)
	overflowGeneration.URL.Path = "/executions/execution-1/generations/9223372036854775808/runtime-context/elitea-client-token"
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, overflowGeneration)
	require.Equal(t, http.StatusUnauthorized, response.Code)
	require.Zero(t, calls)
}

func TestIndexRuntimeContextRouteSharesContentCapacityAndIsNotMountedByDefault(t *testing.T) {
	t.Parallel()

	service, err := NewEliteaClientTokenService(
		runtimeContextAuthorizerFunc(func(context.Context, ContentClaim) (RuntimeContextAuthorization, error) {
			t.Fatal("saturated request must not authorize")
			return RuntimeContextAuthorization{}, nil
		}),
		&fakeSecretVaultLoader{projectLoads: map[int64]int{}},
		projectTokenValidatorFunc(func(context.Context, string) (auth.User, error) {
			t.Fatal("saturated request must not validate")
			return auth.User{}, nil
		}),
	)
	require.NoError(t, err)
	server := newIndexRuntimeContextTestServer(t, service)
	server.requests <- struct{}{}
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, validRuntimeContextRequest(t, nil))
	<-server.requests
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	require.Equal(t, "1", response.Header().Get("Retry-After"))

	ordinary, err := NewContentServer(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			return nil, nil
		}),
		1024,
	)
	require.NoError(t, err)
	response = httptest.NewRecorder()
	ordinary.Routes().ServeHTTP(response, validRuntimeContextRequest(t, nil))
	require.Equal(t, http.StatusNotFound, response.Code)
}

func newIndexRuntimeContextTestServer(t *testing.T, service *EliteaClientTokenService) *ContentServer {
	t.Helper()
	server, err := NewRuntimeContentServerWithLimits(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			t.Fatal("runtime-context route must not call content-entry authorization")
			return ContentAuthorization{}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			t.Fatal("runtime-context route must not open input content")
			return nil, nil
		}),
		service,
		1024,
		1,
	)
	require.NoError(t, err)
	return server
}

func validRuntimeContextRequest(t *testing.T, body io.Reader) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodPost, "/executions/execution-1/generations/1/runtime-context/elitea-client-token", body)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{{}}}}
	request.Header.Set(claimIDHeader, "claim-1")
	request.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, sha256.Size)))
	return request
}

func validProjectTokenPrincipal() auth.User {
	return auth.User{
		ID: "900", UserID: "900", TokenID: "901",
		Email: "system_user_42@centry.user", AuthType: "token",
	}
}
