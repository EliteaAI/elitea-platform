package repos

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
)

func TestNodeEventsRepositoryProjectsThroughLiveAuthorityAndReplayLog(t *testing.T) {
	frame := testNodeEventFrame()
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", false, false}},
	}}
	store := &scriptedStore{scriptedExecutor: executor}
	repository, err := newNodeEventsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := repository.ProjectNodeEvent(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Inserted || outcome.Cursor != 17 || outcome.CommittedSequence != 1 || store.txCalls != 1 {
		t.Fatalf("unexpected node event projection: %+v tx=%d", outcome, store.txCalls)
	}
	if len(executor.rowCalls) != 4 {
		t.Fatalf("unexpected node event query count: %d", len(executor.rowCalls))
	}
	lockQuery := executor.rowCalls[1]
	for _, evidence := range []string{"execution_claims", "command_outbox", "j.capability_id = 'index.ingest.v1'", "c.initial_output_watermark = $13", "FOR UPDATE OF j, o, c"} {
		if !strings.Contains(lockQuery.sql, evidence) {
			t.Fatalf("node event authority lock SQL is missing %q", evidence)
		}
	}
	stateQuery := executor.rowCalls[2]
	if !strings.Contains(stateQuery.sql, "execution_replay_state") || !strings.Contains(stateQuery.sql, "FOR UPDATE") {
		t.Fatal("node event did not serialize the retained sequence state")
	}
	query := executor.rowCalls[3]
	for _, evidence := range []string{"ranked_progress", "deleted_progress", "output_inbox", "execution_replay_events", "execution_replay_state", "r.projection_project_id = $4", "c.initial_output_watermark = $18"} {
		if !strings.Contains(query.sql, evidence) {
			t.Fatalf("node event projection SQL is missing %q", evidence)
		}
	}
	if strings.Contains(query.sql, "FOR UPDATE") {
		t.Fatal("node event state query shares the authority-lock statement snapshot")
	}
	if query.args[4] != replayEventNodeEvent || string(query.args[5].([]byte)) != string(frame.BrowserData) {
		t.Fatal("node event did not project exact browser JSON into the replay log")
	}
}

func TestNodeEventsRepositoryReplaysIdenticalEventAndRejectsDifferentBytes(t *testing.T) {
	frame := testNodeEventFrame()
	digest := runtimedomain.SHA256(frame.BrowserData)
	row := scriptedRow{values: []any{int64(19), frame.Fence.ExecutionID, int64(1), int64(42), replayEventNodeEvent, []byte(frame.BrowserData), digest[:]}}

	repository, err := newNodeEventsRepository(&scriptedStore{scriptedExecutor: &scriptedExecutor{rowResults: []scriptedRow{row}}})
	if err != nil {
		t.Fatal(err)
	}
	outcome, err := repository.ProjectNodeEvent(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if outcome.Inserted || outcome.Cursor != 19 || outcome.CommittedSequence != 1 {
		t.Fatalf("identical replay was not idempotent: %+v", outcome)
	}

	frame.BrowserData = []byte(`{"type":"agent_index_data_status","content":"different"}`)
	repository, err = newNodeEventsRepository(&scriptedStore{scriptedExecutor: &scriptedExecutor{rowResults: []scriptedRow{row}}})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ProjectNodeEvent(context.Background(), frame); !errors.Is(err, outputapp.ErrNodeEventOutputConflict) {
		t.Fatalf("different replay bytes did not conflict: %v", err)
	}
}

func TestNodeEventsRepositoryRejectsSequenceGapBeforeDurableAppend(t *testing.T) {
	frame := testNodeEventFrame()
	frame.Sequence = 2
	frame.EventID = frame.Fence.CommandID + ":2"
	frame.LogicalOutputID = outputapp.NodeEventLogicalOutputID(frame.Fence.ExecutionID, 2)
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
	}}
	repository, err := newNodeEventsRepository(&scriptedStore{scriptedExecutor: executor})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ProjectNodeEvent(context.Background(), frame); !errors.Is(err, outputapp.ErrNodeEventOutputConflict) {
		t.Fatalf("sequence gap was not rejected: %v", err)
	}
}

func TestNodeEventsRepositoryRejectsMissingAuthorityBeforeStateQuery(t *testing.T) {
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{err: pgx.ErrNoRows},
	}}
	repository, err := newNodeEventsRepository(&scriptedStore{scriptedExecutor: executor})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ProjectNodeEvent(context.Background(), testNodeEventFrame()); !errors.Is(err, runtimedomain.ErrStaleFence) {
		t.Fatalf("missing authority error = %v", err)
	}
	if len(executor.rowCalls) != 2 || !strings.Contains(executor.rowCalls[1].sql, "FOR UPDATE OF j, o, c") {
		t.Fatalf("missing authority reached state query: %+v", executor.rowCalls)
	}
}

func testNodeEventFrame() outputapp.NodeEventFrame {
	fence := runtimedomain.Fence{
		CommandID:         "command-node-1",
		ExecutionID:       "execution-node-1",
		Generation:        1,
		WorkloadIdentity:  "spiffe://elitea.test/workload/indexer-1",
		WorkloadSessionID: "workload-node-1",
		ProducerID:        "indexer-1",
		ClaimAttempt:      1,
		LeaseEpoch:        1,
		Token:             runtimedomain.FenceToken(runtimedomain.SHA256([]byte("node-event-fence-token"))),
	}
	encoded := []byte("deterministic-node-event-protobuf")
	return outputapp.NodeEventFrame{
		StreamID:            "execution-node-1:1",
		TenantID:            "tenant-1",
		ResourceProjectID:   "42",
		ProjectionProjectID: "42",
		WorkloadSessionID:   fence.WorkloadSessionID,
		ProducerID:          fence.ProducerID,
		EventID:             fence.CommandID + ":1",
		LogicalOutputID:     outputapp.NodeEventLogicalOutputID(fence.ExecutionID, 1),
		Sequence:            1,
		OccurredAt:          time.Date(2026, time.July, 22, 12, 0, 0, 0, time.UTC),
		Fence:               fence,
		PayloadDigest:       runtimedomain.SHA256(encoded),
		EncodedEvent:        encoded,
		BrowserData:         []byte(`{"type":"agent_index_data_status"}`),
	}
}
