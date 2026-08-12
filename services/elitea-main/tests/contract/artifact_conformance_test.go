package contract

// S19: the self-contained TestArtifact* conformance suite — real router,
// real Postgres, real S3-compatible backend (see artifact_harness_test.go).
// Every test calls requireArtifactSuite(t) first and uses its own project
// ID (nextArtifactProjectID) so tests never interfere with each other on
// the one shared harness.

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"
)

// --- request/response helpers -----------------------------------------

// artifactAuthToken is the credential artifactContractValidator accepts. Only
// requests addressed to the router carry it — presigned upload/download URLs
// point at the object store, which is not behind Auth and would reject or
// misinterpret an Authorization header (it conflicts with S3 SigV4 query
// signing). Those call http.NewRequest directly, on purpose.
const artifactAuthToken = "artifact-contract-token"

func doArtifact(t *testing.T, srv string, method, path string, body io.Reader, contentType string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv+path, body)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+artifactAuthToken)
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("%s %s: %v", method, path, err)
	}
	return resp
}

func doArtifactJSON(t *testing.T, srv, method, path string, body any) *http.Response {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal request body: %v", err)
		}
		r = bytes.NewReader(b)
	}
	return doArtifact(t, srv, method, path, r, "application/json")
}

type artifactErrorEnvelope struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

// requireArtifactStatus, requireArtifactJSON, and requireArtifactBody all
// read resp.Body exactly once, close it exactly once, and check StatusCode
// before anything else — a single-read design that closes two
// adversarial-review findings at once: the previous two-call
// decode-then-status pattern used everywhere in this file left every
// successful status-only check leaking its HTTP connection
// (decodeArtifactJSON's own Close never ran for those), and every
// decode-then-status pair lost the response body from its failure message
// (decodeArtifactJSON's Close ran first, so a subsequent status mismatch
// read from an already-drained body). Call requireArtifactJSON instead of
// requireArtifactStatus whenever the body needs JSON decoding, or
// requireArtifactBody when it needs the raw bytes (object downloads, range
// reads) — do not call any of the three a second time on the same
// *http.Response, or manually io.ReadAll it afterward: the first call to
// touch the body consumes and closes it, and every later read fails with
// "http: read on closed response body" (confirmed the hard way — this was
// the exact bug this doc comment now warns against, caught empirically by
// running this suite against real Postgres+RustFS after this file's
// decodeArtifactJSON→requireArtifactJSON migration, not by inspection).
func requireArtifactStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	requireArtifactJSON(t, resp, want, nil)
}

// requireArtifactBody is requireArtifactStatus's raw-bytes counterpart for
// binary/non-JSON payloads (object downloads, range reads), which
// requireArtifactJSON's automatic Content-Type/JSON-decode check does not
// fit.
func requireArtifactBody(t *testing.T, resp *http.Response, want int) []byte {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if resp.StatusCode != want {
		t.Fatalf("status = %d, want %d; body=%s", resp.StatusCode, want, body)
	}
	return body
}

// requireArtifactJSON checks resp's status and Content-Type (never plain
// text, per S19's acceptance criterion), then unmarshals its body into v —
// unless v is nil, for a status-only check that still wants this function's
// single-read-and-close behavior.
func requireArtifactJSON(t *testing.T, resp *http.Response, want int, v any) {
	t.Helper()
	body, err := io.ReadAll(resp.Body)
	_ = resp.Body.Close()
	if err != nil {
		t.Fatalf("read response body: %v", err)
	}
	if resp.StatusCode != want {
		t.Fatalf("status = %d, want %d; body=%s", resp.StatusCode, want, body)
	}
	if v == nil {
		return
	}
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		t.Fatalf("Content-Type = %q, want application/json; body=%s", ct, body)
	}
	if err := json.Unmarshal(body, v); err != nil {
		t.Fatalf("decode response body: %v; body=%s", err, body)
	}
}

func requireArtifactErrorCode(t *testing.T, resp *http.Response, wantStatus int, wantCode string) artifactErrorEnvelope {
	t.Helper()
	var env artifactErrorEnvelope
	requireArtifactJSON(t, resp, wantStatus, &env)
	if env.Error.Code != wantCode {
		t.Fatalf("error.code = %q, want %q", env.Error.Code, wantCode)
	}
	return env
}

type artifactBucket struct {
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

func mustCreateArtifactBucket(t *testing.T, srv string, projectID int64, name string) artifactBucket {
	t.Helper()
	resp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID),
		map[string]any{"name": name})
	var b artifactBucket
	requireArtifactJSON(t, resp, http.StatusOK, &b)
	return b
}

// uploadArtifactObject uploads content as a multipart "file" part named
// filename — the same raw Content-Disposition mechanism objects.go's
// UploadObject actually parses (see its own doc comment on why it is not
// part.FileName()), which lets tests exercise a filename storage.NewObjectRef
// itself would reject (a raw ".." segment, a leading slash, a control
// character) without any URL-encoding ambiguity a request-path-based
// attempt would introduce.
func uploadArtifactObject(t *testing.T, srv string, projectID int64, bucket, filename string, content []byte, overwrite bool) *http.Response {
	t.Helper()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", filename)
	if err != nil {
		t.Fatalf("create multipart form file: %v", err)
	}
	if _, err := part.Write(content); err != nil {
		t.Fatalf("write multipart form file: %v", err)
	}
	if err := mw.Close(); err != nil {
		t.Fatalf("close multipart writer: %v", err)
	}
	path := fmt.Sprintf("/api/v2/artifacts/objects/%d/%s", projectID, bucket)
	if overwrite {
		path += "?overwrite=true"
	}
	return doArtifact(t, srv, http.MethodPost, path, &buf, mw.FormDataContentType())
}

// --- scenarios -----------------------------------------------------------

func TestArtifactBucketLifecycle(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()

	created := mustCreateArtifactBucket(t, srv, projectID, "reports")
	if created.Name != "reports" || created.IsPinned || created.SizeBytes != 0 || created.ObjectCount != 0 {
		t.Fatalf("created bucket = %+v, want a fresh unpinned empty bucket named reports", created)
	}

	getResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID), nil, "")
	var got artifactBucket
	requireArtifactJSON(t, getResp, http.StatusOK, &got)
	if got.Name != "reports" {
		t.Fatalf("GetBucket name = %q, want reports", got.Name)
	}

	listResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID), nil, "")
	var listed struct {
		Buckets []artifactBucket `json:"buckets"`
	}
	requireArtifactJSON(t, listResp, http.StatusOK, &listed)
	found := false
	for _, b := range listed.Buckets {
		if b.Name == "reports" {
			found = true
		}
	}
	if !found {
		t.Fatalf("ListBuckets = %+v, want it to contain reports", listed.Buckets)
	}

	patchResp := doArtifactJSON(t, srv, http.MethodPatch, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID),
		map[string]any{"is_pinned": true, "tags": map[string]string{"env": "prod"}})
	var patched artifactBucket
	requireArtifactJSON(t, patchResp, http.StatusOK, &patched)
	if !patched.IsPinned {
		t.Fatalf("UpdateBucket is_pinned = %v, want true", patched.IsPinned)
	}
	if !strings.Contains(string(patched.Tags), `"env":"prod"`) {
		t.Fatalf("UpdateBucket tags = %s, want to contain env=prod", patched.Tags)
	}

	retentionResp := doArtifactJSON(t, srv, http.MethodPatch, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID),
		map[string]any{"retention_days": 30})
	var withRetention artifactBucket
	requireArtifactJSON(t, retentionResp, http.StatusOK, &withRetention)
	if withRetention.RetentionDays == nil || *withRetention.RetentionDays != 30 || withRetention.ExpiresAt == nil {
		t.Fatalf("UpdateBucket retention = %+v, want retention_days=30 with a computed expires_at", withRetention)
	}

	delResp := doArtifact(t, srv, http.MethodDelete, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID), nil, "")
	requireArtifactStatus(t, delResp, http.StatusNoContent)

	goneResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID), nil, "")
	requireArtifactErrorCode(t, goneResp, http.StatusNotFound, "NotFound")
}

func TestArtifactBucketNameRejection(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()

	cases := []struct {
		desc string
		name string
	}{
		{"uppercase", "Reports"},
		{"leading digit", "1reports"},
		{"underscore", "re_ports"},
		{"63-plus characters", strings.Repeat("a", 64)},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			resp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID),
				map[string]any{"name": c.name})
			requireArtifactErrorCode(t, resp, http.StatusBadRequest, "InvalidArgument")
		})
	}
}

func TestArtifactBucketRetentionAboveProjectLimitReturns403(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()

	if _, err := artifactPool.Exec(context.Background(),
		`INSERT INTO elitea_storage.project_storage_policy (project_id, retention_max_days) VALUES ($1, 10)`,
		projectID); err != nil {
		t.Fatalf("seed project_storage_policy: %v", err)
	}

	resp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID),
		map[string]any{"name": "overretained", "retention_days": 20})
	requireArtifactErrorCode(t, resp, http.StatusForbidden, "QuotaExceeded")
}

func TestArtifactObjectUploadDownloadHeadDeleteRangeRead(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "objects1")

	const fiveMiB = 5 << 20
	pattern := []byte("elitea-artifact-conformance-")
	content := bytes.Repeat(pattern, fiveMiB/len(pattern)+1)[:fiveMiB]
	wantDigest := sha256.Sum256(content)

	uploadResp := uploadArtifactObject(t, srv, projectID, "objects1", "bigfile.bin", content, false)
	var uploaded struct {
		Key       string `json:"key"`
		SizeBytes int64  `json:"size_bytes"`
	}
	requireArtifactJSON(t, uploadResp, http.StatusCreated, &uploaded)
	if uploaded.Key != "bigfile.bin" || uploaded.SizeBytes != int64(len(content)) {
		t.Fatalf("UploadObject = %+v, want key=bigfile.bin size_bytes=%d", uploaded, len(content))
	}

	downloadResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	got := requireArtifactBody(t, downloadResp, http.StatusOK)
	if gotDigest := sha256.Sum256(got); gotDigest != wantDigest {
		t.Fatalf("downloaded object digest mismatch: got %x, want %x", gotDigest, wantDigest)
	}

	headResp := doArtifact(t, srv, http.MethodHead, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	requireArtifactStatus(t, headResp, http.StatusOK)
	if cl := headResp.Header.Get("Content-Length"); cl != fmt.Sprint(len(content)) {
		t.Fatalf("HEAD Content-Length = %q, want %d", cl, len(content))
	}

	rangeReq, _ := http.NewRequest(http.MethodGet, srv+fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil)
	rangeReq.Header.Set("Authorization", "Bearer "+artifactAuthToken)
	rangeReq.Header.Set("Range", "bytes=0-99")
	rangeResp, err := http.DefaultClient.Do(rangeReq)
	if err != nil {
		t.Fatalf("range GET: %v", err)
	}
	rangeBody := requireArtifactBody(t, rangeResp, http.StatusPartialContent)
	if len(rangeBody) != 100 || !bytes.Equal(rangeBody, content[:100]) {
		t.Fatalf("range GET returned %d bytes, want the first 100 bytes unmodified", len(rangeBody))
	}

	delResp := doArtifact(t, srv, http.MethodDelete, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	requireArtifactStatus(t, delResp, http.StatusNoContent)

	goneResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	requireArtifactErrorCode(t, goneResp, http.StatusNotFound, "NotFound")
}

func TestArtifactObjectUploadOverwriteFalseConflicts(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "overwrite1")

	first := uploadArtifactObject(t, srv, projectID, "overwrite1", "dup.txt", []byte("v1"), false)
	requireArtifactStatus(t, first, http.StatusCreated)

	conflict := uploadArtifactObject(t, srv, projectID, "overwrite1", "dup.txt", []byte("v2"), false)
	requireArtifactErrorCode(t, conflict, http.StatusConflict, "AlreadyExists")

	replaced := uploadArtifactObject(t, srv, projectID, "overwrite1", "dup.txt", []byte("v2"), true)
	requireArtifactStatus(t, replaced, http.StatusCreated)
}

func TestArtifactObjectListWithPrefixAndDelimiterPaginates(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "listing1")

	keys := []string{"a/1.txt", "a/2.txt", "a/3.txt", "b/1.txt", "top.txt"}
	for _, k := range keys {
		resp := uploadArtifactObject(t, srv, projectID, "listing1", k, []byte(k), false)
		requireArtifactStatus(t, resp, http.StatusCreated)
	}

	delimResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/listing1?delimiter=/", projectID), nil, "")
	var delimListed struct {
		Objects        []struct{ Key string } `json:"objects"`
		CommonPrefixes []string               `json:"common_prefixes"`
	}
	requireArtifactJSON(t, delimResp, http.StatusOK, &delimListed)
	if len(delimListed.Objects) != 1 || delimListed.Objects[0].Key != "top.txt" {
		t.Fatalf("delimiter listing objects = %+v, want exactly [top.txt]", delimListed.Objects)
	}
	wantPrefixes := map[string]bool{"a/": true, "b/": true}
	if len(delimListed.CommonPrefixes) != len(wantPrefixes) {
		t.Fatalf("delimiter listing common_prefixes = %v, want %v", delimListed.CommonPrefixes, wantPrefixes)
	}
	for _, p := range delimListed.CommonPrefixes {
		if !wantPrefixes[p] {
			t.Fatalf("unexpected common_prefix %q", p)
		}
	}

	const pageLimit = 2
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 10; page++ {
		path := fmt.Sprintf("/api/v2/artifacts/objects/%d/listing1?prefix=a/&limit=%d", projectID, pageLimit)
		if cursor != "" {
			// url.QueryEscape, not raw concatenation: an adversarial-review
			// finding confirmed next_cursor is a backend-opaque,
			// commonly base64-shaped token (S3's NextContinuationToken,
			// passed through verbatim) that can legitimately contain '+',
			// '&', or '=' — any of which corrupts the reconstructed query
			// string if appended raw.
			path += "&cursor=" + url.QueryEscape(cursor)
		}
		resp := doArtifact(t, srv, http.MethodGet, path, nil, "")
		var listed struct {
			Objects    []struct{ Key string } `json:"objects"`
			NextCursor string                 `json:"next_cursor"`
		}
		requireArtifactJSON(t, resp, http.StatusOK, &listed)
		// A regression that silently ignores the limit query parameter
		// (returning everything on one page) would still pass the
		// no-duplicates/no-gaps assertions below on its own — confirmed
		// empirically by adversarial review, which patched ListObjects to
		// discard limit and reran only this test: it still reported PASS,
		// because the accumulated `seen` set matched after a single
		// now-unbounded page. This per-page ceiling is what actually
		// proves limit was honored.
		if len(listed.Objects) > pageLimit {
			t.Fatalf("page %d returned %d objects, want at most %d (limit=%d) — is the limit query parameter being ignored?", page, len(listed.Objects), pageLimit, pageLimit)
		}
		for _, o := range listed.Objects {
			if seen[o.Key] {
				t.Fatalf("pagination returned duplicate key %q", o.Key)
			}
			seen[o.Key] = true
		}
		if listed.NextCursor == "" {
			break
		}
		cursor = listed.NextCursor
	}
	want := []string{"a/1.txt", "a/2.txt", "a/3.txt"}
	if len(seen) != len(want) {
		t.Fatalf("pagination collected %v, want exactly %v (no gaps)", seen, want)
	}
	for _, k := range want {
		if !seen[k] {
			t.Fatalf("pagination never returned %q — gap in results", k)
		}
	}
}

func TestArtifactObjectBatchDeleteMixedPresentAbsent(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "batchdel1")

	for _, k := range []string{"present1.txt", "present2.txt"} {
		resp := uploadArtifactObject(t, srv, projectID, "batchdel1", k, []byte("x"), false)
		requireArtifactStatus(t, resp, http.StatusCreated)
	}

	resp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/objects/%d/batchdel1:batchDelete", projectID),
		map[string]any{"keys": []string{"present1.txt", "present2.txt", "missing.txt"}})
	var result struct {
		Deleted []string `json:"deleted"`
		Failed  []struct {
			Key     string `json:"key"`
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"failed"`
	}
	requireArtifactJSON(t, resp, http.StatusOK, &result)

	accounted := map[string]bool{}
	for _, k := range result.Deleted {
		accounted[k] = true
	}
	for _, f := range result.Failed {
		accounted[f.Key] = true
	}
	for _, k := range []string{"present1.txt", "present2.txt", "missing.txt"} {
		if !accounted[k] {
			t.Fatalf("batch delete result %+v does not account for key %q", result, k)
		}
	}
	if !contains(result.Deleted, "present1.txt") || !contains(result.Deleted, "present2.txt") {
		t.Fatalf("batch delete result = %+v, want present1.txt and present2.txt in deleted", result)
	}

	emptyResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/objects/%d/batchdel1:batchDelete", projectID),
		map[string]any{"keys": []string{}})
	requireArtifactErrorCode(t, emptyResp, http.StatusBadRequest, "InvalidArgument")
}

func contains(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}

// transferGrantResponse mirrors internal/api/v2/artifacts's own (unexported)
// response shape.
type transferGrantResponse struct {
	GrantID     string    `json:"grant_id"`
	URL         string    `json:"url"`
	Method      string    `json:"method"`
	ExpiresAt   time.Time `json:"expires_at"`
	ContentType string    `json:"content_type"`
	MaxBytes    int64     `json:"max_bytes"`
	UploadID    *string   `json:"upload_id"`
}

func TestArtifactGrantPresignedUploadAndCommitRoundTrip(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "grants1")

	content := []byte("elitea artifact transfer grant round trip payload")
	digest := sha256.Sum256(content)
	contentType := "application/octet-stream"

	grantResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/grants1", projectID),
		map[string]any{
			"method":       "PUT",
			"content_type": contentType,
			"max_bytes":    4096,
			"digest_alg":   "sha256",
			"digest":       hex.EncodeToString(digest[:]),
		})
	var grant transferGrantResponse
	requireArtifactJSON(t, grantResp, http.StatusOK, &grant)
	if grant.URL == "" || grant.UploadID != nil {
		t.Fatalf("CreateTransferGrant = %+v, want a presigned url and no upload_id (below the multipart threshold)", grant)
	}

	putReq, err := http.NewRequest(http.MethodPut, grant.URL, bytes.NewReader(content))
	if err != nil {
		t.Fatalf("build presigned PUT: %v", err)
	}
	putReq.Header.Set("Content-Type", contentType)
	putReq.ContentLength = int64(len(content))
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("presigned PUT: %v", err)
	}
	_ = putResp.Body.Close()
	if putResp.StatusCode/100 != 2 {
		t.Fatalf("presigned PUT status = %d, want 2xx", putResp.StatusCode)
	}

	commitResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:commit", projectID, grant.GrantID), nil)
	var committed struct {
		Key       string `json:"key"`
		SizeBytes int64  `json:"size_bytes"`
		MediaType string `json:"media_type"`
	}
	requireArtifactJSON(t, commitResp, http.StatusOK, &committed)
	if committed.Key != grant.GrantID || committed.SizeBytes != int64(len(content)) {
		t.Fatalf("CommitTransferGrant = %+v, want key=%s size_bytes=%d", committed, grant.GrantID, len(content))
	}

	downloadResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/grants1/%s", projectID, grant.GrantID), nil, "")
	got := requireArtifactBody(t, downloadResp, http.StatusOK)
	if !bytes.Equal(got, content) {
		t.Fatalf("downloaded committed object = %q, want %q", got, content)
	}
}

func TestArtifactGrantCommitDigestMismatchReturns409(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "grants2")

	wrongDigest := sha256.Sum256([]byte("this is not what gets uploaded"))
	contentType := "application/octet-stream"

	grantResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/grants2", projectID),
		map[string]any{
			"method":       "PUT",
			"content_type": contentType,
			"max_bytes":    4096,
			"digest_alg":   "sha256",
			"digest":       hex.EncodeToString(wrongDigest[:]),
		})
	var grant transferGrantResponse
	requireArtifactJSON(t, grantResp, http.StatusOK, &grant)

	putReq, _ := http.NewRequest(http.MethodPut, grant.URL, strings.NewReader("actual uploaded content"))
	putReq.Header.Set("Content-Type", contentType)
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("presigned PUT: %v", err)
	}
	_ = putResp.Body.Close()

	commitResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:commit", projectID, grant.GrantID), nil)
	requireArtifactErrorCode(t, commitResp, http.StatusConflict, "DigestMismatch")
}

// TestArtifactGrantCommitMediaTypeMismatchReturns409 uploads through the
// presigned PUT without the Content-Type header the grant declared —
// finalizeGrantCommit's own doc comment names this exact scenario
// ("a client's out-of-band presigned PUT omits the Content-Type header
// entirely") as the real-world case the check exists to catch. Whether
// RustFS's presign implementation actually accepts a PUT missing a header
// s3.Backend.PresignPut signed is verified empirically here, not assumed —
// see the plan's S19 section for what was found.
func TestArtifactGrantCommitMediaTypeMismatchReturns409(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "grants3")

	grantResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/grants3", projectID),
		map[string]any{"method": "PUT", "content_type": "application/json", "max_bytes": 4096})
	var grant transferGrantResponse
	requireArtifactJSON(t, grantResp, http.StatusOK, &grant)

	putReq, _ := http.NewRequest(http.MethodPut, grant.URL, strings.NewReader(`{"not":"checked"}`))
	// Deliberately no Content-Type header.
	putResp, err := http.DefaultClient.Do(putReq)
	if err != nil {
		t.Fatalf("presigned PUT: %v", err)
	}
	_ = putResp.Body.Close()
	if putResp.StatusCode/100 != 2 {
		t.Skipf("presigned PUT without Content-Type rejected with status %d — RustFS enforces the grant's signed Content-Type header, so this backend cannot reproduce a stored media-type mismatch through the presigned-URL path", putResp.StatusCode)
	}

	commitResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:commit", projectID, grant.GrantID), nil)
	requireArtifactErrorCode(t, commitResp, http.StatusConflict, "MediaTypeMismatch")
}

func TestArtifactKeyRejection(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectID := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectID, "keyreject1")

	cases := []struct {
		desc     string
		filename string
	}{
		{"dot-dot segment", "a/../escape.txt"},
		{"leading slash", "/leading.txt"},
	}
	for _, c := range cases {
		t.Run(c.desc, func(t *testing.T) {
			resp := uploadArtifactObject(t, srv, projectID, "keyreject1", c.filename, []byte("x"), false)
			requireArtifactErrorCode(t, resp, http.StatusBadRequest, "InvalidKey")
		})
	}

	// The control-character case cannot be driven through the upload path
	// above: a raw control byte in a multipart Content-Disposition filename
	// fails Go's own mime.ParseMediaType before UploadObject ever reaches
	// storage.NewObjectRef, surfacing as InvalidArgument (the
	// Content-Disposition parse failure), not InvalidKey — a different,
	// earlier, equally-defensive 400, but not the code this case is
	// exercising. The download path parses the key straight off the URL
	// with no MIME header in between, reaching validateKey directly.
	t.Run("control character", func(t *testing.T) {
		resp := doArtifact(t, srv, http.MethodGet,
			fmt.Sprintf("/api/v2/artifacts/objects/%d/keyreject1/bad%%01name.txt", projectID), nil, "")
		requireArtifactErrorCode(t, resp, http.StatusBadRequest, "InvalidKey")
	})

	// The same validator on the read path, exercised via a raw URL path
	// rather than a multipart filename — proves both ingress points share
	// storage.NewObjectRef's validateKey, not two independently-maintained
	// checks.
	rawTraversalResp := doArtifact(t, srv, http.MethodGet,
		fmt.Sprintf("/api/v2/artifacts/objects/%d/keyreject1/../escape.txt", projectID), nil, "")
	requireArtifactErrorCode(t, rawTraversalResp, http.StatusBadRequest, "InvalidKey")
}

func TestArtifactCrossProjectMultipartAccessReturns403(t *testing.T) {
	srv := requireArtifactSuite(t).URL
	projectA := nextArtifactProjectID()
	projectB := nextArtifactProjectID()
	mustCreateArtifactBucket(t, srv, projectA, "multipart1")

	grantResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/multipart1", projectA),
		map[string]any{
			"method":       "PUT",
			"content_type": "application/octet-stream",
			"max_bytes":    70 << 20, // above multipartThreshold (64 MiB)
		})
	var grant transferGrantResponse
	requireArtifactJSON(t, grantResp, http.StatusOK, &grant)
	if grant.UploadID == nil {
		t.Fatalf("CreateTransferGrant = %+v, want a native multipart upload_id above the 64 MiB threshold", grant)
	}

	presignPath := fmt.Sprintf("/api/v2/artifacts/grants/%d/%s/parts/1", projectB, grant.GrantID)
	requireArtifactErrorCode(t, doArtifactJSON(t, srv, http.MethodPost, presignPath, nil), http.StatusForbidden, "AccessDenied")

	completePath := fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:completeMultipart", projectB, grant.GrantID)
	requireArtifactErrorCode(t, doArtifactJSON(t, srv, http.MethodPost, completePath, map[string]any{
		"parts": []map[string]any{{"part_number": 1, "etag": "\"deadbeef\""}},
	}), http.StatusForbidden, "AccessDenied")

	abortPath := fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:abortMultipart", projectB, grant.GrantID)
	requireArtifactErrorCode(t, doArtifactJSON(t, srv, http.MethodPost, abortPath, nil), http.StatusForbidden, "AccessDenied")

	// Clean up the live RustFS multipart session under the grant's real
	// project so this test does not leak a backend-side upload session —
	// S14's own lifecycle rule would eventually reclaim it, but there is no
	// reason to rely on that here.
	realAbortPath := fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:abortMultipart", projectA, grant.GrantID)
	requireArtifactStatus(t, doArtifactJSON(t, srv, http.MethodPost, realAbortPath, nil), http.StatusNoContent)
}

func TestArtifactErrorEnvelopeCoversRemainingCodes(t *testing.T) {
	srv := requireArtifactSuite(t).URL

	t.Run("TooLarge", func(t *testing.T) {
		projectID := nextArtifactProjectID()
		mustCreateArtifactBucket(t, srv, projectID, "toolarge1")
		if _, err := artifactPool.Exec(context.Background(),
			`INSERT INTO elitea_storage.project_storage_policy (project_id, max_object_bytes) VALUES ($1, 10)`,
			projectID); err != nil {
			t.Fatalf("seed project_storage_policy: %v", err)
		}
		resp := uploadArtifactObject(t, srv, projectID, "toolarge1", "big.bin", bytes.Repeat([]byte("x"), 1024), false)
		requireArtifactErrorCode(t, resp, http.StatusRequestEntityTooLarge, "TooLarge")
	})

	t.Run("PreconditionFailed", func(t *testing.T) {
		projectID := nextArtifactProjectID()
		mustCreateArtifactBucket(t, srv, projectID, "expired1")
		grantResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/expired1", projectID),
			map[string]any{"method": "PUT", "content_type": "text/plain", "max_bytes": 1024})
		var grant transferGrantResponse
		requireArtifactJSON(t, grantResp, http.StatusOK, &grant)

		if _, err := artifactPool.Exec(context.Background(),
			`UPDATE elitea_storage.transfer_grants SET expires_at = now() - interval '1 hour' WHERE id = $1::uuid`,
			grant.GrantID); err != nil {
			t.Fatalf("force grant expiry: %v", err)
		}

		commitResp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/grants/%d/%s:commit", projectID, grant.GrantID), nil)
		requireArtifactErrorCode(t, commitResp, http.StatusPreconditionFailed, "PreconditionFailed")
	})

	t.Run("AlreadyExists on duplicate bucket", func(t *testing.T) {
		projectID := nextArtifactProjectID()
		mustCreateArtifactBucket(t, srv, projectID, "dupbucket")
		resp := doArtifactJSON(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID),
			map[string]any{"name": "dupbucket"})
		requireArtifactErrorCode(t, resp, http.StatusConflict, "AlreadyExists")
	})

	t.Run("InvalidArgument on malformed body", func(t *testing.T) {
		projectID := nextArtifactProjectID()
		resp := doArtifact(t, srv, http.MethodPost, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID),
			strings.NewReader("not json"), "application/json")
		requireArtifactErrorCode(t, resp, http.StatusBadRequest, "InvalidArgument")
	})
}
