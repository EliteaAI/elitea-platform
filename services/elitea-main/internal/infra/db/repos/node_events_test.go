package repos

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	executiondomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/execution"
	runtimedomain "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/domain/runtime"
	"github.com/jackc/pgx/v5"
)

func TestNodeEventsRepositoryProjectsThroughLiveAuthorityAndReplayLog(t *testing.T) {
	frame := testNodeEventFrame()
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", executiondomain.IndexIngestCapability, false, false}},
	}}
	store := &scriptedStore{scriptedExecutor: executor}
	repository, err := newNodeEventsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	agentTrace := &recordingCurrentAgentTraceProjector{}
	repository.agentTrace = agentTrace
	activity := &recordingNodeEventActivityProjector{}
	repository.activity = activity
	outcome, err := repository.ProjectNodeEvent(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Inserted || outcome.Cursor != 17 || outcome.CommittedSequence != 1 || store.txCalls != 1 {
		t.Fatalf("unexpected node event projection: %+v tx=%d", outcome, store.txCalls)
	}
	if agentTrace.calls != 1 || agentTrace.projectID != 42 ||
		string(agentTrace.frame.BrowserData) != string(frame.BrowserData) {
		t.Fatalf("agent trace projector did not share the durable event transaction: %+v", agentTrace)
	}
	if activity.calls != 1 {
		t.Fatalf("index Activity projector calls = %d, want 1", activity.calls)
	}
	if len(executor.rowCalls) != 4 {
		t.Fatalf("unexpected node event query count: %d", len(executor.rowCalls))
	}
	lockQuery := executor.rowCalls[1]
	for _, evidence := range []string{
		"execution_claims",
		"command_outbox",
		"j.capability_id IN (",
		"'index.ingest.v1'",
		"'agent.execute.application.v1'",
		"'agent.execute.adhoc.v1'",
		"c.initial_output_watermark = $13",
		"j.capability_id",
		"FOR UPDATE OF j, o, c",
	} {
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

type recordingNodeEventActivityProjector struct {
	calls int
}

func (p *recordingNodeEventActivityProjector) projectNodeEvent(
	context.Context,
	sqlExecutor,
	int64,
	outputapp.NodeEventFrame,
) error {
	p.calls++
	return nil
}

func (*recordingNodeEventActivityProjector) projectTerminal(
	context.Context,
	sqlExecutor,
	int64,
	currentIndexActivityTerminal,
) error {
	return nil
}

type recordingCurrentAgentTraceProjector struct {
	calls     int
	projectID int64
	frame     outputapp.NodeEventFrame
}

func (p *recordingCurrentAgentTraceProjector) projectAgentTraceDelta(
	_ context.Context,
	_ sqlExecutor,
	projectID int64,
	frame outputapp.NodeEventFrame,
) error {
	p.calls++
	p.projectID = projectID
	p.frame = frame
	return nil
}

func TestNodeEventsRepositoryDoesNotInterpretNestedAgentToolEventAsIndexActivity(t *testing.T) {
	frame := testNodeEventFrame()
	frame.BrowserData = []byte(`{
		"type":"agent_tool_start",
		"response_metadata":{
			"tool_name":"reload-sse-pov",
			"tool_run_id":"child-call-1",
			"metadata":{
				"parent_agent_name":"Elitea",
				"parent_agent_call_id":"root-call-1",
				"parent_agent_path":["Elitea","reload-sse-pov"],
				"sibling_ordinal":0
			}
		}
	}`)
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", executiondomain.AgentAdhocCapability, false, false}},
	}}
	repository, err := newNodeEventsRepository(&scriptedStore{scriptedExecutor: executor})
	if err != nil {
		t.Fatal(err)
	}
	activity := &recordingNodeEventActivityProjector{}
	agentTrace := &recordingCurrentAgentTraceProjector{}
	repository.activity = activity
	repository.agentTrace = agentTrace

	outcome, err := repository.ProjectNodeEvent(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Inserted || outcome.Cursor != 17 || outcome.CommittedSequence != 1 {
		t.Fatalf("unexpected nested agent event projection: %+v", outcome)
	}
	if activity.calls != 0 {
		t.Fatalf("agent event reached index Activity projector %d times", activity.calls)
	}
	if agentTrace.calls != 1 || string(agentTrace.frame.BrowserData) != string(frame.BrowserData) {
		t.Fatalf("nested agent event did not reach agent trace projector: %+v", agentTrace)
	}
}

type recordingCurrentAgentTextProjector struct {
	calls     int
	projectID int64
	frame     outputapp.NodeEventFrame
}

func (p *recordingCurrentAgentTextProjector) projectAgentTextDelta(
	_ context.Context,
	_ sqlExecutor,
	projectID int64,
	frame outputapp.NodeEventFrame,
) error {
	p.calls++
	p.projectID = projectID
	p.frame = frame
	return nil
}

func TestNodeEventsRepositoryProjectsAgentTextInTheReplayTransaction(t *testing.T) {
	frame := testNodeEventFrame()
	frame.BrowserData = []byte(`{
		"type":"agent_llm_chunk",
		"stream_id":"conversation-1",
		"message_id":"message-1",
		"execution_generation":"generation-1",
		"sio_event":"chat_predict",
		"content":"durable partial"
	}`)
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", executiondomain.AgentAdhocCapability, false, false}},
	}}
	repository, err := newNodeEventsRepository(&scriptedStore{scriptedExecutor: executor})
	if err != nil {
		t.Fatal(err)
	}
	textProjector := &recordingCurrentAgentTextProjector{}
	repository.agentText = textProjector

	outcome, err := repository.ProjectNodeEvent(context.Background(), frame)
	if err != nil {
		t.Fatal(err)
	}
	if !outcome.Inserted || textProjector.calls != 1 || textProjector.projectID != 42 ||
		string(textProjector.frame.BrowserData) != string(frame.BrowserData) {
		t.Fatalf("agent text projection = %+v projector=%+v", outcome, textProjector)
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

func TestNodeEventsRepositoryPersistsTaskRestampWithAuthenticatedAdmissionIdentity(t *testing.T) {
	frame := testNodeEventFrame()
	frame.BrowserData = []byte(`{
		"type":"agent_index_data_status",
		"response_metadata":{
			"state":"in_progress",
			"created_at":1700000000.25,
			"task_id":"forged-task",
			"project_id":999,
			"toolkit_id":999,
			"index_name":"forged"
		}
	}`)
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", executiondomain.IndexIngestCapability, false, false}},
		{values: []any{true, true}},
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
	if !outcome.Inserted || len(executor.rowCalls) != 5 || store.txCalls != 1 {
		t.Fatalf("outcome=%+v calls=%d tx=%d", outcome, len(executor.rowCalls), store.txCalls)
	}
	intent := executor.rowCalls[4]
	for _, evidence := range []string{
		"index_meta_initialized_at IS NOT NULL",
		"j.tenant_id = $3",
		"j.resource_project_id = $4",
		"j.projection_project_id = $5",
		"index_meta_task_restamp_status IS NULL",
	} {
		if !strings.Contains(intent.sql, evidence) {
			t.Fatalf("task restamp intent SQL is missing %q", evidence)
		}
	}
	if intent.args[0] != frame.Fence.ExecutionID ||
		intent.args[1] != int64(frame.Fence.Generation) ||
		intent.args[2] != frame.TenantID ||
		intent.args[3] != int64(42) ||
		intent.args[4] != int64(42) ||
		intent.args[5] != frame.EventID ||
		intent.args[7] != 1700000000.25 {
		t.Fatalf("task restamp intent used worker identity: %#v", intent.args)
	}
}

func TestNodeEventsRepositoryRollsBackProgressWhenTaskRestampLosesAdmissionAuthority(t *testing.T) {
	frame := testNodeEventFrame()
	frame.BrowserData = []byte(`{
		"type":"agent_index_data_status",
		"response_metadata":{"state":"in_progress","created_at":1700000000.25}
	}`)
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{err: pgx.ErrNoRows},
		{values: []any{"claim-node-1"}},
		{values: []any{int64(0), "", []byte{}, []byte{}, int64(0), int64(0), int64(0), int64(0)}},
		{values: []any{int64(17), "claim-node-1", "RUNNING", executiondomain.IndexIngestCapability, false, false}},
		{values: []any{false, false}},
	}}
	store := &scriptedStore{scriptedExecutor: executor}
	repository, err := newNodeEventsRepository(store)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repository.ProjectNodeEvent(context.Background(), frame); !errors.Is(err, runtimedomain.ErrStaleFence) {
		t.Fatalf("lost task restamp admission authority error=%v", err)
	}
	if store.txCalls != 1 {
		t.Fatalf("transaction count=%d", store.txCalls)
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
