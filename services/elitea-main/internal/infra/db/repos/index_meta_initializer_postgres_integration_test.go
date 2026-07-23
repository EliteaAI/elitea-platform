package repos

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"testing"
	"time"

	indexingapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/indexing"
	"github.com/EliteaAI/elitea-platform/services/elitea-main/internal/infra/pgvector"
	"github.com/jackc/pgx/v5"
)

type postgresFrozenToolkitClaimer struct {
	materialized json.RawMessage
}

func (c postgresFrozenToolkitClaimer) ClaimFrozenToolkitConfiguration(
	_ context.Context,
	_ indexingapp.FrozenToolkitConfigurationClaim,
) (json.RawMessage, error) {
	return append(json.RawMessage(nil), c.materialized...), nil
}

// TestPostgresPgvectorIndexMetaInitializationConvergence crosses the runtime
// PostgreSQL transaction, the actual pgx PgVector writer in a separate
// transaction/connection, the idempotent recovery seam, and every dispatch
// gate. The two logical stores share the isolated test database server; this is
// not a multi-cluster, Redis, worker, TLS, load, or browser E2E.
func TestPostgresPgvectorIndexMetaInitializationConvergence(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cancel()
	var vectorAvailable bool
	if err := pool.QueryRow(ctx, `SELECT EXISTS (
SELECT 1 FROM pg_catalog.pg_available_extensions WHERE name = 'vector'
)`).Scan(&vectorAvailable); err != nil {
		t.Fatal(err)
	}
	if !vectorAvailable {
		t.Skip("the PostgreSQL integration server does not provide the vector extension")
	}
	if _, err := pool.Exec(ctx, `CREATE EXTENSION IF NOT EXISTS vector`); err != nil {
		t.Skipf("the isolated integration database cannot install vector: %v", err)
	}

	policy := IndexIngestDispatchPolicy{
		StreamName:        "elitea:runtime:index:commands",
		CapabilityVersion: "1",
		ResourceClass:     "indexing",
		IsolationClass:    "project",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "index-limits-v1",
		MaxOutstanding:    16,
	}
	jobs, err := NewIndexIngestJobsRepository(pool, policy)
	if err != nil {
		t.Fatal(err)
	}
	outbox, err := NewCommandOutboxRepository(pool, policy.StreamName)
	if err != nil {
		t.Fatal(err)
	}

	toolkitID := int32(1_500_000_000 + time.Now().UnixNano()%500_000_000)
	databaseURL := postgresIntegrationPoolURL(t, pool.Config().ConnString(), pool.Config().ConnConfig.Database)
	claimed, err := json.Marshal(map[string]any{
		"id":   toolkitID,
		"type": "confluence",
		"settings": map[string]any{
			"pgvector_configuration": map[string]any{
				"configuration_type":       "pgvector",
				"configuration_project_id": 1,
				"configuration_uuid":       "integration-pgvector",
				"connection_string":        databaseURL,
			},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	initializer, err := indexingapp.NewCurrentIndexMetaInitializer(
		postgresFrozenToolkitClaimer{materialized: claimed},
		pgvector.NewCurrentIndexMetaWriter(),
	)
	if err != nil {
		t.Fatal(err)
	}

	request := postgresIndexMetaConvergenceRequest(toolkitID, "crash-recovery", "Docs")
	firstAdmissions := newPostgresIndexAdmissionService(t, jobs, "meta-convergence-first")
	admitted, err := firstAdmissions.Submit(ctx, request)
	if err != nil {
		t.Fatal(err)
	}
	if err := initializer.MaterializeInitialIndexMeta(ctx, request, admitted); err != nil {
		t.Fatalf("commit external metadata before simulated crash: %v", err)
	}
	pending, err := outbox.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if containsAdmissionID(pending, "meta-convergence-first-outbox") {
		t.Fatalf("external commit alone opened the dispatch gate: %v", pending)
	}
	assertPostgresPgvectorMeta(t, ctx, pool, toolkitID, "Docs", admitted.IndexMetaID, admitted.ExecutionID, 1)

	replayAdmissions := newPostgresIndexAdmissionService(t, jobs, "meta-convergence-replay")
	recovering, err := indexingapp.NewInitializingAdmissionSubmitter(replayAdmissions, initializer, jobs)
	if err != nil {
		t.Fatal(err)
	}
	recovered, err := recovering.Submit(ctx, request)
	if err != nil {
		t.Fatalf("recover cross-store commit: %v", err)
	}
	if recovered.Created || recovered.ExecutionID != admitted.ExecutionID ||
		recovered.IndexMetaID != admitted.IndexMetaID ||
		recovered.IndexMetaInitializedAt == nil || recovered.IndexMetaInitializedAt.IsZero() {
		t.Fatalf("recovered outcome=%+v admitted=%+v", recovered, admitted)
	}
	assertPostgresPgvectorMeta(t, ctx, pool, toolkitID, "Docs", admitted.IndexMetaID, admitted.ExecutionID, 1)
	pending, err = outbox.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if !containsAdmissionID(pending, "meta-convergence-first-outbox") {
		t.Fatalf("recovery did not open the exact dispatch gate: %v", pending)
	}

	conflictRequest := postgresIndexMetaConvergenceRequest(toolkitID, "conflict", "Docs")
	conflictingAdmissions := newPostgresIndexAdmissionService(t, jobs, "meta-convergence-conflict")
	conflicting, err := indexingapp.NewInitializingAdmissionSubmitter(conflictingAdmissions, initializer, jobs)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := conflicting.Submit(ctx, conflictRequest); !errors.Is(err, indexingapp.ErrCurrentIndexMetaConflict) {
		t.Fatalf("same-index conflicting start=%v", err)
	}
	assertPostgresCount(t, ctx, pool, 0, `
SELECT count(*)
FROM elitea_runtime.index_ingest_jobs
WHERE execution_id = 'meta-convergence-conflict-execution'
  AND index_meta_initialized_at IS NOT NULL`)
	pending, err = outbox.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if containsAdmissionID(pending, "meta-convergence-conflict-outbox") {
		t.Fatalf("conflicting metadata start became dispatchable: %v", pending)
	}

	cancelRequest := postgresIndexMetaConvergenceRequest(toolkitID, "cancel", "CancelledDocs")
	cancelAdmissions := newPostgresIndexAdmissionService(t, jobs, "meta-convergence-cancel")
	cancelled, err := cancelAdmissions.Submit(ctx, cancelRequest)
	if err != nil {
		t.Fatal(err)
	}
	if err := initializer.MaterializeInitialIndexMeta(ctx, cancelRequest, cancelled); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.execution_jobs
SET desired_state = 'CANCELLED'
WHERE execution_id = $1 AND generation = $2`,
		cancelled.ExecutionID,
		int64(cancelled.Generation),
	); err != nil {
		t.Fatal(err)
	}
	cancelReplay := newPostgresIndexAdmissionService(t, jobs, "meta-convergence-cancel-replay")
	cancelSubmitter, err := indexingapp.NewInitializingAdmissionSubmitter(cancelReplay, initializer, jobs)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := cancelSubmitter.Submit(ctx, cancelRequest); !errors.Is(err, indexingapp.ErrIndexMetaInitializationMismatch) {
		t.Fatalf("cancelled recovery transition=%v", err)
	}
	assertPostgresCount(t, ctx, pool, 0, `
SELECT count(*)
FROM elitea_runtime.index_ingest_jobs
WHERE execution_id = $1
  AND index_meta_initialized_at IS NOT NULL`, cancelled.ExecutionID)
	pending, err = outbox.ListPendingIndexIngestIDs(ctx, 16, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if containsAdmissionID(pending, "meta-convergence-cancel-outbox") {
		t.Fatalf("cancelled metadata start became dispatchable: %v", pending)
	}
}

func postgresIntegrationPoolURL(t *testing.T, original, database string) string {
	t.Helper()
	parsed, err := url.Parse(original)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") ||
		parsed.Host == "" || database == "" {
		t.Fatal("ELITEA_TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	parsed.Path = "/" + database
	parsed.RawPath = ""
	return parsed.String()
}

func postgresIndexMetaConvergenceRequest(
	toolkitID int32,
	idempotencyKey string,
	indexName string,
) indexingapp.SubmitRequest {
	request := postgresIndexSubmitRequest(idempotencyKey, indexName)
	request.Identity.TenantID = request.Identity.ResourceProjectID
	request.ToolkitID = toolkitID
	request.Inputs.ToolkitConfiguration = json.RawMessage(fmt.Sprintf(
		`{"id":%d,"type":"confluence","settings":{"pgvector_configuration":{"__elitea_frozen_configuration_v1":true,"configuration_type":"pgvector","configuration_project_id":1,"configuration_uuid":"integration-pgvector","connection_string":"{{secret.PGVECTOR}}"}}}`,
		toolkitID,
	))
	return request
}

func assertPostgresPgvectorMeta(
	t *testing.T,
	ctx context.Context,
	pool interface {
		QueryRow(context.Context, string, ...any) pgx.Row
	},
	toolkitID int32,
	indexName string,
	metaID string,
	executionID string,
	historyLength int,
) {
	t.Helper()
	schema := pgx.Identifier{strconv.FormatInt(int64(toolkitID), 10)}.Sanitize()
	var raw []byte
	if err := pool.QueryRow(ctx, `
SELECT cmetadata
FROM `+schema+`.langchain_pg_embedding
WHERE cmetadata->>'collection' = $1
  AND cmetadata->>'type' = 'index_meta'`, indexName).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	if err := json.Unmarshal(raw, &metadata); err != nil {
		t.Fatal(err)
	}
	historyEncoded, ok := metadata["history"].(string)
	if !ok {
		t.Fatalf("history type=%T", metadata["history"])
	}
	var history []map[string]any
	if err := json.Unmarshal([]byte(historyEncoded), &history); err != nil {
		t.Fatal(err)
	}
	if metadata["index_meta_id"] != metaID || metadata["execution_id"] != executionID ||
		metadata["state"] != "in_progress" || len(history) != historyLength {
		t.Fatalf("metadata=%#v history=%#v", metadata, history)
	}
}
