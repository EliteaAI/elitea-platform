from __future__ import annotations

from types import SimpleNamespace

import hashlib

from elitea.runtime.v1 import (
    agent_pb2,
    command_pb2,
    common_pb2,
    control_pb2,
    envelope_pb2,
)

from elitea_worker.execution.delivery import _validate_pending_output
from elitea_worker.handlers.agent_events import (
    CurrentAgentNodeEventCallback,
    CurrentAgentNodeEventContext,
)
from elitea_worker.protocol.codec import (
    VerifiedWorkerCommand,
    build_node_event_output_frame,
)
from elitea_worker.protocol.node_event import encode_current_node_event_json


def _callback():
    events = []
    callback = CurrentAgentNodeEventCallback(
        CurrentAgentNodeEventContext(
            stream_id="conversation-1",
            message_id="message-1",
            execution_generation="generation-1",
            sio_event="chat_predict",
            thread_id="thread-1",
            project_id=7,
            chat_project_id=7,
        ),
        events.append,
    )
    return callback, events


def _request_payload():
    return SimpleNamespace(
        application={"id": 11, "version_id": 22},
        should_continue=False,
        hitl_resume=False,
        parallel_reconcile=None,
        invoked_skills=[],
    )


def _json(event):
    import json

    return json.loads(encode_current_node_event_json(event))


def test_tool_lifecycle_emits_live_events_and_existing_trace_deltas() -> None:
    callback, events = _callback()
    metadata = {
        "parent_agent_name": "researcher",
        "parent_agent_call_id": "call-parent",
        "langgraph_node": "tools",
        "toolkit_name": "github",
    }

    callback.on_tool_start(
        {"name": "search", "metadata": {"display_name": "GitHub"}},
        "ignored",
        run_id="run-1",
        metadata=metadata,
        inputs={"query": "typed contracts"},
    )
    callback.on_tool_end({"items": 2}, run_id="run-1")

    decoded = [_json(event) for event in events]
    assert [event["type"] for event in decoded] == [
        "agent_tool_start",
        "partial_message",
        "agent_tool_end",
        "partial_message",
    ]
    delta = decoded[-1]
    assert delta["execution_generation"] == "generation-1"
    tool = delta["response_metadata"]["tool_calls"]["run-1"]
    assert tool["tool_name"] == "search"
    assert tool["tool_output"] == '{"items":2}'
    assert tool["metadata"]["parent_agent_name"] == "researcher"
    assert tool["finish_reason"] == "stop"
    assert decoded[2]["content"] is None


def test_large_tool_result_fits_one_data_plane_frame_without_duplicate_content() -> None:
    callback, events = _callback()
    callback.on_tool_start(
        {"name": "list_initiatives", "metadata": {"display_name": "Aha"}},
        "ignored",
        run_id="run-large",
        metadata={"toolkit_name": "aha"},
        inputs={"max_records": 100},
    )
    # Production evidence for the failed Aha turn was 51,979 bytes. Keep this
    # fixture at that exact UTF-8 size while including JSON quoting overhead.
    # The stored current output required 57,366 bytes when encoded as a JSON
    # string. Reproduce the same 5,387-byte escaping overhead (including the
    # outer quotes), not only a friendly ASCII payload.
    escaped_quote_count = 5_385
    large_output = ('"' * escaped_quote_count) + (
        "x" * (51_979 - escaped_quote_count)
    )
    assert len(large_output.encode("utf-8")) == 51_979

    callback.on_tool_end(large_output, run_id="run-large")

    decoded = [_json(event) for event in events]
    assert [event["type"] for event in decoded] == [
        "agent_tool_start",
        "partial_message",
        "agent_tool_end",
        "partial_message",
    ]
    assert decoded[2]["content"] is None
    assert decoded[2]["response_metadata"]["tool_output"] == large_output

    fence = common_pb2.ExecutionFenceV1(
        workload_session_id="worker-session",
        producer_id="worker-1",
        claim_attempt=1,
        lease_epoch=1,
        fence_token=b"f" * 32,
    )
    command = command_pb2.WorkerCommandV1(
        command_id="command-large",
        execution_id="execution-large",
        generation=1,
        tenant_id="tenant-1",
        resource_project_id="7",
        projection_project_id="7",
        agent_execution=agent_pb2.AgentExecutionCommandV1(
            request_entry_id="agent-request",
            client_stream_id="conversation-1",
            client_message_id="message-1",
            sio_event="chat_predict",
        ),
    )
    verified = VerifiedWorkerCommand(
        envelope=envelope_pb2.WorkerExecutionEnvelopeV1(fence=fence),
        command=command,
    )
    for sequence, event in enumerate(events[2:], start=1):
        frame = build_node_event_output_frame(
            verified,
            event,
            sequence=sequence,
            occurred_at_unix_millis=1_700_000_000_000,
        )
        assert len(frame.SerializeToString(deterministic=True)) <= 64 * 1024


class _Generation:
    def model_dump(self):
        return {
            "type": "ChatGeneration",
            "text": "answer",
            "message": {
                "content": [
                    {"type": "thinking", "thinking": "reasoning"},
                    {"type": "text", "text": "answer"},
                ],
                "additional_kwargs": {},
            },
        }


class _ToolCallGeneration:
    def model_dump(self):
        return {
            "type": "ChatGeneration",
            "text": "",
            "message": {
                "content": "",
                "additional_kwargs": {
                    "tool_calls": [
                        {
                            "function": {
                                "name": "list_products",
                                "arguments": '{"private":"must-not-be-copied"}',
                            }
                        }
                    ]
                },
            },
        }


def test_llm_callbacks_emit_stream_and_thinking_step_delta() -> None:
    callback, events = _callback()
    callback.on_chat_model_start(
        {"name": "ChatModel"},
        [[]],
        run_id="llm-1",
        metadata={"ls_model_name": "model-1", "parent_agent_name": "planner"},
    )
    callback.on_llm_new_token("hel", run_id="llm-1")
    callback.on_llm_new_token("hello", run_id="llm-1")
    callback.on_llm_end(
        SimpleNamespace(generations=[[_Generation()]]),
        run_id="llm-1",
    )

    decoded = [_json(event) for event in events]
    start = decoded[0]
    assert start["type"] == "agent_llm_start"
    assert start["response_metadata"]["tool_name"] == "Thinking step"
    assert start["response_metadata"]["metadata"]["ls_model_name"] == "model-1"
    assert [event["content"] for event in decoded if event["type"] == "agent_llm_chunk"] == [
        "hel",
        "lo",
    ]
    partial = decoded[-1]
    step = partial["response_metadata"]["thinking_steps"][0]
    assert step["text"] == "answer"
    assert step["thinking"] == "reasoning"
    assert step["message"]["response_metadata"]["model_name"] == "model-1"
    assert step["parent_agent_name"] == "planner"


def test_tool_call_only_llm_turn_keeps_model_activity_without_copying_arguments() -> None:
    callback, events = _callback()
    callback.on_chat_model_start(
        {"name": "ChatModel"},
        [[]],
        run_id="llm-tool-call",
        metadata={"ls_model_name": "model-1"},
    )
    callback.on_llm_end(
        SimpleNamespace(generations=[[_ToolCallGeneration()]]),
        run_id="llm-tool-call",
    )

    decoded = [_json(event) for event in events]
    step = decoded[-1]["response_metadata"]["thinking_steps"][0]
    assert step["text"] == "Planned to call tool 'list_products'"
    assert "must-not-be-copied" not in str(step)


def test_hitl_terminal_keeps_current_shape_and_is_not_a_full_message() -> None:
    callback, events = _callback()
    payload = _request_payload()
    interrupt = {
        "interrupt_id": "interrupt-1",
        "node_name": "sensitive_tool",
        "message": "Approve?",
        "available_actions": ["approve", "reject"],
        "routes": [{"tool_call_id": "call-1"}],
    }

    terminal = callback.emit_terminal(
        {
            "thread_id": "thread-1",
            "paused": True,
            "pause_type": "hitl",
            "hitl_interrupt": interrupt,
            "hitl_interrupts": [interrupt],
        },
        payload,
    )

    decoded = [_json(event) for event in events]
    assert [event["type"] for event in decoded] == ["agent_hitl_interrupt"]
    event = _json(terminal)
    assert event["stream_id"] == "conversation-1"
    assert event["sio_event"] == "chat_predict"
    assert event["content"] == "Approve?"
    assert event["response_metadata"]["hitl_interrupt"] == interrupt
    assert event["response_metadata"]["hitl_interrupts"] == [interrupt]
    assert event["response_metadata"]["available_actions"] == [
        "approve",
        "reject",
    ]


def test_raw_sdk_hitl_custom_event_is_not_a_second_terminal_owner() -> None:
    callback, events = _callback()
    callback.on_custom_event(
        "hitl_interrupt",
        {
            "node_name": "sensitive_tool",
            "message": "Approve?",
            "available_actions": ["approve", "reject"],
            "routes": [{"tool_call_id": "call-1"}],
        },
        run_id="hitl-1",
        metadata={"checkpoint_ns": "agent:child"},
    )

    assert events == []


def test_large_transition_omits_only_duplicate_transcript_state() -> None:
    callback, events = _callback()
    large_tool_transcript = "x" * 90_000

    callback.on_custom_event(
        "on_transitional_edge",
        {
            "next_step": "agent",
            "state": {
                "messages": [
                    {"role": "tool", "content": large_tool_transcript},
                ],
                "chat_history": large_tool_transcript,
                "business_state": {"preserved": True},
            },
        },
        run_id="transition-large",
        metadata={"langgraph_node": "tools"},
    )

    event = _json(events[0])
    response_metadata = event["response_metadata"]
    assert event["type"] == "agent_on_transitional_edge"
    assert response_metadata["next_step"] == "agent"
    assert response_metadata["state"] == {
        "business_state": {"preserved": True},
    }
    assert response_metadata["state_projection"] == {
        "omitted_duplicate_fields": ["messages", "chat_history"],
    }
    assert large_tool_transcript not in str(event)
    assert len(encode_current_node_event_json(events[0])) <= 60 * 1024


def test_agent_event_frame_uses_durable_execution_fence_and_sequence() -> None:
    callback, events = _callback()
    callback.emit_agent_start(invoked_skills=[{"name": "review"}])
    fence = common_pb2.ExecutionFenceV1(
        workload_session_id="worker-session",
        producer_id="worker-1",
        claim_attempt=2,
        lease_epoch=3,
        fence_token=b"f" * 32,
    )
    command = command_pb2.WorkerCommandV1(
        command_id="command-1",
        execution_id="execution-1",
        generation=4,
        tenant_id="tenant-1",
        resource_project_id="7",
        projection_project_id="7",
        agent_execution=agent_pb2.AgentExecutionCommandV1(
            request_entry_id="agent-request",
            client_stream_id="conversation-1",
            client_message_id="message-1",
            sio_event="chat_predict",
        ),
    )
    verified = VerifiedWorkerCommand(
        envelope=envelope_pb2.WorkerExecutionEnvelopeV1(fence=fence),
        command=command,
    )

    frame = build_node_event_output_frame(
        verified,
        events[0],
        sequence=8,
        occurred_at_unix_millis=1_700_000_000_000,
        claim_handoff_watermark=7,
    )

    payload = events[0].SerializeToString(deterministic=True)
    assert frame.stream_id == "execution-1:4"
    assert frame.logical_output_id == "node-event:execution-1:8"
    assert frame.event_id == "command-1:8"
    assert frame.fence == fence
    assert frame.claim_handoff_watermark == 7
    assert bytes(frame.payload_digest.value) == hashlib.sha256(payload).digest()
    assert frame.WhichOneof("payload") == "node_event"
    assert not frame.terminal

    receipt = control_pb2.ClaimReceiptV1(
        identity=common_pb2.ExecutionIdentityV1(
            tenant_id=command.tenant_id,
            resource_project_id=command.resource_project_id,
            projection_project_id=command.projection_project_id,
            command_id=command.command_id,
            execution_id=command.execution_id,
            generation=command.generation,
        )
    )
    assert _validate_pending_output(
        frame,
        command=command,
        receipt=receipt,
    ) is False
