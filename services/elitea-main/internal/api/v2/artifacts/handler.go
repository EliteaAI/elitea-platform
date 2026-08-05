package artifacts

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// bucketNamePattern matches api/openapi/v2.yaml's CreateBucketRequest.name
// pattern. A name that does not already match this is rejected, never
// normalised — see docs/plans/storage-migration-plan.md S8.
var bucketNamePattern = regexp.MustCompile(`^[a-z][a-z0-9-]{1,62}$`)

// Bucket is the JSON-facing shape of one bucket
// (components/schemas/Bucket in api/openapi/v2.yaml).
type Bucket struct {
	Name          string          `json:"name"`
	Type          string          `json:"type"`
	IsPinned      bool            `json:"is_pinned"`
	Tags          json.RawMessage `json:"tags"`
	RetentionDays *int32          `json:"retention_days"`
	ExpiresAt     *time.Time      `json:"expires_at"`
	SizeBytes     int64           `json:"size_bytes"`
	ObjectCount   int64           `json:"object_count"`
	CreatedAt     time.Time       `json:"created_at"`
	UpdatedAt     time.Time       `json:"updated_at"`
}

// Repository is the persistence dependency the bucket-plane handlers need —
// the union of the S6 bucket-metadata methods
// (internal/infra/db/repos.ArtifactBucketsRepository) and the object
// aggregate/policy methods (ArtifactObjectsRepository) they read. The two
// concrete repositories share no method names, so a struct embedding both
// satisfies this interface via promotion — see router.go's wiring.
// fake_repo_test.go provides the in-memory test double.
type Repository interface {
	ListBuckets(ctx context.Context, projectID int64) ([]repos.BucketRow, error)
	GetBucket(ctx context.Context, projectID int64, name string) (repos.BucketRow, error)
	CreateBucket(ctx context.Context, input repos.NewBucketInput) (repos.BucketRow, error)
	UpdateBucketRetention(ctx context.Context, id int64, retentionDays *int32, expiresAt *time.Time) (repos.BucketRow, error)
	SetBucketPinned(ctx context.Context, id int64, pinned bool) (repos.BucketRow, error)
	UpdateBucketTags(ctx context.Context, id int64, tags json.RawMessage) (repos.BucketRow, error)
	SoftDeleteBucket(ctx context.Context, id int64) error
	SumBucketBytes(ctx context.Context, bucketID int64) (int64, error)
	CountBucketObjects(ctx context.Context, bucketID int64) (int64, error)
	GetProjectStoragePolicy(ctx context.Context, projectID int64) (repos.ProjectStoragePolicy, error)
	// UpsertObject, DeleteObjects (metadata), and SumProjectBytes are S12's
	// additions — the object-plane handlers (objects.go) had no metadata
	// footprint at all before S12, which left SumBucketBytes/SumProjectBytes/
	// CountBucketObjects permanently zero for real uploads and made the
	// project-quota check below meaningless without them.
	UpsertObject(ctx context.Context, input repos.NewObjectInput) (repos.ObjectRow, error)
	DeleteObjects(ctx context.Context, bucketID int64, keys []string) error
	SumProjectBytes(ctx context.Context, projectID int64) (int64, error)
	// CreateTransferGrant, GetTransferGrant, MarkTransferGrantConsumed, and
	// GetBucketByID are S15's additions, backing grants.go. GetBucketByID
	// (added for S14's sweeper) resolves a grant's bucket_id back to a
	// bucket name — a grant row has no bucket name of its own, only the
	// internal database id.
	CreateTransferGrant(ctx context.Context, input repos.NewTransferGrantInput) (repos.TransferGrantRow, error)
	GetTransferGrant(ctx context.Context, id string, projectID int64) (repos.TransferGrantRow, error)
	MarkTransferGrantConsumed(ctx context.Context, id string) error
	GetBucketByID(ctx context.Context, id int64) (repos.BucketRow, error)
}

type Handler struct {
	repo  Repository
	store storage.ObjectStore
}

func NewHandler(repo Repository, store storage.ObjectStore) *Handler {
	return &Handler{repo: repo, store: store}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}

// writeError writes the artifact API's typed error envelope
// (components/schemas/Error in api/openapi/v2.yaml).
func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{
		"error": map[string]string{"code": code, "message": message},
	})
}

func parseProjectID(r *http.Request) (int64, bool) {
	id, err := strconv.ParseInt(chi.URLParam(r, "projectID"), 10, 64)
	if err != nil || id <= 0 {
		return 0, false
	}
	return id, true
}

// computeExpiresAt derives the concrete deadline S14's sweeper acts on from
// a policy retention_days value — nil in, nil out (no expiry).
func computeExpiresAt(retentionDays *int32) *time.Time {
	if retentionDays == nil {
		return nil
	}
	t := time.Now().AddDate(0, 0, int(*retentionDays))
	return &t
}

func bucketFromRow(row repos.BucketRow, sizeBytes, objectCount int64) Bucket {
	tags := row.Tags
	if len(tags) == 0 {
		tags = json.RawMessage(`{}`)
	}
	return Bucket{
		Name:          row.Name,
		Type:          row.BucketType,
		IsPinned:      row.IsPinned,
		Tags:          tags,
		RetentionDays: row.RetentionDays,
		ExpiresAt:     row.ExpiresAt,
		SizeBytes:     sizeBytes,
		ObjectCount:   objectCount,
		CreatedAt:     row.CreatedAt,
		UpdatedAt:     row.UpdatedAt,
	}
}

// enrichBucket adds size_bytes/object_count — both single-aggregate queries
// (S6 SumBucketBytes/CountBucketObjects), never a full object listing.
func (h *Handler) enrichBucket(ctx context.Context, row repos.BucketRow) (Bucket, error) {
	sizeBytes, err := h.repo.SumBucketBytes(ctx, row.ID)
	if err != nil {
		return Bucket{}, fmt.Errorf("sum bucket bytes: %w", err)
	}
	objectCount, err := h.repo.CountBucketObjects(ctx, row.ID)
	if err != nil {
		return Bucket{}, fmt.Errorf("count bucket objects: %w", err)
	}
	return bucketFromRow(row, sizeBytes, objectCount), nil
}

func (h *Handler) ListBuckets(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}

	rows, err := h.repo.ListBuckets(r.Context(), projectID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "list buckets: "+err.Error())
		return
	}

	buckets := make([]Bucket, 0, len(rows))
	for _, row := range rows {
		b, err := h.enrichBucket(r.Context(), row)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "list buckets: "+err.Error())
			return
		}
		buckets = append(buckets, b)
	}
	writeJSON(w, http.StatusOK, map[string]any{"buckets": buckets})
}

func (h *Handler) GetBucket(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	name := chi.URLParam(r, "bucket")

	row, err := h.repo.GetBucket(r.Context(), projectID, name)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "get bucket: "+err.Error())
		return
	}

	b, err := h.enrichBucket(r.Context(), row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "get bucket: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, b)
}

// checkRetentionLimit rejects a requested retention_days that exceeds the
// project's policy ceiling. Per S8: read RetentionMaxDays, not
// RetentionDefaultDays — the latter is what applies when a caller omits a
// value, not a ceiling on what they may request. A nil ceiling (or a
// missing policy row, which GetProjectStoragePolicy never errors on) means
// unlimited.
func (h *Handler) checkRetentionLimit(ctx context.Context, projectID int64, retentionDays *int32) (bool, error) {
	if retentionDays == nil {
		return true, nil
	}
	policy, err := h.repo.GetProjectStoragePolicy(ctx, projectID)
	if err != nil {
		return false, err
	}
	if policy.RetentionMaxDays != nil && *retentionDays > *policy.RetentionMaxDays {
		return false, nil
	}
	return true, nil
}

func (h *Handler) CreateBucket(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}

	var req struct {
		Name          string `json:"name"`
		RetentionDays *int32 `json:"retention_days"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid request body")
		return
	}
	if !bucketNamePattern.MatchString(req.Name) {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "bucket name must match ^[a-z][a-z0-9-]{1,62}$")
		return
	}

	allowed, err := h.checkRetentionLimit(r.Context(), projectID, req.RetentionDays)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "get project storage policy: "+err.Error())
		return
	}
	if !allowed {
		writeError(w, http.StatusForbidden, "QuotaExceeded", "retention_days exceeds the project's policy ceiling")
		return
	}

	row, err := h.repo.CreateBucket(r.Context(), repos.NewBucketInput{
		ProjectID:     projectID,
		Name:          req.Name,
		DisplayName:   req.Name,
		BucketType:    "local",
		RetentionDays: req.RetentionDays,
		ExpiresAt:     computeExpiresAt(req.RetentionDays),
	})
	if errors.Is(err, storage.ErrAlreadyExists) {
		writeError(w, http.StatusConflict, "AlreadyExists", "a bucket with this name already exists in the project")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "create bucket: "+err.Error())
		return
	}

	b, err := h.enrichBucket(r.Context(), row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "create bucket: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (h *Handler) UpdateBucket(w http.ResponseWriter, r *http.Request) {
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	name := chi.URLParam(r, "bucket")

	var raw map[string]json.RawMessage
	if err := json.NewDecoder(r.Body).Decode(&raw); err != nil {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid request body")
		return
	}

	row, err := h.repo.GetBucket(r.Context(), projectID, name)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "update bucket: "+err.Error())
		return
	}

	if rawPinned, present := raw["is_pinned"]; present {
		var pinned bool
		if err := json.Unmarshal(rawPinned, &pinned); err != nil {
			writeError(w, http.StatusBadRequest, "InvalidArgument", "is_pinned must be a boolean")
			return
		}
		row, err = h.repo.SetBucketPinned(r.Context(), row.ID, pinned)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "update bucket: "+err.Error())
			return
		}
	}

	if rawTags, present := raw["tags"]; present {
		row, err = h.repo.UpdateBucketTags(r.Context(), row.ID, rawTags)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "update bucket: "+err.Error())
			return
		}
	}

	if rawRetention, present := raw["retention_days"]; present {
		var retentionDays *int32
		if !bytes.Equal(bytes.TrimSpace(rawRetention), []byte("null")) {
			var v int32
			if err := json.Unmarshal(rawRetention, &v); err != nil {
				writeError(w, http.StatusBadRequest, "InvalidArgument", "retention_days must be an integer")
				return
			}
			retentionDays = &v
		}

		allowed, err := h.checkRetentionLimit(r.Context(), projectID, retentionDays)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "get project storage policy: "+err.Error())
			return
		}
		if !allowed {
			writeError(w, http.StatusForbidden, "QuotaExceeded", "retention_days exceeds the project's policy ceiling")
			return
		}

		row, err = h.repo.UpdateBucketRetention(r.Context(), row.ID, retentionDays, computeExpiresAt(retentionDays))
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Internal", "update bucket: "+err.Error())
			return
		}
	}

	b, err := h.enrichBucket(r.Context(), row)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "update bucket: "+err.Error())
		return
	}
	writeJSON(w, http.StatusOK, b)
}

// deleteAllObjects removes every physical object under bucketRef via
// ObjectStore.DeleteBatch, paginating List until exhausted.
func (h *Handler) deleteAllObjects(ctx context.Context, bucketRef storage.ObjectRef) error {
	var token string
	for {
		page, err := h.store.List(ctx, storage.ListQuery{Bucket: bucketRef, ContinuationToken: token})
		if err != nil {
			return fmt.Errorf("list objects: %w", err)
		}

		if len(page.Objects) > 0 {
			refs := make([]storage.ObjectRef, 0, len(page.Objects))
			for _, obj := range page.Objects {
				ref, err := storage.NewObjectRef(bucketRef.ProjectID(), bucketRef.Bucket(), obj.Key)
				if err != nil {
					return fmt.Errorf("build object ref for %q: %w", obj.Key, err)
				}
				refs = append(refs, ref)
			}
			result, err := h.store.DeleteBatch(ctx, refs)
			if err != nil {
				return fmt.Errorf("delete batch: %w", err)
			}
			if len(result.Failed) > 0 {
				first := result.Failed[0]
				return fmt.Errorf("delete batch: %d object(s) failed (first: %s: %v)", len(result.Failed), first.Key, first.Err)
			}
		}

		if !page.IsTruncated {
			return nil
		}
		token = page.NextContinuationToken
	}
}

func (h *Handler) DeleteBucket(w http.ResponseWriter, r *http.Request) {
	projectIDStr := chi.URLParam(r, "projectID")
	projectID, ok := parseProjectID(r)
	if !ok {
		writeError(w, http.StatusBadRequest, "InvalidArgument", "invalid project id")
		return
	}
	name := chi.URLParam(r, "bucket")

	row, err := h.repo.GetBucket(r.Context(), projectID, name)
	if errors.Is(err, storage.ErrNotFound) {
		writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "delete bucket: "+err.Error())
		return
	}

	bucketRef, err := storage.NewBucketRef(projectIDStr, name)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "delete bucket: "+err.Error())
		return
	}

	if err := h.deleteAllObjects(r.Context(), bucketRef); err != nil {
		writeError(w, http.StatusInternalServerError, "Internal", "delete bucket objects: "+err.Error())
		return
	}

	if err := h.repo.SoftDeleteBucket(r.Context(), row.ID); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			writeError(w, http.StatusNotFound, "NotFound", "bucket not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "Internal", "delete bucket: "+err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
