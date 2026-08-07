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

func TestDecodeCurrentAgentHITLPauseAcceptsBoundedParallelInProcessInterrupts(t *testing.T) {
	interrupts := []map[string]any{
		{
			"type": "hitl", "interrupt_id": "interrupt-parallel-1",
			"available_actions":    []any{"approve", "reject"},
			"parent_agent_call_id": "call-orchestrator-1",
			"parent_agent_path":    []any{map[string]any{"name": "orchestrator", "call_id": "call-orchestrator-1"}},
		},
		{
			"type": "hitl", "interrupt_id": "interrupt-parallel-2",
			"available_actions":    []any{"approve", "block_with_comment"},
			"parent_agent_call_id": "call-orchestrator-2",
			"parent_agent_path":    []any{map[string]any{"name": "orchestrator", "call_id": "call-orchestrator-2"}},
		},
	}
	pause, err := decodeCurrentAgentHITLPause(
		json.RawMessage(`"Approve both?"`),
		hitlMetadataForInterruptsForTest(t, interrupts),
	)
	if err != nil {
		t.Fatal(err)
	}
	var persisted []map[string]any
	if err := json.Unmarshal(pause.Interrupts, &persisted); err != nil || len(persisted) != 2 ||
		persisted[0]["interrupt_id"] != "interrupt-parallel-1" ||
		persisted[1]["interrupt_id"] != "interrupt-parallel-2" {
		t.Fatalf("persisted interrupts = %#v, error = %v", persisted, err)
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

func TestDecodeCurrentAgentAuthorizationPausePreservesExactInvocationHierarchy(t *testing.T) {
	requests := []map[string]any{
		{
			"tool_run_id":  "tool-run-sharepoint-1",
			"server_url":   "https://sharepoint.example.test",
			"tool_name":    "list_sites",
			"toolkit_name": "SharePoint",
			"toolkit_type": "sharepoint",
			"metadata": map[string]any{
				"parent_agent_name":    "researcher",
				"parent_agent_call_id": "agent-call-1",
				"parent_agent_path": []any{
					map[string]any{"name": "researcher", "call_id": "agent-call-1"},
				},
			},
		},
	}
	metadata, err := json.Marshal(map[string]any{
		"thread_id":              "thread-parent-1",
		"tool_run_id":            "tool-run-sharepoint-1",
		"authorization_requests": requests,
	})
	if err != nil {
		t.Fatal(err)
	}
	pause, err := decodeCurrentAgentAuthorizationPause(
		json.RawMessage(`"SharePoint authorization is required."`),
		metadata,
	)
	if err != nil || pause.ThreadID != "thread-parent-1" {
		t.Fatalf("pause=%+v error=%v", pause, err)
	}
	var persisted []map[string]any
	if err := json.Unmarshal(pause.Requests, &persisted); err != nil || len(persisted) != 1 ||
		persisted[0]["tool_run_id"] != "tool-run-sharepoint-1" {
		t.Fatalf("persisted=%#v error=%v", persisted, err)
	}
}

func TestDecodeCurrentAgentAuthorizationPauseRejectsAmbiguousIdentity(t *testing.T) {
	for name, test := range map[string]struct {
		requests   []map[string]any
		terminalID string
	}{
		"duplicate": {
			requests: []map[string]any{
				{"tool_run_id": "tool-run-1", "server_url": "https://one.example.test"},
				{"tool_run_id": "tool-run-1", "server_url": "https://two.example.test"},
			},
			terminalID: "tool-run-1",
		},
		"terminal mismatch": {
			requests: []map[string]any{
				{"tool_run_id": "tool-run-1", "server_url": "https://one.example.test"},
			},
			terminalID: "tool-run-other",
		},
	} {
		t.Run(name, func(t *testing.T) {
			metadata, err := json.Marshal(map[string]any{
				"thread_id":              "thread-parent-1",
				"tool_run_id":            test.terminalID,
				"authorization_requests": test.requests,
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = decodeCurrentAgentAuthorizationPause(
				json.RawMessage(`"Authorization required."`),
				metadata,
			)
			if !errors.Is(err, outputapp.ErrAgentExecutionResultMismatch) {
				t.Fatalf("error=%v", err)
			}
		})
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
	return hitlMetadataForInterruptsForTest(t, []map[string]any{interrupt})
}

func hitlMetadataForInterruptsForTest(t *testing.T, interrupts []map[string]any) json.RawMessage {
	t.Helper()
	if len(interrupts) == 0 {
		t.Fatal("interrupts are required")
	}
	encoded, err := json.Marshal(map[string]any{
		"thread_id":       "thread-parent-1",
		"hitl_interrupt":  interrupts[0],
		"hitl_interrupts": interrupts,
	})
	if err != nil {
		t.Fatal(err)
	}
	return encoded
}
