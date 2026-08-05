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
	"strings"
	"testing"
	"time"
)

// --- request/response helpers -----------------------------------------

func doArtifact(t *testing.T, srv string, method, path string, body io.Reader, contentType string) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, srv+path, body)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
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

// decodeArtifactJSON asserts resp's Content-Type is application/json (never
// plain text, per S19's acceptance criterion) and unmarshals its body into
// v.
func decodeArtifactJSON(t *testing.T, resp *http.Response, v any) {
	t.Helper()
	defer func() { _ = resp.Body.Close() }()
	ct := resp.Header.Get("Content-Type")
	if !strings.HasPrefix(ct, "application/json") {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("Content-Type = %q, want application/json; body=%s", ct, body)
	}
	if err := json.NewDecoder(resp.Body).Decode(v); err != nil {
		t.Fatalf("decode response body: %v", err)
	}
}

func requireArtifactStatus(t *testing.T, resp *http.Response, want int) {
	t.Helper()
	if resp.StatusCode != want {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status = %d, want %d; body=%s", resp.StatusCode, want, body)
	}
}

func requireArtifactErrorCode(t *testing.T, resp *http.Response, wantStatus int, wantCode string) artifactErrorEnvelope {
	t.Helper()
	requireArtifactStatus(t, resp, wantStatus)
	var env artifactErrorEnvelope
	decodeArtifactJSON(t, resp, &env)
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
	requireArtifactStatus(t, resp, http.StatusOK)
	var b artifactBucket
	decodeArtifactJSON(t, resp, &b)
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
	decodeArtifactJSON(t, getResp, &got)
	requireArtifactStatus(t, getResp, http.StatusOK)
	if got.Name != "reports" {
		t.Fatalf("GetBucket name = %q, want reports", got.Name)
	}

	listResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/buckets/%d", projectID), nil, "")
	var listed struct {
		Buckets []artifactBucket `json:"buckets"`
	}
	decodeArtifactJSON(t, listResp, &listed)
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
	decodeArtifactJSON(t, patchResp, &patched)
	requireArtifactStatus(t, patchResp, http.StatusOK)
	if !patched.IsPinned {
		t.Fatalf("UpdateBucket is_pinned = %v, want true", patched.IsPinned)
	}
	if !strings.Contains(string(patched.Tags), `"env":"prod"`) {
		t.Fatalf("UpdateBucket tags = %s, want to contain env=prod", patched.Tags)
	}

	retentionResp := doArtifactJSON(t, srv, http.MethodPatch, fmt.Sprintf("/api/v2/artifacts/buckets/%d/reports", projectID),
		map[string]any{"retention_days": 30})
	var withRetention artifactBucket
	decodeArtifactJSON(t, retentionResp, &withRetention)
	requireArtifactStatus(t, retentionResp, http.StatusOK)
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
	decodeArtifactJSON(t, uploadResp, &uploaded)
	requireArtifactStatus(t, uploadResp, http.StatusCreated)
	if uploaded.Key != "bigfile.bin" || uploaded.SizeBytes != int64(len(content)) {
		t.Fatalf("UploadObject = %+v, want key=bigfile.bin size_bytes=%d", uploaded, len(content))
	}

	downloadResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	requireArtifactStatus(t, downloadResp, http.StatusOK)
	got, err := io.ReadAll(downloadResp.Body)
	_ = downloadResp.Body.Close()
	if err != nil {
		t.Fatalf("read download body: %v", err)
	}
	if gotDigest := sha256.Sum256(got); gotDigest != wantDigest {
		t.Fatalf("downloaded object digest mismatch: got %x, want %x", gotDigest, wantDigest)
	}

	headResp := doArtifact(t, srv, http.MethodHead, fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil, "")
	requireArtifactStatus(t, headResp, http.StatusOK)
	if cl := headResp.Header.Get("Content-Length"); cl != fmt.Sprint(len(content)) {
		t.Fatalf("HEAD Content-Length = %q, want %d", cl, len(content))
	}

	rangeReq, _ := http.NewRequest(http.MethodGet, srv+fmt.Sprintf("/api/v2/artifacts/objects/%d/objects1/bigfile.bin", projectID), nil)
	rangeReq.Header.Set("Range", "bytes=0-99")
	rangeResp, err := http.DefaultClient.Do(rangeReq)
	if err != nil {
		t.Fatalf("range GET: %v", err)
	}
	requireArtifactStatus(t, rangeResp, http.StatusPartialContent)
	rangeBody, _ := io.ReadAll(rangeResp.Body)
	_ = rangeResp.Body.Close()
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
	decodeArtifactJSON(t, delimResp, &delimListed)
	requireArtifactStatus(t, delimResp, http.StatusOK)
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

	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 10; page++ {
		path := fmt.Sprintf("/api/v2/artifacts/objects/%d/listing1?prefix=a/&limit=2", projectID)
		if cursor != "" {
			path += "&cursor=" + cursor
		}
		resp := doArtifact(t, srv, http.MethodGet, path, nil, "")
		var listed struct {
			Objects    []struct{ Key string } `json:"objects"`
			NextCursor string                 `json:"next_cursor"`
		}
		decodeArtifactJSON(t, resp, &listed)
		requireArtifactStatus(t, resp, http.StatusOK)
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
	decodeArtifactJSON(t, resp, &result)
	requireArtifactStatus(t, resp, http.StatusOK)

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
	decodeArtifactJSON(t, grantResp, &grant)
	requireArtifactStatus(t, grantResp, http.StatusOK)
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
	decodeArtifactJSON(t, commitResp, &committed)
	requireArtifactStatus(t, commitResp, http.StatusOK)
	if committed.Key != grant.GrantID || committed.SizeBytes != int64(len(content)) {
		t.Fatalf("CommitTransferGrant = %+v, want key=%s size_bytes=%d", committed, grant.GrantID, len(content))
	}

	downloadResp := doArtifact(t, srv, http.MethodGet, fmt.Sprintf("/api/v2/artifacts/objects/%d/grants1/%s", projectID, grant.GrantID), nil, "")
	requireArtifactStatus(t, downloadResp, http.StatusOK)
	got, _ := io.ReadAll(downloadResp.Body)
	_ = downloadResp.Body.Close()
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
	decodeArtifactJSON(t, grantResp, &grant)
	requireArtifactStatus(t, grantResp, http.StatusOK)

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
	decodeArtifactJSON(t, grantResp, &grant)
	requireArtifactStatus(t, grantResp, http.StatusOK)

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
	decodeArtifactJSON(t, grantResp, &grant)
	requireArtifactStatus(t, grantResp, http.StatusOK)
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
		decodeArtifactJSON(t, grantResp, &grant)
		requireArtifactStatus(t, grantResp, http.StatusOK)

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
