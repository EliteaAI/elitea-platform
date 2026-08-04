package artifacts

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"mime/multipart"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
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
// return immediately when ok is false.
func (h *Handler) requireBucket(w http.ResponseWriter, r *http.Request, projectID int64, bucket string) (ok bool) {
	if _, err := h.repo.GetBucket(r.Context(), projectID, bucket); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
		} else {
			writeError(w, http.StatusInternalServerError, "Internal", "get bucket: "+err.Error())
		}
		return false
	}
	return true
}

// requireBucketNoBody is requireBucket for HEAD responses, which must not
// carry a body.
func (h *Handler) requireBucketNoBody(w http.ResponseWriter, r *http.Request, projectID int64, bucket string) (ok bool) {
	if _, err := h.repo.GetBucket(r.Context(), projectID, bucket); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			w.WriteHeader(http.StatusNotFound)
		} else {
			w.WriteHeader(http.StatusInternalServerError)
		}
		return false
	}
	return true
}

func objectKeyFromRequest(r *http.Request) string {
	return strings.TrimPrefix(chi.URLParam(r, "*"), "/")
}

func (h *Handler) ListObjects(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	if !h.requireBucket(w, r, projectID, bucket) {
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
func (h *Handler) UploadObject(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	projectIDStr := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	if !h.requireBucket(w, r, projectID, bucket) {
		return
	}

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
		writeStorageError(w, err)
		return
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
	if !h.requireBucket(w, r, projectID, bucket) {
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

	if !h.requireBucket(w, r, projectID, bucket) {
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

	if !h.requireBucketNoBody(w, r, projectID, bucket) {
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

	if !h.requireBucket(w, r, projectID, bucket) {
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
