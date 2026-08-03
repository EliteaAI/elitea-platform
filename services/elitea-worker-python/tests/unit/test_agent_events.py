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


def test_custom_hitl_event_keeps_current_shape_and_correlation() -> None:
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

    event = _json(events[0])
    assert event["type"] == "agent_hitl_interrupt"
    assert event["stream_id"] == "conversation-1"
    assert event["sio_event"] == "chat_predict"
    assert event["response_metadata"]["available_actions"] == [
        "approve",
        "reject",
    ]
    assert event["response_metadata"]["metadata"]["checkpoint_ns"] == "agent:child"


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
