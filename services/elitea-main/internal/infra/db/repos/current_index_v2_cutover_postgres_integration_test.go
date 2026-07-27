package repos

import (
	"context"
	"testing"
	"time"

	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
)

func TestPostgresServiceBackedIndexV2CutoverRejectsPersistedV1UntilTerminalReconciliation(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	repository, err := NewCurrentIndexV2CutoverRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()

	state, err := repository.ReadIndexV1CutoverState(ctx)
	if err != nil || state.LiveJobs != 0 || state.OutstandingOutbox != 0 || state.ActiveClaims != 0 {
		t.Fatalf("clean persisted state=%+v err=%v", state, err)
	}

	jobs, err := NewIndexIngestJobsRepository(pool, IndexIngestDispatchPolicy{
		StreamName:        "commands.v1.index.ingest.indexing.shared.1.0",
		CapabilityVersion: "1",
		ResourceClass:     "indexing",
		IsolationClass:    "shared",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "elitea.runtime.limits.conformance.v1",
		MaxOutstanding:    16,
	})
	if err != nil {
		t.Fatal(err)
	}
	admitted, err := newPostgresIndexAdmissionService(t, jobs, "v1-cutover").Submit(
		ctx,
		postgresIndexSubmitRequest("v1-cutover", "v1-cutover-index"),
	)
	if err != nil || !admitted.Created {
		t.Fatalf("persist version-1 admission: outcome=%+v err=%v", admitted, err)
	}
	state, err = repository.ReadIndexV1CutoverState(ctx)
	if err != nil || state.LiveJobs != 1 || state.OutstandingOutbox != 1 || state.ActiveClaims != 0 {
		t.Fatalf("admitted v1 state=%+v err=%v", state, err)
	}

	fenceToken := runtimedomain.SHA256([]byte("v1-cutover-fence"))
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.execution_jobs
SET state = 'CLAIMED'
WHERE execution_id = $1
  AND generation = $2`,
		admitted.ExecutionID,
		int64(admitted.Generation),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
INSERT INTO elitea_runtime.execution_claims (
    claim_id, execution_id, generation, workload_session_id,
    workload_identity, producer_id, claim_attempt, lease_epoch,
    fence_token, lease_expires_at
) VALUES (
    'v1-cutover-claim', $1, $2, 'v1-worker-session',
    'spiffe://elitea.test/runtime/v1-worker', 'v1-main', 1, 1,
    $3, clock_timestamp() + interval '5 minutes'
)`,
		admitted.ExecutionID,
		int64(admitted.Generation),
		fenceToken[:],
	); err != nil {
		t.Fatal(err)
	}
	state, err = repository.ReadIndexV1CutoverState(ctx)
	if err != nil || state.LiveJobs != 1 || state.OutstandingOutbox != 1 || state.ActiveClaims != 1 {
		t.Fatalf("claimed v1 state=%+v err=%v", state, err)
	}

	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.execution_claims
SET released_at = clock_timestamp(),
    release_reason = 'CANCELLED'
WHERE claim_id = 'v1-cutover-claim'`); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.command_outbox
SET retired_at = clock_timestamp(),
    retirement_code = 'CANCELLED',
    authority_granted_at = NULL
WHERE execution_id = $1
  AND generation = $2`,
		admitted.ExecutionID,
		int64(admitted.Generation),
	); err != nil {
		t.Fatal(err)
	}
	if _, err := pool.Exec(ctx, `
UPDATE elitea_runtime.execution_jobs
SET state = 'CANCELLED',
    desired_state = 'CANCELLED',
    settled_at = clock_timestamp()
WHERE execution_id = $1
  AND generation = $2`,
		admitted.ExecutionID,
		int64(admitted.Generation),
	); err != nil {
		t.Fatal(err)
	}
	state, err = repository.ReadIndexV1CutoverState(ctx)
	if err != nil || state.LiveJobs != 0 || state.OutstandingOutbox != 0 || state.ActiveClaims != 0 {
		t.Fatalf("terminally reconciled v1 state=%+v err=%v", state, err)
	}

	v2Jobs, err := NewIndexIngestJobsRepository(pool, IndexIngestDispatchPolicy{
		StreamName:        "commands.v1.index.ingest.indexing.shared.1.0",
		CapabilityVersion: "2",
		ResourceClass:     "indexing",
		IsolationClass:    "shared",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "elitea.runtime.limits.conformance.v1",
		MaxOutstanding:    16,
	})
	if err != nil {
		t.Fatal(err)
	}
	v2, err := newPostgresIndexAdmissionService(t, v2Jobs, "v2-cutover").Submit(
		ctx,
		postgresIndexSubmitRequest("v2-cutover", "v2-cutover-index"),
	)
	if err != nil || !v2.Created {
		t.Fatalf("persist version-2 admission: outcome=%+v err=%v", v2, err)
	}
	state, err = repository.ReadIndexV1CutoverState(ctx)
	if err != nil || state.LiveJobs != 0 || state.OutstandingOutbox != 0 || state.ActiveClaims != 0 {
		t.Fatalf("version-2 state was misclassified as v1: state=%+v err=%v", state, err)
	}
}
