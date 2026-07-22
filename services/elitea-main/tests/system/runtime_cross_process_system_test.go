package system_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	"github.com/jackc/pgx/v5/pgxpool"
	redis "github.com/redis/go-redis/v9"
	"google.golang.org/protobuf/proto"
)

const (
	systemTestOptIn = "ELITEA_RUNTIME_SYSTEM_TEST"
	commandStream   = "elitea:runtime:commands"
	consumerGroup   = "elitea-runtime-v1"
	workloadSession = "system-session-1"
	producerID      = "system-producer-1"
	workloadID      = "spiffe://elitea.test/runtime/python-worker"
	signingKeyID    = "system-ed25519-key-1"
	revisionID      = "configuration-revision-system-1"

	producerPassword = "system-producer-password-5681"
	workerPassword   = "system-worker-password-5681"
	observerPassword = "system-observer-password-5681"
	publicSecret     = "system-public-session-secret-5681"
	testReclaimIdle  = 60 * time.Second

	catalogRevision = "2cb85480260a92207f3b3d6d3a84149e10de7949"
	catalogDigest   = "1cfe9846435f68d5ec46d6bc36992679a4fadbbe248a28879c0a312969ca6ef4"
	schemaID        = "elitea.configuration.openapi"
	schemaRevision  = catalogRevision
	schemaDigest    = "8d72b85e9f389410a56a0dd11b5ed6a031ac5c5c677f5f8b68278bb7be638b4d"
)

// TestProductionRuntimeCrossProcessSystem is retained as a topology fixture,
// but cannot be production evidence while public admission/SSE are deliberately
// unmounted. The next system slice must drive a private authenticated admission
// seam and test public routes separately after exact legacy RBAC/audit parity.
func TestProductionRuntimeCrossProcessSystem(t *testing.T) {
	if os.Getenv(systemTestOptIn) != "1" {
		t.Skip("set ELITEA_RUNTIME_SYSTEM_TEST=1 to run the Docker-backed cross-process runtime system test")
	}
	t.Skip("pending private admission refactor; public runtime routes are intentionally unmounted")

	repositoryRoot := findRepositoryRoot(t)
	python := systemPython(t, repositoryRoot)
	requireCommand(t, "docker")
	requirePythonRuntime(t, python, repositoryRoot)

	root := canonicalTempDir(t)
	pki := generateRuntimePKI(t, root)
	signing := generateSigningMaterial(t, root)
	spoolRoot := filepath.Join(root, "spool")
	mustMkdir(t, spoolRoot, 0o700)
	spoolKeyPath := filepath.Join(root, "spool.key")
	writeFile(t, spoolKeyPath, bytes.Repeat([]byte{0x5a}, 32), 0o600)
	producerPasswordPath := filepath.Join(root, "producer.password")
	workerPasswordPath := filepath.Join(root, "worker.password")
	writeFile(t, producerPasswordPath, []byte(producerPassword), 0o600)
	writeFile(t, workerPasswordPath, []byte(workerPassword), 0o600)

	postgresPort := freePort(t)
	legacyRedisPort := freePort(t)
	controlRedisPort := freePort(t)
	publicPort := freePort(t)
	controlPort := freePort(t)
	outputPort := freePort(t)
	contentPort := freePort(t)

	containers := &containerSet{}
	t.Cleanup(containers.stopAll)
	postgresName := containers.start(t,
		"postgres", "postgres:16-alpine",
		[]string{
			"-e", "POSTGRES_USER=elitea",
			"-e", "POSTGRES_PASSWORD=elitea",
			"-e", "POSTGRES_DB=elitea",
			"-p", fmt.Sprintf("127.0.0.1:%d:5432", postgresPort),
		},
	)
	legacyRedisName := containers.start(t,
		"legacy-redis", "redis:7-alpine",
		[]string{"-p", fmt.Sprintf("127.0.0.1:%d:6379", legacyRedisPort)},
		"redis-server", "--save", "", "--appendonly", "no",
	)
	_ = legacyRedisName

	redisConfigDir := filepath.Join(root, "redis")
	mustMkdir(t, redisConfigDir, 0o755)
	prepareTLSRedisConfig(t, redisConfigDir, pki)
	controlRedisName := containers.start(t,
		"control-redis", "redis:7-alpine",
		[]string{
			"-p", fmt.Sprintf("127.0.0.1:%d:6379", controlRedisPort),
			"-v", redisConfigDir + ":/runtime:ro",
		},
		"redis-server", "/runtime/redis.conf",
	)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	databaseURL := fmt.Sprintf("postgres://elitea:elitea@127.0.0.1:%d/elitea?sslmode=disable", postgresPort)
	pool := waitForPostgres(t, ctx, databaseURL, containers, postgresName)
	defer pool.Close()
	bootstrapDatabase(t, ctx, repositoryRoot, pool)

	mainBinary := filepath.Join(root, "elitea-main")
	migrateBinary := filepath.Join(root, "elitea-migrate")
	buildGoBinary(t, repositoryRoot, mainBinary, "./cmd/elitea-main")
	buildGoBinary(t, repositoryRoot, migrateBinary, "./cmd/elitea-migrate")
	runCommand(t, filepath.Join(repositoryRoot, "services", "elitea-main"), []string{"DATABASE_URL=" + databaseURL}, migrateBinary, "-all-tenants")

	settingsMarker := "REDIS-MUST-NEVER-CONTAIN-SETTINGS-5681-" + strings.Repeat("x", 24*1024)
	settings := []byte(`{"scope":"` + settingsMarker + `"}`)
	seedRuntimeFixtures(t, ctx, pool, settings)

	observer := newControlRedisClient(t, controlRedisPort, "observer", observerPassword, pki.caPath)
	defer observer.Close()
	waitForRedis(t, ctx, observer, containers, controlRedisName)
	if err := observer.XGroupCreateMkStream(ctx, commandStream, consumerGroup, "0-0").Err(); err != nil {
		t.Fatalf("provision single runtime consumer group: %v", err)
	}
	assertBrokerLeastPrivilege(t, ctx, controlRedisPort, pki.caPath, observer)

	mainLog := filepath.Join(root, "elitea-main.log")
	mainProcess := startChild(t, "elitea-main", mainLog, filepath.Join(repositoryRoot, "services", "elitea-main"), runtimeMainEnvironment(
		databaseURL,
		legacyRedisPort,
		controlRedisPort,
		publicPort,
		controlPort,
		outputPort,
		contentPort,
		producerPasswordPath,
		pki,
		signing,
	), mainBinary)
	t.Cleanup(func() { mainProcess.stop(t) })
	publicBaseURL := fmt.Sprintf("http://127.0.0.1:%d", publicPort)
	waitForMain(t, ctx, publicBaseURL, mainProcess)

	badSignatureConfigPath := writeWorkerConfig(t, root, "bad-signature", controlRedisPort, controlPort, outputPort, contentPort, publicPort, workerPasswordPath, pki, signing.badKeyringPath, spoolRoot, spoolKeyPath)
	badSignatureWorker := startWorker(t, python, repositoryRoot, badSignatureConfigPath, filepath.Join(root, "worker-bad-signature.log"))
	t.Cleanup(func() { badSignatureWorker.stop(t) })
	waitForWorkerConsumer(t, ctx, observer, "worker-bad-signature", badSignatureWorker)

	admission := submitValidation(t, publicBaseURL, settings)
	waitForPendingDelivery(t, ctx, observer, pool, admission.ExecutionID, "worker-bad-signature", badSignatureWorker)
	assertReferenceOnlyRedisEntry(t, ctx, observer, settingsMarker)
	assertNoClaim(t, ctx, pool, admission.ExecutionID)
	badSignatureWorker.stop(t)
	agePendingDelivery(t, ctx, controlRedisPort, pki.caPath, "worker-bad-signature")

	wrongIdentityPKI := pki
	wrongIdentityPKI.workerCertPath = pki.wrongIdentityWorkerCertPath
	wrongIdentityPKI.workerKeyPath = pki.wrongIdentityWorkerKeyPath
	badIdentityConfigPath := writeWorkerConfig(t, root, "bad-identity", controlRedisPort, controlPort, outputPort, contentPort, publicPort, workerPasswordPath, wrongIdentityPKI, signing.goodKeyringPath, spoolRoot, spoolKeyPath)
	badIdentityWorker := startWorker(t, python, repositoryRoot, badIdentityConfigPath, filepath.Join(root, "worker-bad-identity.log"))
	t.Cleanup(func() { badIdentityWorker.stop(t) })
	waitForPendingDelivery(t, ctx, observer, pool, admission.ExecutionID, "worker-bad-identity", badIdentityWorker)
	assertNoClaim(t, ctx, pool, admission.ExecutionID)
	badIdentityWorker.stop(t)
	agePendingDelivery(t, ctx, controlRedisPort, pki.caPath, "worker-bad-identity")

	untrustedPKI := pki
	untrustedPKI.workerCertPath = pki.untrustedWorkerCertPath
	untrustedPKI.workerKeyPath = pki.untrustedWorkerKeyPath
	badTLSConfigPath := writeWorkerConfig(t, root, "bad-tls", controlRedisPort, controlPort, outputPort, contentPort, publicPort, workerPasswordPath, untrustedPKI, signing.goodKeyringPath, spoolRoot, spoolKeyPath)
	badTLSWorker := startWorker(t, python, repositoryRoot, badTLSConfigPath, filepath.Join(root, "worker-bad-tls.log"))
	t.Cleanup(func() { badTLSWorker.stop(t) })
	waitForPendingDelivery(t, ctx, observer, pool, admission.ExecutionID, "worker-bad-tls", badTLSWorker)
	assertNoClaim(t, ctx, pool, admission.ExecutionID)
	badTLSWorker.stop(t)
	agePendingDelivery(t, ctx, controlRedisPort, pki.caPath, "worker-bad-tls")

	goodConfigPath := writeWorkerConfig(t, root, "good", controlRedisPort, controlPort, outputPort, contentPort, publicPort, workerPasswordPath, pki, signing.goodKeyringPath, spoolRoot, spoolKeyPath)
	goodWorker := startWorker(t, python, repositoryRoot, goodConfigPath, filepath.Join(root, "worker-good.log"))
	t.Cleanup(func() { goodWorker.stop(t) })

	waitForSettlementAndRetirement(t, ctx, pool, observer, admission.ExecutionID, goodWorker)
	assertAuthorizedSSE(t, publicBaseURL, admission.ExecutionID, settingsMarker)
	assertForwardedIdentityCannotReadSSE(t, publicBaseURL, admission.ExecutionID)
	assertDurableTerminalState(t, ctx, pool, admission.ExecutionID)
}

func assertBrokerLeastPrivilege(t *testing.T, ctx context.Context, port int, caPath string, observer *redis.Client) {
	t.Helper()
	worker := newControlRedisClient(t, port, "worker", workerPassword, caPath)
	defer worker.Close()
	producer := newControlRedisClient(t, port, "producer", producerPassword, caPath)
	defer producer.Close()

	assertNOPERM := func(operation string, err error) {
		t.Helper()
		if err == nil || !strings.Contains(strings.ToUpper(err.Error()), "NOPERM") {
			t.Fatalf("Redis ACL allowed forbidden %s operation: %v", operation, err)
		}
	}
	assertNOPERM("worker XADD", worker.XAdd(ctx, &redis.XAddArgs{
		Stream: commandStream,
		Values: map[string]any{"signed_envelope": "forbidden"},
	}).Err())
	assertNOPERM("worker PUBLISH", worker.Publish(ctx, commandStream, "forbidden").Err())
	assertNOPERM("worker HSET", worker.HSet(ctx, commandStream+":delivery-index.v1", "forbidden", "0-0").Err())
	assertNOPERM("producer XREADGROUP", producer.XReadGroup(ctx, &redis.XReadGroupArgs{
		Group:    consumerGroup,
		Consumer: "forbidden-producer",
		Streams:  []string{commandStream, ">"},
		Count:    1,
	}).Err())
	assertNOPERM("producer XACK", producer.XAck(ctx, commandStream, consumerGroup, "0-0").Err())
	assertNOPERM("producer XDEL", producer.XDel(ctx, commandStream, "0-0").Err())
	assertNOPERM("observer XCLAIM", observer.Do(
		ctx,
		"XCLAIM",
		commandStream,
		consumerGroup,
		"forbidden-observer",
		0,
		"0-0",
		"JUSTID",
	).Err())

	length, err := observer.XLen(ctx, commandStream).Result()
	if err != nil || length != 0 {
		t.Fatalf("forbidden broker operations changed the command stream: length=%d err=%v", length, err)
	}
	mappings, err := observer.HLen(ctx, commandStream+":delivery-index.v1").Result()
	if err != nil || mappings != 0 {
		t.Fatalf("settled broker delivery retained mappings: mappings=%d err=%v", mappings, err)
	}
}

type admissionResponse struct {
	ExecutionID string `json:"execution_id"`
	CommandID   string `json:"command_id"`
	Created     bool   `json:"created"`
}

func submitValidation(t *testing.T, publicBaseURL string, settings []byte) admissionResponse {
	t.Helper()
	body := append([]byte(`{"settings":`), settings...)
	body = append(body, '}')
	request, err := http.NewRequest(http.MethodPost, publicBaseURL+"/api/v2/configurations/validation/1/"+revisionID, bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Idempotency-Key", "system-validation-1")
	request.AddCookie(&http.Cookie{Name: "elitea_session", Value: sessionCookie(t, publicSecret)})
	response, err := (&http.Client{Timeout: 10 * time.Second}).Do(request)
	if err != nil {
		t.Fatalf("submit public validation: %v", err)
	}
	defer response.Body.Close()
	var admitted admissionResponse
	if err := json.NewDecoder(response.Body).Decode(&admitted); err != nil {
		t.Fatalf("decode admission response with status %d: %v", response.StatusCode, err)
	}
	if response.StatusCode != http.StatusAccepted || admitted.ExecutionID == "" || admitted.CommandID == "" || !admitted.Created {
		t.Fatalf("unexpected admission status=%d body=%+v", response.StatusCode, admitted)
	}
	return admitted
}

func assertReferenceOnlyRedisEntry(t *testing.T, ctx context.Context, client *redis.Client, settingsMarker string) {
	t.Helper()
	entries, err := client.XRangeN(ctx, commandStream, "-", "+", 2).Result()
	if err != nil {
		t.Fatalf("read bounded control stream: %v", err)
	}
	if len(entries) != 1 || len(entries[0].Values) != 1 {
		t.Fatalf("control stream must contain one one-field reference entry, got %#v", entries)
	}
	raw, ok := entries[0].Values["signed_envelope"].(string)
	if !ok || len(raw) == 0 || len(raw) > 48*1024 {
		t.Fatalf("signed_envelope field has unexpected type/size: %T/%d", entries[0].Values["signed_envelope"], len(raw))
	}
	if strings.Contains(raw, settingsMarker) {
		t.Fatal("Redis control entry contains settings data")
	}
	envelope := &runtimev1.SignedWorkerCommandEnvelopeV1{}
	if err := proto.Unmarshal([]byte(raw), envelope); err != nil {
		t.Fatalf("decode production signed envelope: %v", err)
	}
	if envelope.GetSignatureProfile() != runtimev1.SignatureProfileV1_SIGNATURE_PROFILE_V1_ED25519 || envelope.GetKeyId() != signingKeyID {
		t.Fatalf("unexpected production signature profile/key: %s/%q", envelope.GetSignatureProfile(), envelope.GetKeyId())
	}
	command := &runtimev1.WorkerCommandV1{}
	if err := proto.Unmarshal(envelope.GetWorkerCommandBytes(), command); err != nil {
		t.Fatalf("decode reference command: %v", err)
	}
	if command.GetInputBundleRef() == nil || command.GetInputBundleRef().GetByteLength() == 0 || command.GetConfigurationValidation() == nil {
		t.Fatalf("command lost immutable input reference: %v", command)
	}
}

func assertNoClaim(t *testing.T, ctx context.Context, pool *pgxpool.Pool, executionID string) {
	t.Helper()
	var claimCount int
	var state string
	if err := pool.QueryRow(ctx, `SELECT count(*) FROM elitea_runtime.execution_claims WHERE execution_id = $1`, executionID).Scan(&claimCount); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `SELECT state FROM elitea_runtime.execution_jobs WHERE execution_id = $1`, executionID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if claimCount != 0 || state != "DISPATCHED" {
		t.Fatalf("wrong-key worker crossed the signature boundary: claims=%d state=%s", claimCount, state)
	}
}

func assertAuthorizedSSE(t *testing.T, publicBaseURL, executionID, settingsMarker string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, publicBaseURL+"/api/v2/executions/1/"+url.PathEscape(executionID)+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.AddCookie(&http.Cookie{Name: "elitea_session", Value: sessionCookie(t, publicSecret)})
	response, err := (&http.Client{}).Do(request)
	if err != nil {
		t.Fatalf("open authorized SSE: %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK || response.Header.Get("Content-Type") != "text/event-stream" {
		t.Fatalf("unexpected SSE response status=%d content-type=%q", response.StatusCode, response.Header.Get("Content-Type"))
	}

	var eventType, data string
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1024), 128*1024)
	for scanner.Scan() {
		line := scanner.Text()
		switch {
		case strings.HasPrefix(line, "event: "):
			eventType = strings.TrimPrefix(line, "event: ")
		case strings.HasPrefix(line, "data: "):
			data = strings.TrimPrefix(line, "data: ")
		case line == "" && eventType != "" && data != "":
			if eventType != "configuration.validation.completed" || strings.Contains(data, settingsMarker) {
				t.Fatalf("unsafe or unexpected SSE event type=%q data=%s", eventType, data)
			}
			var result struct {
				ConfigurationRevisionID string `json:"configuration_revision_id"`
				Valid                   bool   `json:"valid"`
				Issues                  []any  `json:"issues"`
			}
			if err := json.Unmarshal([]byte(data), &result); err != nil || result.ConfigurationRevisionID != revisionID || !result.Valid || len(result.Issues) != 0 {
				t.Fatalf("unexpected durable SSE projection: data=%s err=%v", data, err)
			}
			return
		}
	}
	if err := scanner.Err(); err != nil && !errors.Is(err, context.Canceled) {
		t.Fatalf("read authorized SSE: %v", err)
	}
	t.Fatal("authorized SSE closed without the durable terminal event")
}

func assertForwardedIdentityCannotReadSSE(t *testing.T, publicBaseURL, executionID string) {
	t.Helper()
	request, err := http.NewRequest(http.MethodGet, publicBaseURL+"/api/v2/executions/1/"+url.PathEscape(executionID)+"/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("X-Auth-Type", "spoofed-forward-auth")
	request.Header.Set("X-Auth-Id", "1")
	request.Header.Set("X-Auth-Reference", "attacker@example.test")
	response, err := (&http.Client{Timeout: 5 * time.Second}).Do(request)
	if err != nil {
		t.Fatalf("exercise forwarded-identity rejection: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusForbidden {
		t.Fatalf("forwarded public headers reached protected runtime SSE: status=%d", response.StatusCode)
	}
}

func assertDurableTerminalState(t *testing.T, ctx context.Context, pool *pgxpool.Pool, executionID string) {
	t.Helper()
	var state string
	var results, settlements, replayEvents int
	if err := pool.QueryRow(ctx, `
SELECT j.state,
       (SELECT count(*) FROM elitea_runtime.configuration_validation_results AS r WHERE r.execution_id = j.execution_id),
       (SELECT count(*) FROM elitea_runtime.execution_settlements AS s WHERE s.execution_id = j.execution_id),
       (SELECT count(*) FROM elitea_runtime.execution_replay_events AS e WHERE e.execution_id = j.execution_id)
FROM elitea_runtime.execution_jobs AS j
WHERE j.execution_id = $1`, executionID).Scan(&state, &results, &settlements, &replayEvents); err != nil {
		t.Fatal(err)
	}
	if state != "SUCCEEDED" || results != 1 || settlements != 1 || replayEvents != 1 {
		t.Fatalf("terminal durability mismatch state=%s results=%d settlements=%d replay=%d", state, results, settlements, replayEvents)
	}
}
