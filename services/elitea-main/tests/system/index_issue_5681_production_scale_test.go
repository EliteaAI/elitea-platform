package system_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"
)

const (
	index5681OptIn                    = "ELITEA_INDEX_5681_SYSTEM_TEST"
	index5681FixturePortEnv           = "ELITEA_INDEX_5681_FIXTURE_PORT"
	index5681PythonEnv                = "ELITEA_INDEX_5681_PYTHON"
	index5681ReceiptSchema            = "elitea.issue-5681.fixture-receipt.v1"
	index5681FixtureProfile           = "elitea.issue-5681.confluence-images.v1"
	index5681FixtureBytes       int64 = 62 << 20
	index5681LargeImageBytes          = 32 << 20
	index5681CurrentSourceBytes       = 2 * index5681FixtureBytes
	index5681CurrentVisionCalls       = 22
)

type index5681FixtureReceipt struct {
	Schema                     string         `json:"schema"`
	Profile                    string         `json:"profile"`
	DeclaredSourcePayloadBytes int64          `json:"declared_source_payload_bytes"`
	SmallImageSHA256           string         `json:"small_image_sha256"`
	LargeImageSHA256           string         `json:"large_image_sha256"`
	SourceCompletedRequests    map[string]int `json:"source_completed_requests"`
	SourceCompletedBytes       int64          `json:"source_completed_bytes"`
	ChatRequests               int            `json:"chat_requests"`
	MaxChatRequestBytes        int64          `json:"max_chat_request_bytes"`
	EmbeddingRequests          int            `json:"embedding_requests"`
	MaxEmbeddingRequestBytes   int64          `json:"max_embedding_request_bytes"`
	RejectedModelRequests      int            `json:"rejected_model_requests"`
}

type index5681DurableSnapshot struct {
	State                   string `json:"state"`
	DesiredState            string `json:"desired_state"`
	InvocationState         string `json:"invocation_state"`
	TenantID                string `json:"tenant_id"`
	ResourceProjectID       int64  `json:"resource_project_id"`
	ProjectionProjectID     int64  `json:"projection_project_id"`
	WorkloadIdentity        string `json:"workload_identity"`
	WorkloadSessionID       string `json:"workload_session_id"`
	Claims                  int64  `json:"claims"`
	MaxClaimAttempt         int64  `json:"max_claim_attempt"`
	Results                 int64  `json:"results"`
	Settlements             int64  `json:"settlements"`
	ReplayEvents            int64  `json:"replay_events"`
	InputManifestBytes      int64  `json:"input_manifest_bytes"`
	InputEntryBytes         int64  `json:"input_entry_bytes"`
	PreparedEnvelopeBytes   int64  `json:"prepared_envelope_bytes"`
	MaxReplayEventBytes     int64  `json:"max_replay_event_bytes"`
	MaxOutputInboxBytes     int64  `json:"max_output_inbox_bytes"`
	CompletionStatus        string `json:"completion_status"`
	CompletionMessage       string `json:"completion_message"`
	Published               bool   `json:"published"`
	AuthorityGranted        bool   `json:"authority_granted"`
	Retired                 bool   `json:"retired"`
	CommittedSettlement     bool   `json:"committed_settlement"`
	ReleasedClaims          int64  `json:"released_claims"`
	IndexCompletedReplay    int64  `json:"index_completed_replay"`
	TerminalReplayEventSeen bool   `json:"terminal_replay_event_seen"`
}

type index5681SSEObservation struct {
	EventCount   int
	EventTypes   []string
	MaxDataBytes int
	TerminalSeen bool
}

type index5681FixtureProcess struct {
	command *exec.Cmd
	done    chan struct{}
	err     error
	mu      sync.Mutex
	once    sync.Once
}

// TestExistingComposeIndexIssue5681ProductionScale is the opt-in, real-process
// acceptance gate for the production incident. The 62 MiB corpus stays on the
// Confluence/LiteLLM HTTP data plane. PostgreSQL owns only the bounded protected
// configuration bundle and Redis carries exactly one signed reference.
func TestExistingComposeIndexIssue5681ProductionScale(t *testing.T) {
	if os.Getenv(index5681OptIn) != "1" {
		t.Skip("run the fail-fast index_5681/run.sh wrapper to execute the production-scale gate")
	}

	config := loadIndexReliabilityConfig(t)
	requireIssue5681RequestProfile(t, config.startBody)
	harness := &indexComposeHarness{config: config}
	ctx, cancel := context.WithTimeout(context.Background(), config.timeout)
	defer cancel()

	fixturePort := requiredIssue5681Port(t)
	fixture := startIssue5681Fixture(t, ctx, config.projectID, fixturePort)
	t.Cleanup(func() { fixture.stop(t) })
	fixtureBaseURL := fmt.Sprintf("http://127.0.0.1:%d", fixturePort)
	waitForIssue5681Fixture(t, ctx, fixtureBaseURL, fixture)

	harness.requireCleanBaseline(t, ctx)
	requireIssue5681ConfluenceToolkit(t, ctx, harness)
	requireWorkerCanReachIssue5681Fixture(t, ctx, harness, fixturePort)

	type admittedExecution struct {
		id        string
		indexName string
	}
	var admittedMu sync.Mutex
	var admitted []admittedExecution
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		admittedMu.Lock()
		defer admittedMu.Unlock()
		for _, execution := range admitted {
			_ = harness.stopIndex(cleanupCtx, execution.id, execution.indexName)
		}
		_, _ = harness.compose(cleanupCtx, "start", indexWorkerService)
	})

	nonce := randomIndexReliabilityNonce(t)
	indexName := "rel-5681-" + nonce
	controlCanary := "issue-5681-control-canary-" + nonce
	startBody := prepareIndexReliabilityRequest(
		t,
		config.startBody,
		indexName,
		controlCanary,
	)

	harness.stopWorker(t, ctx)
	assertIssue5681UnauthenticatedAdmissionDenied(t, ctx, harness, startBody)
	executionID := harness.startIndex(t, ctx, startBody)
	admittedMu.Lock()
	admitted = append(admitted, admittedExecution{id: executionID, indexName: indexName})
	admittedMu.Unlock()

	assertIssue5681PublicReadBoundaries(t, ctx, harness, executionID)
	sseCancel, sseDone := observeIssue5681SSE(t, ctx, harness, executionID)
	harness.waitForJob(t, ctx, executionID, func(snapshot indexJobSnapshot) bool {
		return snapshot.State == "DISPATCHED" && snapshot.Published
	}, "published production-scale execution")
	reference := harness.waitForRedisReference(t, ctx, controlCanary, 1)
	assertReferenceOnlyIndexRedis(t, reference)
	assertIssue5681BoundedAdmission(t, ctx, harness, executionID)

	entryID := harness.syntheticRead(t, ctx)
	harness.ageSyntheticPending(t, ctx, entryID)
	pending := harness.pendingEntries(t, ctx)
	if len(pending) != 1 || pending[0].ID != entryID ||
		pending[0].Consumer != syntheticConsumer || pending[0].Deliveries < 2 {
		t.Fatalf("crash/retry fixture did not retain one pending reference: %+v", pending)
	}

	harness.startWorker(t, ctx)
	terminal := waitForIssue5681Terminal(t, ctx, harness, executionID)
	if terminal.State != "SUCCEEDED" || terminal.CompletionStatus != "ok" {
		t.Fatalf("production-scale indexing did not succeed: %+v", terminal)
	}
	const expectedCompletion = "Successfully indexed 1 documents (12 chunks)."
	if terminal.CompletionMessage != expectedCompletion {
		t.Fatalf(
			"completion message = %q, want exact current-baseline result %q",
			terminal.CompletionMessage,
			expectedCompletion,
		)
	}
	assertIssue5681DurableTerminal(t, terminal, config.projectID)
	harness.waitForRedisEmpty(t, ctx, controlCanary)

	sse := finishIssue5681SSE(t, sseCancel, sseDone)
	if !sse.TerminalSeen || sse.EventCount < 2 ||
		sse.MaxDataBytes <= 0 || sse.MaxDataBytes > 64*1024 {
		t.Fatalf("public SSE did not provide bounded durable progress and terminal replay: %+v", sse)
	}

	receipt := waitForIssue5681Receipt(t, ctx, fixtureBaseURL)
	assertIssue5681Receipt(t, receipt)

	// A post-terminal worker restart must not create a second claim, result,
	// settlement, replay terminal, source fetch, or model invocation.
	harness.stopWorker(t, ctx)
	harness.startWorker(t, ctx)
	waitForIssue5681StableRestart(t, ctx, harness, executionID, terminal)
	afterRestartReceipt := readIssue5681Receipt(t, ctx, fixtureBaseURL)
	if !equalIssue5681Receipts(receipt, afterRestartReceipt) {
		t.Fatalf(
			"post-terminal restart repeated source/model effects: before=%+v after=%+v",
			receipt,
			afterRestartReceipt,
		)
	}
	harness.waitForRedisEmpty(t, ctx, controlCanary)

	// Stop remains a separate no-authority slice. It must retire the second
	// command before the worker can fetch any of the 62 MiB source corpus.
	cancelIndexName := "rel-5681-stop-" + nonce
	cancelCanary := "issue-5681-stop-canary-" + nonce
	cancelBody := prepareIndexReliabilityRequest(
		t,
		config.startBody,
		cancelIndexName,
		cancelCanary,
	)
	harness.stopWorker(t, ctx)
	cancelExecution := harness.startIndex(t, ctx, cancelBody)
	admittedMu.Lock()
	admitted = append(admitted, admittedExecution{id: cancelExecution, indexName: cancelIndexName})
	admittedMu.Unlock()
	harness.waitForJob(t, ctx, cancelExecution, func(snapshot indexJobSnapshot) bool {
		return snapshot.State == "DISPATCHED" && snapshot.Published
	}, "published production-scale cancellation target")
	assertReferenceOnlyIndexRedis(
		t,
		harness.waitForRedisReference(t, ctx, cancelCanary, 1),
	)
	if err := harness.stopIndex(ctx, cancelExecution, cancelIndexName); err != nil {
		t.Fatalf("cancel production-scale execution: %v", err)
	}
	if err := harness.stopIndex(ctx, cancelExecution, cancelIndexName); err != nil {
		t.Fatalf("repeat production-scale cancellation: %v", err)
	}
	cancelled := harness.waitForJob(t, ctx, cancelExecution, func(snapshot indexJobSnapshot) bool {
		return snapshot.State == "CANCELLED" && snapshot.DesiredState == "CANCELLED"
	}, "durably cancelled production-scale execution")
	if cancelled.Claims != 0 || !cancelled.Retired || cancelled.ReplayEvents == 0 {
		t.Fatalf("pre-claim cancellation crossed worker authority: %+v", cancelled)
	}
	harness.waitForRedisEmpty(t, ctx, cancelCanary)
	if current := readIssue5681Receipt(t, ctx, fixtureBaseURL); !equalIssue5681Receipts(receipt, current) {
		t.Fatalf("cancelled execution reached source/model data plane: before=%+v after=%+v", receipt, current)
	}
	harness.startWorker(t, ctx)

	t.Logf(
		"issue #5681 gate passed: source_bytes=%d max_model_request_bytes=%d redis_envelope_bytes=%d replay_events=%d",
		receipt.SourceCompletedBytes,
		receipt.MaxChatRequestBytes,
		reference.MaxFieldBytes,
		terminal.ReplayEvents,
	)
}

func requiredIssue5681Port(t *testing.T) int {
	t.Helper()
	port, err := strconv.Atoi(os.Getenv(index5681FixturePortEnv))
	if err != nil || port < 1024 || port > 65535 {
		t.Fatalf("%s must be an unprivileged TCP port", index5681FixturePortEnv)
	}
	return port
}

func requireIssue5681RequestProfile(t *testing.T, body map[string]any) {
	t.Helper()
	params, ok := body["tool_params"].(map[string]any)
	if !ok {
		t.Fatal("issue #5681 request tool_params must be an object")
	}
	if params["include_attachments"] != true || params["bins_with_llm"] != true {
		t.Fatal("issue #5681 request must enable include_attachments and bins_with_llm")
	}
	if value, ok := params["max_pages"].(json.Number); !ok || value != "1" {
		t.Fatal("issue #5681 request max_pages must be exactly 1")
	}
}

func assertIssue5681UnauthenticatedAdmissionDenied(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	body []byte,
) {
	t.Helper()
	endpoint := fmt.Sprintf(
		"%s/api/v2/elitea_core/test_toolkit_tool/prompt_lib/%d?await_response=false&execution_contract=index.ingest.v1",
		harness.config.baseURL,
		harness.config.projectID,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("X-Auth-Type", "spoofed-forward-auth")
	request.Header.Set("X-Auth-Id", "1")
	request.Header.Set("X-Auth-Reference", "attacker@example.invalid")
	response, err := harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("exercise unauthenticated index admission: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthenticated forwarded identity reached index admission: status=%d", response.StatusCode)
	}
}

func assertIssue5681PublicReadBoundaries(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
) {
	t.Helper()
	endpoint := fmt.Sprintf(
		"%s/api/v2/executions/%d/%s/events",
		harness.config.baseURL,
		harness.config.projectID,
		executionID,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Auth-Type", "spoofed-forward-auth")
	request.Header.Set("X-Auth-Id", "1")
	request.Header.Set("X-Auth-Reference", "attacker@example.invalid")
	response, err := harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("exercise unauthenticated SSE: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("unauthenticated forwarded identity reached SSE: status=%d", response.StatusCode)
	}

	otherProjectID := harness.config.projectID + 1
	if harness.config.projectID == 2147483647 {
		otherProjectID = harness.config.projectID - 1
	}
	otherEndpoint := fmt.Sprintf(
		"%s/api/v2/executions/%d/%s/events",
		harness.config.baseURL,
		otherProjectID,
		executionID,
	)
	request, err = http.NewRequestWithContext(ctx, http.MethodGet, otherEndpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Cookie", harness.config.cookie)
	response, err = harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("exercise cross-tenant SSE: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("execution replay crossed its project boundary: status=%d", response.StatusCode)
	}
}

func requireIssue5681ConfluenceToolkit(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
) {
	t.Helper()
	query := fmt.Sprintf(
		`SELECT type FROM p_%d.elitea_tools WHERE id = %d`,
		harness.config.projectID,
		harness.config.toolkitID,
	)
	toolkitType := harness.postgresScalar(t, ctx, query)
	if toolkitType != "confluence" {
		t.Fatalf("issue #5681 toolkit type = %q, want confluence", toolkitType)
	}
}

func requireWorkerCanReachIssue5681Fixture(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	port int,
) {
	t.Helper()
	url := fmt.Sprintf("http://host.docker.internal:%d/__elitea_issue_5681/health", port)
	const probe = `import json,sys,urllib.request
with urllib.request.urlopen(sys.argv[1], timeout=5) as response:
    value=json.load(response)
if value.get("status") != "ready":
    raise SystemExit(2)`
	if _, err := harness.compose(
		ctx,
		"exec", "-T", indexWorkerService,
		"python", "-c", probe, url,
	); err != nil {
		t.Fatalf(
			"worker cannot reach fixture; provision Confluence URL as http://host.docker.internal:%d: %v",
			port,
			err,
		)
	}
}

func startIssue5681Fixture(
	t *testing.T,
	ctx context.Context,
	projectID int64,
	port int,
) *index5681FixtureProcess {
	t.Helper()
	repositoryRoot := findRepositoryRoot(t)
	script := filepath.Join(
		repositoryRoot,
		"services", "elitea-main", "tests", "reliability", "index_5681",
		"fixture_server.py",
	)
	python := os.Getenv(index5681PythonEnv)
	if python == "" {
		python = "python3"
	}
	resolvedPython, err := exec.LookPath(python)
	if err != nil {
		t.Fatalf("resolve issue #5681 fixture Python: %v", err)
	}
	fixtureRoot := filepath.Join(canonicalTempDir(t), "issue-5681-fixture")
	command := exec.CommandContext(
		ctx,
		resolvedPython,
		script,
		"--port", strconv.Itoa(port),
		"--project-id", strconv.FormatInt(projectID, 10),
		"--root", fixtureRoot,
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("open fixture stdout: %v", err)
	}
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Start(); err != nil {
		t.Fatalf("start issue #5681 fixture: %v", err)
	}
	process := &index5681FixtureProcess{command: command, done: make(chan struct{})}
	go func() {
		err := command.Wait()
		process.mu.Lock()
		process.err = err
		process.mu.Unlock()
		close(process.done)
	}()

	ready := make(chan error, 1)
	go func() {
		scanner := bufio.NewScanner(stdout)
		if !scanner.Scan() {
			if err := scanner.Err(); err != nil {
				ready <- err
			} else {
				ready <- errors.New("fixture exited before readiness")
			}
			return
		}
		var value struct {
			Status             string `json:"status"`
			Schema             string `json:"schema"`
			SourcePayloadBytes int64  `json:"source_payload_bytes"`
		}
		if err := json.Unmarshal(scanner.Bytes(), &value); err != nil {
			ready <- fmt.Errorf("decode fixture readiness: %w", err)
			return
		}
		if value.Status != "ready" || value.Schema != index5681FixtureProfile ||
			value.SourcePayloadBytes != index5681FixtureBytes {
			ready <- fmt.Errorf("unexpected fixture readiness profile: %+v", value)
			return
		}
		ready <- nil
	}()

	select {
	case err := <-ready:
		if err != nil {
			process.stop(t)
			t.Fatalf("issue #5681 fixture readiness: %v stderr=%s", err, boundedSafeHTTPBody(stderr.Bytes()))
		}
	case <-process.done:
		t.Fatalf(
			"issue #5681 fixture exited early: %v stderr=%s",
			process.waitError(),
			boundedSafeHTTPBody(stderr.Bytes()),
		)
	case <-time.After(time.Minute):
		process.stop(t)
		t.Fatal("issue #5681 fixture did not generate the deterministic corpus within one minute")
	}
	return process
}

func (p *index5681FixtureProcess) stop(t *testing.T) {
	t.Helper()
	p.once.Do(func() {
		if p.command.Process == nil {
			return
		}
		_ = p.command.Process.Signal(syscall.SIGTERM)
		select {
		case <-p.done:
		case <-time.After(5 * time.Second):
			_ = p.command.Process.Kill()
			<-p.done
		}
	})
}

func (p *index5681FixtureProcess) waitError() error {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.err
}

func waitForIssue5681Fixture(
	t *testing.T,
	ctx context.Context,
	baseURL string,
	process *index5681FixtureProcess,
) {
	t.Helper()
	err := pollIndexReliability(ctx, 100*time.Millisecond, func() (bool, error) {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/__elitea_issue_5681/health", nil)
		if err != nil {
			return false, err
		}
		response, err := (&http.Client{Timeout: 2 * time.Second}).Do(request)
		if err != nil {
			select {
			case <-process.done:
				return false, fmt.Errorf("fixture exited: %w", process.waitError())
			default:
			}
			return false, err
		}
		defer response.Body.Close()
		return response.StatusCode == http.StatusOK, nil
	})
	if err != nil {
		t.Fatalf("wait for issue #5681 fixture: %v", err)
	}
}

func assertIssue5681BoundedAdmission(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
) {
	t.Helper()
	snapshot := readIssue5681DurableSnapshot(t, ctx, harness, executionID)
	if snapshot.InputManifestBytes <= 0 || snapshot.InputManifestBytes > 64*1024 ||
		snapshot.InputEntryBytes <= 0 || snapshot.InputEntryBytes > 5*256*1024 ||
		snapshot.PreparedEnvelopeBytes <= 0 || snapshot.PreparedEnvelopeBytes > 48*1024 ||
		snapshot.TenantID != strconv.FormatInt(harness.config.projectID, 10) ||
		snapshot.ResourceProjectID != harness.config.projectID ||
		snapshot.ProjectionProjectID != harness.config.projectID ||
		!snapshot.Published || snapshot.AuthorityGranted || snapshot.Retired {
		t.Fatalf("admission crossed a bounded control/configuration contract: %+v", snapshot)
	}
}

func waitForIssue5681Terminal(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
) index5681DurableSnapshot {
	t.Helper()
	var last index5681DurableSnapshot
	err := pollIndexReliability(ctx, 250*time.Millisecond, func() (bool, error) {
		snapshot, err := issue5681DurableSnapshotResult(ctx, harness, executionID)
		if err != nil {
			return false, err
		}
		last = snapshot
		return snapshot.State == "SUCCEEDED" ||
			snapshot.State == "FAILED" ||
			snapshot.State == "CANCELLED", nil
	})
	if err != nil {
		t.Fatalf("wait for issue #5681 terminal settlement: %v last=%+v", err, last)
	}
	return last
}

func readIssue5681DurableSnapshot(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
) index5681DurableSnapshot {
	t.Helper()
	snapshot, err := issue5681DurableSnapshotResult(ctx, harness, executionID)
	if err != nil {
		t.Fatal(err)
	}
	return snapshot
}

func issue5681DurableSnapshotResult(
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
) (index5681DurableSnapshot, error) {
	if !executionIDPattern.MatchString(executionID) {
		return index5681DurableSnapshot{}, errors.New("invalid execution identity")
	}
	query := fmt.Sprintf(`
	SELECT json_build_object(
	    'state', j.state,
	    'desired_state', j.desired_state,
	    'invocation_state', j.invocation_state,
	    'tenant_id', j.tenant_id,
	    'resource_project_id', j.resource_project_id,
	    'projection_project_id', j.projection_project_id,
	    'workload_identity', COALESCE((
	        SELECT c.workload_identity FROM elitea_runtime.execution_claims AS c
	        WHERE c.execution_id = j.execution_id AND c.generation = j.generation
	        ORDER BY c.claim_attempt DESC LIMIT 1
	    ), ''),
	    'workload_session_id', COALESCE((
	        SELECT c.workload_session_id FROM elitea_runtime.execution_claims AS c
	        WHERE c.execution_id = j.execution_id AND c.generation = j.generation
	        ORDER BY c.claim_attempt DESC LIMIT 1
	    ), ''),
	    'claims', (SELECT count(*) FROM elitea_runtime.execution_claims AS c
               WHERE c.execution_id = j.execution_id AND c.generation = j.generation),
    'max_claim_attempt', COALESCE((SELECT max(c.claim_attempt)
                                  FROM elitea_runtime.execution_claims AS c
                                  WHERE c.execution_id = j.execution_id
                                    AND c.generation = j.generation), 0),
    'released_claims', (SELECT count(*) FROM elitea_runtime.execution_claims AS c
                        WHERE c.execution_id = j.execution_id
                          AND c.generation = j.generation
                          AND c.released_at IS NOT NULL),
    'results', (SELECT count(*) FROM elitea_runtime.index_ingest_results AS i
                WHERE i.execution_id = j.execution_id AND i.generation = j.generation),
    'settlements', (SELECT count(*) FROM elitea_runtime.execution_settlements AS s
                    WHERE s.execution_id = j.execution_id AND s.generation = j.generation),
    'replay_events', (SELECT count(*) FROM elitea_runtime.execution_replay_events AS r
                      WHERE r.execution_id = j.execution_id AND r.generation = j.generation),
    'index_completed_replay', (SELECT count(*) FROM elitea_runtime.execution_replay_events AS r
                               WHERE r.execution_id = j.execution_id
                                 AND r.generation = j.generation
                                 AND r.event_type = 'index.ingest.completed'),
    'terminal_replay_event_seen', EXISTS (
        SELECT 1 FROM elitea_runtime.execution_replay_events AS r
        WHERE r.execution_id = j.execution_id AND r.generation = j.generation
          AND r.event_type = 'index.ingest.completed'
    ),
    'input_manifest_bytes', octet_length(b.manifest_bytes),
    'input_entry_bytes', (SELECT COALESCE(sum(octet_length(e.content_bytes)), 0)
                          FROM elitea_runtime.input_bundle_entries AS e
                          WHERE e.input_bundle_id = b.input_bundle_id),
    'prepared_envelope_bytes', COALESCE(octet_length(o.prepared_signed_envelope_bytes), 0),
    'max_replay_event_bytes', COALESCE((SELECT max(octet_length(r.event_bytes))
                                       FROM elitea_runtime.execution_replay_events AS r
                                       WHERE r.execution_id = j.execution_id
                                         AND r.generation = j.generation), 0),
    'max_output_inbox_bytes', COALESCE((SELECT max(octet_length(i.payload_bytes))
                                       FROM elitea_runtime.output_inbox AS i
                                       WHERE i.execution_id = j.execution_id
                                         AND i.generation = j.generation), 0),
    'completion_status', COALESCE((SELECT i.completion_status
                                  FROM elitea_runtime.index_ingest_results AS i
                                  WHERE i.execution_id = j.execution_id
                                    AND i.generation = j.generation
                                  LIMIT 1), ''),
    'completion_message', COALESCE((SELECT i.completion_message
                                   FROM elitea_runtime.index_ingest_results AS i
                                   WHERE i.execution_id = j.execution_id
                                     AND i.generation = j.generation
                                   LIMIT 1), ''),
    'published', o.published_at IS NOT NULL,
    'authority_granted', o.authority_granted_at IS NOT NULL,
    'retired', o.retired_at IS NOT NULL,
    'committed_settlement', EXISTS (
        SELECT 1 FROM elitea_runtime.execution_settlements AS s
        WHERE s.execution_id = j.execution_id AND s.generation = j.generation
          AND s.committed_at IS NOT NULL
    )
)
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
JOIN elitea_runtime.input_bundles AS b ON b.input_bundle_id = j.input_bundle_id
WHERE j.execution_id = '%s' AND j.capability_id = 'index.ingest.v1'`, executionID)
	output, err := harness.postgres(ctx, query)
	if err != nil {
		return index5681DurableSnapshot{}, err
	}
	if strings.TrimSpace(output) == "" {
		return index5681DurableSnapshot{}, errors.New("execution is not durably visible")
	}
	var snapshot index5681DurableSnapshot
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &snapshot); err != nil {
		return index5681DurableSnapshot{}, fmt.Errorf("decode durable snapshot: %w", err)
	}
	return snapshot, nil
}

func assertIssue5681DurableTerminal(
	t *testing.T,
	snapshot index5681DurableSnapshot,
	projectID int64,
) {
	t.Helper()
	if snapshot.DesiredState != "RUNNING" ||
		snapshot.InvocationState != "MAY_HAVE_STARTED" ||
		snapshot.TenantID != strconv.FormatInt(projectID, 10) ||
		snapshot.ResourceProjectID != projectID ||
		snapshot.ProjectionProjectID != projectID ||
		!strings.HasPrefix(snapshot.WorkloadIdentity, "spiffe://") ||
		snapshot.WorkloadSessionID == "" ||
		snapshot.Claims != 1 ||
		snapshot.MaxClaimAttempt != 1 ||
		snapshot.ReleasedClaims != 1 ||
		snapshot.Results != 1 ||
		snapshot.Settlements != 1 ||
		snapshot.ReplayEvents < 2 ||
		snapshot.IndexCompletedReplay != 1 ||
		!snapshot.TerminalReplayEventSeen ||
		!snapshot.CommittedSettlement ||
		!snapshot.AuthorityGranted ||
		snapshot.Retired ||
		snapshot.MaxReplayEventBytes <= 0 ||
		snapshot.MaxReplayEventBytes > 64*1024 ||
		snapshot.MaxOutputInboxBytes > 256*1024 {
		t.Fatalf("terminal durability/idempotency contract mismatch: %+v", snapshot)
	}
}

func observeIssue5681SSE(
	t *testing.T,
	parent context.Context,
	harness *indexComposeHarness,
	executionID string,
) (context.CancelFunc, <-chan index5681SSEObservation) {
	t.Helper()
	ctx, cancel := context.WithCancel(parent)
	done := make(chan index5681SSEObservation, 1)
	ready := make(chan error, 1)
	go func() {
		observation, err := collectIssue5681SSE(ctx, harness, executionID, ready)
		if err != nil && !errors.Is(err, context.Canceled) {
			select {
			case ready <- err:
			default:
			}
		}
		done <- observation
	}()
	select {
	case err := <-ready:
		if err != nil {
			cancel()
			t.Fatalf("open issue #5681 SSE: %v", err)
		}
	case <-time.After(10 * time.Second):
		cancel()
		t.Fatal("issue #5681 SSE did not return response headers")
	}
	return cancel, done
}

func collectIssue5681SSE(
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	ready chan<- error,
) (index5681SSEObservation, error) {
	endpoint := fmt.Sprintf(
		"%s/api/v2/executions/%d/%s/events",
		harness.config.baseURL,
		harness.config.projectID,
		executionID,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return index5681SSEObservation{}, err
	}
	request.Header.Set("Accept", "text/event-stream")
	request.Header.Set("Cookie", harness.config.cookie)
	client := *harness.config.httpClient
	client.Timeout = 0
	response, err := client.Do(request)
	if err != nil {
		return index5681SSEObservation{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK ||
		!strings.HasPrefix(response.Header.Get("Content-Type"), "text/event-stream") {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return index5681SSEObservation{}, fmt.Errorf(
			"status=%d content-type=%q body=%s",
			response.StatusCode,
			response.Header.Get("Content-Type"),
			boundedSafeHTTPBody(body),
		)
	}
	ready <- nil

	var observation index5681SSEObservation
	var eventType string
	var data strings.Builder
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 128*1024)
	flush := func() bool {
		if eventType == "" {
			data.Reset()
			return false
		}
		observation.EventCount++
		observation.EventTypes = append(observation.EventTypes, eventType)
		observation.MaxDataBytes = max(observation.MaxDataBytes, data.Len())
		if eventType == "index.ingest.completed" {
			observation.TerminalSeen = true
		}
		eventType = ""
		data.Reset()
		return observation.TerminalSeen
	}
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event:"):
			eventType = strings.TrimSpace(strings.TrimPrefix(line, "event:"))
		case strings.HasPrefix(line, "data:"):
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.WriteString(strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		case line == "":
			if flush() {
				return observation, nil
			}
		}
	}
	flush()
	if err := scanner.Err(); err != nil && ctx.Err() == nil {
		return observation, err
	}
	return observation, ctx.Err()
}

func finishIssue5681SSE(
	t *testing.T,
	cancel context.CancelFunc,
	done <-chan index5681SSEObservation,
) index5681SSEObservation {
	t.Helper()
	select {
	case result := <-done:
		cancel()
		return result
	case <-time.After(10 * time.Second):
		cancel()
		select {
		case result := <-done:
			return result
		case <-time.After(5 * time.Second):
			t.Fatal("issue #5681 SSE did not return terminal replay")
			return index5681SSEObservation{}
		}
	}
}

func waitForIssue5681Receipt(
	t *testing.T,
	ctx context.Context,
	baseURL string,
) index5681FixtureReceipt {
	t.Helper()
	var last index5681FixtureReceipt
	err := pollIndexReliability(ctx, 250*time.Millisecond, func() (bool, error) {
		receipt, err := issue5681ReceiptResult(ctx, baseURL)
		if err != nil {
			return false, err
		}
		last = receipt
		return receipt.SourceCompletedBytes >= index5681CurrentSourceBytes &&
			receipt.ChatRequests >= index5681CurrentVisionCalls &&
			receipt.EmbeddingRequests >= 1, nil
	})
	if err != nil {
		t.Fatalf("wait for issue #5681 source/model receipt: %v last=%+v", err, last)
	}
	return last
}

func readIssue5681Receipt(
	t *testing.T,
	ctx context.Context,
	baseURL string,
) index5681FixtureReceipt {
	t.Helper()
	receipt, err := issue5681ReceiptResult(ctx, baseURL)
	if err != nil {
		t.Fatal(err)
	}
	return receipt
}

func issue5681ReceiptResult(
	ctx context.Context,
	baseURL string,
) (index5681FixtureReceipt, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, baseURL+"/__elitea_issue_5681/receipt", nil)
	if err != nil {
		return index5681FixtureReceipt{}, err
	}
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		return index5681FixtureReceipt{}, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return index5681FixtureReceipt{}, fmt.Errorf("receipt status=%d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 64*1024))
	if err != nil {
		return index5681FixtureReceipt{}, err
	}
	var receipt index5681FixtureReceipt
	if err := json.Unmarshal(body, &receipt); err != nil {
		return index5681FixtureReceipt{}, fmt.Errorf("decode receipt: %w", err)
	}
	return receipt, nil
}

func assertIssue5681Receipt(t *testing.T, receipt index5681FixtureReceipt) {
	t.Helper()
	if receipt.Schema != index5681ReceiptSchema ||
		receipt.Profile != index5681FixtureProfile ||
		receipt.DeclaredSourcePayloadBytes != index5681FixtureBytes ||
		len(receipt.SmallImageSHA256) != 64 ||
		len(receipt.LargeImageSHA256) != 64 ||
		receipt.SourceCompletedBytes != index5681CurrentSourceBytes ||
		receipt.ChatRequests != index5681CurrentVisionCalls ||
		receipt.MaxChatRequestBytes <= index5681LargeImageBytes ||
		receipt.EmbeddingRequests < 1 ||
		receipt.RejectedModelRequests != 0 {
		t.Fatalf("source/model receipt does not prove the exact issue #5681 profile: %+v", receipt)
	}
	if len(receipt.SourceCompletedRequests) != 11 ||
		receipt.SourceCompletedRequests["diagram-32mib.png"] != 2 {
		t.Fatalf("source receipt does not contain each exact current-baseline image pass: %+v", receipt.SourceCompletedRequests)
	}
	for ordinal := 0; ordinal < 10; ordinal++ {
		name := fmt.Sprintf("diagram-%02d.png", ordinal)
		if receipt.SourceCompletedRequests[name] != 2 {
			t.Fatalf("source receipt %q count=%d, want 2", name, receipt.SourceCompletedRequests[name])
		}
	}
}

func equalIssue5681Receipts(left, right index5681FixtureReceipt) bool {
	leftBytes, leftErr := json.Marshal(left)
	rightBytes, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func waitForIssue5681StableRestart(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	expected index5681DurableSnapshot,
) {
	t.Helper()
	stable := 0
	err := pollIndexReliability(ctx, 500*time.Millisecond, func() (bool, error) {
		snapshot, err := issue5681DurableSnapshotResult(ctx, harness, executionID)
		if err != nil {
			return false, err
		}
		if snapshot != expected {
			return false, fmt.Errorf("durable terminal snapshot changed: got=%+v want=%+v", snapshot, expected)
		}
		stable++
		return stable >= 6, nil
	})
	if err != nil {
		t.Fatalf("post-terminal restart idempotency: %v", err)
	}
}

func TestIssue5681FixtureProfileIsExactlySixtyTwoMiB(t *testing.T) {
	if got := 10*(3<<20) + (32 << 20); got != int(index5681FixtureBytes) {
		t.Fatalf("issue #5681 profile bytes=%d, want %d", got, index5681FixtureBytes)
	}
	if index5681LargeImageBytes <= 0 || index5681LargeImageBytes >= index5681FixtureBytes {
		t.Fatal("issue #5681 large-image boundary is malformed")
	}
}
