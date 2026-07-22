package storage

import (
	"bytes"
	"context"
	"crypto/sha256"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/require"
)

func TestPostgresIndexRuntimeContextRequiresExactActiveClaimSessionAndFence(t *testing.T) {
	t.Parallel()

	identity, err := url.Parse("spiffe://elitea.internal/runtime/worker-1")
	require.NoError(t, err)
	fence := bytes.Repeat([]byte{7}, sha256.Size)
	store := contentQueryerFunc(func(_ context.Context, query string, args ...any) pgx.Row {
		for _, predicate := range []string{
			"ws.workload_session_id = c.workload_session_id",
			"ws.workload_identity = c.workload_identity",
			"ws.producer_id = c.producer_id",
			"c.released_at IS NULL",
			"c.lease_expires_at > clock_timestamp()",
			"ws.expires_at > clock_timestamp()",
			"ws.revoked_at IS NULL",
			"j.desired_state = 'RUNNING'",
			"j.capability_id = 'index.ingest.v1'",
		} {
			require.Contains(t, query, predicate)
		}
		require.Equal(t, []any{"claim-1", "execution-1", uint64(3), identity.String(), fence}, args)
		return contentRowFunc(func(dest ...any) error {
			require.Len(t, dest, 1)
			*dest[0].(*int64) = 42
			return nil
		})
	})
	repository, err := newPostgresContentRepository(store)
	require.NoError(t, err)

	authorization, err := repository.AuthorizeRuntimeContext(context.Background(), ContentClaim{
		PeerCertificate: certificateWithURI(identity),
		ExecutionID:     "execution-1",
		Generation:      3,
		ClaimID:         "claim-1",
		FenceToken:      fence,
	})
	require.NoError(t, err)
	require.EqualValues(t, 42, authorization.ResourceProjectID)
}

func TestPostgresIndexRuntimeContextHidesInactiveOrMismatchedClaims(t *testing.T) {
	t.Parallel()

	identity, err := url.Parse("spiffe://elitea.internal/runtime/worker-1")
	require.NoError(t, err)
	repository, err := newPostgresContentRepository(contentQueryerFunc(
		func(_ context.Context, query string, _ ...any) pgx.Row {
			require.True(t, strings.Contains(query, "j.capability_id = 'index.ingest.v1'"))
			return contentRowFunc(func(...any) error { return pgx.ErrNoRows })
		},
	))
	require.NoError(t, err)

	_, err = repository.AuthorizeRuntimeContext(context.Background(), ContentClaim{
		PeerCertificate: certificateWithURI(identity),
		ExecutionID:     "execution-1",
		Generation:      1,
		ClaimID:         "claim-1",
		FenceToken:      make([]byte, sha256.Size),
	})
	require.ErrorIs(t, err, ErrContentUnauthorized)
}

// TestPostgresIndexRuntimeContextAuthorizationIntegration crosses a real
// PostgreSQL service and proves the active claim/session/fence predicates. It
// intentionally leaves mTLS termination and PAT validation to their focused
// component tests.
func TestPostgresIndexRuntimeContextAuthorizationIntegration(t *testing.T) {
	databaseURL := os.Getenv("ELITEA_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("set ELITEA_TEST_DATABASE_URL to run the PostgreSQL runtime-context authorization test")
	}
	pool := isolatedStoragePostgresPool(t, databaseURL)
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	ddl := []string{
		`CREATE SCHEMA elitea_runtime`,
		`CREATE TABLE elitea_runtime.execution_jobs (
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    resource_project_id INTEGER NOT NULL,
    desired_state TEXT NOT NULL,
    capability_id TEXT NOT NULL,
    PRIMARY KEY (execution_id, generation)
)`,
		`CREATE TABLE elitea_runtime.workload_sessions (
    workload_session_id TEXT PRIMARY KEY,
    workload_identity TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ
)`,
		`CREATE TABLE elitea_runtime.execution_claims (
    claim_id TEXT PRIMARY KEY,
    execution_id TEXT NOT NULL,
    generation BIGINT NOT NULL,
    workload_session_id TEXT NOT NULL,
    workload_identity TEXT NOT NULL,
    producer_id TEXT NOT NULL,
    fence_token BYTEA NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    released_at TIMESTAMPTZ
)`,
	}
	for _, statement := range ddl {
		if _, err := pool.Exec(ctx, statement); err != nil {
			t.Fatal(err)
		}
	}
	identity, err := url.Parse("spiffe://elitea.internal/runtime/index-worker-1")
	require.NoError(t, err)
	fence := bytes.Repeat([]byte{8}, sha256.Size)
	if _, err := pool.Exec(ctx, `INSERT INTO elitea_runtime.execution_jobs
    (execution_id, generation, resource_project_id, desired_state, capability_id)
VALUES ('execution-1', 1, 42, 'RUNNING', 'index.ingest.v1')`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO elitea_runtime.workload_sessions
    (workload_session_id, workload_identity, producer_id, issued_at, expires_at)
VALUES ('session-1', $1, 'producer-1', clock_timestamp() - interval '1 minute', clock_timestamp() + interval '5 minutes')`, identity.String()); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `INSERT INTO elitea_runtime.execution_claims
    (claim_id, execution_id, generation, workload_session_id, workload_identity, producer_id, fence_token, lease_expires_at)
VALUES ('claim-1', 'execution-1', 1, 'session-1', $1, 'producer-1', $2, clock_timestamp() + interval '1 minute')`, identity.String(), fence); err != nil {
		t.Fatal(err)
	}
	repository, err := NewPostgresContentRepository(pool)
	require.NoError(t, err)
	claim := ContentClaim{
		PeerCertificate: certificateWithURI(identity),
		ExecutionID:     "execution-1",
		Generation:      1,
		ClaimID:         "claim-1",
		FenceToken:      fence,
	}
	authorization, err := repository.AuthorizeRuntimeContext(ctx, claim)
	require.NoError(t, err)
	require.EqualValues(t, 42, authorization.ResourceProjectID)

	claim.FenceToken = bytes.Repeat([]byte{9}, sha256.Size)
	_, err = repository.AuthorizeRuntimeContext(ctx, claim)
	require.ErrorIs(t, err, ErrContentUnauthorized)
	claim.FenceToken = fence
	if _, err := pool.Exec(ctx, `UPDATE elitea_runtime.workload_sessions SET revoked_at = clock_timestamp() WHERE workload_session_id = 'session-1'`); err != nil {
		t.Fatal(err)
	}
	_, err = repository.AuthorizeRuntimeContext(ctx, claim)
	require.ErrorIs(t, err, ErrContentUnauthorized)
}
