package api

import (
	"context"
	"encoding/json"
	"io"
	"strings"
	"time"

	v2artifacts "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/auth"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// fakePermissionResolver grants exactly the configured permissions without
// touching a database. S11 gates every artifact route with RBAC
// unconditionally (even the still-stubbed grant routes), so router-level
// tests need a deterministic way to control that outcome — a real
// legacyrbac.PostgresResolver against an unreachable pool always denies
// (query error -> 403), which collapses the "unauthorized" and "authorized"
// cases into the same observable result.
type fakePermissionResolver struct {
	granted []string
	// forProject, when non-empty, scopes granted to exactly that projectID —
	// any other requested projectID resolves with zero permissions, proving
	// a principal authorized for one project is still denied on another
	// (S11: "a request for project 8's object with a principal scoped to
	// project 7 returns 403").
	forProject string
}

func (f fakePermissionResolver) ResolvePermissions(_ context.Context, _ auth.User, _ string, projectID string) (auth.PermissionResolution, error) {
	if f.forProject != "" && projectID != f.forProject {
		return auth.PermissionResolution{UserID: 1}, nil
	}
	return auth.PermissionResolution{UserID: 1, Permissions: f.granted}, nil
}

var _ auth.PermissionResolver = fakePermissionResolver{}

// alwaysSucceedsArtifactRepo satisfies v2artifacts.Repository, returning a
// valid response for any input. newArtifactHandler always builds real
// Postgres-backed repositories from RouterConfig.Pool with no injection
// seam of its own, so proving a genuine 2xx through the full auth/RBAC/
// handler chain (RouterConfig.ArtifactHandler, S11) needs a working fake
// Repository, not just a not-yet-implemented stub.
type alwaysSucceedsArtifactRepo struct{}

func (alwaysSucceedsArtifactRepo) ListBuckets(context.Context, int64) ([]repos.BucketRow, error) {
	return []repos.BucketRow{}, nil
}

func (alwaysSucceedsArtifactRepo) GetBucket(_ context.Context, projectID int64, name string) (repos.BucketRow, error) {
	now := time.Now()
	return repos.BucketRow{
		ID: 1, ProjectID: projectID, Name: name, DisplayName: name, BucketType: "local",
		Tags: json.RawMessage(`{}`), CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (alwaysSucceedsArtifactRepo) CreateBucket(_ context.Context, input repos.NewBucketInput) (repos.BucketRow, error) {
	now := time.Now()
	return repos.BucketRow{
		ID: 1, ProjectID: input.ProjectID, Name: input.Name, DisplayName: input.DisplayName,
		BucketType: input.BucketType, Tags: json.RawMessage(`{}`),
		RetentionDays: input.RetentionDays, ExpiresAt: input.ExpiresAt, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (alwaysSucceedsArtifactRepo) UpdateBucketRetention(_ context.Context, id int64, retentionDays *int32, expiresAt *time.Time) (repos.BucketRow, error) {
	now := time.Now()
	return repos.BucketRow{
		ID: id, Name: "reports", BucketType: "local", Tags: json.RawMessage(`{}`),
		RetentionDays: retentionDays, ExpiresAt: expiresAt, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (alwaysSucceedsArtifactRepo) SetBucketPinned(_ context.Context, id int64, pinned bool) (repos.BucketRow, error) {
	now := time.Now()
	return repos.BucketRow{
		ID: id, Name: "reports", BucketType: "local", IsPinned: pinned,
		Tags: json.RawMessage(`{}`), CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (alwaysSucceedsArtifactRepo) UpdateBucketTags(_ context.Context, id int64, tags json.RawMessage) (repos.BucketRow, error) {
	now := time.Now()
	if len(tags) == 0 {
		tags = json.RawMessage(`{}`)
	}
	return repos.BucketRow{
		ID: id, Name: "reports", BucketType: "local", Tags: tags, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (alwaysSucceedsArtifactRepo) SoftDeleteBucket(context.Context, int64) error { return nil }

func (alwaysSucceedsArtifactRepo) SumBucketBytes(context.Context, int64) (int64, error) {
	return 0, nil
}

func (alwaysSucceedsArtifactRepo) CountBucketObjects(context.Context, int64) (int64, error) {
	return 0, nil
}

func (alwaysSucceedsArtifactRepo) GetProjectStoragePolicy(_ context.Context, projectID int64) (repos.ProjectStoragePolicy, error) {
	return repos.ProjectStoragePolicy{ProjectID: projectID}, nil
}

var _ v2artifacts.Repository = alwaysSucceedsArtifactRepo{}

// alwaysSucceedsArtifactStore satisfies storage.ObjectStore, returning an
// empty/zero-value success for any input. Pairs with
// alwaysSucceedsArtifactRepo.
type alwaysSucceedsArtifactStore struct{}

func (alwaysSucceedsArtifactStore) Put(_ context.Context, ref storage.ObjectRef, body io.Reader, _ storage.PutOptions) (storage.ObjectInfo, error) {
	_, _ = io.Copy(io.Discard, body)
	return storage.ObjectInfo{Key: ref.Key(), LastModified: time.Now()}, nil
}

func (alwaysSucceedsArtifactStore) Get(_ context.Context, ref storage.ObjectRef, _ *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	return io.NopCloser(strings.NewReader("")), storage.ObjectInfo{Key: ref.Key(), LastModified: time.Now()}, nil
}

func (alwaysSucceedsArtifactStore) Stat(_ context.Context, ref storage.ObjectRef) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{Key: ref.Key(), LastModified: time.Now()}, nil
}

func (alwaysSucceedsArtifactStore) Delete(context.Context, storage.ObjectRef) error { return nil }

func (alwaysSucceedsArtifactStore) DeleteBatch(_ context.Context, refs []storage.ObjectRef) (storage.BatchResult, error) {
	deleted := make([]string, len(refs))
	for i, ref := range refs {
		deleted[i] = ref.Key()
	}
	return storage.BatchResult{Deleted: deleted}, nil
}

func (alwaysSucceedsArtifactStore) List(context.Context, storage.ListQuery) (storage.ListPage, error) {
	return storage.ListPage{}, nil
}

func (alwaysSucceedsArtifactStore) PresignGet(context.Context, storage.ObjectRef, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) PresignPut(context.Context, storage.ObjectRef, time.Duration, storage.PutOptions) (string, error) {
	return "", storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) StartMultipart(context.Context, storage.ObjectRef, storage.PutOptions) (storage.UploadID, error) {
	return "", storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) PresignPart(context.Context, storage.ObjectRef, storage.UploadID, int32, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) CompleteMultipart(context.Context, storage.ObjectRef, storage.UploadID, []storage.Part) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) AbortMultipart(context.Context, storage.ObjectRef, storage.UploadID) error {
	return storage.ErrNotSupported
}

func (alwaysSucceedsArtifactStore) Capabilities() storage.Capabilities { return storage.Capabilities{} }

var _ storage.ObjectStore = alwaysSucceedsArtifactStore{}
