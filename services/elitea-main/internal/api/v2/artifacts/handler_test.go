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
	rows, ok := resp["rows"].([]interface{})
	if !ok {
		t.Fatalf("expected rows array, got %T", resp["rows"])
	}
	if len(rows) != 0 {
		t.Errorf("expected empty rows, got %d rows", len(rows))
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

	// Handler returns 200 with {"message":"Created","id":...,"name":...}
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["name"] != "test-bucket" {
		t.Errorf("expected name %q, got %q", "test-bucket", resp["name"])
	}
	if id, ok := resp["id"].(string); !ok || id == "" {
		t.Error("expected non-empty id in response")
	}
	if msg, _ := resp["message"].(string); msg != "Created" {
		t.Errorf("expected message %q, got %q", "Created", msg)
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
	rows, ok := resp["rows"].([]interface{})
	if !ok {
		t.Fatalf("expected rows array, got %T", resp["rows"])
	}
	if len(rows) != 0 {
		t.Errorf("expected empty rows, got %d rows", len(rows))
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
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
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

func TestDeleteArtifact_MissingFilename(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	// No filename query param — handler must return 400.
	req := httptest.NewRequest(http.MethodDelete, "/projects/p1/buckets/b1/artifact", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rr.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["error"] == nil {
		t.Error("expected error field in response")
	}
}

func TestDeleteArtifact_WithFilename(t *testing.T) {
	h := artifacts.NewInMemoryHandler()
	r := newTestRouter(h)

	// With filename provided and no storage backend, handler returns 200 + message.
	req := httptest.NewRequest(http.MethodDelete, "/projects/p1/buckets/b1/artifact?filename=test.txt", nil)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	var resp map[string]any
	if err := json.NewDecoder(rr.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp["message"] != "Deleted" {
		t.Errorf("expected message %q, got %v", "Deleted", resp["message"])
	}
}
