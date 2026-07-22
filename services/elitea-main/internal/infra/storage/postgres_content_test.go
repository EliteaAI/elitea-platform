package storage

import (
	"context"
	"crypto/sha256"
	"crypto/x509"
	"net/url"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

type contentQueryerFunc func(context.Context, string, ...any) pgx.Row

func (f contentQueryerFunc) QueryRow(ctx context.Context, query string, args ...any) pgx.Row {
	return f(ctx, query, args...)
}

type contentRowFunc func(...any) error

func (f contentRowFunc) Scan(dest ...any) error {
	return f(dest...)
}

func certificateWithURI(identity *url.URL) *x509.Certificate {
	return &x509.Certificate{URIs: []*url.URL{identity}}
}

func TestPostgresContentAuthorizationRequiresInputReadAudience(t *testing.T) {
	t.Parallel()

	identity, err := url.Parse("spiffe://elitea.internal/runtime/worker-1")
	require.NoError(t, err)
	wantDigest := sha256.Sum256([]byte(`{"auth_type":"Digest"}`))

	store := contentQueryerFunc(func(_ context.Context, query string, args ...any) pgx.Row {
		require.Contains(t, query, "e.required_grant_audience = $8")
		require.Contains(t, query, "ws.workload_session_id = c.workload_session_id")
		require.Contains(t, query, "ws.workload_identity = c.workload_identity")
		require.Contains(t, query, "ws.producer_id = c.producer_id")
		require.Contains(t, query, "ws.issued_at <= clock_timestamp()")
		require.Contains(t, query, "ws.expires_at > clock_timestamp()")
		require.Contains(t, query, "ws.revoked_at IS NULL")
		require.Contains(t, query, "j.capability_id IN ('configuration.validate.v1', 'index.ingest.v1')")
		require.Len(t, args, 8)
		require.Equal(t, inputReadGrantAudience, args[7])
		return contentRowFunc(func(dest ...any) error {
			require.Len(t, dest, 6)
			*dest[0].(*string) = "42"
			*dest[1].(*string) = "bundle-1"
			*dest[2].(*string) = "index.ingest.v1"
			*dest[3].(*string) = "index.toolkit_configuration"
			*dest[4].(*[]byte) = append([]byte(nil), wantDigest[:]...)
			*dest[5].(*int64) = 22
			return nil
		})
	})
	repository, err := newPostgresContentRepository(store)
	require.NoError(t, err)

	authorization, err := repository.AuthorizeContent(context.Background(), ContentClaim{
		PeerCertificate:  certificateWithURI(identity),
		ExecutionID:      "execution-1",
		Generation:       1,
		ClaimID:          "claim-1",
		FenceToken:       make([]byte, sha256.Size),
		ContentID:        "content-1",
		ImmutableVersion: "version-1",
	})
	require.NoError(t, err)
	require.Equal(t, "42", authorization.ResourceProjectID)
	require.Equal(t, "bundle-1", authorization.InputBundleID)
	require.Equal(t, "index.ingest.v1", authorization.CapabilityID)
	require.Equal(t, "index.toolkit_configuration", authorization.SemanticRole)
	require.Equal(t, wantDigest, authorization.ExpectedDigest)
	require.EqualValues(t, 22, authorization.ExpectedLength)
}

func TestPostgresContentAuthorizationHidesAudienceMiss(t *testing.T) {
	t.Parallel()

	identity, err := url.Parse("spiffe://elitea.internal/runtime/worker-1")
	require.NoError(t, err)
	repository, err := newPostgresContentRepository(contentQueryerFunc(
		func(_ context.Context, query string, args ...any) pgx.Row {
			require.True(t, strings.Contains(query, "e.required_grant_audience = $8"))
			require.Equal(t, inputReadGrantAudience, args[7])
			return contentRowFunc(func(...any) error { return pgx.ErrNoRows })
		},
	))
	require.NoError(t, err)

	_, err = repository.AuthorizeContent(context.Background(), ContentClaim{
		PeerCertificate:  certificateWithURI(identity),
		ExecutionID:      "execution-1",
		Generation:       1,
		ClaimID:          "claim-1",
		FenceToken:       make([]byte, sha256.Size),
		ContentID:        "content-1",
		ImmutableVersion: "version-1",
	})
	require.ErrorIs(t, err, ErrContentUnauthorized)
}
