package runtimecomposition

import (
	"context"
	"errors"
	"io"
	"sort"
	"sync"
	"testing"
	"time"

	schedulingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/scheduling"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

func artifactRetentionOccurrence(dueAt time.Time) schedulingapp.Occurrence {
	return schedulingapp.Occurrence{
		InvocationID:     "fenced-occurrence-1",
		JobID:            artifactRetentionSweepCapability,
		ScheduleRevision: artifactRetentionSweepRevision,
		DueAt:            dueAt,
		LeaseEpoch:       3,
		ClaimFence:       "0123456789abcdef",
	}
}

func newArtifactRetentionSweepFixture(t *testing.T) (*artifactRetentionSweep, *artifactRetentionFakeObjectsRepo, *artifactRetentionFakeBucketsRepo, *artifactRetentionFakeNotifier, *artifactRetentionFakeStore) {
	t.Helper()
	objects := &artifactRetentionFakeObjectsRepo{}
	buckets := &artifactRetentionFakeBucketsRepo{buckets: map[int64]repos.BucketRow{}, notFoundIDs: map[int64]bool{}}
	notifier := &artifactRetentionFakeNotifier{ownerByProject: map[int64]int64{}}
	store := &artifactRetentionFakeStore{existing: map[string]bool{}, failKeys: map[string]bool{}}
	sweep, err := newArtifactRetentionSweep(objects, buckets, notifier, store)
	if err != nil {
		t.Fatal(err)
	}
	return sweep, objects, buckets, notifier, store
}

func TestArtifactRetentionSweepRejectsInvalidOccurrenceBeforeAnyWork(t *testing.T) {
	base := artifactRetentionOccurrence(time.Now())
	for _, test := range []struct {
		name   string
		mutate func(schedulingapp.Occurrence) schedulingapp.Occurrence
	}{
		{"empty invocation ID", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.InvocationID = ""; return o }},
		{"wrong job ID", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.JobID = "wrong"; return o }},
		{"wrong revision", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.ScheduleRevision = "wrong"; return o }},
		{"zero due at", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.DueAt = time.Time{}; return o }},
		{"non-positive lease epoch", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.LeaseEpoch = 0; return o }},
		{"empty claim fence", func(o schedulingapp.Occurrence) schedulingapp.Occurrence { o.ClaimFence = ""; return o }},
	} {
		t.Run(test.name, func(t *testing.T) {
			sweep, objects, buckets, notifier, _ := newArtifactRetentionSweepFixture(t)
			outcome, err := sweep.Execute(context.Background(), test.mutate(base))
			if outcome != "" || !errors.Is(err, errArtifactRetentionSweepInvalidOccurrence) {
				t.Fatalf("outcome=%q error=%v", outcome, err)
			}
			if objects.listCalls != 0 || buckets.listNoticeCalls != 0 || notifier.notifyCalls != nil {
				t.Fatalf("expected no repository calls, got objects.listCalls=%d buckets.listNoticeCalls=%d notifyCalls=%v",
					objects.listCalls, buckets.listNoticeCalls, notifier.notifyCalls)
			}
		})
	}
}

func TestArtifactRetentionSweepCompletesWithNothingToDo(t *testing.T) {
	sweep, _, _, _, _ := newArtifactRetentionSweepFixture(t)
	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}
}

func TestArtifactRetentionSweepDeletesExpiredObjectsAcrossBucketsAndLeavesUnexpiredAlone(t *testing.T) {
	sweep, objects, buckets, _, store := newArtifactRetentionSweepFixture(t)
	past := time.Now().Add(-time.Hour)
	future := time.Now().Add(time.Hour)

	buckets.seed(repos.BucketRow{ID: 1, ProjectID: 100, Name: "reports"})
	buckets.seed(repos.BucketRow{ID: 2, ProjectID: 200, Name: "tasks"})

	objects.seed(repos.ObjectRow{ID: 10, BucketID: 1, Key: "old.png", ExpiresAt: &past})
	objects.seed(repos.ObjectRow{ID: 11, BucketID: 1, Key: "fresh.png", ExpiresAt: &future})
	objects.seed(repos.ObjectRow{ID: 12, BucketID: 2, Key: "old.bin", ExpiresAt: &past})
	store.existing["p/100/b/reports/o/old.png"] = true
	store.existing["p/100/b/reports/o/fresh.png"] = true
	store.existing["p/200/b/tasks/o/old.bin"] = true

	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}

	remaining := objects.snapshot()
	if len(remaining) != 1 || remaining[0].ID != 11 {
		t.Fatalf("expected only the unexpired fresh.png to remain, got %+v", remaining)
	}
	if store.existing["p/100/b/reports/o/old.png"] || store.existing["p/200/b/tasks/o/old.bin"] {
		t.Fatal("expected both expired objects' physical bytes to be deleted")
	}
	if !store.existing["p/100/b/reports/o/fresh.png"] {
		t.Fatal("expected the unexpired object's physical bytes to survive")
	}
}

func TestArtifactRetentionSweepPaginatesAcrossMultipleBatches(t *testing.T) {
	sweep, objects, buckets, _, store := newArtifactRetentionSweepFixture(t)
	past := time.Now().Add(-time.Hour)
	buckets.seed(repos.BucketRow{ID: 1, ProjectID: 100, Name: "reports"})

	const n = int(artifactRetentionSweepBatchSize) + 137
	for i := 0; i < n; i++ {
		key := "bulk-" + string(rune('a'+i%26)) + "-" + itoa(i) + ".bin"
		objects.seed(repos.ObjectRow{ID: int64(i + 1), BucketID: 1, Key: key, ExpiresAt: &past})
		store.existing["p/100/b/reports/o/"+key] = true
	}

	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}
	if remaining := objects.snapshot(); len(remaining) != 0 {
		t.Fatalf("expected every expired object to be swept across batches, got %d remaining", len(remaining))
	}
	if objects.listCalls < 2 {
		t.Fatalf("expected more than one ListExpiredObjects call to exercise pagination, got %d", objects.listCalls)
	}
}

// TestArtifactRetentionSweepPreservesMetadataConsistencyOnPartialDeleteFailure
// mirrors S13's regression test for artifactbootstrap.purgeObjects: a
// partial DeleteBatch failure must not orphan the metadata row for the
// object that DID delete.
func TestArtifactRetentionSweepPreservesMetadataConsistencyOnPartialDeleteFailure(t *testing.T) {
	sweep, objects, buckets, _, store := newArtifactRetentionSweepFixture(t)
	past := time.Now().Add(-time.Hour)
	buckets.seed(repos.BucketRow{ID: 1, ProjectID: 100, Name: "reports"})
	objects.seed(repos.ObjectRow{ID: 10, BucketID: 1, Key: "ok.png", ExpiresAt: &past})
	objects.seed(repos.ObjectRow{ID: 11, BucketID: 1, Key: "stuck.png", ExpiresAt: &past})
	store.existing["p/100/b/reports/o/ok.png"] = true
	store.existing["p/100/b/reports/o/stuck.png"] = true
	store.failKeys["stuck.png"] = true

	_, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err == nil {
		t.Fatal("expected an error from the simulated partial delete failure, got nil")
	}

	remaining := objects.snapshot()
	if len(remaining) != 1 || remaining[0].Key != "stuck.png" {
		t.Fatalf("expected only the still-undeleted stuck.png metadata row to remain (ok.png's row must be cleaned up), got %+v", remaining)
	}
	if store.existing["p/100/b/reports/o/ok.png"] {
		t.Fatal("expected ok.png's physical bytes to be deleted")
	}
	if !store.existing["p/100/b/reports/o/stuck.png"] {
		t.Fatal("expected stuck.png's physical bytes to survive the simulated failure")
	}
}

func TestArtifactRetentionSweepDeletesOrphanedMetadataForMissingBucket(t *testing.T) {
	sweep, objects, buckets, _, store := newArtifactRetentionSweepFixture(t)
	past := time.Now().Add(-time.Hour)
	buckets.notFoundIDs[1] = true
	objects.seed(repos.ObjectRow{ID: 10, BucketID: 1, Key: "orphan.png", ExpiresAt: &past})

	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}
	if remaining := objects.snapshot(); len(remaining) != 0 {
		t.Fatalf("expected the orphaned metadata row to be deleted, got %+v", remaining)
	}
	if store.deleteBatchCalls != 0 {
		t.Fatalf("expected no ObjectStore.DeleteBatch call for a bucket that no longer exists, got %d", store.deleteBatchCalls)
	}
}

func TestArtifactRetentionSweepNotifiesExpiringBucketsAndMarksThemNotified(t *testing.T) {
	sweep, _, buckets, notifier, _ := newArtifactRetentionSweepFixture(t)
	expiresAt := time.Now().Add(12 * time.Hour)
	buckets.needingNotice = []repos.BucketRow{
		{ID: 5, ProjectID: 100, Name: "reports", ExpiresAt: &expiresAt},
	}
	notifier.ownerByProject[100] = 777

	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}
	if len(notifier.notifyCalls) != 1 {
		t.Fatalf("expected exactly 1 notify call, got %d", len(notifier.notifyCalls))
	}
	call := notifier.notifyCalls[0]
	if call.projectID != 100 || call.userID != 777 || call.bucketID != 5 || !call.expiresAt.Equal(expiresAt) {
		t.Fatalf("unexpected notify call: %+v", call)
	}
	if len(buckets.markedNotified) != 1 || buckets.markedNotified[0] != 5 {
		t.Fatalf("expected bucket 5 to be marked notified, got %v", buckets.markedNotified)
	}
}

// TestArtifactRetentionSweepUpdatesProjectByteUsageGaugeForEveryKnownProject
// proves S18's per-project byte-usage gauge is refreshed on the sweeper
// tick, for every project that owns a bucket — not zero of them, not just
// the first. The gauge's own recorded value is asserted directly against
// the real OTel instrument in internal/infra/storage's own test suite
// (TestArtifactObservability*, S18's Verify command target); this test's
// job is proving the SWEEPER side actually calls SumProjectBytes for the
// right project set on every tick, which is the part storage's own tests
// cannot see.
func TestArtifactRetentionSweepUpdatesProjectByteUsageGaugeForEveryKnownProject(t *testing.T) {
	sweep, objects, buckets, _, _ := newArtifactRetentionSweepFixture(t)
	buckets.seed(repos.BucketRow{ID: 1, ProjectID: 100, Name: "reports"})
	buckets.seed(repos.BucketRow{ID: 2, ProjectID: 200, Name: "exports"})
	objects.seedProjectBytes(100, 4096)
	objects.seedProjectBytes(200, 8192)

	outcome, err := sweep.Execute(context.Background(), artifactRetentionOccurrence(time.Now()))
	if err != nil || outcome != schedulingapp.OutcomeLocalCompleted {
		t.Fatalf("outcome=%q error=%v", outcome, err)
	}

	got := append([]int64(nil), objects.sumProjectBytesCalls...)
	sort.Slice(got, func(i, j int) bool { return got[i] < got[j] })
	want := []int64{100, 200}
	if len(got) != len(want) || got[0] != want[0] || got[1] != want[1] {
		t.Fatalf("SumProjectBytes calls = %v, want %v", got, want)
	}
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	neg := i < 0
	if neg {
		i = -i
	}
	var buf [20]byte
	pos := len(buf)
	for i > 0 {
		pos--
		buf[pos] = byte('0' + i%10)
		i /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

type artifactRetentionFakeObjectsRepo struct {
	mu              sync.Mutex
	objects         []repos.ObjectRow
	listCalls       int
	deleteRowsCalls int
	// projectBytes and sumProjectBytesCalls back S18's SumProjectBytes —
	// set directly via seedProjectBytes rather than derived from objects
	// above: real SumProjectBytes joins through buckets to resolve
	// project_id (elitea_storage.objects has no project_id column of its
	// own, only bucket_id), a relationship this fake's sibling
	// artifactRetentionFakeBucketsRepo owns, not this one — deriving it
	// here would couple two independently-seeded fakes for no test value.
	projectBytes         map[int64]int64
	sumProjectBytesCalls []int64
}

func (r *artifactRetentionFakeObjectsRepo) seedProjectBytes(projectID, bytes int64) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.projectBytes == nil {
		r.projectBytes = map[int64]int64{}
	}
	r.projectBytes[projectID] = bytes
}

func (r *artifactRetentionFakeObjectsRepo) SumProjectBytes(_ context.Context, projectID int64) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.sumProjectBytesCalls = append(r.sumProjectBytesCalls, projectID)
	return r.projectBytes[projectID], nil
}

func (r *artifactRetentionFakeObjectsRepo) seed(obj repos.ObjectRow) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.objects = append(r.objects, obj)
}

func (r *artifactRetentionFakeObjectsRepo) snapshot() []repos.ObjectRow {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]repos.ObjectRow(nil), r.objects...)
}

func (r *artifactRetentionFakeObjectsRepo) ListExpiredObjects(_ context.Context, olderThan time.Time, limit int32) ([]repos.ObjectRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listCalls++
	var out []repos.ObjectRow
	for _, obj := range r.objects {
		if obj.ExpiresAt != nil && obj.ExpiresAt.Before(olderThan) {
			out = append(out, obj)
			if int32(len(out)) >= limit {
				break
			}
		}
	}
	return out, nil
}

func (r *artifactRetentionFakeObjectsRepo) DeleteObjectRows(_ context.Context, ids []int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.deleteRowsCalls++
	idSet := make(map[int64]bool, len(ids))
	for _, id := range ids {
		idSet[id] = true
	}
	var remaining []repos.ObjectRow
	for _, obj := range r.objects {
		if !idSet[obj.ID] {
			remaining = append(remaining, obj)
		}
	}
	r.objects = remaining
	return nil
}

type artifactRetentionFakeBucketsRepo struct {
	mu              sync.Mutex
	buckets         map[int64]repos.BucketRow
	notFoundIDs     map[int64]bool
	needingNotice   []repos.BucketRow
	markedNotified  []int64
	listNoticeCalls int
}

func (r *artifactRetentionFakeBucketsRepo) seed(bucket repos.BucketRow) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.buckets[bucket.ID] = bucket
}

func (r *artifactRetentionFakeBucketsRepo) GetBucketByID(_ context.Context, id int64) (repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.notFoundIDs[id] {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	b, ok := r.buckets[id]
	if !ok {
		return repos.BucketRow{}, storage.ErrNotFound
	}
	return b, nil
}

func (r *artifactRetentionFakeBucketsRepo) ListBucketsNeedingExpiryNotice(_ context.Context, _ time.Duration, limit int32) ([]repos.BucketRow, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.listNoticeCalls++
	out := r.needingNotice
	if int32(len(out)) > limit {
		out = out[:limit]
	}
	return append([]repos.BucketRow(nil), out...), nil
}

func (r *artifactRetentionFakeBucketsRepo) MarkBucketNotified(_ context.Context, bucketID int64) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.markedNotified = append(r.markedNotified, bucketID)
	return nil
}

// ListProjectIDsWithBuckets (S18) derives the distinct project set from
// r.buckets — unlike SumProjectBytes on the sibling objects fake, this one
// genuinely can be derived correctly, since every seeded BucketRow already
// carries its own ProjectID.
func (r *artifactRetentionFakeBucketsRepo) ListProjectIDsWithBuckets(_ context.Context) ([]int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	seen := map[int64]bool{}
	var ids []int64
	for _, b := range r.buckets {
		if !seen[b.ProjectID] {
			seen[b.ProjectID] = true
			ids = append(ids, b.ProjectID)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids, nil
}

type artifactRetentionNotifyCall struct {
	projectID, userID, bucketID int64
	expiresAt                   time.Time
}

type artifactRetentionFakeNotifier struct {
	mu             sync.Mutex
	ownerByProject map[int64]int64
	notifyCalls    []artifactRetentionNotifyCall
}

func (n *artifactRetentionFakeNotifier) ProjectOwnerUserID(_ context.Context, projectID int64) (int64, error) {
	n.mu.Lock()
	defer n.mu.Unlock()
	return n.ownerByProject[projectID], nil
}

func (n *artifactRetentionFakeNotifier) NotifyBucketExpiring(_ context.Context, projectID, userID, bucketID int64, expiresAt time.Time) error {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.notifyCalls = append(n.notifyCalls, artifactRetentionNotifyCall{projectID, userID, bucketID, expiresAt})
	return nil
}

// artifactRetentionFakeStore is a minimal storage.ObjectStore double —
// DeleteBatch is the only method this package's sweep ever calls; the rest
// exist to satisfy the interface and return storage.ErrNotSupported.
// existing/failKeys are keyed by the same "{projectID}/{bucket}/{key}"
// storage key ObjectRef.StorageKey("") produces.
type artifactRetentionFakeStore struct {
	mu               sync.Mutex
	existing         map[string]bool
	failKeys         map[string]bool
	deleteBatchCalls int
}

func (s *artifactRetentionFakeStore) DeleteBatch(_ context.Context, refs []storage.ObjectRef) (storage.BatchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleteBatchCalls++
	result := storage.BatchResult{}
	for _, ref := range refs {
		if s.failKeys[ref.Key()] {
			result.Failed = append(result.Failed, storage.BatchError{Key: ref.Key(), Err: errors.New("simulated delete failure")})
			continue
		}
		delete(s.existing, ref.StorageKey(""))
		result.Deleted = append(result.Deleted, ref.Key())
	}
	return result, nil
}

func (s *artifactRetentionFakeStore) Put(context.Context, storage.ObjectRef, io.Reader, storage.PutOptions) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) Get(context.Context, storage.ObjectRef, *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	return nil, storage.ObjectInfo{}, storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) Stat(context.Context, storage.ObjectRef) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) Delete(context.Context, storage.ObjectRef) error {
	return storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) List(context.Context, storage.ListQuery) (storage.ListPage, error) {
	return storage.ListPage{}, storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) PresignGet(context.Context, storage.ObjectRef, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) PresignPut(context.Context, storage.ObjectRef, time.Duration, storage.PutOptions) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) StartMultipart(context.Context, storage.ObjectRef, storage.PutOptions) (storage.UploadID, error) {
	return "", storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) PresignPart(context.Context, storage.ObjectRef, storage.UploadID, int32, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) CompleteMultipart(context.Context, storage.ObjectRef, storage.UploadID, []storage.Part) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) AbortMultipart(context.Context, storage.ObjectRef, storage.UploadID) error {
	return storage.ErrNotSupported
}

func (s *artifactRetentionFakeStore) Capabilities() storage.Capabilities {
	return storage.Capabilities{}
}

var _ storage.ObjectStore = (*artifactRetentionFakeStore)(nil)
