package artifacts_test

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// fakeRepo is an in-memory double for artifacts.Repository — the union of
// S6's ArtifactBucketsRepository and ArtifactObjectsRepository methods the
// bucket-plane handlers depend on. Nothing before S8 builds one.
type fakeRepo struct {
	mu       sync.Mutex
	nextID   int64
	buckets  map[int64]repos.BucketRow
	policies map[int64]repos.ProjectStoragePolicy
	sizes    map[int64]int64
	counts   map[int64]int64
	// objects backs UpsertObject/DeleteObjects/SumProjectBytes (S12) with
	// real per-object tracking, independent of sizes/counts above (which
	// stay directly seedable via setAggregate for S8's bucket-enrichment
	// tests) — this is what lets a test genuinely exercise the S12 quota
	// rollback path (upload, observe SumProjectBytes grow, delete, observe
	// it shrink) through the real handler rather than a seeded number.
	objects map[string]fakeObjectRecord
	// grants backs CreateTransferGrant/GetTransferGrant/MarkTransferGrantConsumed
	// (S15), keyed by grant ID.
	grants map[string]repos.TransferGrantRow
}

type fakeObjectRecord struct {
	bucketID   int64
	key        string
	byteLength int64
	expiresAt  *time.Time
}

func fakeObjectKey(bucketID int64, key string) string {
	return fmt.Sprintf("%d\x00%s", bucketID, key)
}

func newFakeRepo() *fakeRepo {
	return &fakeRepo{
		buckets:  make(map[int64]repos.BucketRow),
		policies: make(map[int64]repos.ProjectStoragePolicy),
		sizes:    make(map[int64]int64),
		counts:   make(map[int64]int64),
		objects:  make(map[string]fakeObjectRecord),
		grants:   make(map[string]repos.TransferGrantRow),
	}
}

// setAggregate seeds the size_bytes/object_count SumBucketBytes and
// CountBucketObjects report for a bucket — the real repository derives
// these from the objects table, which this fake does not model directly.
func (r *fakeRepo) setAggregate(bucketID, sizeBytes, objectCount int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sizes[bucketID] = sizeBytes
	r.counts[bucketID] = objectCount
}

// objectKeys reports the keys of the metadata rows a bucket still holds,
// in ascending order. DeleteBucket's regression tests need it: a test that
// only counts bytes cannot tell a cleaned-up row from an orphaned one.
func (r *fakeRepo) objectKeys(bucketID int64) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	keys := make([]string, 0, len(r.objects))
	for _, obj := range r.objects {
		if obj.bucketID == bucketID {
			keys = append(keys, obj.key)
		}
	}
	sort.Strings(keys)
	return keys
}

func (r *fakeRepo) setPolicy(policy repos.ProjectStoragePolicy) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.policies[policy.ProjectID] = policy
}

func (r *fakeRepo) ListBuckets(_ context.Context, projectID int64) ([]repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []repos.BucketRow
	for _, b := range r.buckets {
		if b.ProjectID == projectID {
			out = append(out, b)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

func (r *fakeRepo) GetBucket(_ context.Context, projectID int64, name string) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, b := range r.buckets {
		if b.ProjectID == projectID && b.Name == name {
			return b, nil
		}
	}
	return repos.BucketRow{}, storage.ErrNotFound
}

func (r *fakeRepo) CreateBucket(_ context.Context, input repos.NewBucketInput) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, b := range r.buckets {
		if b.ProjectID == input.ProjectID && b.Name == input.Name {
			return repos.BucketRow{}, storage.ErrAlreadyExists
		}
	}
	r.nextID++
	now := time.Now()
	row := repos.BucketRow{
		ID:            r.nextID,
		ProjectID:     input.ProjectID,
		Name:          input.Name,
		DisplayName:   input.DisplayName,
		BucketType:    input.BucketType,
		Tags:          json.RawMessage(`{}`),
		RetentionDays: input.RetentionDays,
		ExpiresAt:     input.ExpiresAt,
		CreatedAt:     now,
		UpdatedAt:     now,
	}
	r.buckets[row.ID] = row
	return row, nil
}

func (r *fakeRepo) UpdateBucketRetention(_ context.Context, id int64, retentionDays *int32, expiresAt *time.Time) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[id]
	if !ok {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	b.RetentionDays = retentionDays
	b.ExpiresAt = expiresAt
	b.UpdatedAt = time.Now()
	r.buckets[id] = b
	return b, nil
}

func (r *fakeRepo) SetBucketPinned(_ context.Context, id int64, pinned bool) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[id]
	if !ok {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	b.IsPinned = pinned
	b.UpdatedAt = time.Now()
	r.buckets[id] = b
	return b, nil
}

func (r *fakeRepo) UpdateBucketTags(_ context.Context, id int64, tags json.RawMessage) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[id]
	if !ok {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	if len(tags) == 0 {
		tags = json.RawMessage(`{}`)
	}
	b.Tags = tags
	b.UpdatedAt = time.Now()
	r.buckets[id] = b
	return b, nil
}

func (r *fakeRepo) SoftDeleteBucket(_ context.Context, id int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.buckets[id]; !ok {
		return storage.ErrNotFound
	}
	delete(r.buckets, id)
	return nil
}

// SumBucketBytes adds the seeded baseline (setAggregate, for S8 tests that
// never call UpsertObject) to the real total of tracked objects (S12) —
// this is what lets both a pre-seeded aggregate and a genuine
// upload-then-sum round trip work through the same fake.
func (r *fakeRepo) SumBucketBytes(_ context.Context, bucketID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	total := r.sizes[bucketID]
	for _, obj := range r.objects {
		if obj.bucketID == bucketID {
			total += obj.byteLength
		}
	}
	return total, nil
}

func (r *fakeRepo) CountBucketObjects(_ context.Context, bucketID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	count := r.counts[bucketID]
	for _, obj := range r.objects {
		if obj.bucketID == bucketID {
			count++
		}
	}
	return count, nil
}

func (r *fakeRepo) GetProjectStoragePolicy(_ context.Context, projectID int64) (repos.ProjectStoragePolicy, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if p, ok := r.policies[projectID]; ok {
		return p, nil
	}
	return repos.ProjectStoragePolicy{ProjectID: projectID}, nil
}

func (r *fakeRepo) UpsertObject(_ context.Context, input repos.NewObjectInput) (repos.ObjectRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	now := time.Now()
	r.objects[fakeObjectKey(input.BucketID, input.Key)] = fakeObjectRecord{
		bucketID: input.BucketID, key: input.Key, byteLength: input.ByteLength, expiresAt: input.ExpiresAt,
	}
	return repos.ObjectRow{
		BucketID: input.BucketID, Key: input.Key, ByteLength: input.ByteLength,
		MediaType: input.MediaType, ExpiresAt: input.ExpiresAt, CreatedAt: now, UpdatedAt: now,
	}, nil
}

func (r *fakeRepo) DeleteObjects(_ context.Context, bucketID int64, keys []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, key := range keys {
		delete(r.objects, fakeObjectKey(bucketID, key))
	}
	return nil
}

// SumProjectBytes sums every tracked object whose bucket belongs to
// projectID — cross-referencing r.buckets, since fakeObjectRecord only
// carries a bucketID, mirroring the real schema (elitea_storage.objects has
// no project_id column of its own; project scoping goes through the bucket).
func (r *fakeRepo) SumProjectBytes(_ context.Context, projectID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var total int64
	for _, obj := range r.objects {
		if bucket, ok := r.buckets[obj.bucketID]; ok && bucket.ProjectID == projectID {
			total += obj.byteLength
		}
	}
	return total, nil
}

func (r *fakeRepo) GetBucketByID(_ context.Context, id int64) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b, ok := r.buckets[id]
	if !ok {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	return b, nil
}

func (r *fakeRepo) CreateTransferGrant(_ context.Context, input repos.NewTransferGrantInput) (repos.TransferGrantRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row := repos.TransferGrantRow{
		ID: input.ID, ProjectID: input.ProjectID, BucketID: input.BucketID, Key: input.Key,
		Method: input.Method, ContentType: input.ContentType, MaxBytes: input.MaxBytes,
		DigestAlg: input.DigestAlg, Digest: input.Digest, UploadID: input.UploadID,
		ExpiresAt: input.ExpiresAt, CreatedAt: time.Now(),
	}
	r.grants[row.ID] = row
	return row, nil
}

func (r *fakeRepo) GetTransferGrant(_ context.Context, id string, projectID int64) (repos.TransferGrantRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row, ok := r.grants[id]
	if !ok || row.ProjectID != projectID {
		return repos.TransferGrantRow{}, storage.ErrNotFound
	}
	return row, nil
}

// GetTransferGrantByID mirrors the real repository's unscoped lookup (S16)
// — unlike GetTransferGrant above, it does not filter on projectID at all,
// leaving the ownership decision to the caller (multipart.go's
// requireOwnedMultipartGrant).
func (r *fakeRepo) GetTransferGrantByID(_ context.Context, id string) (repos.TransferGrantRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	row, ok := r.grants[id]
	if !ok {
		return repos.TransferGrantRow{}, storage.ErrNotFound
	}
	return row, nil
}

// MarkTransferGrantConsumed mirrors the real repository's single-use
// enforcement: an already-consumed (or unknown) id returns
// storage.ErrAlreadyExists.
func (r *fakeRepo) MarkTransferGrantConsumed(_ context.Context, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	row, ok := r.grants[id]
	if !ok || row.ConsumedAt != nil {
		return storage.ErrAlreadyExists
	}
	now := time.Now()
	row.ConsumedAt = &now
	r.grants[id] = row
	return nil
}

var _ artifacts.Repository = (*fakeRepo)(nil)
