package system_test

import (
	"bufio"
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	runtimegrpc "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/transport/runtimegrpc/nodeevent"
	"google.golang.org/protobuf/proto"
)

const (
	index5681OptIn                     = "ELITEA_INDEX_5681_SYSTEM_TEST"
	index5681FixturePortEnv            = "ELITEA_INDEX_5681_FIXTURE_PORT"
	index5681PythonEnv                 = "ELITEA_INDEX_5681_PYTHON"
	index5681DeniedCookieFileEnv       = "ELITEA_INDEX_5681_DENIED_COOKIE_FILE"
	index5681SecondProjectEnv          = "ELITEA_INDEX_5681_SECOND_PROJECT_ID"
	index5681SecondToolkitEnv          = "ELITEA_INDEX_5681_SECOND_TOOLKIT_ID"
	index5681WorkloadIdentityEnv       = "ELITEA_INDEX_5681_WORKLOAD_IDENTITY"
	index5681SourceAuthDigestEnv       = "ELITEA_INDEX_5681_SOURCE_AUTH_SHA256"
	index5681ModelAuthDigestEnv        = "ELITEA_INDEX_5681_MODEL_AUTH_SHA256"
	index5681ProxyAttestationEnv       = "ELITEA_INDEX_5681_LITELLM_ATTESTATION_SHA256"
	index5681PlatformSHAEnv            = "ELITEA_INDEX_5681_PLATFORM_SHA"
	index5681MainImageIDEnv            = "ELITEA_INDEX_5681_MAIN_IMAGE_ID"
	index5681WorkerImageIDEnv          = "ELITEA_INDEX_5681_WORKER_IMAGE_ID"
	index5681LiteLLMImageIDEnv         = "ELITEA_INDEX_5681_LITELLM_IMAGE_ID"
	index5681LiteLLMServiceEnv         = "ELITEA_INDEX_5681_LITELLM_SERVICE"
	index5681LiteLLMRevisionEnv        = "ELITEA_INDEX_5681_LITELLM_REVISION"
	index5681SDKRevisionEnv            = "ELITEA_INDEX_5681_SDK_REVISION"
	index5681ReceiptSchema             = "elitea.issue-5681.fixture-receipt.v1"
	index5681FixtureProfile            = "elitea.issue-5681.confluence-images.v1"
	index5681FixtureBytes        int64 = 62 << 20
	index5681LargeImageBytes           = 32 << 20
	index5681CurrentSourceBytes        = 2 * index5681FixtureBytes
	index5681CurrentVisionCalls        = 22
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
	RejectedSourceRequests     int            `json:"rejected_source_requests"`
	RejectedModelRequests      int            `json:"rejected_model_requests"`
	RejectedProxyRequests      int            `json:"rejected_proxy_requests"`
}

type index5681Environment struct {
	deniedCookie             string
	secondProjectID          int64
	secondToolkitID          int64
	expectedWorkloadIdentity string
	sourceAuthDigest         string
	modelAuthDigest          string
	proxyAttestationDigest   string
	platformSHA              string
	mainImageID              string
	workerImageID            string
	liteLLMImageID           string
	liteLLMService           string
	liteLLMRevision          string
	sdkRevision              string
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
	InputEntryCount         int64  `json:"input_entry_count"`
	InputEntryBytes         int64  `json:"input_entry_bytes"`
	MaxInputEntryBytes      int64  `json:"max_input_entry_bytes"`
	PreparedEnvelopeBytes   int64  `json:"prepared_envelope_bytes"`
	MaxReplayEventBytes     int64  `json:"max_replay_event_bytes"`
	TotalReplayEventBytes   int64  `json:"total_replay_event_bytes"`
	NodeReplayEvents        int64  `json:"node_replay_events"`
	MaxOutputInboxBytes     int64  `json:"max_output_inbox_bytes"`
	TotalOutputInboxBytes   int64  `json:"total_output_inbox_bytes"`
	OutputInboxFrames       int64  `json:"output_inbox_frames"`
	LastNodeSequence        int64  `json:"last_node_sequence"`
	TerminalSequence        int64  `json:"terminal_sequence"`
	OutputIdentityBound     bool   `json:"output_identity_bound"`
	WorkloadSessionActive   bool   `json:"workload_session_active"`
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
	EventCount         int
	EventTypes         []string
	NodeTypes          []string
	StatusStates       []string
	MaxDataBytes       int
	TotalDataBytes     int
	ThinkingEvents     int
	TerminalEvents     int
	TerminalSeen       bool
	TerminalStatus     string
	TerminalMessage    string
	ThinkingIndex      int
	InProgressIndex    int
	CompletedIndex     int
	InvalidContract    bool
	UnsafeDataObserved bool
}

type index5681RedisEvidence struct {
	EntryID           string `json:"entry_id"`
	FieldName         string `json:"field_name"`
	EnvelopeHex       string `json:"envelope_hex"`
	MappingField      string `json:"mapping_field"`
	MappingValue      string `json:"mapping_value"`
	StreamLength      int64  `json:"stream_length"`
	MappingCount      int64  `json:"mapping_count"`
	FieldCount        int64  `json:"field_count"`
	EnvelopeBytes     int64  `json:"envelope_bytes"`
	MappingFieldBytes int64  `json:"mapping_field_bytes"`
	MappingValueBytes int64  `json:"mapping_value_bytes"`
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
	environment := loadIssue5681Environment(t, config)
	requireIssue5681RequestProfile(t, config.startBody)
	harness := &indexComposeHarness{config: config}
	ctx, cancel := context.WithTimeout(context.Background(), config.timeout)
	defer cancel()

	fixturePort := requiredIssue5681Port(t)
	requireIssue5681SUTProvenance(t, ctx, harness, environment)
	fixture := startIssue5681Fixture(
		t,
		ctx,
		config.projectID,
		fixturePort,
		environment,
	)
	t.Cleanup(func() { fixture.stop(t) })
	fixtureBaseURL := fmt.Sprintf("http://127.0.0.1:%d", fixturePort)
	waitForIssue5681Fixture(t, ctx, fixtureBaseURL, fixture)
	initialReceipt := readIssue5681Receipt(t, ctx, fixtureBaseURL)

	requireIssue5681CleanDedicatedBaseline(t, ctx, harness)
	requireIssue5681ConfluenceToolkit(t, ctx, harness)
	requireIssue5681SecondProjectAccess(
		t,
		ctx,
		harness,
		environment.secondProjectID,
		environment.secondToolkitID,
	)
	requireWorkerCanReachIssue5681Fixture(t, ctx, harness, fixturePort)

	type admittedExecution struct {
		id        string
		indexName string
	}
	var admittedMu sync.Mutex
	var admitted []admittedExecution
	var indexNames []string
	t.Cleanup(func() {
		cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cleanupCancel()
		admittedMu.Lock()
		defer admittedMu.Unlock()
		for _, execution := range admitted {
			_ = harness.stopIndex(cleanupCtx, execution.id, execution.indexName)
		}
		for _, createdIndexName := range indexNames {
			if err := cleanupIssue5681Index(
				cleanupCtx,
				harness,
				createdIndexName,
			); err != nil {
				t.Errorf("clean issue #5681 PgVector index: %v", err)
			}
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
	indexNames = append(indexNames, indexName)

	harness.stopWorker(t, ctx)
	assertIssue5681AdmissionRBAC(
		t,
		ctx,
		harness,
		startBody,
		environment.deniedCookie,
	)
	executionID := harness.startIndex(t, ctx, startBody)
	admittedMu.Lock()
	admitted = append(admitted, admittedExecution{id: executionID, indexName: indexName})
	admittedMu.Unlock()

	assertIssue5681PublicReadBoundaries(
		t,
		ctx,
		harness,
		executionID,
		environment.deniedCookie,
		environment.secondProjectID,
	)
	expectedClientIdentity := "index-reliability-" + indexName
	sseCancel, sseDone := observeIssue5681SSE(
		t,
		ctx,
		harness,
		executionID,
		expectedClientIdentity,
		expectedClientIdentity,
		[]string{
			controlCanary,
			initialReceipt.SmallImageSHA256,
			initialReceipt.LargeImageSHA256,
		},
	)
	harness.waitForJob(t, ctx, executionID, func(snapshot indexJobSnapshot) bool {
		return snapshot.State == "DISPATCHED" && snapshot.Published
	}, "published production-scale execution")
	reference := harness.waitForRedisReference(t, ctx, controlCanary, 1)
	assertReferenceOnlyIndexRedis(t, reference)
	expectedInputEntries := assertIssue5681DecodedRedisReference(
		t,
		ctx,
		harness,
		executionID,
		expectedClientIdentity,
	)
	assertIssue5681BoundedAdmission(t, ctx, harness, executionID, expectedInputEntries)

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
	assertIssue5681DurableTerminal(
		t,
		terminal,
		config.projectID,
		environment.expectedWorkloadIdentity,
	)
	harness.waitForRedisEmpty(t, ctx, controlCanary)
	removeIssue5681SyntheticConsumer(t, ctx, harness)

	sse := finishIssue5681SSE(t, sseCancel, sseDone)
	assertIssue5681SSE(t, sse, terminal)

	receipt := waitForIssue5681Receipt(t, ctx, fixtureBaseURL)
	assertIssue5681Receipt(t, receipt)
	assertIssue5681PgVectorOutcome(t, ctx, harness, indexName)

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
	indexNames = append(indexNames, cancelIndexName)
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
	waitForIssue5681CancelledStability(
		t,
		ctx,
		harness,
		cancelExecution,
		cancelled,
		fixtureBaseURL,
		receipt,
		cancelCanary,
	)

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

func loadIssue5681Environment(
	t *testing.T,
	config indexReliabilityConfig,
) index5681Environment {
	t.Helper()
	if os.Getenv("ELITEA_INDEX_5681_DEDICATED") != "1" ||
		!strings.HasPrefix(config.composeProject, "elitea-5681-") ||
		len(config.composeProject) > 64 {
		t.Fatal("issue #5681 requires an explicitly dedicated elitea-5681-* Compose project")
	}
	deniedCookiePath := requiredAbsoluteFile(t, index5681DeniedCookieFileEnv, true)
	deniedCookie := readIssue5681Cookie(t, deniedCookiePath, index5681DeniedCookieFileEnv)
	if deniedCookie == config.cookie {
		t.Fatal("allowed and permission-denied browser sessions must be distinct")
	}
	environment := index5681Environment{
		deniedCookie:             deniedCookie,
		secondProjectID:          requiredIssue5681PositiveInteger(t, index5681SecondProjectEnv),
		secondToolkitID:          requiredIssue5681PositiveInteger(t, index5681SecondToolkitEnv),
		expectedWorkloadIdentity: requiredIssue5681Text(t, index5681WorkloadIdentityEnv, "spiffe://", 512),
		sourceAuthDigest:         requiredIssue5681SHA256(t, index5681SourceAuthDigestEnv, false),
		modelAuthDigest:          requiredIssue5681SHA256(t, index5681ModelAuthDigestEnv, false),
		proxyAttestationDigest:   requiredIssue5681SHA256(t, index5681ProxyAttestationEnv, false),
		platformSHA:              requiredIssue5681Hex(t, index5681PlatformSHAEnv, 40),
		mainImageID:              requiredIssue5681SHA256(t, index5681MainImageIDEnv, true),
		workerImageID:            requiredIssue5681SHA256(t, index5681WorkerImageIDEnv, true),
		liteLLMImageID:           requiredIssue5681SHA256(t, index5681LiteLLMImageIDEnv, true),
		liteLLMService:           requiredIssue5681Text(t, index5681LiteLLMServiceEnv, "", 128),
		liteLLMRevision:          requiredIssue5681Hex(t, index5681LiteLLMRevisionEnv, 40),
		sdkRevision:              requiredIssue5681Hex(t, index5681SDKRevisionEnv, 40),
	}
	if environment.secondProjectID == config.projectID {
		t.Fatal("issue #5681 second project must differ from the execution project")
	}
	if environment.liteLLMService == "" ||
		strings.ContainsAny(environment.liteLLMService, "/\\.:") {
		t.Fatalf("%s must be one bounded Compose service name", index5681LiteLLMServiceEnv)
	}
	return environment
}

func readIssue5681Cookie(t *testing.T, path, environmentName string) string {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s", environmentName)
	}
	value := strings.TrimSpace(string(raw))
	if value == "" || len(value) > 4096 || strings.ContainsAny(value, "\r\n") ||
		!strings.Contains(value, "=") || strings.HasPrefix(strings.ToLower(value), "cookie:") {
		t.Fatalf("%s must contain one bounded raw Cookie header value", environmentName)
	}
	return value
}

func requiredIssue5681PositiveInteger(t *testing.T, environmentName string) int64 {
	t.Helper()
	value, err := strconv.ParseInt(strings.TrimSpace(os.Getenv(environmentName)), 10, 32)
	if err != nil || value <= 0 {
		t.Fatalf("%s must be a positive PostgreSQL integer", environmentName)
	}
	return value
}

func requiredIssue5681Text(
	t *testing.T,
	environmentName string,
	prefix string,
	maximum int,
) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(environmentName))
	if !strings.HasPrefix(value, prefix) || len(value) > maximum ||
		strings.ContainsAny(value, "\x00\r\n") {
		t.Fatalf("%s has an invalid non-secret identity", environmentName)
	}
	return value
}

func requiredIssue5681SHA256(
	t *testing.T,
	environmentName string,
	withPrefix bool,
) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(environmentName))
	digest := value
	if withPrefix {
		if !strings.HasPrefix(value, "sha256:") {
			t.Fatalf("%s must be an immutable sha256 image ID", environmentName)
		}
		digest = strings.TrimPrefix(value, "sha256:")
	}
	if len(digest) != sha256.Size*2 {
		t.Fatalf("%s must contain one SHA-256 digest", environmentName)
	}
	if _, err := hex.DecodeString(digest); err != nil || strings.ToLower(digest) != digest {
		t.Fatalf("%s must contain lowercase hexadecimal SHA-256", environmentName)
	}
	return value
}

func requiredIssue5681Hex(t *testing.T, environmentName string, length int) string {
	t.Helper()
	value := strings.TrimSpace(os.Getenv(environmentName))
	if len(value) != length {
		t.Fatalf("%s must contain one full immutable revision", environmentName)
	}
	if _, err := hex.DecodeString(value); err != nil || strings.ToLower(value) != value {
		t.Fatalf("%s must contain lowercase hexadecimal", environmentName)
	}
	return value
}

func requireIssue5681SUTProvenance(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	environment index5681Environment,
) {
	t.Helper()
	repositoryRoot := findRepositoryRoot(t)
	head := issue5681CommandOutput(t, ctx, repositoryRoot, "git", "rev-parse", "HEAD")
	if strings.TrimSpace(head) != environment.platformSHA {
		t.Fatalf("checked-out platform revision does not match %s", index5681PlatformSHAEnv)
	}
	if status := issue5681CommandOutput(
		t,
		ctx,
		repositoryRoot,
		"git", "status", "--porcelain", "--untracked-files=no",
	); strings.TrimSpace(status) != "" {
		t.Fatal("production-scale gate requires a clean tracked platform checkout")
	}

	for service, expected := range map[string]struct {
		imageID  string
		revision string
	}{
		"elitea-main": {
			imageID:  environment.mainImageID,
			revision: environment.platformSHA,
		},
		indexWorkerService: {
			imageID:  environment.workerImageID,
			revision: environment.platformSHA,
		},
		environment.liteLLMService: {
			imageID:  environment.liteLLMImageID,
			revision: environment.liteLLMRevision,
		},
	} {
		containerID, err := harness.compose(ctx, "ps", "-q", service)
		if err != nil || strings.TrimSpace(containerID) == "" ||
			strings.ContainsAny(strings.TrimSpace(containerID), "\r\n") {
			t.Fatalf("attest running %s container identity", service)
		}
		attestation := issue5681CommandOutput(
			t,
			ctx,
			repositoryRoot,
			"docker", "inspect",
			`--format={{.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}`,
			strings.TrimSpace(containerID),
		)
		if strings.TrimSpace(attestation) != expected.imageID+"|"+expected.revision {
			t.Fatalf("running %s image ID/source revision attestation mismatch", service)
		}
	}

	var lock struct {
		DistributionVersion string `json:"distribution_version"`
		Source              struct {
			Revision string `json:"revision"`
		} `json:"source"`
		InstalledPackageTree struct {
			SHA256 string `json:"sha256"`
		} `json:"installed_package_tree"`
		IndexingCapabilityProfile struct {
			ProfileSHA256 string `json:"profile_sha256"`
		} `json:"indexing_capability_profile"`
	}
	lockBytes, err := os.ReadFile(filepath.Join(
		repositoryRoot,
		"services", "elitea-worker-python", "elitea-sdk.lock.json",
	))
	if err != nil || json.Unmarshal(lockBytes, &lock) != nil {
		t.Fatal("read checked-out worker SDK lock")
	}
	if lock.Source.Revision != environment.sdkRevision ||
		lock.DistributionVersion == "" ||
		len(lock.InstalledPackageTree.SHA256) != 64 ||
		len(lock.IndexingCapabilityProfile.ProfileSHA256) != 64 {
		t.Fatal("checked-out worker SDK lock does not match the expected immutable SDK revision")
	}

	const workerAttestation = `import importlib.metadata,json
from elitea_worker.constants import SDK_PACKAGE_TREE_SHA256,SDK_SOURCE_REVISION
from elitea_worker.indexing_runtime_capabilities import require_indexing_runtime_capabilities
print(json.dumps({"revision":SDK_SOURCE_REVISION,"tree":SDK_PACKAGE_TREE_SHA256,"version":importlib.metadata.version("elitea-sdk"),"profile":require_indexing_runtime_capabilities()},sort_keys=True))`
	output, err := harness.compose(
		ctx,
		"exec", "-T", indexWorkerService,
		"python", "-c", workerAttestation,
	)
	if err != nil {
		t.Fatal("attest the running worker SDK and indexing capability profile")
	}
	var actual struct {
		Revision string `json:"revision"`
		Tree     string `json:"tree"`
		Version  string `json:"version"`
		Profile  string `json:"profile"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(output)), &actual) != nil ||
		actual.Revision != lock.Source.Revision ||
		actual.Tree != lock.InstalledPackageTree.SHA256 ||
		actual.Version != lock.DistributionVersion ||
		actual.Profile != lock.IndexingCapabilityProfile.ProfileSHA256 {
		t.Fatal("running worker SDK/capability attestation does not match the checked-out lock")
	}
}

func issue5681CommandOutput(
	t *testing.T,
	ctx context.Context,
	directory string,
	name string,
	arguments ...string,
) string {
	t.Helper()
	command := exec.CommandContext(ctx, name, arguments...)
	command.Dir = directory
	var stdout bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = io.Discard
	if err := command.Run(); err != nil {
		t.Fatalf("execute non-secret provenance command %s", name)
	}
	return stdout.String()
}

func requireIssue5681CleanDedicatedBaseline(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
) {
	t.Helper()
	if count := harness.postgresScalar(
		t,
		ctx,
		`SELECT count(*) FROM elitea_runtime.execution_jobs`,
	); count != "0" {
		t.Fatalf("dedicated Compose project contains pre-existing runtime executions: count=%s", count)
	}
	stream, err := harness.redisReferenceResult(ctx, "")
	if err != nil {
		t.Fatalf("inspect dedicated issue #5681 Redis baseline: %v", err)
	}
	if stream.Length != 0 || stream.Mappings != 0 || stream.EntryCount != 0 {
		t.Fatalf("dedicated issue #5681 Redis baseline is not empty: %+v", stream)
	}
	if pending, err := harness.pendingEntriesResult(ctx); err == nil && len(pending) != 0 {
		t.Fatalf("dedicated issue #5681 Redis consumer group is not empty: %+v", pending)
	}
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

func assertIssue5681AdmissionRBAC(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	body []byte,
	deniedCookie string,
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

	request, err = http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Cookie", deniedCookie)
	response, err = harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("exercise permission-denied index admission: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("authenticated actor without index permission reached admission: status=%d", response.StatusCode)
	}
}

func assertIssue5681PublicReadBoundaries(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	deniedCookie string,
	secondProjectID int64,
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

	request, err = http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Cookie", deniedCookie)
	response, err = harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("exercise permission-denied SSE: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("authenticated actor without replay permission reached SSE: status=%d", response.StatusCode)
	}

	secondProjectEndpoint := fmt.Sprintf(
		"%s/api/v2/executions/%d/%s/events",
		harness.config.baseURL,
		secondProjectID,
		executionID,
	)
	request, err = http.NewRequestWithContext(ctx, http.MethodGet, secondProjectEndpoint, nil)
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

func requireIssue5681SecondProjectAccess(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	projectID int64,
	toolkitID int64,
) {
	t.Helper()
	endpoint := fmt.Sprintf(
		"%s/api/v2/elitea_core/index_meta/prompt_lib/%d/%d",
		harness.config.baseURL,
		projectID,
		toolkitID,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Cookie", harness.config.cookie)
	response, err := harness.config.httpClient.Do(request)
	if err != nil {
		t.Fatalf("verify allowed actor access to the second existing project: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("allowed actor cannot access the supplied second project/toolkit: status=%d", response.StatusCode)
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
	environment index5681Environment,
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
		"--source-authorization-sha256", environment.sourceAuthDigest,
		"--model-authorization-sha256", environment.modelAuthDigest,
		"--proxy-attestation-sha256", environment.proxyAttestationDigest,
	)
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("open fixture stdout: %v", err)
	}
	command.Stderr = io.Discard
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
			t.Fatalf("issue #5681 fixture readiness: %v", err)
		}
	case <-process.done:
		t.Fatalf("issue #5681 fixture exited early: %v", process.waitError())
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

func assertIssue5681DecodedRedisReference(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	expectedClientIdentity string,
) int64 {
	t.Helper()
	const script = `
local rows = redis.call('XRANGE', KEYS[1], '-', '+', 'COUNT', 2)
local mappings = redis.call('HGETALL', KEYS[2])
if #rows ~= 1 or #rows[1][2] ~= 2 or #mappings ~= 2 then return '{}' end
local function hex(value)
  return (string.gsub(value, '.', function(character)
    return string.format('%02x', string.byte(character))
  end))
end
return cjson.encode({
  entry_id = rows[1][1],
  field_name = rows[1][2][1],
  envelope_hex = hex(rows[1][2][2]),
  mapping_field = mappings[1],
  mapping_value = mappings[2],
  stream_length = redis.call('XLEN', KEYS[1]),
  mapping_count = redis.call('HLEN', KEYS[2]),
  field_count = 1,
  envelope_bytes = string.len(rows[1][2][2]),
  mapping_field_bytes = string.len(mappings[1]),
  mapping_value_bytes = string.len(mappings[2])
})`
	output, err := harness.redis(
		ctx,
		"producer",
		"--raw", "EVAL", script, "2",
		indexCommandStream, indexCommandStream+":delivery-index.v1",
	)
	if err != nil {
		t.Fatalf("read issue #5681 Redis command evidence: %v", err)
	}
	var evidence index5681RedisEvidence
	if json.Unmarshal([]byte(strings.TrimSpace(output)), &evidence) != nil ||
		evidence.StreamLength != 1 ||
		evidence.MappingCount != 1 ||
		evidence.FieldCount != 1 ||
		evidence.FieldName != "signed_envelope" ||
		!redisEntryPattern.MatchString(evidence.EntryID) ||
		evidence.MappingValue != evidence.EntryID ||
		evidence.EnvelopeBytes <= 0 ||
		evidence.EnvelopeBytes > 48*1024 ||
		evidence.MappingFieldBytes <= 0 ||
		evidence.MappingFieldBytes > 256 ||
		evidence.MappingValueBytes <= 0 ||
		evidence.MappingValueBytes > 64 {
		t.Fatalf("invalid Redis command/delivery-index evidence: %+v", evidence)
	}
	envelopeBytes, err := hex.DecodeString(evidence.EnvelopeHex)
	if err != nil || int64(len(envelopeBytes)) != evidence.EnvelopeBytes {
		t.Fatal("Redis signed envelope hex evidence is malformed")
	}
	var envelope runtimev1.SignedWorkerCommandEnvelopeV1
	if err := runtimegrpc.ScanStrictMessage(
		envelopeBytes,
		envelope.ProtoReflect().Descriptor(),
	); err != nil {
		t.Fatalf("strictly scan Redis signed envelope: %v", err)
	}
	if err := proto.Unmarshal(envelopeBytes, &envelope); err != nil {
		t.Fatalf("decode Redis signed envelope: %v", err)
	}
	canonicalEnvelope, err := proto.MarshalOptions{Deterministic: true}.Marshal(&envelope)
	if err != nil || !bytes.Equal(canonicalEnvelope, envelopeBytes) ||
		envelope.GetEnvelopeSchemaRevision() != "elitea.runtime.signed-worker-command.v1" ||
		envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_ED25519 ||
		envelope.GetKeyId() == "" ||
		len(envelope.GetSignature()) != 64 ||
		!validIssue5681Digest(envelope.GetWorkerCommandDigest(), envelope.GetWorkerCommandBytes()) {
		t.Fatal("Redis signed envelope is not the exact canonical production contract")
	}

	commandBytes := envelope.GetWorkerCommandBytes()
	var command runtimev1.WorkerCommandV1
	if err := runtimegrpc.ScanStrictMessage(
		commandBytes,
		command.ProtoReflect().Descriptor(),
	); err != nil {
		t.Fatalf("strictly scan Redis worker command: %v", err)
	}
	if err := proto.Unmarshal(commandBytes, &command); err != nil {
		t.Fatalf("decode Redis worker command: %v", err)
	}
	canonicalCommand, err := proto.MarshalOptions{Deterministic: true}.Marshal(&command)
	indexCommand := command.GetIndexIngest()
	projectID := strconv.FormatInt(harness.config.projectID, 10)
	bundle := command.GetInputBundleRef()
	if err != nil || !bytes.Equal(canonicalCommand, commandBytes) ||
		command.GetProtocolRevision() != "elitea.runtime.v1" ||
		command.GetCommandType() != runtimev1.WorkerCommandTypeV1_WORKER_COMMAND_TYPE_V1_INDEX_INGEST ||
		command.GetExecutionId() != executionID ||
		command.GetGeneration() != 1 ||
		command.GetRootExecutionId() != executionID ||
		command.GetTenantId() != projectID ||
		command.GetResourceProjectId() != projectID ||
		command.GetProjectionProjectId() != projectID ||
		command.GetCapabilityId() != "index.ingest.v1" ||
		command.GetCapabilityVersion() != "1" ||
		command.GetCommandId() == "" ||
		command.GetIdempotencyKey() != evidence.MappingField ||
		indexCommand == nil ||
		indexCommand.GetClientStreamId() != expectedClientIdentity ||
		indexCommand.GetClientMessageId() != expectedClientIdentity ||
		indexCommand.GetSioEvent() != "chat_predict" ||
		bundle == nil ||
		bundle.GetInputBundleId() == "" ||
		bundle.GetImmutableVersion() == "" ||
		bundle.GetByteLength() == 0 ||
		bundle.GetByteLength() > 64*1024 ||
		bundle.GetMediaType() == "" ||
		!validIssue5681DigestValue(bundle.GetDigest()) {
		t.Fatal("Redis worker command is not the exact bounded index.ingest.v1 reference contract")
	}

	entryIDs := []string{
		indexCommand.GetToolkitConfigurationEntryId(),
		indexCommand.GetToolParametersEntryId(),
		indexCommand.GetLlmModelEntryId(),
		indexCommand.GetLlmConfigurationEntryId(),
		indexCommand.GetMcpTokensEntryId(),
	}
	if entryIDs[0] == "" || entryIDs[1] == "" {
		t.Fatal("Redis index command lacks required toolkit/tool-parameter references")
	}
	if binding := indexCommand.GetEmbeddingBinding(); binding != nil {
		if binding.GetEntryId() == "" ||
			binding.GetImmutableVersion() == "" ||
			!validIssue5681DigestValue(binding.GetContentDigest()) {
			t.Fatal("Redis index command embedding binding is malformed")
		}
		entryIDs = append(entryIDs, binding.GetEntryId())
	}
	seen := make(map[string]struct{}, len(entryIDs))
	var entryCount int64
	for _, entryID := range entryIDs {
		if entryID == "" {
			continue
		}
		if len(entryID) > 256 {
			t.Fatal("Redis index command contains an oversized input-entry identity")
		}
		if _, duplicate := seen[entryID]; duplicate {
			t.Fatal("Redis index command aliases two immutable input entries")
		}
		seen[entryID] = struct{}{}
		entryCount++
	}
	if entryCount < 2 || entryCount > 6 {
		t.Fatalf("Redis index command references %d input entries, want 2..6", entryCount)
	}
	return entryCount
}

func validIssue5681Digest(digest *runtimev1.DigestV1, value []byte) bool {
	if !validIssue5681DigestValue(digest) {
		return false
	}
	actual := sha256.Sum256(value)
	return bytes.Equal(digest.GetValue(), actual[:])
}

func validIssue5681DigestValue(digest *runtimev1.DigestV1) bool {
	return digest != nil &&
		digest.GetAlgorithm() == runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256 &&
		len(digest.GetValue()) == sha256.Size
}

func assertIssue5681BoundedAdmission(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	expectedInputEntries int64,
) {
	t.Helper()
	snapshot := readIssue5681DurableSnapshot(t, ctx, harness, executionID)
	if snapshot.InputManifestBytes <= 0 || snapshot.InputManifestBytes > 64*1024 ||
		snapshot.InputEntryCount != expectedInputEntries ||
		snapshot.InputEntryCount < 2 || snapshot.InputEntryCount > 6 ||
		snapshot.InputEntryBytes <= 0 || snapshot.InputEntryBytes > 6*256*1024 ||
		snapshot.MaxInputEntryBytes <= 0 || snapshot.MaxInputEntryBytes > 256*1024 ||
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
    'input_entry_count', (SELECT count(*)
                          FROM elitea_runtime.input_bundle_entries AS e
                          WHERE e.input_bundle_id = b.input_bundle_id),
    'input_entry_bytes', (SELECT COALESCE(sum(octet_length(e.content_bytes)), 0)
                          FROM elitea_runtime.input_bundle_entries AS e
                          WHERE e.input_bundle_id = b.input_bundle_id),
    'max_input_entry_bytes', (SELECT COALESCE(max(octet_length(e.content_bytes)), 0)
                              FROM elitea_runtime.input_bundle_entries AS e
                              WHERE e.input_bundle_id = b.input_bundle_id),
    'prepared_envelope_bytes', COALESCE(octet_length(o.prepared_signed_envelope_bytes), 0),
    'max_replay_event_bytes', COALESCE((SELECT max(octet_length(r.event_bytes))
                                       FROM elitea_runtime.execution_replay_events AS r
                                       WHERE r.execution_id = j.execution_id
                                         AND r.generation = j.generation), 0),
    'total_replay_event_bytes', COALESCE((SELECT sum(octet_length(r.event_bytes))
                                         FROM elitea_runtime.execution_replay_events AS r
                                         WHERE r.execution_id = j.execution_id
                                           AND r.generation = j.generation), 0),
    'node_replay_events', (SELECT count(*)
                           FROM elitea_runtime.execution_replay_events AS r
                           WHERE r.execution_id = j.execution_id
                             AND r.generation = j.generation
                             AND r.event_type = 'execution.node_event'),
    'max_output_inbox_bytes', COALESCE((SELECT max(octet_length(i.payload_bytes))
                                       FROM elitea_runtime.output_inbox AS i
                                       WHERE i.execution_id = j.execution_id
                                         AND i.generation = j.generation), 0),
    'total_output_inbox_bytes', COALESCE((SELECT sum(octet_length(i.payload_bytes))
                                         FROM elitea_runtime.output_inbox AS i
                                         WHERE i.execution_id = j.execution_id
                                           AND i.generation = j.generation), 0),
    'output_inbox_frames', (SELECT count(*) FROM elitea_runtime.output_inbox AS i
                            WHERE i.execution_id = j.execution_id
                              AND i.generation = j.generation),
    'last_node_sequence', COALESCE((
        SELECT r.last_node_sequence
        FROM elitea_runtime.execution_replay_state AS r
        WHERE r.execution_id = j.execution_id AND r.generation = j.generation
    ), 0),
    'terminal_sequence', COALESCE((
        SELECT s.terminal_sequence
        FROM elitea_runtime.execution_settlements AS s
        WHERE s.execution_id = j.execution_id AND s.generation = j.generation
    ), 0),
    'output_identity_bound', EXISTS (
        SELECT 1
        FROM elitea_runtime.output_inbox AS i
        JOIN elitea_runtime.execution_claims AS c
          ON c.claim_id = i.claim_id
         AND c.execution_id = i.execution_id
         AND c.generation = i.generation
         AND c.fence_token = i.fence_token
         AND c.workload_identity = i.workload_identity
         AND c.workload_session_id = i.workload_session_id
         AND c.producer_id = i.producer_id
         AND c.claim_attempt = i.claim_attempt
         AND c.lease_epoch = i.lease_epoch
        JOIN elitea_runtime.execution_settlements AS s
          ON s.execution_id = i.execution_id
         AND s.generation = i.generation
         AND s.claim_id = i.claim_id
         AND s.fence_token = i.fence_token
         AND s.workload_identity = i.workload_identity
         AND s.workload_session_id = i.workload_session_id
         AND s.producer_id = i.producer_id
         AND s.claim_attempt = i.claim_attempt
         AND s.lease_epoch = i.lease_epoch
         AND s.final_logical_output_id = i.logical_output_id
         AND s.terminal_event_id = i.event_id
         AND s.terminal_sequence = i.sequence
         AND s.terminal_payload_digest = i.payload_digest
         AND s.idempotency_key = i.settlement_idempotency_key
         AND s.proposal_id = i.settlement_proposal_id
         AND s.proposal_bytes = i.settlement_proposal_bytes
         AND s.proposal_digest = i.settlement_proposal_digest
        JOIN elitea_runtime.execution_replay_state AS r
          ON r.execution_id = i.execution_id
         AND r.generation = i.generation
         AND i.sequence = r.last_node_sequence + 1
        WHERE i.execution_id = j.execution_id
          AND i.generation = j.generation
          AND i.payload_type = 'INDEX_INGEST_RESULT'
          AND i.projected_at IS NOT NULL
          AND s.committed_at IS NOT NULL
          AND c.released_at IS NOT NULL
          AND c.release_reason = 'SETTLED'
    ),
    'workload_session_active', EXISTS (
        SELECT 1
        FROM elitea_runtime.execution_claims AS c
        JOIN elitea_runtime.workload_sessions AS w
          ON w.workload_session_id = c.workload_session_id
         AND w.workload_identity = c.workload_identity
         AND w.producer_id = c.producer_id
        WHERE c.execution_id = j.execution_id
          AND c.generation = j.generation
          AND w.issued_at <= clock_timestamp()
          AND w.expires_at > clock_timestamp()
          AND w.revoked_at IS NULL
    ),
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
	expectedWorkloadIdentity string,
) {
	t.Helper()
	if snapshot.DesiredState != "RUNNING" ||
		snapshot.InvocationState != "MAY_HAVE_STARTED" ||
		snapshot.TenantID != strconv.FormatInt(projectID, 10) ||
		snapshot.ResourceProjectID != projectID ||
		snapshot.ProjectionProjectID != projectID ||
		snapshot.WorkloadIdentity != expectedWorkloadIdentity ||
		snapshot.WorkloadSessionID == "" ||
		!snapshot.WorkloadSessionActive ||
		snapshot.Claims != 1 ||
		snapshot.MaxClaimAttempt != 1 ||
		snapshot.ReleasedClaims != 1 ||
		snapshot.Results != 1 ||
		snapshot.Settlements != 1 ||
		snapshot.ReplayEvents < 4 ||
		snapshot.ReplayEvents > 65 ||
		snapshot.NodeReplayEvents < 3 ||
		snapshot.NodeReplayEvents > 64 ||
		snapshot.IndexCompletedReplay != 1 ||
		!snapshot.TerminalReplayEventSeen ||
		!snapshot.CommittedSettlement ||
		!snapshot.AuthorityGranted ||
		snapshot.Retired ||
		snapshot.MaxReplayEventBytes <= 0 ||
		snapshot.MaxReplayEventBytes > 48*1024 ||
		snapshot.TotalReplayEventBytes <= 0 ||
		snapshot.TotalReplayEventBytes > 1024*1024 ||
		snapshot.OutputInboxFrames != 1 ||
		snapshot.MaxOutputInboxBytes <= 0 ||
		snapshot.MaxOutputInboxBytes > 256*1024 ||
		snapshot.TotalOutputInboxBytes != snapshot.MaxOutputInboxBytes ||
		snapshot.LastNodeSequence != snapshot.NodeReplayEvents ||
		snapshot.TerminalSequence != snapshot.LastNodeSequence+1 ||
		!snapshot.OutputIdentityBound {
		t.Fatalf("terminal durability/idempotency contract mismatch: %+v", snapshot)
	}
}

func observeIssue5681SSE(
	t *testing.T,
	parent context.Context,
	harness *indexComposeHarness,
	executionID string,
	expectedStreamID string,
	expectedMessageID string,
	forbiddenValues []string,
) (context.CancelFunc, <-chan index5681SSEObservation) {
	t.Helper()
	ctx, cancel := context.WithCancel(parent)
	done := make(chan index5681SSEObservation, 1)
	ready := make(chan error, 1)
	go func() {
		observation, err := collectIssue5681SSE(
			ctx,
			harness,
			executionID,
			expectedStreamID,
			expectedMessageID,
			forbiddenValues,
			ready,
		)
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
	expectedStreamID string,
	expectedMessageID string,
	forbiddenValues []string,
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
		return index5681SSEObservation{}, fmt.Errorf(
			"status=%d content-type=%q",
			response.StatusCode,
			response.Header.Get("Content-Type"),
		)
	}
	ready <- nil

	observation := index5681SSEObservation{
		ThinkingIndex:   -1,
		InProgressIndex: -1,
		CompletedIndex:  -1,
	}
	var eventType string
	var data strings.Builder
	var toolRunID string
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 4096), 128*1024)
	flush := func() bool {
		if eventType == "" {
			data.Reset()
			return false
		}
		raw := []byte(data.String())
		observation.EventCount++
		observation.EventTypes = append(observation.EventTypes, eventType)
		observation.MaxDataBytes = max(observation.MaxDataBytes, len(raw))
		observation.TotalDataBytes += len(raw)
		if issue5681UnsafePayload(raw, forbiddenValues) {
			observation.UnsafeDataObserved = true
		}
		switch eventType {
		case "execution.node_event":
			event, err := nodeevent.DecodeCurrentJSON(raw)
			if err != nil {
				observation.InvalidContract = true
				break
			}
			canonical, err := nodeevent.EncodeCurrentJSON(event)
			if err != nil || !bytes.Equal(canonical, raw) ||
				event.GetStreamId() != expectedStreamID ||
				event.GetMessageId() != expectedMessageID ||
				event.GetSioEvent() != "chat_predict" {
				observation.InvalidContract = true
			}
			eventIndex := len(observation.NodeTypes)
			observation.NodeTypes = append(observation.NodeTypes, event.GetType())
			var metadata map[string]any
			decoder := json.NewDecoder(bytes.NewReader(event.GetResponseMetadata()))
			decoder.UseNumber()
			if err := decoder.Decode(&metadata); err != nil {
				observation.InvalidContract = true
				break
			}
			currentToolRunID, _ := metadata["tool_run_id"].(string)
			if currentToolRunID == "" {
				observation.InvalidContract = true
			} else if toolRunID == "" {
				toolRunID = currentToolRunID
			} else if toolRunID != currentToolRunID {
				observation.InvalidContract = true
			}
			switch event.GetType() {
			case "agent_tool_start":
			case "agent_thinking_step", "agent_thinking_step_update":
				observation.ThinkingEvents++
				if observation.ThinkingIndex == -1 {
					observation.ThinkingIndex = eventIndex
				}
			case "agent_index_data_status":
				state, _ := metadata["state"].(string)
				observation.StatusStates = append(observation.StatusStates, state)
				if metadata["name"] != "index_data_status" ||
					metadata["task_id"] != executionID ||
					!issue5681JSONIntegerEquals(metadata["project_id"], harness.config.projectID) ||
					!issue5681JSONIntegerEquals(metadata["toolkit_id"], harness.config.toolkitID) {
					observation.InvalidContract = true
				}
				switch state {
				case "in_progress":
					if observation.InProgressIndex != -1 {
						observation.InvalidContract = true
					}
					observation.InProgressIndex = eventIndex
				case "completed":
					if observation.CompletedIndex != -1 {
						observation.InvalidContract = true
					}
					observation.CompletedIndex = eventIndex
				default:
					observation.InvalidContract = true
				}
			case "agent_tool_end":
			default:
				observation.InvalidContract = true
			}
		case "index.ingest.completed":
			decoder := json.NewDecoder(bytes.NewReader(raw))
			decoder.DisallowUnknownFields()
			var terminal struct {
				Status  string `json:"status"`
				Message string `json:"message"`
			}
			if err := decoder.Decode(&terminal); err != nil ||
				decoder.Decode(new(any)) != io.EOF {
				observation.InvalidContract = true
			}
			canonical, err := json.Marshal(terminal)
			if err != nil || !bytes.Equal(canonical, raw) {
				observation.InvalidContract = true
			}
			observation.TerminalEvents++
			observation.TerminalSeen = true
			observation.TerminalStatus = terminal.Status
			observation.TerminalMessage = terminal.Message
		default:
			observation.InvalidContract = true
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

func issue5681JSONIntegerEquals(value any, expected int64) bool {
	number, ok := value.(json.Number)
	if !ok {
		return false
	}
	actual, err := strconv.ParseInt(number.String(), 10, 64)
	return err == nil && actual == expected
}

func issue5681UnsafePayload(raw []byte, forbiddenValues []string) bool {
	lower := strings.ToLower(string(raw))
	for _, marker := range []string{
		"authorization",
		"bearer ",
		"api_key",
		"api-key",
		"auth_token",
		"private_token",
		"password",
		"client_secret",
		"toolkit_config",
		"llm_configuration",
		"mcp_tokens",
		"data:image/",
		"base64,",
	} {
		if strings.Contains(lower, marker) {
			return true
		}
	}
	for _, value := range forbiddenValues {
		if value != "" && strings.Contains(lower, strings.ToLower(value)) {
			return true
		}
	}
	for _, field := range strings.FieldsFunc(lower, func(character rune) bool {
		return !(character >= 'a' && character <= 'z') &&
			!(character >= '0' && character <= '9') &&
			character != '+' && character != '/' && character != '='
	}) {
		if len(field) > 4096 {
			return true
		}
	}
	return false
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

func assertIssue5681SSE(
	t *testing.T,
	observation index5681SSEObservation,
	durable index5681DurableSnapshot,
) {
	t.Helper()
	expectedCompletion := "Successfully indexed 1 documents (12 chunks)."
	if observation.InvalidContract ||
		observation.UnsafeDataObserved ||
		!observation.TerminalSeen ||
		observation.TerminalEvents != 1 ||
		observation.TerminalStatus != "ok" ||
		observation.TerminalMessage != expectedCompletion ||
		observation.EventCount != int(durable.ReplayEvents) ||
		len(observation.NodeTypes) != int(durable.NodeReplayEvents) ||
		observation.TotalDataBytes != int(durable.TotalReplayEventBytes) ||
		observation.MaxDataBytes <= 0 ||
		observation.MaxDataBytes > nodeevent.MaxCurrentJSONBytes ||
		observation.TotalDataBytes > 1024*1024 ||
		len(observation.NodeTypes) < 5 ||
		len(observation.NodeTypes) > 64 ||
		observation.NodeTypes[0] != "agent_tool_start" ||
		observation.NodeTypes[len(observation.NodeTypes)-1] != "agent_tool_end" ||
		observation.ThinkingEvents < 1 ||
		observation.ThinkingIndex <= 0 ||
		observation.InProgressIndex <= observation.ThinkingIndex ||
		observation.CompletedIndex <= observation.InProgressIndex ||
		observation.CompletedIndex >= len(observation.NodeTypes)-1 ||
		len(observation.StatusStates) != 2 ||
		observation.StatusStates[0] != "in_progress" ||
		observation.StatusStates[1] != "completed" ||
		observation.EventTypes[len(observation.EventTypes)-1] != "index.ingest.completed" {
		t.Fatalf("SSE did not preserve the exact bounded current indexing contract: %+v", observation)
	}
	for index, eventType := range observation.EventTypes {
		if index == len(observation.EventTypes)-1 {
			continue
		}
		if eventType != "execution.node_event" {
			t.Fatalf("unexpected non-terminal SSE event %q at position %d", eventType, index)
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
		receipt.RejectedSourceRequests != 0 ||
		receipt.RejectedModelRequests != 0 ||
		receipt.RejectedProxyRequests != 0 {
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

func removeIssue5681SyntheticConsumer(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
) {
	t.Helper()
	const script = `
local removed = redis.call('XGROUP', 'DELCONSUMER', KEYS[1], ARGV[1], ARGV[2])
local consumers = redis.call('XINFO', 'CONSUMERS', KEYS[1], ARGV[1])
local remaining = false
for _, consumer in ipairs(consumers) do
  for i = 1, #consumer, 2 do
    if consumer[i] == 'name' and consumer[i + 1] == ARGV[2] then remaining = true end
  end
end
return cjson.encode({removed_pending = removed, remaining = remaining})`
	output, err := harness.redis(
		ctx,
		"indexer-worker",
		"--raw", "EVAL", script, "1",
		indexCommandStream, indexConsumerGroup, syntheticConsumer,
	)
	if err != nil {
		t.Fatalf("remove synthetic Redis consumer: %v", err)
	}
	var result struct {
		RemovedPending int64 `json:"removed_pending"`
		Remaining      bool  `json:"remaining"`
	}
	if json.Unmarshal([]byte(strings.TrimSpace(output)), &result) != nil ||
		result.RemovedPending != 0 || result.Remaining {
		t.Fatalf("synthetic Redis consumer was not cleanly removed: %+v", result)
	}
}

type index5681MetaItem struct {
	ID       string         `json:"id"`
	Metadata map[string]any `json:"metadata"`
	Stale    bool           `json:"stale"`
}

func assertIssue5681PgVectorOutcome(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	indexName string,
) {
	t.Helper()
	items, err := listIssue5681IndexMeta(ctx, harness)
	if err != nil {
		t.Fatal(err)
	}
	var matches []index5681MetaItem
	for _, item := range items {
		if item.Metadata["collection"] == indexName {
			matches = append(matches, item)
		}
	}
	if len(matches) != 1 {
		t.Fatalf("public PgVector metadata contains %d rows for exact collection %q", len(matches), indexName)
	}
	item := matches[0]
	if item.ID == "" || len(item.ID) > 256 || item.Stale ||
		item.Metadata["state"] != "completed" ||
		!issue5681JSONIntegerEquals(item.Metadata["indexed"], 1) ||
		!issue5681JSONIntegerEquals(item.Metadata["updated"], 0) {
		t.Fatalf("public PgVector metadata does not prove the exact completed business result: %+v", item)
	}
}

func listIssue5681IndexMeta(
	ctx context.Context,
	harness *indexComposeHarness,
) ([]index5681MetaItem, error) {
	endpoint := fmt.Sprintf(
		"%s/api/v2/elitea_core/index_meta/prompt_lib/%d/%d",
		harness.config.baseURL,
		harness.config.projectID,
		harness.config.toolkitID,
	)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Cookie", harness.config.cookie)
	response, err := harness.config.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("read public index metadata: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("read public index metadata: status=%d", response.StatusCode)
	}
	body, err := io.ReadAll(io.LimitReader(response.Body, 8*1024*1024+1))
	if err != nil || len(body) > 8*1024*1024 {
		return nil, errors.New("public index metadata exceeded the test response bound")
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var items []index5681MetaItem
	if err := decoder.Decode(&items); err != nil || len(items) > 1000 {
		return nil, errors.New("decode bounded public index metadata")
	}
	return items, nil
}

func cleanupIssue5681Index(
	ctx context.Context,
	harness *indexComposeHarness,
	indexName string,
) error {
	items, err := listIssue5681IndexMeta(ctx, harness)
	if err != nil {
		return err
	}
	for _, item := range items {
		if item.Metadata["collection"] != indexName {
			continue
		}
		if item.ID == "" || len(item.ID) > 256 ||
			url.PathEscape(item.ID) != item.ID {
			return errors.New("unsafe public index metadata identity")
		}
		endpoint := fmt.Sprintf(
			"%s/api/v2/elitea_core/index_meta/prompt_lib/%d/%d/%s",
			harness.config.baseURL,
			harness.config.projectID,
			harness.config.toolkitID,
			url.PathEscape(item.ID),
		)
		request, requestErr := http.NewRequestWithContext(ctx, http.MethodDelete, endpoint, nil)
		if requestErr != nil {
			return requestErr
		}
		request.Header.Set("Cookie", harness.config.cookie)
		response, requestErr := harness.config.httpClient.Do(request)
		if requestErr != nil {
			return fmt.Errorf("delete public index metadata: %w", requestErr)
		}
		response.Body.Close()
		if response.StatusCode != http.StatusOK &&
			response.StatusCode != http.StatusNoContent {
			return fmt.Errorf("delete public index metadata: status=%d", response.StatusCode)
		}
	}
	remaining, err := listIssue5681IndexMeta(ctx, harness)
	if err != nil {
		return err
	}
	for _, item := range remaining {
		if item.Metadata["collection"] == indexName {
			return errors.New("public index delete left the collection visible")
		}
	}
	return nil
}

func equalIssue5681Receipts(left, right index5681FixtureReceipt) bool {
	leftBytes, leftErr := json.Marshal(left)
	rightBytes, rightErr := json.Marshal(right)
	return leftErr == nil && rightErr == nil && bytes.Equal(leftBytes, rightBytes)
}

func waitForIssue5681CancelledStability(
	t *testing.T,
	ctx context.Context,
	harness *indexComposeHarness,
	executionID string,
	expected indexJobSnapshot,
	fixtureBaseURL string,
	expectedReceipt index5681FixtureReceipt,
	canary string,
) {
	t.Helper()
	stable := 0
	err := pollIndexReliability(ctx, 500*time.Millisecond, func() (bool, error) {
		job, err := harness.jobSnapshot(ctx, executionID)
		if err != nil {
			return false, err
		}
		if job != expected {
			return false, fmt.Errorf("cancelled execution changed after worker restart")
		}
		durable, err := issue5681DurableSnapshotResult(ctx, harness, executionID)
		if err != nil {
			return false, err
		}
		if durable.State != "CANCELLED" ||
			durable.DesiredState != "CANCELLED" ||
			durable.Claims != 0 ||
			durable.Results != 0 ||
			durable.Settlements != 0 ||
			durable.OutputInboxFrames != 0 ||
			durable.AuthorityGranted ||
			!durable.Retired {
			return false, errors.New("cancelled execution crossed worker authority after restart")
		}
		redisSnapshot, err := harness.redisReferenceResult(ctx, canary)
		if err != nil {
			return false, err
		}
		pending, err := harness.pendingEntriesResult(ctx)
		if err != nil {
			return false, err
		}
		receipt, err := issue5681ReceiptResult(ctx, fixtureBaseURL)
		if err != nil {
			return false, err
		}
		if redisSnapshot.Length != 0 ||
			redisSnapshot.Mappings != 0 ||
			len(pending) != 0 ||
			!equalIssue5681Receipts(receipt, expectedReceipt) {
			return false, errors.New("cancelled execution produced post-restart side effects")
		}
		stable++
		return stable >= 6, nil
	})
	if err != nil {
		t.Fatalf("post-cancellation worker restart stability: %v", err)
	}
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

func TestIssue5681PayloadSafetyRejectsBulkAndPrivateMarkers(t *testing.T) {
	for _, raw := range [][]byte{
		[]byte(`{"response_metadata":{"authorization":"redacted"}}`),
		[]byte(`{"response_metadata":{"payload":"data:image/png;base64,AAAA"}}`),
		[]byte(`{"response_metadata":{"message":"private-digest"}}`),
		[]byte(`{"response_metadata":{"toolkit_config":{}}}`),
	} {
		if !issue5681UnsafePayload(raw, []string{"private-digest"}) {
			t.Fatalf("unsafe issue #5681 payload was accepted: %s", raw)
		}
	}
	if issue5681UnsafePayload(
		[]byte(`{"type":"agent_thinking_step","response_metadata":{"message":"20 files processed"}}`),
		nil,
	) {
		t.Fatal("bounded safe issue #5681 progress was rejected")
	}
}

func TestIssue5681DigestValidatesExactBytes(t *testing.T) {
	value := []byte("bounded-reference")
	sum := sha256.Sum256(value)
	digest := &runtimev1.DigestV1{
		Algorithm: runtimev1.DigestAlgorithmV1_DIGEST_ALGORITHM_V1_SHA256,
		Value:     append([]byte(nil), sum[:]...),
	}
	if !validIssue5681Digest(digest, value) {
		t.Fatal("exact issue #5681 SHA-256 digest was rejected")
	}
	if validIssue5681Digest(digest, []byte("different")) {
		t.Fatal("issue #5681 digest accepted different bytes")
	}
}
