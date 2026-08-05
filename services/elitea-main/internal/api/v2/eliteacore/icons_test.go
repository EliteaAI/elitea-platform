package eliteacore_test

// S20b: TestArtifactIcon* — UploadIcon/DeleteIcon/DownloadIcon moved off
// ICONS_DATA_DIR onto the object store. Handler-level, backed by an
// in-memory fake storage.ObjectStore (no real infra) — no shared testutil
// exists in this codebase, matching S18/S19/S20a's own per-file fakes.

import (
	"bytes"
	"context"
	"io"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/eliteacore"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

// fakeIconObjectStore implements storage.ObjectStore in memory — only Put/
// Get/Delete are exercised by the icon byte path.
type fakeIconObjectStore struct {
	mu      sync.Mutex
	objects map[string][]byte
}

func newFakeIconObjectStore() *fakeIconObjectStore {
	return &fakeIconObjectStore{objects: map[string][]byte{}}
}

func iconStoreKey(ref storage.ObjectRef) string {
	return ref.ProjectID() + "/" + ref.Bucket() + "/" + ref.Key()
}

func (f *fakeIconObjectStore) Put(_ context.Context, ref storage.ObjectRef, body io.Reader, _ storage.PutOptions) (storage.ObjectInfo, error) {
	data, err := io.ReadAll(body)
	if err != nil {
		return storage.ObjectInfo{}, err
	}
	f.mu.Lock()
	f.objects[iconStoreKey(ref)] = data
	f.mu.Unlock()
	return storage.ObjectInfo{Key: ref.Key(), Size: int64(len(data))}, nil
}

func (f *fakeIconObjectStore) Get(_ context.Context, ref storage.ObjectRef, _ *storage.ByteRange) (io.ReadCloser, storage.ObjectInfo, error) {
	f.mu.Lock()
	data, ok := f.objects[iconStoreKey(ref)]
	f.mu.Unlock()
	if !ok {
		return nil, storage.ObjectInfo{}, storage.ErrNotFound
	}
	return io.NopCloser(bytes.NewReader(data)), storage.ObjectInfo{Key: ref.Key(), Size: int64(len(data))}, nil
}

func (f *fakeIconObjectStore) Delete(_ context.Context, ref storage.ObjectRef) error {
	f.mu.Lock()
	delete(f.objects, iconStoreKey(ref))
	f.mu.Unlock()
	return nil
}

func (f *fakeIconObjectStore) DeleteBatch(context.Context, []storage.ObjectRef) (storage.BatchResult, error) {
	return storage.BatchResult{}, storage.ErrNotSupported
}
func (f *fakeIconObjectStore) Stat(context.Context, storage.ObjectRef) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}
func (f *fakeIconObjectStore) List(context.Context, storage.ListQuery) (storage.ListPage, error) {
	return storage.ListPage{}, storage.ErrNotSupported
}
func (f *fakeIconObjectStore) PresignGet(context.Context, storage.ObjectRef, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}
func (f *fakeIconObjectStore) PresignPut(context.Context, storage.ObjectRef, time.Duration, storage.PutOptions) (string, error) {
	return "", storage.ErrNotSupported
}
func (f *fakeIconObjectStore) StartMultipart(context.Context, storage.ObjectRef, storage.PutOptions) (storage.UploadID, error) {
	return "", storage.ErrNotSupported
}
func (f *fakeIconObjectStore) PresignPart(context.Context, storage.ObjectRef, storage.UploadID, int32, time.Duration) (string, error) {
	return "", storage.ErrNotSupported
}
func (f *fakeIconObjectStore) CompleteMultipart(context.Context, storage.ObjectRef, storage.UploadID, []storage.Part) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, storage.ErrNotSupported
}
func (f *fakeIconObjectStore) AbortMultipart(context.Context, storage.ObjectRef, storage.UploadID) error {
	return storage.ErrNotSupported
}
func (f *fakeIconObjectStore) Capabilities() storage.Capabilities { return storage.Capabilities{} }

var _ storage.ObjectStore = (*fakeIconObjectStore)(nil)

func iconUploadRequest(t *testing.T, projectID, filename string, content []byte) *http.Request {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write file content: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	req := newRequest(http.MethodPost, "/", map[string]string{"projectID": projectID}, &buf)
	req.Header.Set("Content-Type", mw.FormDataContentType())
	return req
}

func TestArtifactIconUploadStoresBytesAndDownloadServesThem(t *testing.T) {
	store := newFakeIconObjectStore()
	h := eliteacore.NewHandler(nil, eliteacore.WithObjectStore(store))

	content := []byte("<svg>icon</svg>")
	req := iconUploadRequest(t, "1", "icon.svg", content)
	w := httptest.NewRecorder()
	h.UploadIcon(w, req)

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	iconURL, _ := body["url"].(string)
	const prefix = "/icons/1/"
	if !strings.HasPrefix(iconURL, prefix) || !strings.HasSuffix(iconURL, ".svg") {
		t.Fatalf("unexpected icon URL %q", iconURL)
	}
	filename := strings.TrimPrefix(iconURL, prefix)

	downloadReq := newRequest(http.MethodGet, "/", map[string]string{"projectID": "1", "filename": filename}, nil)
	downloadRec := httptest.NewRecorder()
	eliteacore.DownloadIcon(store).ServeHTTP(downloadRec, downloadReq)

	if downloadRec.Code != http.StatusOK {
		t.Fatalf("download status = %d, want 200; body=%s", downloadRec.Code, downloadRec.Body.String())
	}
	if got := downloadRec.Body.String(); got != string(content) {
		t.Fatalf("downloaded body = %q, want %q", got, content)
	}
}

func TestArtifactIconUploadWithoutStoreConfiguredReturns500(t *testing.T) {
	h := eliteacore.NewHandler(nil) // no WithObjectStore

	req := iconUploadRequest(t, "1", "icon.png", []byte("data"))
	w := httptest.NewRecorder()
	h.UploadIcon(w, req)

	assertStatus(t, w, http.StatusInternalServerError)
}

func TestArtifactIconUploadWithNoFileStillSucceedsWithoutStore(t *testing.T) {
	// Matches the pre-S20b contract: an upload request with no file part is
	// a no-op, not an error — even when storage isn't configured, since the
	// early return never touches it.
	h := eliteacore.NewHandler(nil)

	req := newRequest(http.MethodPost, "/", map[string]string{"projectID": "1"}, nil)
	w := httptest.NewRecorder()
	h.UploadIcon(w, req)

	assertStatus(t, w, http.StatusOK)
	body := decodeObj(t, w)
	if ok, _ := body["ok"].(bool); !ok {
		t.Error("ok should be true")
	}
	if url, _ := body["url"].(string); url != "" {
		t.Errorf("url = %q, want empty", url)
	}
}

func TestArtifactIconUploadRejectsInvalidProjectID(t *testing.T) {
	store := newFakeIconObjectStore()
	h := eliteacore.NewHandler(nil, eliteacore.WithObjectStore(store))

	// "abc" passes validIconPathSegment's own (looser, pre-S20b) check —
	// non-empty, no slash/backslash/null byte — but storage.NewObjectRef
	// requires a project ID matching ^[1-9][0-9]{0,17}$, so this exercises
	// the new, stricter numeric-format enforcement S20b adds, not the
	// pre-existing structural check.
	req := iconUploadRequest(t, "abc", "icon.png", []byte("data"))
	w := httptest.NewRecorder()
	h.UploadIcon(w, req)

	assertStatus(t, w, http.StatusBadRequest)
}

func TestArtifactIconDeleteRemovesFromStoreAndIsIdempotent(t *testing.T) {
	store := newFakeIconObjectStore()
	h := eliteacore.NewHandler(nil, eliteacore.WithObjectStore(store))

	uploadReq := iconUploadRequest(t, "1", "icon.png", []byte("data"))
	uploadRec := httptest.NewRecorder()
	h.UploadIcon(uploadRec, uploadReq)
	body := decodeObj(t, uploadRec)
	iconURL, _ := body["url"].(string)
	filename := strings.TrimPrefix(iconURL, "/icons/1/")

	deleteReq := newRequest(http.MethodDelete, "/", map[string]string{"projectID": "1", "name": filename}, nil)
	deleteRec := httptest.NewRecorder()
	h.DeleteIcon(deleteRec, deleteReq)
	assertStatus(t, deleteRec, http.StatusNoContent)

	downloadReq := newRequest(http.MethodGet, "/", map[string]string{"projectID": "1", "filename": filename}, nil)
	downloadRec := httptest.NewRecorder()
	eliteacore.DownloadIcon(store).ServeHTTP(downloadRec, downloadReq)
	if downloadRec.Code != http.StatusNotFound {
		t.Fatalf("download after delete status = %d, want 404", downloadRec.Code)
	}

	// Deleting again (or a never-existed icon) is idempotent, matching this
	// handler's pre-S20b behavior and storage.ObjectStore's own documented
	// Delete semantics.
	deleteAgainRec := httptest.NewRecorder()
	h.DeleteIcon(deleteAgainRec, deleteReq)
	assertStatus(t, deleteAgainRec, http.StatusNoContent)
}

func TestArtifactIconDownloadMissingIconReturns404(t *testing.T) {
	store := newFakeIconObjectStore()
	req := newRequest(http.MethodGet, "/", map[string]string{"projectID": "1", "filename": "never-uploaded.png"}, nil)
	rec := httptest.NewRecorder()
	eliteacore.DownloadIcon(store).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func TestArtifactIconDownloadRejectsInvalidProjectID(t *testing.T) {
	store := newFakeIconObjectStore()
	req := newRequest(http.MethodGet, "/", map[string]string{"projectID": "not-numeric", "filename": "icon.png"}, nil)
	rec := httptest.NewRecorder()
	eliteacore.DownloadIcon(store).ServeHTTP(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}
