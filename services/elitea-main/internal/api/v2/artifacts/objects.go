package artifacts

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"os"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

const (
	// defaultMaxObjectBytes matches the legacy vault-sourced
	// chat_max_file_upload_size_mb default (150 MiB), used when the
	// project's storage policy has no max_object_bytes and
	// ARTIFACT_MAX_OBJECT_BYTES is unset (S12).
	defaultMaxObjectBytes int64 = 150 * 1024 * 1024

	// artifactStreamDeadline bounds a single upload/download body once past
	// the header phase, replacing the global http.Server{ReadTimeout,
	// WriteTimeout} S12 removes (see cmd/elitea-main/http_server.go).
	// Generous enough to comfortably cover both stated targets (a 100 MiB
	// upload over 30s, a 300s download) without acting as a de facto
	// unlimited timeout.
	artifactStreamDeadline = 10 * time.Minute
)

// objectSummary is the JSON-facing shape of one listed object
// (components/schemas/ObjectSummary in api/openapi/v2.yaml).
type objectSummary struct {
	Key        string    `json:"key"`
	SizeBytes  int64     `json:"size_bytes"`
	MediaType  string    `json:"media_type"`
	ETag       string    `json:"etag"`
	ModifiedAt time.Time `json:"modified_at"`
}

// batchDeleteFailure is one entry of BatchDeleteObjectsResponse.failed.
type batchDeleteFailure struct {
	Key     string `json:"key"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// storageErrorCode maps an ObjectStore sentinel error (internal/infra/storage
// errors.go) onto the artifact API's typed error code enum
// (components/schemas/Error in api/openapi/v2.yaml).
func storageErrorCode(err error) string {
	switch {
	case errors.Is(err, storage.ErrNotFound):
		return "NotFound"
	case errors.Is(err, storage.ErrAlreadyExists):
		return "AlreadyExists"
	case errors.Is(err, storage.ErrAccessDenied):
		return "AccessDenied"
	case errors.Is(err, storage.ErrInvalidKey):
		return "InvalidKey"
	case errors.Is(err, storage.ErrTooLarge):
		return "TooLarge"
	case errors.Is(err, storage.ErrPreconditionFailed):
		return "PreconditionFailed"
	case errors.Is(err, storage.ErrNotSupported):
		return "NotImplemented"
	default:
		return "Internal"
	}
}

func statusForCode(code string) int {
	switch code {
	case "NotFound":
		return http.StatusNotFound
	case "AlreadyExists":
		return http.StatusConflict
	case "AccessDenied":
		return http.StatusForbidden
	case "InvalidKey", "InvalidArgument":
		return http.StatusBadRequest
	case "TooLarge":
		return http.StatusRequestEntityTooLarge
	case "PreconditionFailed":
		return http.StatusPreconditionFailed
	case "QuotaExceeded":
		return http.StatusForbidden
	case "NotImplemented":
		return http.StatusNotImplemented
	default:
		return http.StatusInternalServerError
	}
}

// writeStorageError maps a storage.ObjectStore error onto the typed error
// envelope, choosing both the HTTP status and the error code from the same
// sentinel classification.
func writeStorageError(w http.ResponseWriter, err error) {
	code := storageErrorCode(err)
	writeError(w, statusForCode(code), code, err.Error())
}

// isMaxBytesError reports whether err (or something it wraps) is
// http.MaxBytesReader's limit-exceeded error. It can surface either from
// multipart.Reader.NextPart (scanning boundary/headers) or later from a
// part's own Read calls (inside ObjectStore.Put) — both mean the same
// thing, S12's per-object size limit, and both must map to 413/TooLarge
// rather than whatever generic error the caller would otherwise report.
func isMaxBytesError(err error) bool {
	var maxBytesErr *http.MaxBytesError
	return errors.As(err, &maxBytesErr)
}

func mimeFromExtension(key string) string {
	if ext := path.Ext(key); ext != "" {
		if mt := mime.TypeByExtension(ext); mt != "" {
			return mt
		}
	}
	return "application/octet-stream"
}

// requireBucket 404s (typed envelope) when the bucket doesn't exist and
// 500s on any other repository error, writing the response itself. Callers
// return immediately when ok is false. Returns the fetched row so callers
// that need the bucket's database ID (object metadata read/write, S12)
// don't have to look it up a second time.
func (h *Handler) requireBucket(w http.ResponseWriter, r *http.Request, projectID int64, bucket string) (repos.BucketRow, bool) {
	row, err := h.repo.GetBucket(r.Context(), projectID, bucket)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
		} else {
			writeError(w, http.StatusInternalServerError, "Internal", "get bucket: "+err.Error())
		}
		return repos.BucketRow{}, false
	}
	return row, true
}

// requireBucketNoBody is requireBucket for HEAD responses, which must not
// carry a body.
func (h *Handler) requireBucketNoBody(w http.ResponseWriter, r *http.Request, projectID int64, bucket string) (repos.BucketRow, bool) {
	row, err := h.repo.GetBucket(r.Context(), projectID, bucket)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
		} else {
			w.WriteHeader(http.StatusInternalServerError)
		}
		return repos.BucketRow{}, false
	}
	return row, true
}

func objectKeyFromRequest(r *http.Request) string {
	return strings.TrimPrefix(chi.URLParam(r, "*"), "/")
}

// artifactMaxObjectBytesFromEnv reads ARTIFACT_MAX_OBJECT_BYTES — the
// fallback used when a project has no explicit max_object_bytes policy
// (S12). A missing, non-numeric, or non-positive value means "no override."
func artifactMaxObjectBytesFromEnv() (int64, bool) {
	raw := os.Getenv("ARTIFACT_MAX_OBJECT_BYTES")
	if raw == "" {
		return 0, false
	}
	v, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || v <= 0 {
		return 0, false
	}
	return v, true
}

func (h *Handler) ListObjects(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	if _, ok := h.requireBucket(w, r, projectID, bucket); !ok {
		return
	}

	bucketRef, err := storage.NewBucketRef(projectIDStr, bucket)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "list objects: "+err.Error())
		return
	}

	q := r.URL.Query()
	prefix := q.Get("prefix")
	if err := storage.ValidateKeyPrefix(prefix); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidKey", err.Error())
		return
	}

	var maxKeys int32
	if limitStr := q.Get("limit"); limitStr != "" {
		limit, err := strconv.ParseInt(limitStr, 10, 32)
		if err != nil || limit < 0 {
			writeError(w, http.StatusBadRequest, "InvalidArgument", "limit must be a non-negative integer")
			return
		}
		maxKeys = int32(limit)
	}

	page, err := h.store.List(r.Context(), storage.ListQuery{
		Bucket:            bucketRef,
		KeyPrefix:         prefix,
		Delimiter:         q.Get("delimiter"),
		MaxKeys:           maxKeys,
		ContinuationToken: q.Get("cursor"),
	})
	if err != nil {
		writeStorageError(w, err)
		return
	}

	objects := make([]objectSummary, 0, len(page.Objects))
	for _, o := range page.Objects {
		mediaType := o.ContentType
		if mediaType == "" {
			mediaType = mimeFromExtension(o.Key)
		}
		objects = append(objects, objectSummary{
			Key:        o.Key,
			SizeBytes:  o.Size,
			MediaType:  mediaType,
			ETag:       o.ETag,
			ModifiedAt: o.LastModified,
		})
	}
	commonPrefixes := page.CommonPrefixes
	if commonPrefixes == nil {
		commonPrefixes = []string{}
	}

	resp := map[string]any{"objects": objects, "common_prefixes": commonPrefixes}
	if page.IsTruncated {
		resp["next_cursor"] = page.NextContinuationToken
	}
	writeJSON(w, http.StatusOK, resp)
}

// UploadObject streams the multipart "file" part straight into
// ObjectStore.Put. It deliberately avoids every net/http form-parsing helper
// that buffers the body to memory or spills it to os.TempDir (ADR-0016) —
// MultipartReader is the one API here that does neither.
//
// S12 wraps the body in http.MaxBytesReader (per-object cap) and sets a
// per-request read deadline, then — after a successful write — records the
// object's metadata row (UpsertObject) and enforces the project-wide quota
// against the resulting SumProjectBytes, rolling back both the physical
// object and its metadata row on violation. The quota check runs after the
// write, not before, because the object's exact byte length isn't known
// until the stream has been fully read.
func (h *Handler) UploadObject(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	bucketRow, ok := h.requireBucket(w, r, projectID, bucket)
	if !ok {
		return
	}

	policy, err := h.repo.GetProjectStoragePolicy(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "get project storage policy: "+err.Error())
		return
	}
	maxObjectBytes := defaultMaxObjectBytes
	if policy.MaxObjectBytes != nil {
		maxObjectBytes = *policy.MaxObjectBytes
	} else if envLimit, ok := artifactMaxObjectBytesFromEnv(); ok {
		maxObjectBytes = envLimit
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxObjectBytes)

	// Best-effort: httptest.ResponseRecorder and similar test writers don't
	// support this (http.ErrNotSupported), which is expected and harmless —
	// the deadline is a defense-in-depth ceiling, not a correctness
	// requirement checked here.
	_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(artifactStreamDeadline))

	overwrite := r.URL.Query().Get("overwrite") == "true"

	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "request is not multipart/form-data")
		return
	}

	var part *multipart.Part
	for {
		p, err := mr.NextPart()
		if err != nil {
			if isMaxBytesError(err) {
				writeError(w, http.StatusRequestEntityTooLarge, "TooLarge", "object exceeds the project's max_object_bytes limit")
				return
			}
			writeError(w, http.StatusBadRequest, "InvalidArgument", "file field is required")
			return
		}
		if p.FormName() == "file" {
			part = p
			break
		}
		_ = p.Close()
	}
	defer func() { _ = part.Close() }()

	// Not part.FileName(): per RFC 7578 it runs the client-declared filename
	// through filepath.Base, silently truncating a multi-segment key like
	// "a/b/c.png" to "c.png". Parsing Content-Disposition directly recovers
	// the raw value; storage.NewObjectRef's own validateKey (S1) is the
	// actual traversal guard — it rejects ".." segments, leading/trailing
	// slashes, and empty segments, which is what FileName's stripping
	// exists to prevent, so bypassing it here does not reopen that gap.
	_, dispositionParams, err := mime.ParseMediaType(part.Header.Get("Content-Disposition"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid Content-Disposition on file field")
		return
	}
	filename := dispositionParams["filename"]
	if filename == "" {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "file field must include a filename")
		return
	}

	ref, err := storage.NewObjectRef(projectIDStr, bucket, filename)
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidKey", err.Error())
		return
	}

	if !overwrite {
		if _, statErr := h.store.Stat(r.Context(), ref); statErr == nil {
			writeError(w, http.StatusConflict, "AlreadyExists", "key already exists; pass overwrite=true to replace it")
			return
		} else if !errors.Is(statErr, storage.ErrNotFound) {
			writeStorageError(w, statErr)
			return
		}
	}

	contentType := part.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mimeFromExtension(filename)
	}

	info, err := h.store.Put(r.Context(), ref, part, storage.PutOptions{
		ContentType:   contentType,
		ContentLength: -1,
	})
	if err != nil {
		if isMaxBytesError(err) {
			writeError(w, http.StatusRequestEntityTooLarge, "TooLarge", "object exceeds the project's max_object_bytes limit")
			return
		}
		writeStorageError(w, err)
		return
	}

	if _, err := h.repo.UpsertObject(r.Context(), repos.NewObjectInput{
		BucketID:   bucketRow.ID,
		Key:        info.Key,
		ByteLength: info.Size,
		MediaType:  contentType,
		ExpiresAt:  bucketRow.ExpiresAt,
	}); err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "record object metadata: "+err.Error())
		return
	}

	if policy.MaxTotalBytes != nil {
		total, err := h.repo.SumProjectBytes(r.Context(), projectID)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "sum project bytes: "+err.Error())
			return
		}
		if total > *policy.MaxTotalBytes {
			_ = h.repo.DeleteObjects(r.Context(), bucketRow.ID, []string{info.Key})
			_ = h.store.Delete(r.Context(), ref)
			writeError(w, http.StatusRequestEntityTooLarge, "TooLarge", "upload would exceed the project's storage quota")
			return
		}
	}

	writeJSON(w, http.StatusCreated, map[string]any{
		"key":        info.Key,
		"size_bytes": info.Size,
		"media_type": contentType,
		"etag":       info.ETag,
		"created_at": info.LastModified,
	})
}

func (h *Handler) BatchDeleteObjects(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	bucketRow, ok := h.requireBucket(w, r, projectID, bucket)
	if !ok {
		return
	}

	var req struct {
		Keys []string `json:"keys"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid request body")
		return
	}
	if len(req.Keys) == 0 {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "keys must not be empty")
		return
	}

	refs := make([]storage.ObjectRef, 0, len(req.Keys))
	failed := make([]batchDeleteFailure, 0)
	for _, key := range req.Keys {
		ref, err := storage.NewObjectRef(projectIDStr, bucket, key)
		if err != nil {
			failed = append(failed, batchDeleteFailure{Key: key, Code: "InvalidKey", Message: err.Error()})
			continue
		}
		refs = append(refs, ref)
	}

	deleted := []string{}
	if len(refs) > 0 {
		result, err := h.store.DeleteBatch(r.Context(), refs)
		if err != nil {
			writeStorageError(w, err)
			return
		}
		deleted = result.Deleted
		if deleted == nil {
			deleted = []string{}
		}
		for _, f := range result.Failed {
			failed = append(failed, batchDeleteFailure{Key: f.Key, Code: storageErrorCode(f.Err), Message: f.Err.Error()})
		}
		if len(deleted) > 0 {
			if err := h.repo.DeleteObjects(r.Context(), bucketRow.ID, deleted); err != nil {
				writeError(w, http.StatusInternalServerError, "Internal", "delete object metadata: "+err.Error())
				return
			}
		}
	}

	writeJSON(w, http.StatusOK, map[string]any{"deleted": deleted, "failed": failed})
}

func (h *Handler) DownloadObject(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	key := objectKeyFromRequest(r)

	ref, err := storage.NewObjectRef(projectIDStr, bucket, key)
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidKey", err.Error())
		return
	}

	if _, ok := h.requireBucket(w, r, projectID, bucket); !ok {
		return
	}

	status := http.StatusOK
	var rng *storage.ByteRange
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		parsed, ok := parseRangeHeader(rangeHeader)
		if !ok {
			writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid Range header")
			return
		}
		rng = &parsed
		status = http.StatusPartialContent
	}

	body, info, err := h.store.Get(r.Context(), ref, rng)
	if err != nil {
		writeStorageError(w, err)
		return
	}
	defer func() { _ = body.Close() }()

	// S12: replaces the global http.Server WriteTimeout (120s), which
	// otherwise caps every download at 120 seconds regardless of size —
	// see cmd/elitea-main/http_server.go. Best-effort for the same reason
	// as the read deadline above.
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(artifactStreamDeadline))

	contentType := info.ContentType
	if contentType == "" {
		contentType = mimeFromExtension(key)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	if info.ETag != "" {
		w.Header().Set("ETag", info.ETag)
	}
	w.WriteHeader(status)
	_, _ = io.Copy(w, body)
}

func (h *Handler) StatObject(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		w.WriteHeader(http.StatusBadRequest)
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	key := objectKeyFromRequest(r)

	ref, err := storage.NewObjectRef(projectIDStr, bucket, key)
	if err != nil {
		w.WriteHeader(http.StatusBadRequest)
		return
	}

	if _, ok := h.requireBucketNoBody(w, r, projectID, bucket); !ok {
		return
	}

	info, err := h.store.Stat(r.Context(), ref)
	if err != nil {
		w.WriteHeader(statusForCode(storageErrorCode(err)))
		return
	}

	contentType := info.ContentType
	if contentType == "" {
		contentType = mimeFromExtension(key)
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.FormatInt(info.Size, 10))
	if info.ETag != "" {
		w.Header().Set("ETag", info.ETag)
	}
	if !info.LastModified.IsZero() {
		w.Header().Set("Last-Modified", info.LastModified.UTC().Format(http.TimeFormat))
	}
	w.WriteHeader(http.StatusOK)
}

// DeleteObject stats before deleting so a missing key 404s — Delete itself
// is documented idempotent (S1 errors.go), so it would not otherwise error
// on an already-absent object.
func (h *Handler) DeleteObject(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	key := objectKeyFromRequest(r)

	ref, err := storage.NewObjectRef(projectIDStr, bucket, key)
	if err != nil {
		writeError(w, http.StatusBadRequest, "InvalidKey", err.Error())
		return
	}

	bucketRow, ok := h.requireBucket(w, r, projectID, bucket)
	if !ok {
		return
	}

	if _, err := h.store.Stat(r.Context(), ref); err != nil {
		writeStorageError(w, err)
		return
	}

	if err := h.store.Delete(r.Context(), ref); err != nil {
		writeStorageError(w, err)
		return
	}

	if err := h.repo.DeleteObjects(r.Context(), bucketRow.ID, []string{key}); err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "delete object metadata: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// parseRangeHeader supports a single "bytes=start-end" or "bytes=start-"
// range, matching what storage.ByteRange can express. Multi-range and
// suffix ("bytes=-N") requests are rejected rather than guessed at.
func parseRangeHeader(h string) (storage.ByteRange, bool) {
	const prefix = "bytes="
	if !strings.HasPrefix(h, prefix) {
		return storage.ByteRange{}, false
	}
	spec := strings.TrimPrefix(h, prefix)
	if strings.Contains(spec, ",") {
		return storage.ByteRange{}, false
	}
	parts := strings.SplitN(spec, "-", 2)
	if len(parts) != 2 || parts[0] == "" {
		return storage.ByteRange{}, false
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || start < 0 {
		return storage.ByteRange{}, false
	}
	end := int64(-1)
	if parts[1] != "" {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil || end < start {
			return storage.ByteRange{}, false
		}
	}
	return storage.ByteRange{Start: start, End: end}, true
}
