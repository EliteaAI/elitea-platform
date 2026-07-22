package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
)

// TestPostgresServiceBackedIndexIngestAdmission is a real PostgreSQL 16-18
// service-integration gate. It crosses the typed application use case, SQLC
// queries, migration constraints and one database transaction; it is not a
// Redis/worker/system E2E, load, soak or penetration test.
func TestPostgresServiceBackedIndexIngestAdmission(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	policy := IndexIngestDispatchPolicy{
		StreamName:        "elitea:runtime:index:commands",
		CapabilityVersion: "1",
		ResourceClass:     "indexing",
		IsolationClass:    "project",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "index-limits-v1",
		MaxOutstanding:    1,
	}
	repository, err := NewIndexIngestJobsRepository(pool, policy)
	if err != nil {
		t.Fatal(err)
	}
	request := postgresIndexSubmitRequest("request-1", "knowledge")
	service := newPostgresIndexAdmissionService(t, repository, "first")

	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	created, err := service.Submit(ctx, request)
	if err != nil || !created.Created {
		t.Fatalf("create index admission: outcome=%+v err=%v", created, err)
	}
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.execution_jobs WHERE capability_id = 'index.ingest.v1'`)
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.index_ingest_jobs`)
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.input_bundles`)
	assertPostgresCount(t, ctx, pool, 2, `SELECT count(*) FROM elitea_runtime.input_bundle_entries`)
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.command_outbox WHERE stream_name = $1`, policy.StreamName)

	var toolkitID int32
	var indexName, initiator, streamName string
	var validationColumns int
	var preparedBytes, inputBytes int64
	if err := pool.QueryRow(ctx, `
SELECT i.toolkit_id, i.index_name, i.initiator, o.stream_name,
       num_nonnulls(
           j.configuration_revision_id, j.configuration_type,
           j.catalog_revision, j.catalog_digest, j.schema_id,
           j.schema_revision, j.schema_digest, j.settings_entry_id
       ),
       COALESCE(octet_length(o.prepared_signed_envelope_bytes), 0),
       sum(octet_length(e.content_bytes))
FROM elitea_runtime.execution_jobs AS j
JOIN elitea_runtime.index_ingest_jobs AS i
  ON i.execution_id = j.execution_id AND i.generation = j.generation
JOIN elitea_runtime.command_outbox AS o
  ON o.execution_id = j.execution_id AND o.generation = j.generation
JOIN elitea_runtime.input_bundle_entries AS e
  ON e.input_bundle_id = j.input_bundle_id
WHERE j.execution_id = $1
GROUP BY i.toolkit_id, i.index_name, i.initiator, o.stream_name,
         j.configuration_revision_id, j.configuration_type,
         j.catalog_revision, j.catalog_digest, j.schema_id,
         j.schema_revision, j.schema_digest, j.settings_entry_id,
         o.prepared_signed_envelope_bytes`, created.ExecutionID).Scan(
		&toolkitID, &indexName, &initiator, &streamName,
		&validationColumns, &preparedBytes, &inputBytes,
	); err != nil {
		t.Fatal(err)
	}
	if toolkitID != 19 || indexName != "knowledge" || initiator != "user" || streamName != policy.StreamName || validationColumns != 0 || preparedBytes != 0 || inputBytes == 0 {
		t.Fatalf("unexpected durable index binding: toolkit=%d index=%s initiator=%s stream=%s validation=%d outbox_bytes=%d input_bytes=%d", toolkitID, indexName, initiator, streamName, validationColumns, preparedBytes, inputBytes)
	}

	replayed, err := newPostgresIndexAdmissionService(t, repository, "replay").Submit(ctx, request)
	if err != nil || replayed.Created || replayed.ExecutionID != created.ExecutionID || replayed.CommandID != created.CommandID || !replayed.AdmittedAt.Equal(created.AdmittedAt) || !replayed.Deadline.Equal(created.Deadline) {
		t.Fatalf("exact replay changed durable identity: created=%+v replay=%+v err=%v", created, replayed, err)
	}
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.execution_jobs`)
	assertPostgresCount(t, ctx, pool, 2, `SELECT count(*) FROM elitea_runtime.input_bundle_entries`)

	conflict := request
	conflict.Inputs.ToolParameters = json.RawMessage(`{"index_name":"different"}`)
	if _, err := newPostgresIndexAdmissionService(t, repository, "conflict").Submit(ctx, conflict); !errors.Is(err, executionapp.ErrIdempotencyConflict) {
		t.Fatalf("changed request reused idempotency key: %v", err)
	}

	capacity := postgresIndexSubmitRequest("request-2", "second")
	if _, err := newPostgresIndexAdmissionService(t, repository, "capacity").Submit(ctx, capacity); !errors.Is(err, executionapp.ErrAdmissionCapacityExhausted) {
		t.Fatalf("active index capacity was not enforced: %v", err)
	}
	assertPostgresCount(t, ctx, pool, 1, `SELECT count(*) FROM elitea_runtime.execution_jobs`)

	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.execution_jobs
SET configuration_type = 'must-not-exist'
WHERE execution_id = $1`, created.ExecutionID); err == nil {
		t.Fatal("index.ingest.v1 accepted a validation-only execution column")
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO elitea_runtime.execution_jobs (
    execution_id, generation, command_id, tenant_id,
    resource_project_id, projection_project_id, actor_id, principal_ref,
    capability_id, capability_version, input_bundle_id, request_digest,
    idempotency_scope, idempotency_key, state, desired_state
)
SELECT 'invalid-validation-shape', 1, 'invalid-validation-command', tenant_id,
       resource_project_id, projection_project_id, actor_id, principal_ref,
       'configuration.validate.v1', '1', input_bundle_id, request_digest,
       'invalid-validation-scope', 'invalid-validation-key', 'PENDING', 'RUNNING'
FROM elitea_runtime.execution_jobs
WHERE execution_id = $1`, created.ExecutionID); err == nil {
		t.Fatal("configuration.validate.v1 accepted missing validation columns")
	}
}

func postgresIndexSubmitRequest(idempotencyKey, indexName string) indexingapp.SubmitRequest {
	return indexingapp.SubmitRequest{
		Identity: executionapp.AdmissionIdentity{
			TenantID:            "tenant-postgres",
			ResourceProjectID:   "1",
			ProjectionProjectID: "1",
			ActorID:             "7",
		},
		IdempotencyKey: idempotencyKey,
		ToolkitID:      19,
		Initiator:      executiondomain.IndexIngestInitiatorUser,
		Inputs: indexingapp.AuthoritativeInputs{
			ToolkitConfiguration: json.RawMessage(`{"id":19,"type":"confluence","settings":{"token":"secret-ref://toolkit/19"}}`),
			ToolParameters:       json.RawMessage(fmt.Sprintf(`{"index_name":%q}`, indexName)),
		},
	}
}

func newPostgresIndexAdmissionService(t *testing.T, repository *IndexIngestJobsRepository, prefix string) *indexingapp.AdmissionService {
	t.Helper()
	factory, err := indexingapp.NewInputBundleFactory(indexingapp.InputProfile{
		Classification:        "project-confidential",
		RequiredGrantAudience: "elitea.runtime.input.read.v1",
	}, postgresIndexIDs(prefix+"-bundle", prefix+"-toolkit-content", prefix+"-parameters-content"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := indexingapp.NewAdmissionService(repository, factory, time.Now, postgresIndexIDs(prefix+"-execution", prefix+"-command", prefix+"-outbox"))
	if err != nil {
		t.Fatal(err)
	}
	return service
}

func postgresIndexIDs(values ...string) executionapp.IDGenerator {
	return func() (string, error) {
		if len(values) == 0 {
			return "", errors.New("unexpected index ID allocation")
		}
		value := values[0]
		values = values[1:]
		return value, nil
	}
}
