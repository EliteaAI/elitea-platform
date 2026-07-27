package repos

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
	"github.com/jackc/pgx/v5"
)

type recordingCurrentIndexActivityProjector struct {
	terminals []currentIndexActivityTerminal
}

func (*recordingCurrentIndexActivityProjector) projectNodeEvent(
	context.Context,
	sqlExecutor,
	int64,
	outputapp.NodeEventFrame,
) error {
	return nil
}

func (p *recordingCurrentIndexActivityProjector) projectTerminal(
	_ context.Context,
	_ sqlExecutor,
	_ int64,
	terminal currentIndexActivityTerminal,
) error {
	p.terminals = append(p.terminals, terminal)
	return nil
}

func TestCurrentIndexActivityMapsCurrentWorkerEventsToCurrentTraceContract(t *testing.T) {
	occurredAt := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	tests := []struct {
		name         string
		event        string
		kind         string
		text         string
		finishReason string
		isError      bool
	}{
		{
			name:  "tool start",
			event: `{"type":"agent_tool_start","stream_id":"event-controlled","message_id":"event-controlled","content":null,"response_metadata":{"tool_name":"index_data","tool_run_id":"run-1","timestamp_start":"2026-07-27T09:59:58Z","metadata":{"initiator":"user","tool_name":"index_data","display_name":"configurations","ignored":"must-not-persist"}},"references":[],"sio_event":"chat_predict","created_at":"2026-07-27T09:59:58Z"}`,
			kind:  "tool_call",
		},
		{
			name:  "thinking step",
			event: `{"type":"agent_thinking_step","stream_id":"event-controlled","message_id":"event-controlled","content":null,"response_metadata":{"name":"thinking_step","run_id":"run-1","tool_run_id":"run-1","tool_name":"loader","message":"10 files processed","datetime":"2026-07-27T09:59:59Z","metadata":{"initiator":"user","tool_name":"index_data","display_name":"configurations"}},"references":[],"sio_event":"chat_predict","created_at":"2026-07-27T09:59:59Z"}`,
			kind:  "thinking_step",
			text:  "10 files processed",
		},
		{
			name:  "tool error",
			event: `{"type":"agent_tool_error","stream_id":"event-controlled","message_id":"event-controlled","content":null,"response_metadata":{"tool_name":"index_data","tool_run_id":"run-1","finish_reason":"error","timestamp_start":"2026-07-27T09:59:58Z","timestamp_finish":"2026-07-27T10:00:00Z"},"references":[],"sio_event":"chat_predict","created_at":"2026-07-27T10:00:00Z"}`,
			kind:  "tool_call", finishReason: "error", isError: true,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			node, ok, err := currentIndexActivityNodeFromFrame(outputapp.NodeEventFrame{
				EventID:     "command-1:7",
				OccurredAt:  occurredAt,
				BrowserData: json.RawMessage(test.event),
			})
			if err != nil {
				t.Fatal(err)
			}
			if !ok {
				t.Fatal("current worker fixture was not mapped")
			}
			if node.kind != test.kind || node.runID != "run-1" ||
				node.text != test.text || node.finishReason != test.finishReason ||
				node.isError != test.isError {
				t.Fatalf("unexpected current Activity node: %+v", node)
			}
			if strings.Contains(string(node.attrs), "ignored") ||
				strings.Contains(string(node.attrs), "event-controlled") {
				t.Fatalf("untrusted event identity/metadata reached attrs: %s", node.attrs)
			}
			if test.kind == "tool_call" && strings.Contains(test.event, "agent_tool_start") &&
				!strings.Contains(string(node.attrs), `"display_name":"configurations"`) {
				t.Fatalf("current tool display metadata was not projected: %s", node.attrs)
			}
		})
	}
}

func TestCurrentIndexActivityRejectsUnboundedOrUnsupportedNodeFields(t *testing.T) {
	occurredAt := time.Date(2026, 7, 27, 10, 0, 0, 0, time.UTC)
	for _, event := range []string{
		`{"type":"agent_index_data_status","response_metadata":{"run_id":"run-1"}}`,
		`{"type":"agent_thinking_step","response_metadata":{"run_id":"run-1","message":"` +
			strings.Repeat("x", currentActivityMaxTextBytes+1) + `"}}`,
		`{"type":"agent_tool_start","response_metadata":{"tool_run_id":"` +
			strings.Repeat("x", currentActivityMaxNameBytes+1) + `"}}`,
	} {
		if _, ok, err := currentIndexActivityNodeFromFrame(outputapp.NodeEventFrame{
			OccurredAt: occurredAt, BrowserData: json.RawMessage(event),
		}); ok || (strings.Contains(event, "agent_index_data_status") && err != nil) ||
			(!strings.Contains(event, "agent_index_data_status") && err == nil) {
			t.Fatalf("unsupported/malformed classification: ok=%t err=%v", ok, err)
		}
	}
}

func TestCurrentIndexActivityMissingCurrentSchemaIsSafeNoop(t *testing.T) {
	executor := &scriptedExecutor{rowResults: []scriptedRow{
		{values: []any{true}},
		{values: []any{false}},
	}}
	groupID, ready, err := ensureCurrentIndexActivityGroup(
		t.Context(), executor, 7, "execution-1", 1, time.Now().UTC(),
	)
	if err != nil || ready || groupID != 0 {
		t.Fatalf("missing current schema: group=%d ready=%t err=%v", groupID, ready, err)
	}
	if len(executor.rowCalls) != 2 ||
		executor.rowCalls[1].args[0] != `"p_7".chat_conversations` {
		t.Fatalf("schema preflight did not use trusted identifier: %+v", executor.rowCalls)
	}
}

func TestCurrentIndexActivityConfigurationFailureDoesNotTouchChatSchema(t *testing.T) {
	executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{false}}}}
	groupID, ready, err := ensureCurrentIndexActivityGroup(
		t.Context(), executor, 7, "configuration-execution", 1, time.Now().UTC(),
	)
	if err != nil || ready || groupID != 0 {
		t.Fatalf("configuration failure: group=%d ready=%t err=%v", groupID, ready, err)
	}
	if len(executor.rowCalls) != 1 ||
		strings.Contains(executor.rowCalls[0].sql, "chat_") {
		t.Fatalf("configuration failure touched current chat schema: %+v", executor.rowCalls)
	}
}

func TestCurrentIndexActivityMissingOrCrossProjectTargetIsSafeNoop(t *testing.T) {
	t.Run("missing or deleted current conversation", func(t *testing.T) {
		executor := &scriptedExecutor{rowResults: []scriptedRow{
			{values: []any{true}},
			{values: []any{true}},
			{err: pgx.ErrNoRows},
		}}
		groupID, ready, err := ensureCurrentIndexActivityGroup(
			t.Context(), executor, 7, "execution-1", 1, time.Now().UTC(),
		)
		if err != nil || ready || groupID != 0 {
			t.Fatalf("missing/deleted target: group=%d ready=%t err=%v", groupID, ready, err)
		}
	})

	t.Run("cross project admitted execution", func(t *testing.T) {
		executor := &scriptedExecutor{rowResults: []scriptedRow{{values: []any{false}}}}
		groupID, ready, err := ensureCurrentIndexActivityGroup(
			t.Context(), executor, 8, "project-7-execution", 1, time.Now().UTC(),
		)
		if err != nil || ready || groupID != 0 {
			t.Fatalf("cross-project target: group=%d ready=%t err=%v", groupID, ready, err)
		}
		if len(executor.rowCalls) != 1 || strings.Contains(executor.rowCalls[0].sql, `"p_7"`) {
			t.Fatalf("cross-project lookup touched another tenant: %+v", executor.rowCalls)
		}
	})
}
