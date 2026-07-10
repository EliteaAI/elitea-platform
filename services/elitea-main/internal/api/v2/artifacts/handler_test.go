package artifacts_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
)

func newTestRouter(h *artifacts.Handler) chi.Router {
	r := chi.NewRouter()
	r.Get("/projects/{projectID}/buckets", h.ListBuckets)
	r.Post("/projects/{projectID}/buckets", h.CreateBucket)
	r.Get("/projects/{projectID}/buckets/{bucket}", h.ListArtifacts)
	r.Get("/projects/{projectID}/buckets/{bucket}/artifact", h.GetArtifact)
	r.Post("/projects/{projectID}/buckets/{bucket}/artifact", h.CreateArtifact)
	r.Delete("/projects/{projectID}/buckets/{bucket}/artifact", h.DeleteArtifact)
	return r
}

func TestListBuckets_Empty(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/p1/buckets", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	items, ok := resp["items"].([]interface{})
	if !ok {
		t.Fatalf("expected items array, got %T", resp["items"])
	}
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d items", len(items))
	}
	if total := resp["total"].(float64); total != 0 {
		t.Errorf("expected total 0, got %v", total)
	}
}

func TestCreateBucket_ReturnsCreated(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	body := bytes.NewBufferString(`{"name":"test-bucket"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects/p1/buckets", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rr.Code)
	}
	var bucket artifacts.Bucket
	if err := json.NewDecoder(rr.Body).Decode(&bucket); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if bucket.Name != "test-bucket" {
		t.Errorf("expected name %q, got %q", "test-bucket", bucket.Name)
	}
	if bucket.ID == "" {
		t.Error("expected non-empty bucket ID")
	}
	if bucket.CreatedAt.IsZero() {
		t.Error("expected non-zero created_at")
	}
}

func TestListArtifacts_Empty(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/p1/buckets/b1", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	items, ok := resp["items"].([]interface{})
	if !ok {
		t.Fatalf("expected items array, got %T", resp["items"])
	}
	if len(items) != 0 {
		t.Errorf("expected empty items, got %d items", len(items))
	}
}

func TestGetArtifact_NotFound(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	req := httptest.NewRequest(http.MethodGet, "/projects/p1/buckets/b1/artifact", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", rr.Code)
	}
	var resp map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["error"] == nil {
		t.Error("expected error field in response")
	}
}

func TestCreateArtifact_ReturnsCreated(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	body := bytes.NewBufferString(`{"name":"my-artifact"}`)
	req := httptest.NewRequest(http.MethodPost, "/projects/p1/buckets/b1/artifact", body)
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d", rr.Code)
	}
	var art artifacts.Artifact
	if err := json.NewDecoder(rr.Body).Decode(&art); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if art.Name != "my-artifact" {
		t.Errorf("expected name %q, got %q", "my-artifact", art.Name)
	}
	if art.BucketID != "b1" {
		t.Errorf("expected bucket_id %q, got %q", "b1", art.BucketID)
	}
	if art.ID == "" {
		t.Error("expected non-empty artifact ID")
	}
}

func TestDeleteArtifact_NoContent(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	req := httptest.NewRequest(http.MethodDelete, "/projects/p1/buckets/b1/artifact", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", rr.Code)
	}
}
