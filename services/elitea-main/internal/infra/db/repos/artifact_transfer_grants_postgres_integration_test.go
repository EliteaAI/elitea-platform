package repos

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// newArtifactTransferGrantsTestRepos builds both S6's bucket repository and
// S15's grant repository against the SAME pool — a grant row's bucket_id
// foreign-keys into elitea_storage.buckets (ON DELETE CASCADE), so a
// meaningful grant test always needs a real bucket row from the same
// database first.
func newArtifactTransferGrantsTestRepos(t *testing.T) (*ArtifactBucketsRepository, *ArtifactTransferGrantsRepository) {
	t.Helper()
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	buckets, err := NewArtifactBucketsRepository(pool)
	if err != nil {
		t.Fatalf("NewArtifactBucketsRepository: %v", err)
	}
	grants, err := NewArtifactTransferGrantsRepository(pool)
	if err != nil {
		t.Fatalf("NewArtifactTransferGrantsRepository: %v", err)
	}
	return buckets, grants
}

func TestArtifactGrantRepositoryCreatesAndFetchesAgainstRealPostgres(t *testing.T) {
	buckets, grants := newArtifactTransferGrantsTestRepos(t)
	ctx := context.Background()
	const projectID = int64(9201)

	bucket := mustCreateArtifactBucket(t, buckets, projectID, "reports")
	digestAlg := "sha256"
	digest := []byte{0xde, 0xad, 0xbe, 0xef}
	expiresAt := time.Now().Add(15 * time.Minute).Truncate(time.Millisecond)

	created, err := grants.CreateTransferGrant(ctx, NewTransferGrantInput{
		ID: "11111111-1111-4111-8111-111111111111", ProjectID: projectID, BucketID: bucket.ID,
		Key: "11111111-1111-4111-8111-111111111111", Method: "PUT", ContentType: "image/png",
		MaxBytes: 4096, DigestAlg: &digestAlg, Digest: digest, ExpiresAt: expiresAt,
	})
	if err != nil {
		t.Fatalf("CreateTransferGrant: %v", err)
	}
	if created.ID != "11111111-1111-4111-8111-111111111111" || created.ProjectID != projectID ||
		created.BucketID != bucket.ID || created.Method != "PUT" || created.ContentType != "image/png" ||
		created.MaxBytes != 4096 || created.DigestAlg == nil || *created.DigestAlg != "sha256" ||
		string(created.Digest) != string(digest) || created.ConsumedAt != nil {
		t.Fatalf("created = %+v", created)
	}
	if !created.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("created.ExpiresAt = %v, want %v", created.ExpiresAt, expiresAt)
	}

	fetched, err := grants.GetTransferGrant(ctx, created.ID, projectID)
	if err != nil {
		t.Fatalf("GetTransferGrant: %v", err)
	}
	if fetched.ID != created.ID || fetched.Key != created.Key || !fetched.ExpiresAt.Equal(expiresAt) {
		t.Fatalf("fetched = %+v", fetched)
	}
}

func TestArtifactGrantRepositoryGetIsScopedToProjectIDAgainstRealPostgres(t *testing.T) {
	buckets, grants := newArtifactTransferGrantsTestRepos(t)
	ctx := context.Background()
	const projectID = int64(9202)
	const otherProjectID = int64(9203)

	bucket := mustCreateArtifactBucket(t, buckets, projectID, "reports")
	created, err := grants.CreateTransferGrant(ctx, NewTransferGrantInput{
		ID: "22222222-2222-4222-8222-222222222222", ProjectID: projectID, BucketID: bucket.ID,
		Key: "22222222-2222-4222-8222-222222222222", Method: "PUT", ContentType: "image/png",
		MaxBytes: 4096, ExpiresAt: time.Now().Add(15 * time.Minute),
	})
	if err != nil {
		t.Fatalf("CreateTransferGrant: %v", err)
	}

	if _, err := grants.GetTransferGrant(ctx, created.ID, otherProjectID); !errors.Is(err, storage.ErrNotFound) {
		t.Fatalf("GetTransferGrant under the wrong project: err = %v, want ErrNotFound", err)
	}
	if _, err := grants.GetTransferGrant(ctx, created.ID, projectID); err != nil {
		t.Fatalf("GetTransferGrant under the correct project: %v", err)
	}
}

// TestArtifactGrantRepositoryMarkConsumedEnforcesSingleUseAgainstRealPostgres
// proves the plan's "PUT grants are single-use" acceptance criterion at the
// repository layer, against a real database — not just the in-memory fake
// this same behavior is also unit-tested against (fake_repo_test.go).
func TestArtifactGrantRepositoryMarkConsumedEnforcesSingleUseAgainstRealPostgres(t *testing.T) {
	buckets, grants := newArtifactTransferGrantsTestRepos(t)
	ctx := context.Background()
	const projectID = int64(9204)

	bucket := mustCreateArtifactBucket(t, buckets, projectID, "reports")
	created, err := grants.CreateTransferGrant(ctx, NewTransferGrantInput{
		ID: "33333333-3333-4333-8333-333333333333", ProjectID: projectID, BucketID: bucket.ID,
		Key: "33333333-3333-4333-8333-333333333333", Method: "PUT", ContentType: "image/png",
		MaxBytes: 4096, ExpiresAt: time.Now().Add(15 * time.Minute),
	})
	if err != nil {
		t.Fatalf("CreateTransferGrant: %v", err)
	}

	if err := grants.MarkTransferGrantConsumed(ctx, created.ID); err != nil {
		t.Fatalf("first MarkTransferGrantConsumed: %v", err)
	}
	fetched, err := grants.GetTransferGrant(ctx, created.ID, projectID)
	if err != nil {
		t.Fatalf("GetTransferGrant after consuming: %v", err)
	}
	if fetched.ConsumedAt == nil {
		t.Fatal("expected ConsumedAt to be set after MarkTransferGrantConsumed")
	}

	if err := grants.MarkTransferGrantConsumed(ctx, created.ID); !errors.Is(err, storage.ErrAlreadyExists) {
		t.Fatalf("second MarkTransferGrantConsumed: err = %v, want ErrAlreadyExists", err)
	}
}
