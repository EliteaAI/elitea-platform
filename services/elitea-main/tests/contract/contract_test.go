package contract

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"testing"
	"time"
)

var (
	goBaseURL     string
	legacyBaseURL string
	authToken     string
	projectID     string
	client        *http.Client
)

// TestMain sets up two independent harnesses that must not gate each other:
//
//  1. The legacy-parity fixtures below (TestApplicationsList, TestHealthz,
//     TestPredict, ...) diff the Go service against a running legacy
//     instance. They need CONTRACT_AUTH_TOKEN and a reachable legacy_url,
//     both only available in ci-contract.yml's weekly schedule/dispatch job
//     — requireLegacyParityCredentials skips each one individually when
//     authToken is unset, rather than this function exiting the whole
//     process before m.Run() the way it used to. That old early-exit gated
//     every test in this package shut by default, including any
//     unrelated, self-contained TestArtifact* test added later — S19 needs
//     those to run unconditionally (skipping per-test on their own,
//     unrelated RustFS/Postgres env vars — see artifact_harness_test.go).
//  2. setupArtifactSuite (artifact_harness_test.go) builds S19's
//     self-contained artifact-API harness, torn down after m.Run() returns
//     — TestMain, not t.Cleanup, is the right place for whole-binary
//     setup/teardown shared across many independent top-level test
//     functions.
func TestMain(m *testing.M) {
	goBaseURL = envOr("CONTRACT_GO_URL", "http://localhost:8080")
	legacyBaseURL = envOr("CONTRACT_LEGACY_URL", "http://localhost:8000")
	authToken = os.Getenv("CONTRACT_AUTH_TOKEN")
	projectID = envOr("CONTRACT_PROJECT_ID", "test-project")
	client = &http.Client{Timeout: 10 * time.Second}

	teardownArtifactSuite := setupArtifactSuite()
	code := m.Run()
	teardownArtifactSuite()
	os.Exit(code)
}

// requireLegacyParityCredentials skips the calling test when
// CONTRACT_AUTH_TOKEN is unset — the default everywhere except
// ci-contract.yml's weekly schedule/workflow_dispatch job, which sets the
// real secret. See TestMain's doc comment for why this is now a per-test
// skip rather than a whole-process early exit.
func requireLegacyParityCredentials(t *testing.T) {
	t.Helper()
	if authToken == "" {
		t.Skip("set CONTRACT_AUTH_TOKEN to run the legacy-parity contract tests")
	}
}

func TestApplicationsList(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/applications", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestSkillsList(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/skills", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestFoldersList(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/folders", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestTagsList(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/tags", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestConversationsList(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/conversations", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestAnalytics(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/analytics", projectID)
	compareEndpoints(t, "GET", path, nil)
}

func TestHealthz(t *testing.T) {
	requireLegacyParityCredentials(t)
	goResp := doRequest(t, "GET", goBaseURL+"/healthz", nil)
	if goResp.StatusCode != http.StatusOK {
		t.Errorf("Go /healthz returned %d", goResp.StatusCode)
	}
}

type CompareResult struct {
	Endpoint     string
	GoStatus     int
	LegacyStatus int
	SchemaMatch  bool
	Diff         string
}

func compareEndpoints(t *testing.T, method, path string, body io.Reader) CompareResult {
	t.Helper()

	goResp := doRequest(t, method, goBaseURL+path, body)
	legacyResp := doRequest(t, method, legacyBaseURL+path, body)

	result := CompareResult{
		Endpoint:     fmt.Sprintf("%s %s", method, path),
		GoStatus:     goResp.StatusCode,
		LegacyStatus: legacyResp.StatusCode,
	}

	if goResp.StatusCode != legacyResp.StatusCode {
		t.Errorf("[%s] status mismatch: go=%d legacy=%d", result.Endpoint, goResp.StatusCode, legacyResp.StatusCode)
		return result
	}

	goBody, _ := io.ReadAll(goResp.Body)
	legacyBody, _ := io.ReadAll(legacyResp.Body)
	_ = goResp.Body.Close()
	_ = legacyResp.Body.Close()

	goKeys := extractTopLevelKeys(goBody)
	legacyKeys := extractTopLevelKeys(legacyBody)

	result.SchemaMatch = sameKeys(goKeys, legacyKeys)
	if !result.SchemaMatch {
		result.Diff = fmt.Sprintf("go keys: %v, legacy keys: %v", goKeys, legacyKeys)
		t.Errorf("[%s] schema mismatch: %s", result.Endpoint, result.Diff)
	}

	return result
}

func doRequest(t *testing.T, method, url string, body io.Reader) *http.Response {
	t.Helper()
	req, err := http.NewRequest(method, url, body)
	if err != nil {
		t.Fatalf("failed to create request: %v", err)
	}
	req.Header.Set("Authorization", "Bearer "+authToken)
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("request to %s failed: %v", url, err)
	}
	return resp
}

func extractTopLevelKeys(data []byte) []string {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(data, &m); err != nil {
		return nil
	}
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}

func sameKeys(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	set := make(map[string]bool, len(a))
	for _, k := range a {
		set[k] = true
	}
	for _, k := range b {
		if !set[k] {
			return false
		}
	}
	return true
}

func envOr(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func TestPredict(t *testing.T) {
	requireLegacyParityCredentials(t)
	path := fmt.Sprintf("/api/v2/projects/%s/predict", projectID)
	body := strings.NewReader(`{"prompt":"hello","agent_id":"test","stream":false}`)
	compareEndpoints(t, "POST", path, body)
}
