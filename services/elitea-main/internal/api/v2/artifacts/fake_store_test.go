package artifacts_test

import (
	"bytes"
	"context"
	"io"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// fakeStore is a minimal in-memory storage.ObjectStore double. Only Put,
// List, and DeleteBatch see real use in this stage's tests (seeding fixtures
// and exercising DeleteBucket's cascade); the rest exist to satisfy the
// interface and return storage.ErrNotSupported.
type fakeStore struct {
	mu      sync.Mutex
	objects map[string]storage.ObjectInfo
	data    map[string][]byte
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		objects: make(map[string]storage.ObjectInfo),
		data:    make(map[string][]byte),
	}
}

func (s *fakeStore) objectCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.objects)
}

// seed adds an object directly, bypassing Put, for test fixture setup.
func (s *fakeStore) seed(projectID, bucket, key string, size int64) {
	ref, err := storage.NewObjectRef(projectID, bucket, key)
	if err != nil {
		panic(err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	storageKey := ref.StorageKey("")
	s.objects[storageKey] = storage.ObjectInfo{Key: key, Size: size, LastModified: time.Now()}
	s.data[storageKey] = make([]byte, size)
}

func (s *fakeStore) Put(_ context.Context, ref storage.ObjectRef, body io.Reader, opts storage.PutOptions) (storage.ObjectInfo, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return storage.ObjectInfo{}, err
	}
	info := storage.ObjectInfo{Key: ref.Key(), Size: int64(len(data)), LastModified: time.Now(), ContentType: opts.ContentType}
	s.mu.Lock()
	defer s.mu.Unlock()
	storageKey := ref.StorageKey("")
	s.objects[storageKey] = info
	s.data[storageKey] = data
	return info, nil
}

func (s *fakeStore) Get(_ context.Context, ref storage.ObjectRef, _ *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	storageKey := ref.StorageKey("")
	info, ok := s.objects[storageKey]
	if !ok {
		return nil, storage.ObjectInfo{}, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(s.data[storageKey])), info, nil
}

func (s *fakeStore) Stat(_ context.Context, ref storage.ObjectRef) (storage.ObjectInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, ok := s.objects[ref.StorageKey("")]
	if !ok {
		return storage.ObjectInfo{}, storage.ErrNotFound
	}
	return info, nil
}

func (s *fakeStore) Delete(_ context.Context, ref storage.ObjectRef) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	storageKey := ref.StorageKey("")
	delete(s.objects, storageKey)
	delete(s.data, storageKey)
	return nil
}

func (s *fakeStore) DeleteBatch(_ context.Context, refs []storage.ObjectRef) (storage.BatchResult, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := storage.BatchResult{}
	for _, ref := range refs {
		storageKey := ref.StorageKey("")
		delete(s.objects, storageKey)
		delete(s.data, storageKey)
		result.Deleted = append(result.Deleted, ref.Key())
	}
	return result, nil
}

func (s *fakeStore) List(_ context.Context, q storage.ListQuery) (storage.ListPage, error) {
	basePrefix := q.Bucket.BucketPrefix("")
	s.mu.Lock()
	defer s.mu.Unlock()

	var keys []string
	for storageKey := range s.objects {
		if !strings.HasPrefix(storageKey, basePrefix) {
			continue
		}
		logicalKey := strings.TrimPrefix(storageKey, basePrefix)
		if q.KeyPrefix != "" && !strings.HasPrefix(logicalKey, q.KeyPrefix) {
			continue
		}
		keys = append(keys, logicalKey)
	}
	sort.Strings(keys)

	page := storage.ListPage{Objects: make([]storage.ObjectInfo, 0, len(keys))}
	for _, k := range keys {
		page.Objects = append(page.Objects, s.objects[basePrefix+k])
	}
	return page, nil
}

func (s *fakeStore) PresignGet(context.Context, storage.ObjectRef, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *fakeStore) PresignPut(context.Context, storage.ObjectRef, time.Duration, storage.PutOptions) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *fakeStore) StartMultipart(context.Context, storage.ObjectRef, storage.PutOptions) (storage.UploadID, error) {
	return "", storage.ErrNotSupported
}

func (s *fakeStore) PresignPart(context.Context, storage.ObjectRef, storage.UploadID, int32, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}

func (s *fakeStore) CompleteMultipart(context.Context, storage.ObjectRef, storage.UploadID, []storage.Part) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}

func (s *fakeStore) AbortMultipart(context.Context, storage.ObjectRef, storage.UploadID) error {
	return storage.ErrNotSupported
}

func (s *fakeStore) Capabilities() storage.Capabilities {
	return storage.Capabilities{}
}

var _ storage.ObjectStore = (*fakeStore)(nil)
