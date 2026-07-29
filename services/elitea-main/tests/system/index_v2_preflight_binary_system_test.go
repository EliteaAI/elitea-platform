package system_test

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const indexV2PreflightSystemTestOptIn = "ELITEA_INDEX_V2_PREFLIGHT_SYSTEM_TEST"

// TestIndexV2PreflightShippedBinary crosses the built operator binary, real
// PostgreSQL, TLS/ACL Redis, and a private spool directory. Repository-level
// integration tests separately prove that the settled fixture shape is
// produced by the production claim/output/PrepareSettlement path.
func TestIndexV2PreflightShippedBinary(t *testing.T) {
	if os.Getenv(indexV2PreflightSystemTestOptIn) != "1" {
		t.Skip("set ELITEA_INDEX_V2_PREFLIGHT_SYSTEM_TEST=1 to run the binary cutover system test")
	}
	requireCommand(t, "docker")
	requireCommand(t, "go")

	repositoryRoot := findRepositoryRoot(t)
	root := canonicalTempDir(t)
	spoolRoot := filepath.Join(root, "output-spool")
	mustMkdir(t, spoolRoot, 0o700)
	pki := generateRuntimePKI(t, root)
	observerPasswordPath := filepath.Join(root, "observer.password")
	writeFile(t, observerPasswordPath, []byte(observerPassword), 0o600)

	postgresPort := freePort(t)
	controlRedisPort := freePort(t)
	containers := &containerSet{}
	t.Cleanup(containers.stopAll)
	postgresName := containers.start(t,
		"preflight-postgres", "postgres:16-alpine",
		[]string{
			"-e", "POSTGRES_USER=elitea",
			"-e", "POSTGRES_PASSWORD=elitea",
			"-e", "POSTGRES_DB=elitea",
			"-p", fmt.Sprintf("127.0.0.1:%d:5432", postgresPort),
		},
	)
	redisConfigDir := filepath.Join(root, "redis")
	mustMkdir(t, redisConfigDir, 0o755)
	prepareTLSRedisConfig(t, redisConfigDir, pki)
	controlRedisName := containers.start(t,
		"preflight-redis", "redis:7-alpine",
		[]string{
			"-p", fmt.Sprintf("127.0.0.1:%d:6379", controlRedisPort),
			"-v", redisConfigDir + ":/runtime:ro",
		},
		"redis-server", "/runtime/redis.conf",
	)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	databaseURL := fmt.Sprintf(
		"postgres://elitea:elitea@127.0.0.1:%d/elitea?sslmode=disable",
		postgresPort,
	)
	pool := waitForPostgres(t, ctx, databaseURL, containers, postgresName)
	defer pool.Close()
	bootstrapDatabase(t, ctx, repositoryRoot, pool)

	migrateBinary := filepath.Join(root, "elitea-migrate")
	preflightBinary := filepath.Join(root, "index-v2-preflight")
	buildGoBinary(t, repositoryRoot, migrateBinary, "./cmd/elitea-migrate")
	buildGoBinary(t, repositoryRoot, preflightBinary, "./cmd/index-v2-preflight")
	runCommand(
		t,
		filepath.Join(repositoryRoot, "services", "elitea-main"),
		[]string{"DATABASE_URL=" + databaseURL},
		migrateBinary,
		"-all-tenants",
	)
	seedSettledRetainedIndexV1(t, ctx, pool)

	observer := newControlRedisClient(
		t, controlRedisPort, "observer", observerPassword, pki.caPath,
	)
	defer observer.Close()
	waitForRedis(t, ctx, observer, containers, controlRedisName)
	if err := observer.XGroupCreateMkStream(
		ctx, commandStream, consumerGroup, "0-0",
	).Err(); err != nil {
		t.Fatalf("create empty version-1 consumer group: %v", err)
	}

	environment := []string{
		"DATABASE_URL=" + databaseURL,
		"ELITEA_RUNTIME_ENABLED=true",
		"ELITEA_RUNTIME_INDEX_INGEST_DISPATCH_ENABLED=true",
		"ELITEA_RUNTIME_INDEX_INGEST_COMMAND_STREAM=" + commandStream,
		"ELITEA_RUNTIME_INDEX_INGEST_CONSUMER_GROUP=" + consumerGroup,
		fmt.Sprintf(
			"ELITEA_RUNTIME_REDIS_URL=rediss://observer@localhost:%d/0",
			controlRedisPort,
		),
		"ELITEA_RUNTIME_REDIS_PASSWORD_FILE=" + observerPasswordPath,
		"ELITEA_RUNTIME_REDIS_CA_FILE=" + pki.caPath,
	}
	status, report, stderr := runIndexV2PreflightBinary(
		t, preflightBinary, environment, spoolRoot,
	)
	if status != 0 ||
		report.Persisted.OutstandingOutbox != 0 ||
		report.Persisted.LiveJobs != 0 ||
		report.Persisted.ActiveClaims != 0 ||
		report.Control.StreamEntries != 0 ||
		report.Control.PendingEntries != 0 ||
		report.Control.DeliveryMappings != 0 ||
		report.SpoolRoots != 1 ||
		report.NonEmptySpoolRoots != 0 {
		t.Fatalf(
			"settled retained state did not pass shipped preflight: status=%d report=%+v stderr=%q",
			status, report, stderr,
		)
	}

	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.command_outbox
SET authority_granted_at = NULL
WHERE execution_id = 'preflight-settled-execution'
  AND generation = 1`); err != nil {
		t.Fatalf("isolate unsafe retained outbox authority: %v", err)
	}
	status, report, stderr = runIndexV2PreflightBinary(
		t, preflightBinary, environment, spoolRoot,
	)
	if status != 1 ||
		report.Persisted.OutstandingOutbox != 1 ||
		report.Persisted.LiveJobs != 0 ||
		report.Persisted.ActiveClaims != 0 ||
		report.Control.StreamEntries != 0 ||
		report.Control.PendingEntries != 0 ||
		report.Control.DeliveryMappings != 0 ||
		report.SpoolRoots != 1 ||
		report.NonEmptySpoolRoots != 0 {
		t.Fatalf(
			"unsafe retained state did not block shipped preflight: status=%d report=%+v stderr=%q",
			status, report, stderr,
		)
	}
}

type indexV2PreflightBinaryReport struct {
	Persisted struct {
		LiveJobs          int64 `json:"live_jobs"`
		OutstandingOutbox int64 `json:"outstanding_outbox"`
		ActiveClaims      int64 `json:"active_claims"`
	} `json:"persisted"`
	Control struct {
		StreamEntries    int64 `json:"stream_entries"`
		PendingEntries   int64 `json:"pending_entries"`
		DeliveryMappings int64 `json:"delivery_mappings"`
	} `json:"control"`
	SpoolRoots         int `json:"spool_roots"`
	NonEmptySpoolRoots int `json:"non_empty_spool_roots"`
}

func runIndexV2PreflightBinary(
	t *testing.T,
	binary string,
	environment []string,
	spoolRoot string,
) (int, indexV2PreflightBinaryReport, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	command := exec.CommandContext(
		ctx, binary, "--spool-root", spoolRoot,
	)
	command.Env = append(os.Environ(), environment...)
	var stdout, stderr bytes.Buffer
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()
	status := 0
	if err != nil {
		var exitError *exec.ExitError
		if !errors.As(err, &exitError) {
			t.Fatalf("execute shipped index-v2-preflight binary: %v", err)
		}
		status = exitError.ExitCode()
	}
	if ctx.Err() != nil {
		t.Fatalf("shipped index-v2-preflight binary timed out: %v", ctx.Err())
	}
	var report indexV2PreflightBinaryReport
	if err := json.Unmarshal(stdout.Bytes(), &report); err != nil {
		t.Fatalf(
			"decode shipped index-v2-preflight report: %v stdout=%q stderr=%q",
			err, stdout.String(), stderr.String(),
		)
	}
	return status, report, stderr.String()
}

func seedSettledRetainedIndexV1(
	t *testing.T,
	ctx context.Context,
	pool *pgxpool.Pool,
) {
	t.Helper()
	manifest := []byte("preflight settled retained manifest")
	manifestDigest := sha256.Sum256(manifest)
	requestDigest := sha256.Sum256([]byte("preflight settled request"))
	envelope := []byte("preflight settled signed envelope")
	envelopeDigest := sha256.Sum256(envelope)
	fenceToken := sha256.Sum256([]byte("preflight settled fence"))
	proposal := []byte("preflight settled proposal")
	proposalDigest := sha256.Sum256(proposal)
	payloadDigest := sha256.Sum256([]byte("preflight settled output"))

	tx, err := pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = tx.Rollback(context.Background()) }()
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.input_bundles (
    input_bundle_id, immutable_version, media_type, resource_project_id,
    manifest_digest, manifest_size, manifest_bytes, created_by
) VALUES (
    'preflight-settled-bundle', 'v1', 'application/x-protobuf', 1,
    $1, $2, $3, 'preflight-system-test'
)`, manifestDigest[:], int64(len(manifest)), manifest); err != nil {
		t.Fatalf("seed settled retained input bundle: %v", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.execution_jobs (
    execution_id, generation, command_id, tenant_id,
    resource_project_id, projection_project_id, actor_id, principal_ref,
    capability_id, capability_version, input_bundle_id,
    request_digest, idempotency_scope, idempotency_key,
    state, desired_state, settled_at
) VALUES (
    'preflight-settled-execution', 1, 'preflight-settled-command', '1',
    1, 1, '1', 'user:1',
    'index.ingest.v1', '1', 'preflight-settled-bundle',
    $1, 'preflight-system-test', 'preflight-settled',
    'SUCCEEDED', 'RUNNING', clock_timestamp()
)`, requestDigest[:]); err != nil {
		t.Fatalf("seed settled retained execution: %v", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.command_outbox (
    outbox_id, execution_id, generation, stream_name, dispatch_ordinal,
    resource_class, isolation_class, priority, deadline, limits_revision,
    prepared_signed_envelope_bytes, prepared_signed_envelope_digest,
    prepared_signature_profile, prepared_key_id, prepared_at,
    published_at, published_envelope_digest, authority_granted_at,
    publish_attempts
) VALUES (
    'preflight-settled-outbox', 'preflight-settled-execution', 1,
    $1, 1, 'indexing', 'shared', 1,
    clock_timestamp() + interval '1 hour', 'preflight-limits-v1',
    $2, $3, 1, 'preflight-key', clock_timestamp(),
    clock_timestamp(), $3, clock_timestamp(), 1
)`, commandStream, envelope, envelopeDigest[:]); err != nil {
		t.Fatalf("seed settled retained outbox: %v", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.execution_claims (
    claim_id, execution_id, generation, workload_session_id,
    workload_identity, producer_id, claim_attempt, lease_epoch,
    fence_token, claimed_at, lease_expires_at, released_at, release_reason
) VALUES (
    'preflight-settled-claim', 'preflight-settled-execution', 1,
    'preflight-worker-session', 'spiffe://elitea.test/index-worker/preflight',
    'preflight-worker', 1, 1, $1,
    clock_timestamp() - interval '2 minutes',
    clock_timestamp() + interval '5 minutes',
    clock_timestamp(), 'SETTLED'
)`, fenceToken[:]); err != nil {
		t.Fatalf("seed settled retained claim: %v", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO elitea_runtime.execution_settlements (
    execution_id, generation, claim_id, fence_token, workload_identity,
    workload_session_id, producer_id, claim_attempt, lease_epoch,
    settlement_receipt_id, proposal_id, proposal_bytes, proposal_digest,
    idempotency_key, disposition, final_logical_output_id,
    terminal_event_id, terminal_sequence, terminal_payload_digest,
    committed_at
) VALUES (
    'preflight-settled-execution', 1, 'preflight-settled-claim', $1,
    'spiffe://elitea.test/index-worker/preflight',
    'preflight-worker-session', 'preflight-worker', 1, 1,
    'preflight-settled-receipt', 'preflight-settled-proposal',
    $2, $3, 'preflight-settled-idempotency',
    'SUCCEEDED', 'index-ingest:preflight-settled-execution',
    'preflight-settled-event', 1, $4, clock_timestamp()
)`, fenceToken[:], proposal, proposalDigest[:], payloadDigest[:]); err != nil {
		t.Fatalf("seed settled retained settlement: %v", err)
	}
	if err := tx.Commit(ctx); err != nil {
		t.Fatalf("commit settled retained version-1 cutover fixture: %v", err)
	}
}
