package artifacts_test

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/db/repos"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/storage"
)

func newGrantTestRouter(h *artifacts.Handler) chi.Router {
	r := chi.NewRouter()
	r.Post("/grants/{projectID}/{bucket}", h.CreateTransferGrant)
	r.Post("/grants/{projectID}/{grantID}:commit", h.CommitTransferGrant)
	return r
}

func newGrantRequest(t *testing.T, path, body string) *http.Request {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

func decodeGrantResponse(t *testing.T, body *bytes.Buffer) struct {
	GrantID     string    `json:"grant_id"`
	URL         string    `json:"url"`
	Method      string    `json:"method"`
	ExpiresAt   time.Time `json:"expires_at"`
	ContentType string    `json:"content_type"`
	MaxBytes    int64     `json:"max_bytes"`
	UploadID    *string   `json:"upload_id"`
} {
	t.Helper()
	var resp struct {
		GrantID     string    `json:"grant_id"`
		URL         string    `json:"url"`
		Method      string    `json:"method"`
		ExpiresAt   time.Time `json:"expires_at"`
		ContentType string    `json:"content_type"`
		MaxBytes    int64     `json:"max_bytes"`
		UploadID    *string   `json:"upload_id"`
	}
	if err := json.Unmarshal(body.Bytes(), &resp); err != nil {
		t.Fatalf("decode grant response: %v (body=%s)", err, body.String())
	}
	return resp
}

func TestArtifactGrantCreatePresignedPutReturnsRealPresignedURL(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.presign = true
	r := newGrantTestRouter(h)

	before := time.Now()
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"PUT","content_type":"image/png","max_bytes":1024}`))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	resp := decodeGrantResponse(t, rr.Body)
	if resp.GrantID == "" {
		t.Fatal("expected a non-empty grant_id")
	}
	if !strings.HasPrefix(resp.URL, "https://presigned.example.test/put/") {
		t.Fatalf("url = %q, want a real presigned PUT URL", resp.URL)
	}
	if !strings.HasSuffix(resp.URL, resp.GrantID) {
		t.Fatalf("url = %q, want it to end with grant_id %q (the server-derived key)", resp.URL, resp.GrantID)
	}
	if resp.Method != "PUT" || resp.ContentType != "image/png" || resp.MaxBytes != 1024 {
		t.Fatalf("resp = %+v", resp)
	}
	if resp.ExpiresAt.Before(before.Add(14*time.Minute)) || resp.ExpiresAt.After(before.Add(16*time.Minute)) {
		t.Fatalf("expires_at = %v, want ~15 minutes from %v", resp.ExpiresAt, before)
	}
}

// TestArtifactGrantCreateFallsBackToFacadeURLWhenPresignUnsupported proves
// S15's explicit fallback requirement: "return the facade URL, not an
// error" when Capabilities().Presign is false — the default for fakeStore,
// matching an Azure-workload-identity or signing-material-less GCS client.
func TestArtifactGrantCreateFallsBackToFacadeURLWhenPresignUnsupported(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	t.Run("PUT", func(t *testing.T) {
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"PUT","content_type":"image/png","max_bytes":1024}`))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
		}
		resp := decodeGrantResponse(t, rr.Body)
		if resp.URL != "/api/v2/artifacts/objects/1/reports" {
			t.Fatalf("url = %q, want the facade upload endpoint", resp.URL)
		}
	})

	t.Run("GET", func(t *testing.T) {
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"GET","content_type":"image/png","max_bytes":1024}`))
		if rr.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
		}
		resp := decodeGrantResponse(t, rr.Body)
		if resp.URL != "/api/v2/artifacts/objects/1/reports/"+resp.GrantID {
			t.Fatalf("url = %q, want the facade download endpoint for grant_id %q", resp.URL, resp.GrantID)
		}
	})
}

func TestArtifactGrantCreateRejectsInvalidMethod(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"DELETE","content_type":"image/png","max_bytes":1024}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestArtifactGrantCreateRejectsMissingContentType(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"PUT","max_bytes":1024}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

func TestArtifactGrantCreateRejectsNonPositiveMaxBytes(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", `{"method":"PUT","content_type":"image/png","max_bytes":0}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

// TestArtifactGrantCreateRejectsPartialDigestDeclaration proves the plan's
// "reject a grant request with no digest when the caller declares one is
// required" reasoning applied the other direction too: declaring only one
// of digest_alg/digest is a caller error, not something to silently accept
// and leave unverifiable at commit.
func TestArtifactGrantCreateRejectsPartialDigestDeclaration(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	for _, body := range []string{
		`{"method":"PUT","content_type":"image/png","max_bytes":1024,"digest_alg":"sha256"}`,
		`{"method":"PUT","content_type":"image/png","max_bytes":1024,"digest":"` + strings.Repeat("00", 32) + `"}`,
	} {
		rr := httptest.NewRecorder()
		r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", body))
		if rr.Code != http.StatusBadRequest {
			t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
		}
	}
}

func TestArtifactGrantCreateRejectsUnsupportedDigestAlgorithm(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports",
		`{"method":"PUT","content_type":"image/png","max_bytes":1024,"digest_alg":"md5","digest":"`+strings.Repeat("00", 16)+`"}`))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}

// TestArtifactGrantCreateRejectsMalformedDigest exercises
// parseGrantDigest's two remaining failure branches beyond the algorithm
// check: non-hex characters, and hex that decodes but isn't 32 bytes.
func TestArtifactGrantCreateRejectsMalformedDigest(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	for name, digest := range map[string]string{
		"not hex":        "not-valid-hex-at-all-zzzzzzzzzzzzzzzzzzzzzzzzzzzzz",
		"wrong length":   strings.Repeat("00", 16),
		"empty":          "",
		"odd hex length": "0",
	} {
		t.Run(name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports",
				`{"method":"PUT","content_type":"image/png","max_bytes":1024,"digest_alg":"sha256","digest":"`+digest+`"}`))
			if rr.Code != http.StatusBadRequest {
				t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

// createTestGrant issues a grant through the real handler and returns its
// grant_id and content-type, so commit tests exercise the exact code path
// CommitTransferGrant reads back — not a hand-built repository row.
func createTestGrant(t *testing.T, r chi.Router, body string) string {
	t.Helper()
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, newGrantRequest(t, "/grants/1/reports", body))
	if rr.Code != http.StatusOK {
		t.Fatalf("create grant: status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	return decodeGrantResponse(t, rr.Body).GrantID
}

// simulateGrantUpload calls Put directly against the fake store, standing
// in for the out-of-band presigned PUT a real client would perform — commit
// only ever observes the object through Get, so it cannot tell the
// difference.
func simulateGrantUpload(t *testing.T, store *fakeStore, grantID, contentType string, content []byte) {
	t.Helper()
	ref, err := storage.NewObjectRef("1", "reports", grantID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.Put(t.Context(), ref, bytes.NewReader(content), storage.PutOptions{ContentType: contentType}); err != nil {
		t.Fatal(err)
	}
}

func TestArtifactGrantCommitProducesListableObjectAndConsumesGrant(t *testing.T) {
	h, repo, store := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	content := []byte("hello, grant")
	digest := sha256.Sum256(content)
	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"text/plain","max_bytes":1024,"digest_alg":"sha256","digest":"`+hex.EncodeToString(digest[:])+`"}`)
	simulateGrantUpload(t, store, grantID, "text/plain", content)

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rr.Code, rr.Body.String())
	}
	var resp struct {
		Key       string `json:"key"`
		SizeBytes int64  `json:"size_bytes"`
		MediaType string `json:"media_type"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode commit response: %v (body=%s)", err, rr.Body.String())
	}
	if resp.Key != grantID || resp.SizeBytes != int64(len(content)) || resp.MediaType != "text/plain" {
		t.Fatalf("resp = %+v", resp)
	}

	bucket, err := repo.GetBucket(t.Context(), 1, "reports")
	if err != nil {
		t.Fatal(err)
	}
	if record, ok := repo.objects[fakeObjectKey(bucket.ID, grantID)]; !ok || record.byteLength != int64(len(content)) {
		t.Fatalf("expected object metadata for %q to be recorded, got ok=%v record=%+v", grantID, ok, record)
	}

	// Single-use: a second commit on the same grant must fail.
	rr2 := httptest.NewRecorder()
	r.ServeHTTP(rr2, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr2.Code != http.StatusConflict {
		t.Fatalf("second commit: status = %d, want 409; body=%s", rr2.Code, rr2.Body.String())
	}
}

func TestArtifactGrantCommitWithMismatchedDigestReturns409AndDeletesObject(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	declaredDigest := sha256.Sum256([]byte("expected content"))
	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"text/plain","max_bytes":1024,"digest_alg":"sha256","digest":"`+hex.EncodeToString(declaredDigest[:])+`"}`)
	simulateGrantUpload(t, store, grantID, "text/plain", []byte("different content actually uploaded"))

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "DigestMismatch" {
		t.Fatalf("error.code = %q, want DigestMismatch", envelope.Error.Code)
	}
	if store.objectCount() != 0 {
		t.Fatalf("expected the mismatched object to be deleted, got %d objects", store.objectCount())
	}
}

func TestArtifactGrantCommitWithMismatchedMediaTypeReturns409AndDeletesObject(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"image/png","max_bytes":1024}`)
	simulateGrantUpload(t, store, grantID, "application/pdf", []byte("not actually a png"))

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "MediaTypeMismatch" {
		t.Fatalf("error.code = %q, want MediaTypeMismatch", envelope.Error.Code)
	}
	if store.objectCount() != 0 {
		t.Fatalf("expected the mismatched object to be deleted, got %d objects", store.objectCount())
	}
}

func TestArtifactGrantCommitExceedingMaxBytesReturns413AndDeletesObject(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"text/plain","max_bytes":4}`)
	simulateGrantUpload(t, store, grantID, "text/plain", []byte("this is way more than 4 bytes"))

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413; body=%s", rr.Code, rr.Body.String())
	}
	if store.objectCount() != 0 {
		t.Fatalf("expected the oversized object to be deleted, got %d objects", store.objectCount())
	}
}

func TestArtifactGrantCommitUnknownGrantReturns404(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/00000000-0000-4000-8000-000000000000:commit", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

// TestArtifactGrantCommitMalformedGrantIDReturns404 proves looksLikeGrantID's
// defensive check: a grantID that cannot possibly be a UUID must not reach
// the repository at all (which would otherwise surface a raw Postgres
// "invalid input syntax for type uuid" as a 500 in production).
func TestArtifactGrantCommitMalformedGrantIDReturns404(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/not-a-uuid:commit", nil))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404; body=%s", rr.Code, rr.Body.String())
	}
}

// TestArtifactGrantCommitMalformedGrantIDVariantsReturn404 exercises
// looksLikeGrantID's per-character checks individually — right length but a
// dash in the wrong place, and right shape but a non-hex character — not
// just the "obviously not a UUID at all" case above.
func TestArtifactGrantCommitMalformedGrantIDVariantsReturn404(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	for name, id := range map[string]string{
		"dash in wrong place": "111111112-111-4111-8111-111111111111",
		"non-hex character":   "zzzzzzzz-1111-4111-8111-111111111111",
	} {
		t.Run(name, func(t *testing.T) {
			rr := httptest.NewRecorder()
			r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+id+":commit", nil))
			if rr.Code != http.StatusNotFound {
				t.Fatalf("status = %d, want 404; body=%s", rr.Code, rr.Body.String())
			}
		})
	}
}

// TestArtifactGrantCommitExpiredGrantReturns412 proves commit's own
// defense-in-depth expiry check (beyond "an expired grant URL returns 403
// from the provider" — the provider-side behavior a presigned URL itself
// enforces, which this test cannot exercise against a fake store). Backdates
// the grant's expires_at directly on the fake repository, since waiting out
// a real 15-minute TTL is not a reasonable thing to do in a test.
func TestArtifactGrantCommitExpiredGrantReturns412(t *testing.T) {
	h, repo, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"image/png","max_bytes":1024}`)

	grant := repo.grants[grantID]
	grant.ExpiresAt = time.Now().Add(-time.Minute)
	repo.grants[grantID] = grant

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusPreconditionFailed {
		t.Fatalf("status = %d, want 412; body=%s", rr.Code, rr.Body.String())
	}
}

// TestArtifactGrantCommitWithEmptyBackendContentTypeReturns409 proves the
// media-type check is mandatory, not defensive (S15's explicit requirement):
// a backend that reports no ContentType at all (info.ContentType == "" —
// e.g. a provider that doesn't echo it back, or an out-of-band client that
// omitted the header on its presigned PUT) must still be rejected against a
// grant that declared one, not silently waved through.
func TestArtifactGrantCommitWithEmptyBackendContentTypeReturns409(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	r := newGrantTestRouter(h)

	grantID := createTestGrant(t, r, `{"method":"PUT","content_type":"image/png","max_bytes":1024}`)
	simulateGrantUpload(t, store, grantID, "", []byte("no content-type reported by the backend"))

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusConflict {
		t.Fatalf("status = %d, want 409; body=%s", rr.Code, rr.Body.String())
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(rr.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "MediaTypeMismatch" {
		t.Fatalf("error.code = %q, want MediaTypeMismatch", envelope.Error.Code)
	}
	if store.objectCount() != 0 {
		t.Fatalf("expected the mismatched object to be deleted, got %d objects", store.objectCount())
	}
}

// TestArtifactGrantCommitExceedingProjectQuotaReturns413AndRollsBack proves
// commit enforces S12's project storage quota exactly like UploadObject does
// (objects_limits_test.go's TestArtifactLimitUploadExceedingProjectQuotaReturns413AndRollsBack) —
// a grant-based commit that pushes the project's total past max_total_bytes
// must not be allowed to bypass the same control a direct upload is subject
// to.
func TestArtifactGrantCommitExceedingProjectQuotaReturns413AndRollsBack(t *testing.T) {
	h, repo, store := newObjectTestHandler(t)
	limit := int64(150)
	repo.setPolicy(repos.ProjectStoragePolicy{ProjectID: 1, MaxTotalBytes: &limit})
	r := newGrantTestRouter(h)

	firstGrantID := createTestGrant(t, r, `{"method":"PUT","content_type":"text/plain","max_bytes":1024}`)
	simulateGrantUpload(t, store, firstGrantID, "text/plain", bytes.Repeat([]byte("A"), 100))
	firstRR := httptest.NewRecorder()
	r.ServeHTTP(firstRR, httptest.NewRequest(http.MethodPost, "/grants/1/"+firstGrantID+":commit", nil))
	if firstRR.Code != http.StatusOK {
		t.Fatalf("first commit: status = %d, want 200; body=%s", firstRR.Code, firstRR.Body.String())
	}

	secondGrantID := createTestGrant(t, r, `{"method":"PUT","content_type":"text/plain","max_bytes":1024}`)
	simulateGrantUpload(t, store, secondGrantID, "text/plain", bytes.Repeat([]byte("B"), 100))
	secondRR := httptest.NewRecorder()
	r.ServeHTTP(secondRR, httptest.NewRequest(http.MethodPost, "/grants/1/"+secondGrantID+":commit", nil))
	if secondRR.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("second commit: status = %d, want 413; body=%s", secondRR.Code, secondRR.Body.String())
	}
	var envelope struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	if err := json.Unmarshal(secondRR.Body.Bytes(), &envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Error.Code != "TooLarge" {
		t.Fatalf("error.code = %q, want TooLarge", envelope.Error.Code)
	}

	// Rolled back: the second object must not exist physically...
	if store.objectCount() != 1 {
		t.Fatalf("expected only the first commit's object to remain in the store, got %d objects", store.objectCount())
	}
	// ...nor count toward the project's metadata total.
	total, err := repo.SumProjectBytes(t.Context(), 1)
	if err != nil {
		t.Fatalf("SumProjectBytes: %v", err)
	}
	if total != 100 {
		t.Fatalf("SumProjectBytes = %d, want 100 (only the first commit, second rolled back)", total)
	}

	// The grant itself is not marked consumed on rollback — the plan's
	// existing rejectCommit path deletes the object but does not, and must
	// not, call MarkTransferGrantConsumed on a rejected commit.
	if _, err := repo.GetTransferGrant(t.Context(), secondGrantID, 1); err != nil {
		t.Fatalf("GetTransferGrant after rollback: %v", err)
	}
}

func TestArtifactGrantCommitNonPutGrantReturns400(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)
	r := newGrantTestRouter(h)
	grantID := createTestGrant(t, r, `{"method":"GET","content_type":"image/png","max_bytes":1024}`)

	rr := httptest.NewRecorder()
	r.ServeHTTP(rr, httptest.NewRequest(http.MethodPost, "/grants/1/"+grantID+":commit", nil))
	if rr.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400; body=%s", rr.Code, rr.Body.String())
	}
}
