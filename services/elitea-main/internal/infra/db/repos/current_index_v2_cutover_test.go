package repos

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestCurrentIndexV2CutoverRepositoryReadsExactSafeRetainedOutboxPredicate(t *testing.T) {
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{int64(2), int64(3), int64(4)}}}}
	repository, err := newCurrentIndexV2CutoverRepository(executor)
	if err != nil {
		t.Fatal(err)
	}

	state, err := repository.ReadIndexV1CutoverState(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if state.LiveJobs != 2 || state.OutstandingOutbox != 3 || state.ActiveClaims != 4 {
		t.Fatalf("unexpected persisted state: %+v", state)
	}
	if len(executor.rowCalls) != 1 {
		t.Fatalf("unexpected query count: %d", len(executor.rowCalls))
	}
	query := executor.rowCalls[0].sql
	for _, required := range []string{
		"outbox.retired_at IS NULL",
		"outbox.authority_granted_at IS NOT NULL",
		"job.state IN ('SUCCEEDED', 'FAILED', 'CANCELLED')",
		"job.settled_at IS NOT NULL",
		"FROM elitea_runtime.execution_settlements AS settlement",
		"settlement.execution_id = job.execution_id",
		"settlement.generation = job.generation",
		"settlement.disposition = job.state",
		"settlement.committed_at IS NOT NULL",
		"claim.released_at IS NULL",
	} {
		if !strings.Contains(query, required) {
			t.Fatalf("cutover query is missing %q", required)
		}
	}
}

func TestCurrentIndexV2CutoverRepositoryRejectsInvalidDependenciesAndContext(t *testing.T) {
	if _, err := newCurrentIndexV2CutoverRepository(nil); err == nil {
		t.Fatal("accepted nil query executor")
	}
	repository, err := newCurrentIndexV2CutoverRepository(&scriptedExecutor{})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ReadIndexV1CutoverState(nil); err == nil {
		t.Fatal("accepted nil context")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := repository.ReadIndexV1CutoverState(ctx); !errors.Is(err, context.Canceled) {
		t.Fatalf("did not preserve context cancellation: %v", err)
	}
}
