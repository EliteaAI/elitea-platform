package artifacts_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"

	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/api/v2/artifacts"
)

// These tests pin the S3-shaped listing the SDK's artifact toolkit consumes.
//
// They deliberately decode into map[string]any rather than a struct with
// json tags: a struct would silently accept a renamed or re-cased field
// (encoding/json just leaves the zero value), which is precisely the
// regression that produced the original defect — a listing that decodes to
// "no files" makes an index run report success having indexed nothing. Only
// asserting on the raw key set catches that.

func newS3TestRouter(h *artifacts.Handler) chi.Router {
	r := chi.NewRouter()
	r.Get("/artifacts/s3/{bucket}", h.ListObjectsS3)
	return r
}

// getS3Listing performs the request and returns the decoded body as a raw
// map, so tests can assert on exact key names.
func getS3Listing(t *testing.T, h *artifacts.Handler, target string) (int, map[string]any) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, target, nil)
	rr := httptest.NewRecorder()
	newS3TestRouter(h).ServeHTTP(rr, req)

	var body map[string]any
	if err := json.Unmarshal(rr.Body.Bytes(), &body); err != nil {
		t.Fatalf("response is not JSON: %v (body=%s)", err, rr.Body.String())
	}
	return rr.Code, body
}

// TestListObjectsS3_UsesExactSDKKeyNames is the shape-regression guard. It
// asserts the camelCase envelope and item field names the SDK reads by exact
// name (elitea-sdk runtime/clients/artifact.py:123-127, :203-217) and, just
// as importantly, that the native route's snake_case names are NOT what this
// route emits — the two representations share a query but must not share a
// vocabulary.
func TestListObjectsS3_UsesExactSDKKeyNames(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.seed("1", "reports", "a.png", 10)

	code, body := getS3Listing(t, h, "/artifacts/s3/reports?project_id=1&format=json&list-type=2")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%v", code, body)
	}

	if _, ok := body["contents"]; !ok {
		t.Fatalf(`response has no "contents" key; keys=%v`, keysOf(body))
	}
	if _, ok := body["commonPrefixes"]; !ok {
		t.Fatalf(`response has no "commonPrefixes" key; keys=%v`, keysOf(body))
	}
	// The native route's names must not leak into this representation.
	for _, forbidden := range []string{"objects", "common_prefixes"} {
		if _, ok := body[forbidden]; ok {
			t.Errorf("response carries native-route key %q; the SDK reads camelCase only", forbidden)
		}
	}

	contents, ok := body["contents"].([]any)
	if !ok || len(contents) != 1 {
		t.Fatalf("contents = %v, want exactly 1 entry", body["contents"])
	}
	item, ok := contents[0].(map[string]any)
	if !ok {
		t.Fatalf("contents[0] is not an object: %v", contents[0])
	}
	// Every field the SDK reads, by exact name and with the right value.
	if got := item["key"]; got != "a.png" {
		t.Errorf(`item["key"] = %v, want "a.png"`, got)
	}
	if got := item["size"]; got != float64(10) {
		t.Errorf(`item["size"] = %v, want 10`, got)
	}
	if _, ok := item["lastModified"]; !ok {
		t.Errorf(`item has no "lastModified" key; keys=%v`, keysOf(item))
	}
	for _, forbidden := range []string{"size_bytes", "modified_at", "last_modified", "LastModified"} {
		if _, ok := item[forbidden]; ok {
			t.Errorf("item carries %q; the SDK reads lastModified/size only", forbidden)
		}
	}
}

// TestListObjectsS3_EmptyBucketEmitsArraysNotNull proves an empty listing is
// [] rather than null. The SDK reads result.get('contents', []) and iterates
// it — a JSON null decodes to Python None and raises on iteration instead of
// yielding an empty listing.
func TestListObjectsS3_EmptyBucketEmitsArraysNotNull(t *testing.T) {
	h, _, _ := newObjectTestHandler(t)

	code, body := getS3Listing(t, h, "/artifacts/s3/reports?project_id=1&list-type=2")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%v", code, body)
	}
	for _, key := range []string{"contents", "commonPrefixes"} {
		v, ok := body[key].([]any)
		if !ok {
			t.Fatalf("%s = %v (%T), want an array", key, body[key], body[key])
		}
		if len(v) != 0 {
			t.Errorf("%s = %v, want empty", key, v)
		}
	}
}

// TestListObjectsS3_DelimiterGroupsFolders covers the folder-listing call the
// SDK makes: prefix with a trailing slash plus delimiter=/. Nested keys must
// roll up into commonPrefixes as plain strings (the shape this route commits
// to) and must NOT appear in contents.
func TestListObjectsS3_DelimiterGroupsFolders(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.seed("1", "reports", "docs/top.txt", 5)
	store.seed("1", "reports", "docs/nested/deep.txt", 7)

	code, body := getS3Listing(t, h, "/artifacts/s3/reports?project_id=1&list-type=2&prefix=docs%2F&delimiter=%2F")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%v", code, body)
	}

	contents, _ := body["contents"].([]any)
	if len(contents) != 1 {
		t.Fatalf("contents = %v, want only the non-nested key", body["contents"])
	}
	if got := contents[0].(map[string]any)["key"]; got != "docs/top.txt" {
		t.Errorf("listed key = %v, want docs/top.txt", got)
	}

	prefixes, _ := body["commonPrefixes"].([]any)
	if len(prefixes) != 1 {
		t.Fatalf("commonPrefixes = %v, want exactly one group", body["commonPrefixes"])
	}
	// The chosen shape is a plain string, not {"prefix": "..."}. The SDK
	// tolerates both, so only an explicit type assertion pins which one this
	// route actually emits.
	got, ok := prefixes[0].(string)
	if !ok {
		t.Fatalf("commonPrefixes[0] = %v (%T), want a plain string", prefixes[0], prefixes[0])
	}
	if got != "docs/nested/" {
		t.Errorf("commonPrefixes[0] = %q, want docs/nested/", got)
	}
}

// TestListObjectsS3_OmittedDelimiterListsRecursively covers the other call
// shape: the SDK omits delimiter entirely for a recursive listing
// (client.py:1109 only sets it when truthy). An absent delimiter must flatten
// every nested key into contents and group nothing — this is the call the
// indexing path makes, so getting it wrong reproduces the zero-document run.
func TestListObjectsS3_OmittedDelimiterListsRecursively(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.seed("1", "reports", "docs/top.txt", 5)
	store.seed("1", "reports", "docs/nested/deep.txt", 7)

	code, body := getS3Listing(t, h, "/artifacts/s3/reports?project_id=1&list-type=2&prefix=docs%2F")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%v", code, body)
	}

	contents, _ := body["contents"].([]any)
	if len(contents) != 2 {
		t.Fatalf("contents = %v, want both keys listed recursively", body["contents"])
	}
	seen := map[string]bool{}
	for _, entry := range contents {
		seen[entry.(map[string]any)["key"].(string)] = true
	}
	if !seen["docs/top.txt"] || !seen["docs/nested/deep.txt"] {
		t.Errorf("recursive listing = %v, want both docs/top.txt and docs/nested/deep.txt", seen)
	}
	if prefixes, _ := body["commonPrefixes"].([]any); len(prefixes) != 0 {
		t.Errorf("commonPrefixes = %v, want none when no delimiter is given", prefixes)
	}
}

// TestListObjectsS3_ScopesBucketLookupToQueryProject proves the handler
// resolves the bucket in the project named by project_id and nowhere else.
// The bucket "reports" exists only in project 1; asking for it as project 2
// must not find it. This is the handler-level half of the cross-tenant
// guarantee — the RBAC half (a caller who cannot even name project 2) is
// proven at the router level in internal/api.
func TestListObjectsS3_ScopesBucketLookupToQueryProject(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.seed("1", "reports", "secret.txt", 42)

	code, body := getS3Listing(t, h, "/artifacts/s3/reports?project_id=2&list-type=2")
	if code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404 for another project's bucket; body=%v", code, body)
	}
	if got := errorCodeOf(t, body); got != "NoSuchBucket" {
		t.Errorf("error.code = %q, want NoSuchBucket", got)
	}
}

// TestListObjectsS3_ErrorEnvelopeMatchesWhatTheSDKReads pins the error shape
// _handle_s3_error parses: a JSON body with error.code, in the S3 code
// vocabulary its S3_ERROR_MESSAGES table can phrase (client.py:1060-1067).
// A code outside that table degrades to "S3 error: <code>", so the exact
// strings matter.
func TestListObjectsS3_ErrorEnvelopeMatchesWhatTheSDKReads(t *testing.T) {
	cases := []struct {
		name       string
		target     string
		wantStatus int
		wantCode   string
	}{
		{
			name:       "missing bucket",
			target:     "/artifacts/s3/nope?project_id=1&list-type=2",
			wantStatus: http.StatusNotFound,
			wantCode:   "NoSuchBucket",
		},
		{
			// storage.ValidateKeyPrefix rejects "..", which surfaces as
			// InvalidKey internally and must reach the SDK as the S3
			// InvalidArgument it knows how to phrase.
			name:       "traversal prefix",
			target:     "/artifacts/s3/reports?project_id=1&prefix=..%2Fetc",
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidArgument",
		},
		{
			name:       "missing project_id",
			target:     "/artifacts/s3/reports?list-type=2",
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidArgument",
		},
		{
			name:       "non-numeric project_id",
			target:     "/artifacts/s3/reports?project_id=notanumber",
			wantStatus: http.StatusBadRequest,
			wantCode:   "InvalidArgument",
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			h, _, _ := newObjectTestHandler(t)
			code, body := getS3Listing(t, h, tc.target)
			if code != tc.wantStatus {
				t.Fatalf("status = %d, want %d; body=%v", code, tc.wantStatus, body)
			}
			if got := errorCodeOf(t, body); got != tc.wantCode {
				t.Errorf("error.code = %q, want %q", got, tc.wantCode)
			}
		})
	}
}

// TestListObjectsS3_AcceptsLowercasedBucketName mirrors the SDK, which
// lower-cases the bucket before building the URL (client.py:1105).
func TestListObjectsS3_AcceptsLowercasedBucketName(t *testing.T) {
	h, _, store := newObjectTestHandler(t)
	store.seed("1", "reports", "a.png", 10)

	// "REPORTS" stands in for a caller that did not lower-case; the stored
	// bucket is "reports".
	code, body := getS3Listing(t, h, "/artifacts/s3/REPORTS?project_id=1&list-type=2")
	if code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%v", code, body)
	}
	if contents, _ := body["contents"].([]any); len(contents) != 1 {
		t.Errorf("contents = %v, want the seeded object", body["contents"])
	}
}

// errorCodeOf pulls error.code out of the typed envelope, failing the test
// if the body is not shaped the way _handle_s3_error expects.
func errorCodeOf(t *testing.T, body map[string]any) string {
	t.Helper()
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf(`body has no "error" object; keys=%v`, keysOf(body))
	}
	code, ok := errObj["code"].(string)
	if !ok {
		t.Fatalf(`error has no string "code"; keys=%v`, keysOf(errObj))
	}
	return code
}

func keysOf(m map[string]any) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
