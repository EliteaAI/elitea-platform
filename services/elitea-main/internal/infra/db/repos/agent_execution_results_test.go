package repos

import (
	"encoding/json"
	"errors"
	"testing"

	outputapp "github.com/EliteaAI/elitea-platform/services/elitea-main/internal/application/output"
)

func TestDecodeCurrentAgentHITLPauseAcceptsOneSequentialNestedInterrupt(t *testing.T) {
	interrupt := map[string]any{
		"type":                 "hitl",
		"interrupt_id":         "interrupt-nested-1",
		"available_actions":    []any{"approve", "reject", "block_with_comment"},
		"parent_agent_call_id": "call-pipeline-1",
		"parent_agent_path": []any{
			map[string]any{"name": "artifact_test", "call_id": "call-pipeline-1"},
		},
	}
	pause := decodeAgentHITLPauseForTest(t, interrupt)
	if pause.ThreadID != "thread-parent-1" {
		t.Fatalf("thread ID = %q", pause.ThreadID)
	}
	var persisted map[string]any
	if err := json.Unmarshal(pause.Interrupt, &persisted); err != nil ||
		persisted["parent_agent_call_id"] != "call-pipeline-1" {
		t.Fatalf("persisted interrupt = %#v, error = %v", persisted, err)
	}
}

func TestDecodeCurrentAgentHITLPauseRejectsParallelChildRouting(t *testing.T) {
	for _, routed := range []map[string]any{
		{"child_thread_id": "child-thread-1"},
		{"via_call_id": "call-1"},
		{"_via_call_id": "call-1"},
	} {
		interrupt := map[string]any{
			"interrupt_id":      "interrupt-child-1",
			"available_actions": []any{"approve"},
		}
		for key, value := range routed {
			interrupt[key] = value
		}
		_, err := decodeCurrentAgentHITLPause(
			json.RawMessage(`"Approve?"`),
			hitlMetadataForTest(t, interrupt),
		)
		if !errors.Is(err, outputapp.ErrAgentExecutionResultMismatch) {
			t.Fatalf("routed interrupt %#v error = %v", routed, err)
		}
	}
}

func TestDecodeCurrentAgentHITLPauseRejectsUnboundNestedPath(t *testing.T) {
	interrupt := map[string]any{
		"interrupt_id":         "interrupt-nested-1",
		"available_actions":    []any{"approve"},
		"parent_agent_call_id": "call-pipeline-1",
		"parent_agent_path": []any{
			map[string]any{"name": "artifact_test", "call_id": "different-call"},
		},
	}
	_, err := decodeCurrentAgentHITLPause(
		json.RawMessage(`"Approve?"`),
		hitlMetadataForTest(t, interrupt),
	)
	if !errors.Is(err, outputapp.ErrAgentExecutionResultMismatch) {
		t.Fatalf("unbound path error = %v", err)
	}
}

func TestDecodeCurrentAgentHITLPauseRejectsIncompleteNestedIdentity(t *testing.T) {
	for _, interrupt := range []map[string]any{
		{
			"interrupt_id":         "interrupt-call-only",
			"available_actions":    []any{"approve"},
			"parent_agent_call_id": "call-pipeline-1",
		},
		{
			"interrupt_id":      "interrupt-path-only",
			"available_actions": []any{"approve"},
			"parent_agent_path": []any{
				map[string]any{"name": "artifact_test", "call_id": "call-pipeline-1"},
			},
		},
	} {
		_, err := decodeCurrentAgentHITLPause(
			json.RawMessage(`"Approve?"`),
			hitlMetadataForTest(t, interrupt),
		)
		if !errors.Is(err, outputapp.ErrAgentExecutionResultMismatch) {
			t.Fatalf("incomplete nested identity %#v error = %v", interrupt, err)
		}
	}
}

func decodeAgentHITLPauseForTest(
	t *testing.T,
	interrupt map[string]any,
) currentAgentHITLPause {
	t.Helper()
	pause, err := decodeCurrentAgentHITLPause(
		json.RawMessage(`"Approve?"`),
		hitlMetadataForTest(t, interrupt),
	)
	if err != nil {
		t.Fatal(err)
	}
	return pause
}

func hitlMetadataForTest(t *testing.T, interrupt map[string]any) json.RawMessage {
	t.Helper()
	encoded, err := json.Marshal(map[string]any{
		"thread_id":       "thread-parent-1",
		"hitl_interrupt":  interrupt,
		"hitl_interrupts": []any{interrupt},
	})
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
