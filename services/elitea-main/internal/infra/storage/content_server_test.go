package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"encoding/base64"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	"github.com/stretchr/testify/require"
)

type contentAuthorizerFunc func(context.Context, ContentClaim) (ContentAuthorization, error)

func (f contentAuthorizerFunc) AuthorizeContent(ctx context.Context, claim ContentClaim) (ContentAuthorization, error) {
	return f(ctx, claim)
}

type contentStoreFunc func(context.Context, string, string, string, string) (io.ReadCloser, error)

func (f contentStoreFunc) OpenContent(ctx context.Context, projectID, inputBundleID, contentID, version string) (io.ReadCloser, error) {
	return f(ctx, projectID, inputBundleID, contentID, version)
}

type contentMaterializerFunc func(context.Context, ContentAuthorization, []byte, int64) ([]byte, error)

func (f contentMaterializerFunc) MaterializeContent(
	ctx context.Context,
	authorization ContentAuthorization,
	source []byte,
	maxBytes int64,
) ([]byte, error) {
	return f(ctx, authorization, source, maxBytes)
}

func TestContentServerRequiresVerifiedMTLSAndClaimFence(t *testing.T) {
	t.Parallel()

	server, err := NewContentServer(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			t.Fatal("authorizer must not be called")
			return ContentAuthorization{}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			t.Fatal("store must not be called")
			return nil, nil
		}),
		0,
	)
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodGet, "/executions/e1/generations/1/inputs/settings/versions/v1", nil)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	require.Equal(t, http.StatusUnauthorized, response.Code)
}

func TestContentServerReturnsOnlyAuthorizedVerifiedBytes(t *testing.T) {
	t.Parallel()

	data := []byte(`{"auth_type":"Digest"}`)
	digest := sha256.Sum256(data)
	fence := bytes.Repeat([]byte{7}, sha256.Size)
	certificate := &x509.Certificate{SerialNumber: nil}

	server, err := NewContentServer(
		contentAuthorizerFunc(func(_ context.Context, claim ContentClaim) (ContentAuthorization, error) {
			require.Equal(t, "execution-1", claim.ExecutionID)
			require.EqualValues(t, 1, claim.Generation)
			require.Equal(t, "claim-1", claim.ClaimID)
			require.Equal(t, fence, claim.FenceToken)
			require.Same(t, certificate, claim.PeerCertificate)
			return ContentAuthorization{
				ResourceProjectID: "42",
				ActorID:           "17",
				InputBundleID:     "bundle-1",
				CapabilityID:      executiondomain.ConfigurationValidationCapability,
				SemanticRole:      "configuration.settings",
				ExpectedDigest:    digest,
				ExpectedLength:    int64(len(data)),
			}, nil
		}),
		contentStoreFunc(func(_ context.Context, projectID, inputBundleID, contentID, version string) (io.ReadCloser, error) {
			require.Equal(t, "42", projectID)
			require.Equal(t, "bundle-1", inputBundleID)
			require.Equal(t, "settings", contentID)
			require.Equal(t, "v1", version)
			return io.NopCloser(bytes.NewReader(data)), nil
		}),
		0,
	)
	require.NoError(t, err)

	request := httptest.NewRequest(http.MethodGet, "/executions/execution-1/generations/1/inputs/settings/versions/v1", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{certificate}}}
	request.Header.Set(claimIDHeader, "claim-1")
	request.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(fence))
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)

	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, data, response.Body.Bytes())
	require.Equal(t, "private, no-store", response.Header().Get("Cache-Control"))
	require.NotEmpty(t, response.Header().Get("Content-Digest"))
	require.Equal(t, response.Header().Get("Content-Digest"), response.Header().Get(SourceContentDigestHeader))
	require.Equal(t, "v1", response.Header().Get(SourceImmutableVersionHeader))
	require.Equal(t, "22", response.Header().Get(SourceContentLengthHeader))
}

func TestContentServerDoesNotReleaseWrongDigest(t *testing.T) {
	t.Parallel()

	data := []byte(`{}`)
	server, err := NewContentServer(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{
				ResourceProjectID: "42",
				ActorID:           "17",
				InputBundleID:     "bundle-1",
				CapabilityID:      executiondomain.ConfigurationValidationCapability,
				SemanticRole:      "configuration.settings",
				ExpectedDigest:    sha256.Sum256([]byte("different")),
				ExpectedLength:    int64(len(data)),
			}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(data)), nil
		}),
		0,
	)
	require.NoError(t, err)

	request := validContentRequest(t)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	require.Equal(t, http.StatusInternalServerError, response.Code)
	require.NotEqual(t, data, response.Body.Bytes())
}

func TestContentServerHidesAuthorizationFailure(t *testing.T) {
	t.Parallel()

	server, err := NewContentServer(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{}, errors.New("sensitive reason")
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			t.Fatal("store must not be called")
			return nil, nil
		}),
		0,
	)
	require.NoError(t, err)

	request := validContentRequest(t)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	require.Equal(t, http.StatusForbidden, response.Code)
	require.NotContains(t, response.Body.String(), "sensitive")
}

func TestContentServerRejectsOverLimitBeforeOpeningContent(t *testing.T) {
	t.Parallel()

	server, err := NewContentServer(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{
				ResourceProjectID: "42",
				ActorID:           "17",
				InputBundleID:     "bundle-1",
				CapabilityID:      executiondomain.ConfigurationValidationCapability,
				SemanticRole:      "configuration.settings",
				ExpectedDigest:    sha256.Sum256([]byte("bounded")),
				ExpectedLength:    9,
			}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			t.Fatal("over-limit content must not be opened")
			return nil, nil
		}),
		8,
	)
	require.NoError(t, err)

	request := validContentRequest(t)
	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, request)
	require.Equal(t, http.StatusRequestEntityTooLarge, response.Code)
}

func TestContentServerRejectsMultiplexedWorkBeyondRequestCapacity(t *testing.T) {
	t.Parallel()

	server, err := NewContentServerWithLimits(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			t.Fatal("saturated content request must not reach PostgreSQL authorization")
			return ContentAuthorization{}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			t.Fatal("saturated content request must not open content")
			return nil, nil
		}),
		defaultMaxInputContentBytes,
		1,
	)
	require.NoError(t, err)
	server.requests <- struct{}{}
	defer func() { <-server.requests }()

	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, validContentRequest(t))
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	require.Equal(t, "1", response.Header().Get("Retry-After"))
}

func TestMaterializingRuntimeContentServerComposesBothBoundedPaths(t *testing.T) {
	t.Parallel()

	source := []byte(`{"private":true,"elitea_title":"source"}`)
	expanded := []byte(`{"configuration_type":"confluence","private":true}`)
	digest := sha256.Sum256(source)
	materializerCalls := 0
	materializer := contentMaterializerFunc(func(
		_ context.Context,
		authorization ContentAuthorization,
		gotSource []byte,
		maxBytes int64,
	) ([]byte, error) {
		materializerCalls++
		require.Equal(t, "17", authorization.ActorID)
		require.Equal(t, source, gotSource)
		require.EqualValues(t, 1024, maxBytes)
		return append([]byte(nil), expanded...), nil
	})
	runtimeToken := &EliteaClientTokenService{}
	server, err := NewMaterializingRuntimeContentServerWithLimits(
		contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
			return ContentAuthorization{
				ResourceProjectID: "42",
				ActorID:           "17",
				InputBundleID:     "bundle-1",
				CapabilityID:      executiondomain.IndexIngestCapability,
				SemanticRole:      "index.toolkit_configuration",
				ExpectedDigest:    digest,
				ExpectedLength:    int64(len(source)),
			}, nil
		}),
		contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
			return io.NopCloser(bytes.NewReader(source)), nil
		}),
		materializer,
		runtimeToken,
		1024,
		1,
	)
	require.NoError(t, err)
	require.NotNil(t, server.materializer)
	require.Same(t, runtimeToken, server.runtimeToken)
	require.Equal(t, 1, cap(server.requests))

	response := httptest.NewRecorder()
	server.Routes().ServeHTTP(response, validContentRequest(t))
	require.Equal(t, http.StatusOK, response.Code)
	require.Equal(t, expanded, response.Body.Bytes())
	require.Equal(t, 1, materializerCalls)

	runtimeRequest := httptest.NewRequest(
		http.MethodPost,
		"/executions/execution-1/generations/1/runtime-context/elitea-client-token",
		nil,
	)
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, runtimeRequest)
	require.Equal(t, http.StatusUnauthorized, response.Code)

	server.requests <- struct{}{}
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, validContentRequest(t))
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	response = httptest.NewRecorder()
	server.Routes().ServeHTTP(response, runtimeRequest)
	require.Equal(t, http.StatusServiceUnavailable, response.Code)
	<-server.requests
}

func TestMaterializingRuntimeContentServerRequiresBothServices(t *testing.T) {
	t.Parallel()

	authorizer := contentAuthorizerFunc(func(context.Context, ContentClaim) (ContentAuthorization, error) {
		return ContentAuthorization{}, nil
	})
	store := contentStoreFunc(func(context.Context, string, string, string, string) (io.ReadCloser, error) {
		return nil, nil
	})
	materializer := contentMaterializerFunc(func(context.Context, ContentAuthorization, []byte, int64) ([]byte, error) {
		return nil, nil
	})
	runtimeToken := &EliteaClientTokenService{}

	_, err := NewMaterializingRuntimeContentServerWithLimits(authorizer, store, nil, runtimeToken, 1024, 1)
	require.EqualError(t, err, "content materializer is required")
	_, err = NewMaterializingRuntimeContentServerWithLimits(authorizer, store, materializer, nil, 1024, 1)
	require.EqualError(t, err, "runtime context is required")

	materializing, err := NewMaterializingContentServerWithLimits(authorizer, store, materializer, 1024, 1)
	require.NoError(t, err)
	require.NotNil(t, materializing.materializer)
	require.Nil(t, materializing.runtimeToken)
	runtime, err := NewRuntimeContentServerWithLimits(authorizer, store, runtimeToken, 1024, 1)
	require.NoError(t, err)
	require.Nil(t, runtime.materializer)
	require.Same(t, runtimeToken, runtime.runtimeToken)
}

func validContentRequest(t *testing.T) *http.Request {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/executions/execution-1/generations/1/inputs/settings/versions/v1", nil)
	request.TLS = &tls.ConnectionState{VerifiedChains: [][]*x509.Certificate{{{}}}}
	request.Header.Set(claimIDHeader, "claim-1")
	request.Header.Set(fenceHeader, base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{1}, sha256.Size)))
	return request
}

func TestWorkloadIdentityRequiresOneUnambiguousVerifiedSAN(t *testing.T) {
	t.Parallel()

	valid, err := url.Parse("spiffe://elitea.internal/runtime/worker-1")
	require.NoError(t, err)
	identity, err := workloadIdentity(&x509.Certificate{URIs: []*url.URL{valid}})
	require.NoError(t, err)
	require.Equal(t, valid.String(), identity)
	dnsIdentity, err := workloadIdentity(&x509.Certificate{DNSNames: []string{"Worker.Runtime.Example"}})
	require.NoError(t, err)
	require.Equal(t, "dns:worker.runtime.example", dnsIdentity)

	for _, certificate := range []*x509.Certificate{
		nil,
		{},
		{DNSNames: []string{"*.runtime.example"}},
		{URIs: []*url.URL{valid}, DNSNames: []string{"worker.runtime.example"}},
		{URIs: []*url.URL{valid, valid}},
		{URIs: []*url.URL{{Scheme: "https", Host: "elitea.internal", Path: "/runtime/worker-1"}}},
		{URIs: []*url.URL{{Scheme: "spiffe", Host: "", Path: "/runtime/worker-1"}}},
		{URIs: []*url.URL{{Scheme: "spiffe", Host: "elitea.internal", Path: ""}}},
	} {
		_, err := workloadIdentity(certificate)
		require.ErrorIs(t, err, ErrContentUnauthorized)
	}
}
