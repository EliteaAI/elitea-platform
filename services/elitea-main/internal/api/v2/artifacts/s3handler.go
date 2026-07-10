package artifacts

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type S3Handler struct {
	pool    *pgxpool.Pool
	dataDir string
}

func NewS3Handler(pool *pgxpool.Pool) *S3Handler {
	dir := os.Getenv("ARTIFACTS_DATA_DIR")
	if dir == "" {
		dir = "/data/artifacts"
	}
	return &S3Handler{pool: pool, dataDir: dir}
}

func (h *S3Handler) ListBuckets(w http.ResponseWriter, r *http.Request) {
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	dir := filepath.Join(h.dataDir, projectID)
	os.MkdirAll(dir, 0755)

	entries, _ := os.ReadDir(dir)
	buckets := make([]map[string]any, 0)
	for _, e := range entries {
		if e.IsDir() {
			info, _ := e.Info()
			buckets = append(buckets, map[string]any{
				"Name":         e.Name(),
				"CreationDate": info.ModTime().Format(time.RFC3339),
			})
		}
	}

	format := r.URL.Query().Get("format")
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"Buckets": buckets,
			"Owner":   map[string]string{"DisplayName": "elitea", "ID": projectID},
		})
		return
	}

	w.Header().Set("Content-Type", "application/xml")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListAllMyBucketsResult><Buckets>`)
	for _, b := range buckets {
		fmt.Fprintf(w, `<Bucket><Name>%s</Name><CreationDate>%s</CreationDate></Bucket>`,
			b["Name"], b["CreationDate"])
	}
	fmt.Fprintf(w, `</Buckets></ListAllMyBucketsResult>`)
}

func (h *S3Handler) ListObjects(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	dir := filepath.Join(h.dataDir, projectID, bucket)
	os.MkdirAll(dir, 0755)

	entries, _ := os.ReadDir(dir)
	objects := make([]map[string]any, 0)
	for _, e := range entries {
		if !e.IsDir() {
			info, _ := e.Info()
			objects = append(objects, map[string]any{
				"Key":          e.Name(),
				"Size":         info.Size(),
				"LastModified": info.ModTime().Format(time.RFC3339),
			})
		}
	}

	format := r.URL.Query().Get("format")
	if format == "json" {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]any{
			"Contents": objects,
			"Name":     bucket,
		})
		return
	}

	w.Header().Set("Content-Type", "application/xml")
	fmt.Fprintf(w, `<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><Name>%s</Name><Contents>`, bucket)
	for _, obj := range objects {
		fmt.Fprintf(w, `<Content><Key>%s</Key><Size>%d</Size><LastModified>%s</LastModified></Content>`,
			obj["Key"], obj["Size"], obj["LastModified"])
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

	path := filepath.Join(h.dataDir, projectID, bucket, key)
	f, err := os.Open(path)
	if err != nil {
		http.Error(w, "Not Found", http.StatusNotFound)
		return
	}
	defer f.Close()

	info, _ := f.Stat()
	w.Header().Set("Content-Length", fmt.Sprintf("%d", info.Size()))
	w.Header().Set("Last-Modified", info.ModTime().UTC().Format(http.TimeFormat))
	io.Copy(w, f)
}

func (h *S3Handler) PutObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	dir := filepath.Join(h.dataDir, projectID, bucket)
	os.MkdirAll(dir, 0755)

	path := filepath.Join(dir, key)
	os.MkdirAll(filepath.Dir(path), 0755)

	f, err := os.Create(path)
	if err != nil {
		http.Error(w, "Internal Error", http.StatusInternalServerError)
		return
	}
	defer f.Close()
	io.Copy(f, r.Body)

	w.WriteHeader(http.StatusOK)
}

func (h *S3Handler) DeleteObject(w http.ResponseWriter, r *http.Request) {
	bucket := chi.URLParam(r, "bucket")
	key := strings.TrimPrefix(chi.URLParam(r, "*"), "/")
	projectID := r.URL.Query().Get("project_id")
	if projectID == "" {
		projectID = "1"
	}

	path := filepath.Join(h.dataDir, projectID, bucket, key)
	os.Remove(path)
	w.WriteHeader(http.StatusNoContent)
}
