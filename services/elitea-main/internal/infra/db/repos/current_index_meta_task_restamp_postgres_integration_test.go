package repos

import (
	"context"
	"errors"
	"testing"
	"time"

	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

// TestPostgresNodeEventTaskRestampIntentRetryAndTenantAuthority crosses the real
// admission, claim, authenticated NodeEvent and PostgreSQL intent/retry
// transactions. It deliberately forges browser identity fields to prove that
// the restamp binding comes only from immutable admission state.
func TestPostgresNodeEventTaskRestampIntentRetryAndTenantAuthority(
	t *testing.T,
) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	dispatchPolicy := IndexIngestDispatchPolicy{
		StreamName:        "elitea:runtime:index:commands",
		CapabilityVersion: "1",
		ResourceClass:     "indexing",
		IsolationClass:    "project",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "index-limits-v1",
		MaxOutstanding:    1,
	}
	jobs, err := NewIndexIngestJobsRepository(pool, dispatchPolicy)
	if err != nil {
		t.Fatal(err)
	}
	admitted, err := newPostgresIndexAdmissionService(
		t,
		jobs,
		"task-restamp",
	).Submit(
		context.Background(),
		postgresIndexSubmitRequest(
			"request-task-restamp",
			"authoritative-index",
		),
	)
	if err != nil || !admitted.Created {
		t.Fatalf("admit index execution: outcome=%+v err=%v", admitted, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	// index_ingest_jobs_meta_initialization_shape (migration 0051) only
	// permits index_meta_initialized_at IS NOT NULL together with status =
	// 'INITIALIZED', a cleared claim/retry state, and
	// index_meta_initialization_resolved_at exactly equal to
	// index_meta_initialized_at — setting index_meta_initialized_at alone
	// violates it. Mirrors ResolveIndexMetaInitialization's shape
	// (internal/db/queries/runtime_index_ingest.sql): compute one
	// timestamp via a FROM subquery so both columns get the identical
	// value, rather than calling clock_timestamp() twice in the SET list
	// (which are independently volatile and would not compare equal).
	if tag, err := pool.Exec(ctx, `
UPDATE elitea_runtime.index_ingest_jobs AS i
SET index_meta_initialized_at = authority.initialized_at,
    index_meta_initialization_status = 'INITIALIZED',
    index_meta_initialization_claim_token = NULL,
    index_meta_initialization_claim_expires_at = NULL,
    index_meta_initialization_next_attempt_at = NULL,
    index_meta_initialization_last_error_code = NULL,
    index_meta_initialization_resolved_at = authority.initialized_at,
    index_meta_initialization_failed_at = NULL
FROM (SELECT clock_timestamp() AS initialized_at) AS authority
WHERE i.execution_id = $1 AND i.generation = 1`,
		admitted.ExecutionID,
	); err != nil || tag.RowsAffected() != 1 {
		t.Fatalf("open initialized metadata gate: tag=%v err=%v", tag, err)
	}
	results, err := NewIndexIngestResultsRepository(
		pool,
		IndexIngestOutputPolicy{
			LimitsRevision:    dispatchPolicy.LimitsRevision,
			ArtifactMediaType: "application/json",
			MaxArtifactBytes:  1024 * 1024,
		},
	)
	if err != nil {
		t.Fatal(err)
	}
	expected, err := results.ExpectedIndexIngest(
		ctx,
		admitted.ExecutionID,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	fence := claimPostgresIndexExecution(t, pool, expected)
	claims, err := NewClaimsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	claimService, err := executionapp.NewClaimService(
		claims,
		time.Now,
		30*time.Second,
	)
	if err != nil {
		t.Fatal(err)
	}
	nodeRepository, err := NewNodeEventsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	nodeService, err := outputapp.NewNodeEventService(
		claimService,
		nodeRepository,
	)
	if err != nil {
		t.Fatal(err)
	}
	wire := []byte("task-restamp-node-event")
	progress := outputapp.NodeEventFrame{
		StreamID:            fence.ExecutionID + ":1",
		TenantID:            expected.TenantID,
		ResourceProjectID:   expected.ResourceProjectID,
		ProjectionProjectID: expected.ProjectionProjectID,
		WorkloadSessionID:   fence.WorkloadSessionID,
		ProducerID:          fence.ProducerID,
		EventID:             fence.CommandID + ":1",
		LogicalOutputID: outputapp.NodeEventLogicalOutputID(
			fence.ExecutionID,
			1,
		),
		Sequence:      1,
		OccurredAt:    time.Date(2026, time.July, 27, 12, 0, 0, 0, time.UTC),
		Fence:         fence,
		PayloadDigest: runtimedomain.SHA256(wire),
		EncodedEvent:  wire,
		BrowserData: []byte(`{
			"type":"agent_index_data_status",
			"response_metadata":{
				"state":"in_progress",
				"created_at":1700000000.25,
				"task_id":"forged-task",
				"project_id":999,
				"user_id":999,
				"toolkit_id":999,
				"index_name":"forged-index"
			}
		}`),
	}
	outcome, err := nodeService.IngestNodeEvent(ctx, progress)
	if err != nil || !outcome.Inserted {
		t.Fatalf("ingest restamp source: outcome=%+v err=%v", outcome, err)
	}
	retry, err := nodeService.IngestNodeEvent(ctx, progress)
	if err != nil || retry.Inserted || retry.Cursor != outcome.Cursor {
		t.Fatalf("idempotent source retry: outcome=%+v err=%v", retry, err)
	}

	var status, sourceEvent string
	var createdOn float64
	var attempts int
	if err := pool.QueryRow(ctx, `
SELECT index_meta_task_restamp_status,
       index_meta_task_restamp_source_event_id,
       index_meta_task_restamp_created_on,
       index_meta_task_restamp_attempt_count
FROM elitea_runtime.index_ingest_jobs
WHERE execution_id = $1 AND generation = 1`,
		admitted.ExecutionID,
	).Scan(&status, &sourceEvent, &createdOn, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "PENDING" || sourceEvent != progress.EventID ||
		createdOn != 1_700_000_000.25 || attempts != 0 {
		t.Fatalf(
			"status=%q source=%q created=%v attempts=%d",
			status,
			sourceEvent,
			createdOn,
			attempts,
		)
	}

	// The next exact-sequence event has a valid worker fence but a forged tenant.
	// It must not append or mutate the existing authoritative intent.
	crossTenant := progress
	crossTenant.Sequence = 2
	crossTenant.EventID = fence.CommandID + ":2"
	crossTenant.LogicalOutputID = outputapp.NodeEventLogicalOutputID(
		fence.ExecutionID,
		2,
	)
	crossTenant.TenantID = "other-tenant"
	crossTenant.EncodedEvent = []byte("cross-tenant-node-event")
	crossTenant.PayloadDigest = runtimedomain.SHA256(crossTenant.EncodedEvent)
	if _, err := nodeService.IngestNodeEvent(
		ctx,
		crossTenant,
	); !errors.Is(err, runtimedomain.ErrStaleFence) {
		t.Fatalf("cross-tenant event error=%v", err)
	}
	assertPostgresCount(t, ctx, pool, 1, `
SELECT count(*)
FROM elitea_runtime.execution_replay_events
WHERE execution_id = $1
  AND generation = 1
  AND event_type = 'execution.node_event'`, admitted.ExecutionID)

	store, err := NewCurrentIndexMetaTaskRestampRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	pending, err := store.ClaimPendingTaskRestamps(
		ctx,
		"claim-one",
		8,
		time.Minute,
	)
	if err != nil || len(pending) != 1 {
		t.Fatalf("claim pending=%+v err=%v", pending, err)
	}
	binding, err := store.LoadCurrentIndexMetaTaskRestampBinding(
		ctx,
		admitted.ExecutionID,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ResourceProjectID != 1 || binding.ActorUserID != 7 ||
		binding.ToolkitID != 19 ||
		binding.IndexName != "authoritative-index" ||
		binding.ExecutionID != admitted.ExecutionID ||
		binding.Generation != 1 {
		t.Fatalf("binding used browser identity: %+v", binding)
	}
	if err := store.ReleaseTaskRestamp(
		ctx,
		pending[0],
		"DEPENDENCY_UNAVAILABLE",
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.index_ingest_jobs
SET index_meta_task_restamp_next_attempt_at =
    clock_timestamp() - interval '1 second'
WHERE execution_id = $1 AND generation = 1`,
		admitted.ExecutionID,
	); err != nil {
		t.Fatal(err)
	}

	// A new repository instance models process restart. It reclaims the durable
	// immutable request and resolves exactly once.
	restarted, err := NewCurrentIndexMetaTaskRestampRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	pending, err = restarted.ClaimPendingTaskRestamps(
		ctx,
		"claim-two",
		8,
		time.Minute,
	)
	if err != nil || len(pending) != 1 {
		t.Fatalf("restart claim pending=%+v err=%v", pending, err)
	}
	if pending[0].SourceEventID != progress.EventID ||
		pending[0].CreatedOn != 1_700_000_000.25 {
		t.Fatalf("reclaimed intent=%+v", pending[0])
	}
	if err := restarted.ResolveTaskRestamp(
		ctx,
		pending[0],
		"APPLIED",
	); err != nil {
		t.Fatal(err)
	}
	if err := pool.QueryRow(ctx, `
SELECT index_meta_task_restamp_status,
       index_meta_task_restamp_attempt_count
FROM elitea_runtime.index_ingest_jobs
WHERE execution_id = $1 AND generation = 1`,
		admitted.ExecutionID,
	).Scan(&status, &attempts); err != nil {
		t.Fatal(err)
	}
	if status != "APPLIED" || attempts != 2 {
		t.Fatalf("resolved status=%q attempts=%d", status, attempts)
	}
}
