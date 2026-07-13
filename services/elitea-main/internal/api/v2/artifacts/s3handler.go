package artifacts

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

type S3Handler struct {
	backend storage.Backend
}

func NewS3Handler(backend storage.Backend) *S3Handler {
	return &S3Handler{backend: backend}
}

func (h *S3Handler) ListBuckets(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	infos, _ := h.backend.ListBuckets(r.Context(), projectID)
	buckets := make([]map[string]any, 0, len(infos))
	for _, info := range infos {
		buckets = append(buckets, map[string]any{
			"name":          info.Name,
			"creation_date": info.CreatedAt.Format(time.RFC3339),
		})
	}

	format := r.URL.Query().Get("format")
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"buckets": buckets,
			"owner":   map[string]string{"DisplayName": "elitea", "ID": projectID},
		})
		return
	}

	w.Header().Set("Content-Type", "application/xml")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>`)
	for _, b := range buckets {
		fmt.Fprintf(w, `<Bucket><Name>%s</Name><CreationDate>%s</CreationDate></Bucket>`,
			b["name"], b["creation_date"])
	}
	fmt.Fprintf(w, `</Buckets></ListAllMyBucketsResult>`)
}

func (h *S3Handler) ListObjects(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	infos, _ := h.backend.ListObjects(r.Context(), projectID, bucket, "")
	objects := make([]map[string]any, 0, len(infos))
	for _, info := range infos {
		objects = append(objects, map[string]any{
			"key":          info.Key,
			"size":         info.Size,
			"lastModified": info.LastModified.Format(time.RFC3339),
		})
	}

	format := r.URL.Query().Get("format")
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"contents": objects,
			"name":     bucket,
		})
		return
	}

	w.Header().Set("Content-Type", "application/xml")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>%s</Name><Contents>`, bucket)
	for _, obj := range objects {
		fmt.Fprintf(w, `<Content><Key>%s</Key><Size>%d</Size><LastModified>%s</LastModified></Content>`,
			obj["key"], obj["size"], obj["lastModified"])
	}
	fmt.Fprintf(w, `</Contents></ListBucketResult>`)
}

func (h *S3Handler) GetObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	reader, info, err := h.backend.GetObject(r.Context(), projectID, bucket, key)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	defer reader.Close()

	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size))
	w.Header().Set("Last-Modified", info.LastModified.UTC().Format(http.TimeFormat))
	io.Copy(w, reader)
}

func (h *S3Handler) PutObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	h.backend.CreateBucket(r.Context(), projectID, bucket)
	if err := h.backend.PutObject(r.Context(), projectID, bucket, key, r.Body, r.ContentLength, ""); err != nil {
		http.Error(w, "Internal Error", http.StatusInternalServerError)
		return
	}

	w.WriteHeader(http.StatusOK)
}

func (h *S3Handler) DeleteObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	h.backend.DeleteObject(r.Context(), projectID, bucket, key)
	w.WriteHeader(http.StatusNoContent)
}
