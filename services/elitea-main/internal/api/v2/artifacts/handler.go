package artifacts

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type Bucket struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	IsPinned  bool      `json:"is_pinned"`
	CreatedAt time.Time `json:"created_at"`
}

type Artifact struct {
	ID        string    `json:"id"`
	BucketID  string    `json:"bucket_id"`
	Name      string    `json:"name"`
	MimeType  string    `json:"mime_type,omitempty"`
	Size      int64     `json:"size"`
	CreatedAt time.Time `json:"created_at"`
}

type Repository interface {
	ListBuckets(ctx context.Context, projectID string) ([]Bucket, error)
	CreateBucket(ctx context.Context, projectID, name string) (Bucket, error)
	UpdateBucket(ctx context.Context, projectID, name string, meta map[string]any) (Bucket, error)
	PatchBucket(ctx context.Context, projectID, name string, isPinned bool) (Bucket, error)
	DeleteBucket(ctx context.Context, projectID, name string) error
	ListArtifacts(ctx context.Context, projectID, bucket string) ([]Artifact, error)
	GetArtifact(ctx context.Context, projectID, bucket string) (Artifact, error)
	CreateArtifact(ctx context.Context, projectID, bucket string, body map[string]any) (Artifact, error)
	DeleteArtifact(ctx context.Context, projectID, bucket string) error
	UploadArtifact(ctx context.Context, projectID, bucket, filename, mimeType string, size int64) (Artifact, error)
	DeleteArtifacts(ctx context.Context, projectID, bucket string, names []string) error
}

type Handler struct {
	repo    Repository
	backend storage.Backend
}

func NewHandler(repo Repository, backend storage.Backend) *Handler {
	return &Handler{repo: repo, backend: backend}
}

func NewInMemoryHandler() *Handler {
	return &Handler{repo: newMemRepo()}
}

// --- Bucket handlers ---

func (h *Handler) ListBuckets(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	buckets, err := h.repo.ListBuckets(r.Context(), projectID)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	rows := make([]map[string]any, len(buckets))
	for i, b := range buckets {
		rows[i] = map[string]any{
			"id":         b.ID,
			"name":       b.Name,
			"is_pinned":  b.IsPinned,
			"created_at": b.CreatedAt,
			"size":       0,
			"tags":       []any{},
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "total": len(rows)})
}

func (h *Handler) CreateBucket(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	var body struct {
		Name string `json:"name"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	bucket, err := h.repo.CreateBucket(r.Context(), projectID, body.Name)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"message": "Created",
		"id":      bucket.ID,
		"name":    bucket.Name,
	})
}

// UpdateBucket handles PUT /buckets/default/{projectID}?name={bucket}
func (h *Handler) UpdateBucket(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "name query param required"})
		return
	}
	var meta map[string]any
	json.NewDecoder(r.Body).Decode(&meta)
	bucket, err := h.repo.UpdateBucket(r.Context(), projectID, name, meta)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, bucket)
}

// PatchBucket handles PATCH /buckets/default/{projectID}?name={bucket} with body { "is_pinned": bool }
func (h *Handler) PatchBucket(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "name query param required"})
		return
	}
	var body struct {
		IsPinned bool `json:"is_pinned"`
	}
	json.NewDecoder(r.Body).Decode(&body)
	bucket, err := h.repo.PatchBucket(r.Context(), projectID, name, body.IsPinned)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, bucket)
}

// DeleteBucket handles DELETE /buckets/default/{projectID}?name={bucket}
func (h *Handler) DeleteBucket(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	name := r.URL.Query().Get("name")
	if name == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "name query param required"})
		return
	}
	if err := h.repo.DeleteBucket(r.Context(), projectID, name); err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "Deleted"})
}

// --- Artifact handlers ---

func (h *Handler) ListArtifacts(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	artifacts, err := h.repo.ListArtifacts(r.Context(), projectID, bucket)
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"rows": []any{}, "total": 0})
		return
	}
	rows := make([]map[string]any, len(artifacts))
	for i, a := range artifacts {
		rows[i] = map[string]any{
			"id":       a.ID,
			"name":     a.Name,
			"size":     a.Size,
			"modified": a.CreatedAt,
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"rows": rows, "total": len(rows)})
}

func (h *Handler) GetArtifact(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	artifact, err := h.repo.GetArtifact(r.Context(), projectID, bucket)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]any{"error": "artifact not found"})
		return
	}
	writeJSON(w, http.StatusOK, artifact)
}

// ServeFile serves file content from the storage backend.
// URL: GET /artifact/default/{projectID}/{bucket}/*
func (h *Handler) ServeFile(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	filePath := strings.TrimPrefix(chi.URLParam(r, "*"), "/")

	if decoded, err := url.PathUnescape(filePath); err == nil {
		filePath = decoded
	}
	if decodedBucket, err := url.PathUnescape(bucket); err == nil {
		bucket = decodedBucket
	}

	if h.backend == nil || filePath == "" {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}

	reader, info, err := h.backend.GetObject(r.Context(), projectID, bucket, filePath)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	defer reader.Close()

	mimeType := info.ContentType
	if mimeType == "" {
		ext := ""
		if idx := strings.LastIndex(filePath, "."); idx >= 0 {
			ext = filePath[idx:]
		}
		mimeType = mime.TypeByExtension(ext)
		if mimeType == "" {
			mimeType = "application/octet-stream"
		}
	}

	w.Header().Set("Content-Type", mimeType)
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size))
	io.Copy(w, reader)
}

func (h *Handler) CreateArtifact(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	var body map[string]any
	json.NewDecoder(r.Body).Decode(&body)
	artifact, err := h.repo.CreateArtifact(r.Context(), projectID, bucket, body)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	writeJSON(w, http.StatusCreated, artifact)
}

func (h *Handler) DeleteArtifact(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	filename := r.URL.Query().Get("filename")
	if filename == "" {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "filename query param required"})
		return
	}
	var size int64
	if h.backend != nil {
		if info, err := h.backend.StatObject(r.Context(), projectID, bucket, filename); err == nil {
			size = info.Size
		}
		h.backend.DeleteObject(r.Context(), projectID, bucket, filename)
	}
	writeJSON(w, http.StatusOK, map[string]any{"message": "Deleted", "size": size})
}

// UploadArtifact handles POST /artifacts/default/{projectID}/{bucket} (multipart/form-data, field "file")
func (h *Handler) UploadArtifact(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")

	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid multipart form"})
		return
	}

	file, header, err := r.FormFile("file")
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "file field required"})
		return
	}
	defer file.Close()

	data, err := io.ReadAll(file)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": "failed to read file"})
		return
	}

	mimeType := header.Header.Get("Content-Type")
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}

	artifact, err := h.repo.UploadArtifact(r.Context(), projectID, bucket, header.Filename, mimeType, int64(len(data)))
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}

	if h.backend != nil {
		h.backend.PutObject(r.Context(), projectID, bucket, header.Filename, bytes.NewReader(data), int64(len(data)), mimeType)
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"message": "Done",
		"size":    artifact.Size,
		"name":    artifact.Name,
	})
}

// DeleteArtifacts handles DELETE /artifacts/default/{projectID}/{bucket}?fname[]={name}&fname[]={name}
func (h *Handler) DeleteArtifacts(w http.ResponseWriter, r *http.Request) {
	projectID := chi.URLParam(r, "projectID")
	bucket := chi.URLParam(r, "bucket")
	names := r.URL.Query()["fname[]"]
	if len(names) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "fname[] query param required"})
		return
	}
	if err := h.repo.DeleteArtifacts(r.Context(), projectID, bucket, names); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]any{"error": err.Error()})
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- In-memory repository ---

// memRepo is a mutex-protected in-memory store that persists for the process lifetime.
type memRepo struct {
	mu        sync.Mutex
	buckets   map[string][]Bucket              // projectID -> buckets
	artifacts map[string]map[string][]Artifact // projectID -> bucketName -> artifacts
}

func newMemRepo() *memRepo {
	return &memRepo{
		buckets:   make(map[string][]Bucket),
		artifacts: make(map[string]map[string][]Artifact),
	}
}

func (r *memRepo) ListBuckets(_ context.Context, projectID string) ([]Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b := r.buckets[projectID]
	if b == nil {
		return []Bucket{}, nil
	}
	out := make([]Bucket, len(b))
	copy(out, b)
	return out, nil
}

func (r *memRepo) CreateBucket(_ context.Context, projectID, name string) (Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	b := Bucket{
		ID:        fmt.Sprintf("bucket-%d", time.Now().UnixMilli()),
		Name:      name,
		CreatedAt: time.Now(),
	}
	r.buckets[projectID] = append(r.buckets[projectID], b)
	return b, nil
}

func (r *memRepo) UpdateBucket(_ context.Context, projectID, name string, meta map[string]any) (Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, b := range r.buckets[projectID] {
		if b.Name == name {
			if newName, ok := meta["name"].(string); ok && newName != "" {
				// Rename: also migrate artifact map key.
				r.buckets[projectID][i].Name = newName
				if r.artifacts[projectID] != nil {
					r.artifacts[projectID][newName] = r.artifacts[projectID][name]
					delete(r.artifacts[projectID], name)
				}
			}
			return r.buckets[projectID][i], nil
		}
	}
	return Bucket{}, fmt.Errorf("bucket %q not found", name)
}

func (r *memRepo) PatchBucket(_ context.Context, projectID, name string, isPinned bool) (Bucket, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for i, b := range r.buckets[projectID] {
		if b.Name == name {
			r.buckets[projectID][i].IsPinned = isPinned
			return r.buckets[projectID][i], nil
		}
	}
	return Bucket{}, fmt.Errorf("bucket %q not found", name)
}

func (r *memRepo) DeleteBucket(_ context.Context, projectID, name string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	buckets := r.buckets[projectID]
	for i, b := range buckets {
		if b.Name == name {
			r.buckets[projectID] = append(buckets[:i], buckets[i+1:]...)
			if r.artifacts[projectID] != nil {
				delete(r.artifacts[projectID], name)
			}
			return nil
		}
	}
	return fmt.Errorf("bucket %q not found", name)
}

func (r *memRepo) ListArtifacts(_ context.Context, projectID, bucket string) ([]Artifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.artifacts[projectID] == nil {
		return []Artifact{}, nil
	}
	arts := r.artifacts[projectID][bucket]
	if arts == nil {
		return []Artifact{}, nil
	}
	out := make([]Artifact, len(arts))
	copy(out, arts)
	return out, nil
}

func (r *memRepo) GetArtifact(_ context.Context, _, _ string) (Artifact, error) {
	return Artifact{}, fmt.Errorf("not found")
}

func (r *memRepo) CreateArtifact(_ context.Context, projectID, bucket string, body map[string]any) (Artifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	name, _ := body["name"].(string)
	art := Artifact{
		ID:        fmt.Sprintf("art-%d", time.Now().UnixMilli()),
		BucketID:  bucket,
		Name:      name,
		CreatedAt: time.Now(),
	}
	if r.artifacts[projectID] == nil {
		r.artifacts[projectID] = make(map[string][]Artifact)
	}
	r.artifacts[projectID][bucket] = append(r.artifacts[projectID][bucket], art)
	return art, nil
}

func (r *memRepo) DeleteArtifact(_ context.Context, _, _ string) error {
	return nil
}

func (r *memRepo) UploadArtifact(_ context.Context, projectID, bucket, filename, mimeType string, size int64) (Artifact, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	art := Artifact{
		ID:        fmt.Sprintf("art-%d", time.Now().UnixMilli()),
		BucketID:  bucket,
		Name:      filename,
		MimeType:  mimeType,
		Size:      size,
		CreatedAt: time.Now(),
	}
	if r.artifacts[projectID] == nil {
		r.artifacts[projectID] = make(map[string][]Artifact)
	}
	r.artifacts[projectID][bucket] = append(r.artifacts[projectID][bucket], art)
	return art, nil
}

func (r *memRepo) DeleteArtifacts(_ context.Context, projectID, bucket string, names []string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.artifacts[projectID] == nil {
		return nil
	}
	nameSet := make(map[string]struct{}, len(names))
	for _, n := range names {
		nameSet[n] = struct{}{}
	}
	arts := r.artifacts[projectID][bucket]
	kept := arts[:0]
	for _, a := range arts {
		if _, remove := nameSet[a.Name]; !remove {
			kept = append(kept, a)
		}
	}
	r.artifacts[projectID][bucket] = kept
	return nil
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(v)
}
