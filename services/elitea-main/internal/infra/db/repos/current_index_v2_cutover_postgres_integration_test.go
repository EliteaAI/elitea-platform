package repos

import (
	"context"
	"testing"
	"time"

	runtimev1 "github.com/EliteaAI/elitea-platform/libs/proto/gen/go/elitea/runtime/v1"
	executionapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/execution"
	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/proto"
)

func TestPostgresServiceBackedIndexV2CutoverAcceptsExactProductionSettlements(t *testing.T) {
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	repository := newPostgresIndexV2CutoverRepository(t, pool)
	assertPostgresIndexV1CutoverState(t, repository, 0, 0, 0)

	for _, outcome := range []executionapp.SettlementOutcome{
		executionapp.SettlementSucceeded,
		executionapp.SettlementFailed,
		executionapp.SettlementCancelled,
	} {
		t.Run(string(outcome), func(t *testing.T) {
			executionID := settlePostgresV1CutoverExecution(t, pool, repository, string(outcome), outcome)
			ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			assertPostgresCount(t, ctx, pool, 1, `
SELECT count(*)
FROM elitea_runtime.command_outbox
WHERE execution_id = $1
  AND authority_granted_at IS NOT NULL
  AND retired_at IS NULL`, executionID)
			assertPostgresCount(t, ctx, pool, 1, `
SELECT count(*)
FROM elitea_runtime.execution_claims
WHERE execution_id = $1
  AND release_reason = 'SETTLED'
  AND released_at IS NOT NULL`, executionID)
			assertPostgresIndexV1CutoverState(t, repository, 0, 0, 0)
		})
	}

	v2Jobs, err := NewIndexIngestJobsRepository(pool, IndexIngestDispatchPolicy{
		StreamName:        "commands.v2.index.ingest.indexing.shared.1.0",
		CapabilityVersion: "2",
		ResourceClass:     "indexing",
		IsolationClass:    "shared",
		Priority:          1,
		DeadlineTTL:       time.Hour,
		LimitsRevision:    "elitea.runtime.limits.conformance.v2",
		MaxOutstanding:    16,
	})
	if err != nil {
		t.Fatal(err)
	}
	v2, err := newPostgresIndexAdmissionService(t, v2Jobs, "v2-cutover").Submit(
		context.Background(),
		postgresIndexSubmitRequest("v2-cutover", "v2-cutover-index"),
	)
	if err != nil || !v2.Created {
		t.Fatalf("persist version-2 admission: outcome=%+v err=%v", v2, err)
	}
	assertPostgresIndexV1CutoverState(t, repository, 0, 0, 0)
}

func TestPostgresServiceBackedIndexV2CutoverBlocksUnsafeRetainedState(t *testing.T) {
	t.Run("missing settlement", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "missing", executionapp.SettlementSucceeded,
		)
		execPostgresCutoverFixture(t, pool, `
DELETE FROM elitea_runtime.execution_settlements
WHERE execution_id = $1`, executionID)

		assertPostgresIndexV1CutoverState(t, repository, 0, 1, 0)
	})

	t.Run("mismatched settlement disposition", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "mismatch", executionapp.SettlementSucceeded,
		)
		execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.execution_settlements
SET disposition = 'FAILED'
WHERE execution_id = $1`, executionID)

		assertPostgresIndexV1CutoverState(t, repository, 0, 1, 0)
	})

	t.Run("uncommitted settlement", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "uncommitted", executionapp.SettlementSucceeded,
		)
		execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.execution_settlements
SET committed_at = NULL
WHERE execution_id = $1`, executionID)

		assertPostgresIndexV1CutoverState(t, repository, 0, 1, 0)
	})

	t.Run("outcome unknown remains settling", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		fixture := admitAndClaimPostgresV1CutoverExecution(t, pool, repository, "unknown")
		frame := postgresIndexRuntimeFailureFrame(t, fixture.expected, fixture.fence)
		if _, err := newPostgresRuntimeFailureService(t, pool).IngestFailure(context.Background(), frame); err != nil {
			t.Fatalf("project terminal output before unknown settlement: %v", err)
		}
		unknown := frame.Settlement
		unknown.Outcome = executionapp.SettlementOutcomeUnknown
		encodeUnknownPostgresCutoverSettlement(t, pool, &unknown)
		settlements, err := NewSettlementsRepository(pool)
		if err != nil {
			t.Fatal(err)
		}
		if receipt, err := settlements.PrepareSettlement(context.Background(), unknown); err != nil ||
			receipt.Outcome != executionapp.SettlementOutcomeUnknown {
			t.Fatalf("prepare unknown settlement: receipt=%+v err=%v", receipt, err)
		}

		assertPostgresIndexV1CutoverState(t, repository, 1, 1, 0)
	})

	t.Run("null authority alone blocks production settlement", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "null-authority", executionapp.SettlementSucceeded,
		)
		execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.command_outbox
SET authority_granted_at = NULL
WHERE execution_id = $1`, executionID)

		assertPostgresIndexV1CutoverState(t, repository, 0, 1, 0)
	})

	t.Run("null settled at alone blocks production settlement", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "null-settled-at", executionapp.SettlementSucceeded,
		)
		execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.execution_jobs
SET settled_at = NULL
WHERE execution_id = $1`, executionID)

		assertPostgresIndexV1CutoverState(t, repository, 0, 1, 0)
	})

	t.Run("active claim remains an independent gate", func(t *testing.T) {
		pool, repository := newPostgresIndexV2CutoverFixture(t)
		executionID := settlePostgresV1CutoverExecution(
			t, pool, repository, "active-claim", executionapp.SettlementSucceeded,
		)
		token := runtimedomain.SHA256([]byte("active-cutover-claim"))
		execPostgresCutoverFixture(t, pool, `
INSERT INTO elitea_runtime.execution_claims (
    claim_id, execution_id, generation, workload_session_id,
    workload_identity, producer_id, claim_attempt, lease_epoch,
    fence_token, lease_expires_at
) VALUES (
    'active-cutover-claim', $1, 1, 'active-cutover-session',
    'spiffe://elitea.test/index-worker/active', 'active-cutover-producer',
    2, 2, $2, clock_timestamp() + interval '5 minutes'
)`, executionID, token[:])

		assertPostgresIndexV1CutoverState(t, repository, 0, 0, 1)
	})
}

func newPostgresIndexV2CutoverFixture(
	t *testing.T,
) (*pgxpool.Pool, *CurrentIndexV2CutoverRepository) {
	t.Helper()
	pool := newPostgresIntegrationPool(t)
	applyPostgresIntegrationMigrations(t, pool)
	return pool, newPostgresIndexV2CutoverRepository(t, pool)
}

type postgresV1CutoverFixture struct {
	expected outputapp.ExpectedIndexIngest
	fence    runtimedomain.Fence
}

func newPostgresIndexV2CutoverRepository(
	t *testing.T,
	pool *pgxpool.Pool,
) *CurrentIndexV2CutoverRepository {
	t.Helper()
	repository, err := NewCurrentIndexV2CutoverRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	return repository
}

func admitPostgresV1CutoverExecution(
	t *testing.T,
	pool *pgxpool.Pool,
	suffix string,
) postgresV1CutoverFixture {
	t.Helper()
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
	admitted, err := newPostgresIndexAdmissionService(t, jobs, "v1-cutover-"+suffix).Submit(
		context.Background(),
		postgresIndexSubmitRequest("v1-cutover-"+suffix, "v1-cutover-"+suffix),
	)
	if err != nil || !admitted.Created {
		t.Fatalf("persist version-1 admission: outcome=%+v err=%v", admitted, err)
	}
	results, err := NewIndexIngestResultsRepository(pool, IndexIngestOutputPolicy{
		LimitsRevision:    "elitea.runtime.limits.conformance.v1",
		ArtifactMediaType: "application/json",
		MaxArtifactBytes:  1024 * 1024,
	})
	if err != nil {
		t.Fatal(err)
	}
	expected, err := results.ExpectedIndexIngest(
		context.Background(), admitted.ExecutionID, admitted.Generation,
	)
	if err != nil {
		t.Fatalf("load admitted index binding: %v", err)
	}
	return postgresV1CutoverFixture{expected: expected}
}

func admitAndClaimPostgresV1CutoverExecution(
	t *testing.T,
	pool *pgxpool.Pool,
	repository *CurrentIndexV2CutoverRepository,
	suffix string,
) postgresV1CutoverFixture {
	t.Helper()
	fixture := admitPostgresV1CutoverExecution(t, pool, suffix)
	assertPostgresIndexV1CutoverState(t, repository, 1, 1, 0)
	fixture.fence = claimPostgresIndexExecution(t, pool, fixture.expected)
	assertPostgresIndexV1CutoverState(t, repository, 1, 1, 1)
	return fixture
}

func settlePostgresV1CutoverExecution(
	t *testing.T,
	pool *pgxpool.Pool,
	repository *CurrentIndexV2CutoverRepository,
	suffix string,
	outcome executionapp.SettlementOutcome,
) string {
	t.Helper()
	fixture := admitAndClaimPostgresV1CutoverExecution(t, pool, repository, suffix)
	var proposal executionapp.SettlementProposal
	switch outcome {
	case executionapp.SettlementSucceeded:
		frame := postgresInlineIndexOutputFrame(t, fixture.expected, fixture.fence, outputapp.IndexIngestSummary{
			Status:  outputapp.IndexIngestStatusOK,
			Message: "Indexing completed.",
		})
		results, err := NewIndexIngestResultsRepository(pool, IndexIngestOutputPolicy{
			LimitsRevision:    "elitea.runtime.limits.conformance.v1",
			ArtifactMediaType: "application/json",
			MaxArtifactBytes:  1024 * 1024,
		})
		if err != nil {
			t.Fatal(err)
		}
		if _, err := newPostgresIndexOutputService(t, pool, results).IngestIndex(context.Background(), frame); err != nil {
			t.Fatalf("project successful index result: %v", err)
		}
		proposal = frame.Settlement
	case executionapp.SettlementFailed:
		frame := postgresIndexRuntimeFailureFrame(t, fixture.expected, fixture.fence)
		if _, err := newPostgresRuntimeFailureService(t, pool).IngestFailure(context.Background(), frame); err != nil {
			t.Fatalf("project failed index result: %v", err)
		}
		proposal = frame.Settlement
	case executionapp.SettlementCancelled:
		execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.execution_jobs
SET desired_state = 'CANCELLED'
WHERE execution_id = $1
  AND generation = $2`, fixture.expected.ExecutionID, int64(fixture.expected.Generation))
		frame := postgresIndexCancellationFrame(t, fixture.expected, fixture.fence)
		if _, err := newPostgresRuntimeFailureService(t, pool).IngestFailure(context.Background(), frame); err != nil {
			t.Fatalf("project cancelled index result: %v", err)
		}
		proposal = frame.Settlement
	default:
		t.Fatalf("unsupported terminal outcome %q", outcome)
	}
	settlements, err := NewSettlementsRepository(pool)
	if err != nil {
		t.Fatal(err)
	}
	receipt, err := settlements.PrepareSettlement(context.Background(), proposal)
	if err != nil || receipt.ID == "" || receipt.Outcome != outcome {
		t.Fatalf("prepare %s settlement: receipt=%+v err=%v", outcome, receipt, err)
	}
	return fixture.expected.ExecutionID
}

func postgresIndexCancellationFrame(
	t *testing.T,
	expected outputapp.ExpectedIndexIngest,
	fence runtimedomain.Fence,
) outputapp.RuntimeFailureFrame {
	t.Helper()
	frame := postgresIndexRuntimeFailureFrame(t, expected, fence)
	failure := &runtimev1.RuntimeErrorV1{
		Code:        runtimev1.RuntimeErrorCodeV1_RUNTIME_ERROR_CODE_V1_CANCELLED,
		SafeMessage: "Execution was cancelled.",
		Retryable:   false,
	}
	encodedFailure, err := proto.MarshalOptions{Deterministic: true}.Marshal(failure)
	if err != nil {
		t.Fatal(err)
	}
	frame.Failure = outputapp.RuntimeFailure{
		Code:        "CANCELLED",
		SafeMessage: failure.GetSafeMessage(),
		Retryable:   failure.GetRetryable(),
	}
	frame.EncodedFailure = encodedFailure
	frame.PayloadDigest = runtimedomain.SHA256(encodedFailure)
	frame.Settlement.Outcome = executionapp.SettlementCancelled
	frame.Settlement.TerminalPayloadDigest = frame.PayloadDigest
	wireSettlement := &runtimev1.SettlementProposalV1{
		ProposalId:              frame.Settlement.ProposalID,
		RequestedOutcome:        runtimev1.ExecutionOutcomeV1_EXECUTION_OUTCOME_V1_CANCELLED,
		TerminalLogicalOutputId: frame.LogicalOutputID,
		TerminalEventId:         frame.EventID,
		TerminalSequence:        frame.Sequence,
		TerminalPayloadDigest:   postgresDigestV1(frame.PayloadDigest),
		PrepareIdempotencyKey:   frame.Settlement.IdempotencyKey,
	}
	frame.EncodedSettlement, err = proto.MarshalOptions{Deterministic: true}.Marshal(wireSettlement)
	if err != nil {
		t.Fatal(err)
	}
	frame.Settlement.ProposalDigest = runtimedomain.SHA256(frame.EncodedSettlement)
	if err := frame.Validate(); err != nil {
		t.Fatalf("build PostgreSQL index cancellation: %v", err)
	}
	return frame
}

func encodeUnknownPostgresCutoverSettlement(
	t *testing.T,
	pool *pgxpool.Pool,
	proposal *executionapp.SettlementProposal,
) {
	t.Helper()
	wire := &runtimev1.SettlementProposalV1{
		ProposalId:              proposal.ProposalID,
		RequestedOutcome:        runtimev1.ExecutionOutcomeV1_EXECUTION_OUTCOME_V1_OUTCOME_UNKNOWN,
		TerminalLogicalOutputId: proposal.TerminalLogicalOutputID,
		TerminalEventId:         proposal.TerminalEventID,
		TerminalSequence:        proposal.TerminalSequence,
		TerminalPayloadDigest:   postgresDigestV1(proposal.TerminalPayloadDigest),
		PrepareIdempotencyKey:   proposal.IdempotencyKey,
	}
	encoded, err := proto.MarshalOptions{Deterministic: true}.Marshal(wire)
	if err != nil {
		t.Fatal(err)
	}
	proposal.ProposalDigest = runtimedomain.SHA256(encoded)
	execPostgresCutoverFixture(t, pool, `
UPDATE elitea_runtime.output_inbox
SET settlement_outcome = 'OUTCOME_UNKNOWN',
    settlement_proposal_bytes = $2,
    settlement_proposal_digest = $3
WHERE execution_id = $1`, proposal.Fence.ExecutionID, encoded, proposal.ProposalDigest[:])
}

func assertPostgresIndexV1CutoverState(
	t *testing.T,
	repository *CurrentIndexV2CutoverRepository,
	liveJobs int64,
	outstandingOutbox int64,
	activeClaims int64,
) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	state, err := repository.ReadIndexV1CutoverState(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if state.LiveJobs != liveJobs ||
		state.OutstandingOutbox != outstandingOutbox ||
		state.ActiveClaims != activeClaims {
		t.Fatalf(
			"unexpected persisted cutover state: got=%+v want={LiveJobs:%d OutstandingOutbox:%d ActiveClaims:%d}",
			state, liveJobs, outstandingOutbox, activeClaims,
		)
	}
}

func execPostgresCutoverFixture(
	t *testing.T,
	pool *pgxpool.Pool,
	query string,
	args ...any,
) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if _, err := pool.Exec(ctx, query, args...); err != nil {
		t.Fatalf("mutate PostgreSQL cutover fixture: %v", err)
	}
}
