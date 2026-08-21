package sdkharness

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"runtime"
	"strings"
	"testing"
	"time"
)

// THESE TESTS CHECK THE HARNESS, NOT THE SDK CONTRACT.
//
// The authority on the elitea-sdk contract is
// scripts/sdk-conformance/conformance.py, which drives the installed SDK. A Go
// test cannot be that authority: the defect that shipped was a Go test agreeing
// with the Go code it was copied from. What these tests protect is the harness
// itself — a harness that silently answers `allow` for every verdict would make
// the Python driver's two refusal assertions vacuous.

// orgHeader is the name the SDK sends. journalOrgKey is how the journal spells
// it: net/http canonicalises header names and the journal lowercases them, so a
// lookup under the SDK's own spelling would silently find nothing.
const (
	orgHeader     = "OpenAI-Organization"
	journalOrgKey = "openai-organization"
)

func newTestServer(t *testing.T) (*Server, *httptest.Server) {
	t.Helper()
	s, err := New(Config{ProjectID: 4242, UserID: 77})
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	t.Cleanup(s.Close)
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)
	return s, ts
}

// chat posts a minimal non-streaming completion and returns the status and the
// decoded body.
func chat(t *testing.T, ts *httptest.Server, org string) (int, map[string]any) {
	t.Helper()
	body := strings.NewReader(`{"model":"openai/gpt-4o","messages":[{"role":"user","content":"hi"}]}`)
	req, err := http.NewRequest(http.MethodPost, ts.URL+"/llm/v1/chat/completions", body)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	// The SDK sends Authorization on every /llm call. Without it the journal
	// assertion on the redaction branch short-circuits on `got != ""`, and
	// snapshotHeaders' whole authorization case can be deleted with this suite
	// green (measured).
	req.Header.Set("Authorization", "Bearer harness-test-token")
	if org != "" {
		req.Header.Set(orgHeader, org)
	}
	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	var decoded map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	return resp.StatusCode, decoded
}

func errorFields(t *testing.T, body map[string]any) map[string]any {
	t.Helper()
	fields, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("the refusal carries no error object: %v", body)
	}
	return fields
}

// TestEachVerdictProducesADifferentOutcome is the harness's own floor. Without
// it a harness that ignored SetVerdict would answer 200 three times and the
// Python driver would report two passes for assertions that never ran.
func TestEachVerdictProducesADifferentOutcome(t *testing.T) {
	s, ts := newTestServer(t)

	if err := s.SetVerdict(VerdictAllow); err != nil {
		t.Fatalf("SetVerdict(allow): %v", err)
	}
	if status, _ := chat(t, ts, "4242"); status != http.StatusOK {
		t.Fatalf("allow verdict answered %d, want 200", status)
	}

	if err := s.SetVerdict(VerdictProject402); err != nil {
		t.Fatalf("SetVerdict(project): %v", err)
	}
	projectStatus, projectBody := chat(t, ts, "4242")
	if projectStatus != http.StatusPaymentRequired {
		t.Fatalf("project verdict answered %d, want 402: %v", projectStatus, projectBody)
	}

	if err := s.SetVerdict(VerdictMember402); err != nil {
		t.Fatalf("SetVerdict(member): %v", err)
	}
	memberStatus, memberBody := chat(t, ts, "4242")
	if memberStatus != http.StatusPaymentRequired {
		t.Fatalf("member verdict answered %d, want 402: %v", memberStatus, memberBody)
	}

	// The two ceilings must be DISTINGUISHABLE, and they must be distinguished
	// in the same field. No literal is written here: both values come from the
	// two live responses. The elitea-sdk reader matches on type and reads the
	// scope from code, so a refusal pair that differs in the type is the
	// shipped defect and a pair that differs in neither is unusable.
	projectFields := errorFields(t, projectBody)
	memberFields := errorFields(t, memberBody)
	if projectFields["type"] != memberFields["type"] {
		t.Fatalf("the project and member refusals carry different error types "+
			"(%v vs %v). elitea-sdk matches on the type ALONE, so a per-ceiling type "+
			"means one of the two refusals is not recognised as a budget refusal at all.",
			projectFields["type"], memberFields["type"])
	}
	if projectFields["code"] == memberFields["code"] {
		t.Fatalf("the project and member refusals carry the same error code (%v). "+
			"elitea-sdk reads the SCOPE out of the code, so the two ceilings would be "+
			"indistinguishable to every caller.", projectFields["code"])
	}
}

// TestUnknownVerdictIsRejected keeps the control endpoint from defaulting. A
// typo in the driver must fail loudly rather than leave the previous verdict in
// place and report a pass for the wrong measurement.
func TestUnknownVerdictIsRejected(t *testing.T) {
	s, ts := newTestServer(t)

	if err := s.SetVerdict("no-such-verdict"); err == nil {
		t.Fatal("SetVerdict accepted an unknown verdict")
	}
	if got := s.Verdict(); got != VerdictAllow {
		t.Fatalf("a rejected verdict changed the state to %q", got)
	}

	resp, err := ts.Client().Post(ts.URL+"/__harness/verdict", "application/json",
		bytes.NewReader([]byte(`{"verdict":"no-such-verdict"}`)))
	if err != nil {
		t.Fatalf("post verdict: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("the control endpoint answered %d for an unknown verdict, want 400", resp.StatusCode)
	}
}

// TestProjectHeaderDrivesTheRefusal pins the coupling the edge shim relies on.
// A caller that sends no project selector must be ADMITTED — the gateway treats
// an unresolvable project as unlimited — so the driver's refusal assertions can
// only pass while the SDK still sends the header.
func TestProjectHeaderDrivesTheRefusal(t *testing.T) {
	s, ts := newTestServer(t)
	if err := s.SetVerdict(VerdictMember402); err != nil {
		t.Fatalf("SetVerdict: %v", err)
	}

	if status, _ := chat(t, ts, ""); status != http.StatusOK {
		t.Fatalf("a request with no project selector answered %d, want 200. The "+
			"refusal assertions in the Python driver would then pass without the SDK "+
			"sending the header at all.", status)
	}
	if status, _ := chat(t, ts, "4242"); status != http.StatusPaymentRequired {
		t.Fatalf("a request WITH the project selector answered %d, want 402", status)
	}
}

// TestJournalRecordsWhatTheClientSent covers the record the driver reads. The
// headers must be captured BEFORE the shim adds the gateway identity headers,
// or the driver would assert on this file's own work.
func TestJournalRecordsWhatTheClientSent(t *testing.T) {
	s, ts := newTestServer(t)
	s.ResetJournal()

	// The status is asserted by the tests above; this call exists for the record.
	_, _ = chat(t, ts, "4242")

	entries := s.Journal()
	if len(entries) != 1 {
		t.Fatalf("the journal holds %d entr(y|ies), want 1", len(entries))
	}
	entry := entries[0]
	if entry.Path != "/llm/v1/chat/completions" {
		t.Fatalf("the journal recorded the path %q", entry.Path)
	}
	if got := entry.Headers[journalOrgKey]; got != "4242" {
		t.Fatalf("the journal recorded %s=%q, want \"4242\"", journalOrgKey, got)
	}
	if _, ok := entry.Headers["x-elitea-project-id"]; ok {
		t.Fatal("the journal recorded the gateway identity header. It is added by the " +
			"edge shim AFTER the snapshot, so recording it means the driver would be " +
			"asserting on this file rather than on what the client sent.")
	}
	if got := entry.Headers["authorization"]; got != "" && got != "<present>" {
		t.Fatalf("the journal echoed an Authorization value (%q)", got)
	}

	s.ResetJournal()
	if len(s.Journal()) != 0 {
		t.Fatal("ResetJournal left entries behind")
	}
}

// TestConfigRejectsAnUnusableIdentity keeps two silent-pass configurations out.
func TestConfigRejectsAnUnusableIdentity(t *testing.T) {
	if _, err := New(Config{ProjectID: 0, UserID: 77}); err == nil {
		t.Fatal("New accepted a zero ProjectID")
	}
	if _, err := New(Config{ProjectID: 1, UserID: 0}); err == nil {
		t.Fatal("New accepted a zero UserID, which makes the member ceiling unreachable")
	}
}

// TestCloseStopsTheSweepGoroutine proves New's sweep loop is stoppable.
//
// Every New starts one reconciler sweep goroutine. It was bound to
// context.Background(), so its <-ctx.Done() case could never fire and the
// goroutine outlived every reference to the Server: 25 Servers leaked 25
// goroutines that survived dropping all references and forcing GC. The leak was
// invisible because this module has no goleak dependency and nothing counted
// goroutines.
//
// The margin is deliberately loose. This asserts "the leak is bounded", not an
// exact count: the race detector and the HTTP stack keep their own goroutines,
// and a tight equality here would be flaky rather than strict.
func TestCloseStopsTheSweepGoroutine(t *testing.T) {
	const servers = 25

	settle := func() {
		for i := 0; i < 5; i++ {
			runtime.GC()
			time.Sleep(20 * time.Millisecond)
		}
	}

	settle()
	before := runtime.NumGoroutine()

	for i := 0; i < servers; i++ {
		s, err := New(Config{ProjectID: 4242, UserID: 77})
		if err != nil {
			t.Fatalf("New #%d: %v", i, err)
		}
		s.Close()
	}

	settle()
	after := runtime.NumGoroutine()

	if grown := after - before; grown >= servers {
		t.Fatalf("built and closed %d servers and the goroutine count grew by %d "+
			"(%d -> %d). Close does not stop the reconciler sweep loop, so every "+
			"New leaks one goroutine for the life of the process.",
			servers, grown, before, after)
	}
}

// TestALargeBodyReachesTheHandlerIntact pins the boundary probeBody used to
// corrupt.
//
// probeBody buffers the body to read three scalar fields, then puts it back. It
// used to put back ONLY what it had read, capped at probeBodyLimit, so a body
// over that limit reached the real router TRUNCATED. The router itself accepts
// 32 MiB (llmproxy.maxRequestBody), which made this harness 32x stricter than
// the thing it exists to represent, and the doc comment's claim that it
// "RESTORES the body" was false above the limit.
//
// The measured boundary was exact: probeBodyLimit-1 bytes answered 200 and
// probeBodyLimit+1 answered 400 "unexpected EOF".
func TestALargeBodyReachesTheHandlerIntact(t *testing.T) {
	_, ts := newTestServer(t)

	// A valid chat request padded past probeBodyLimit with a long content
	// string. The padding is inside the JSON, so a truncated body is invalid
	// JSON and the router answers 400.
	padding := strings.Repeat("x", probeBodyLimit+4096)
	payload := map[string]any{
		"model": "openai/gpt-4o",
		"messages": []map[string]string{
			{"role": "user", "content": padding},
		},
	}
	encoded, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if len(encoded) <= probeBodyLimit {
		t.Fatalf("the fixture is %d bytes, which does not exceed probeBodyLimit (%d); "+
			"it would not exercise the truncation path", len(encoded), probeBodyLimit)
	}

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/llm/v1/chat/completions",
		bytes.NewReader(encoded))
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := ts.Client().Do(req)
	if err != nil {
		t.Fatalf("post: %v", err)
	}
	defer func() { _ = resp.Body.Close() }()
	body, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		t.Fatalf("a %d-byte body answered HTTP %d (%s), want 200. probeBody handed the "+
			"handler a truncated prefix instead of the whole body.",
			len(encoded), resp.StatusCode, strings.TrimSpace(string(body)))
	}
}
