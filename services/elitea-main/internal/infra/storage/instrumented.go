package storage

import (
	"context"
	"io"
	"time"
)

// instrumentedStore wraps a concrete ObjectStore with the S18 OTel
// instruments and the delete-audit log — the one place every Put/Get/
// Delete/... call, regardless of which handler or background job triggered
// it, passes through, so "instrument every ObjectStore method" and "emit a
// structured log line for every delete" are true by construction rather
// than by remembering to call something at every call site.
type instrumentedStore struct {
	inner   ObjectStore
	backend string
}

// Instrument wraps store with S18's observability instruments, labelling
// every metric with backend (e.g. "s3", "azure", "gcs" — the same string
// storage.Config.Backend already uses). Call once, at construction time
// (cmd/elitea-main/storage_factory.go), not per request.
func Instrument(store ObjectStore, backend string) ObjectStore {
	return &instrumentedStore{inner: store, backend: backend}
}

func (s *instrumentedStore) Put(ctx context.Context, ref ObjectRef, body io.Reader, opts PutOptions) (ObjectInfo, error) {
	start := time.Now()
	info, err := s.inner.Put(ctx, ref, body, opts)
	recordOperation(ctx, s.backend, "put", start, err)
	if err == nil {
		bytesInCounter.Add(ctx, info.Size, metricAttrs(s.backend, "put"))
	}
	return info, err
}

func (s *instrumentedStore) Get(ctx context.Context, ref ObjectRef, rng *ByteRange) (io.ReadCloser, ObjectInfo, error) {
	start := time.Now()
	body, info, err := s.inner.Get(ctx, ref, rng)
	recordOperation(ctx, s.backend, "get", start, err)
	if err == nil {
		// info.Size is backend-reported metadata, known before the caller
		// reads a single byte from body — recording it here does not
		// require wrapping/counting the stream itself (which S9/S15 both
		// deliberately avoid doing for the actual object bytes).
		bytesOutCounter.Add(ctx, info.Size, metricAttrs(s.backend, "get"))
	}
	return body, info, err
}

func (s *instrumentedStore) Stat(ctx context.Context, ref ObjectRef) (ObjectInfo, error) {
	start := time.Now()
	info, err := s.inner.Stat(ctx, ref)
	recordOperation(ctx, s.backend, "stat", start, err)
	return info, err
}

func (s *instrumentedStore) Delete(ctx context.Context, ref ObjectRef) error {
	start := time.Now()
	err := s.inner.Delete(ctx, ref)
	recordOperation(ctx, s.backend, "delete", start, err)
	LogAudit(ctx, "delete", ref.Bucket(), ref.Key(), ref.ProjectID(), outcomeOf(err))
	return err
}

func (s *instrumentedStore) DeleteBatch(ctx context.Context, refs []ObjectRef) (BatchResult, error) {
	start := time.Now()
	result, err := s.inner.DeleteBatch(ctx, refs)
	recordOperation(ctx, s.backend, "delete_batch", start, err)

	// One audit line per requested ref, not one per call — DeleteBatch is
	// many logical deletes sharing one request, and each one is
	// independently auditable (a partial failure must not make the keys
	// that DID delete invisible to audit, or vice versa). Driven by refs
	// itself, not a bare-key-keyed lookup map built from it: an
	// adversarial-review finding confirmed the earlier map-by-Key()
	// approach would silently misattribute bucket/project_id for a batch
	// spanning multiple buckets whose keys happen to collide (unreachable
	// through this codebase's sole production caller today, which always
	// groups by bucket first, but not a guarantee this method's own
	// signature makes). Every requested ref gets a line even if the
	// backend never reports it in Deleted or Failed — confirmed reachable:
	// s3.Backend.DeleteBatch can return a partial result alongside a
	// non-nil err when one chunk of a >1000-key batch fails outright, and
	// "log every delete" must still hold for the keys in that chunk.
	// Any requested key absent from result.Deleted defaults to "failure" —
	// this correctly covers both an explicit entry in result.Failed and a
	// key the backend never mentioned in either list at all.
	deletedKeys := make(map[string]bool, len(result.Deleted))
	for _, key := range result.Deleted {
		deletedKeys[key] = true
	}
	for _, ref := range refs {
		outcome := "failure"
		if deletedKeys[ref.Key()] {
			outcome = "success"
		}
		LogAudit(ctx, "delete", ref.Bucket(), ref.Key(), ref.ProjectID(), outcome)
	}
	return result, err
}

func (s *instrumentedStore) List(ctx context.Context, q ListQuery) (ListPage, error) {
	start := time.Now()
	page, err := s.inner.List(ctx, q)
	recordOperation(ctx, s.backend, "list", start, err)
	return page, err
}

func (s *instrumentedStore) PresignGet(ctx context.Context, ref ObjectRef, ttl time.Duration) (string, error) {
	start := time.Now()
	url, err := s.inner.PresignGet(ctx, ref, ttl)
	recordOperation(ctx, s.backend, "presign_get", start, err)
	return url, err
}

func (s *instrumentedStore) PresignPut(ctx context.Context, ref ObjectRef, ttl time.Duration, opts PutOptions) (string, error) {
	start := time.Now()
	url, err := s.inner.PresignPut(ctx, ref, ttl, opts)
	recordOperation(ctx, s.backend, "presign_put", start, err)
	return url, err
}

func (s *instrumentedStore) StartMultipart(ctx context.Context, ref ObjectRef, opts PutOptions) (UploadID, error) {
	start := time.Now()
	id, err := s.inner.StartMultipart(ctx, ref, opts)
	recordOperation(ctx, s.backend, "start_multipart", start, err)
	return id, err
}

func (s *instrumentedStore) PresignPart(ctx context.Context, ref ObjectRef, id UploadID, part int32, ttl time.Duration) (string, error) {
	start := time.Now()
	url, err := s.inner.PresignPart(ctx, ref, id, part, ttl)
	recordOperation(ctx, s.backend, "presign_part", start, err)
	return url, err
}

func (s *instrumentedStore) CompleteMultipart(ctx context.Context, ref ObjectRef, id UploadID, parts []Part) (ObjectInfo, error) {
	start := time.Now()
	info, err := s.inner.CompleteMultipart(ctx, ref, id, parts)
	recordOperation(ctx, s.backend, "complete_multipart", start, err)
	if err == nil {
		// A multipart completion writes bytes to the store exactly like Put
		// does, just via parts uploaded out-of-band beforehand — bytes_in
		// should reflect total ingest regardless of which upload mechanism
		// produced it.
		bytesInCounter.Add(ctx, info.Size, metricAttrs(s.backend, "complete_multipart"))
	}
	return info, err
}

func (s *instrumentedStore) AbortMultipart(ctx context.Context, ref ObjectRef, id UploadID) error {
	start := time.Now()
	err := s.inner.AbortMultipart(ctx, ref, id)
	recordOperation(ctx, s.backend, "abort_multipart", start, err)
	return err
}

// Capabilities is deliberately NOT instrumented: it takes no context and
// returns no error — an in-memory field read with nothing to time and
// nothing that can fail.
func (s *instrumentedStore) Capabilities() Capabilities {
	return s.inner.Capabilities()
}

// Unwrap returns the concrete backend Instrument wrapped, mirroring the
// standard library's errors.Unwrap convention — for callers (chiefly tests)
// that need to assert something about the underlying backend's concrete
// type or fields through the instrumentation layer.
func (s *instrumentedStore) Unwrap() ObjectStore {
	return s.inner
}

func outcomeOf(err error) string {
	if err != nil {
		return "failure"
	}
	return "success"
}

var _ ObjectStore = (*instrumentedStore)(nil)
