from __future__ import annotations

import hashlib
import hmac
import json
from types import SimpleNamespace
from typing import Any

import pytest

from elitea.runtime.v1 import (
    agent_pb2,
    command_pb2,
    common_pb2,
    envelope_pb2,
    input_pb2,
)

from elitea_worker.agents.sdk_adapter import EliteaSdkAgentAdapter
from elitea_worker.constants import (
    AGENT_EXECUTE_ADHOC_CAPABILITY_ID,
    AGENT_EXECUTE_APPLICATION_CAPABILITY_ID,
    CONFORMANCE_HMAC_KEY,
    CONFORMANCE_HMAC_KEY_ID,
    ENVELOPE_SCHEMA_REVISION,
    LIMITS_REVISION,
    PROTOCOL_REVISION,
)
from elitea_worker.execution.errors import InvalidInput, UnsupportedCapability
from elitea_worker.handlers.agent import (
    AgentExecutionHandler,
    AgentExecutionKind,
)
from elitea_worker.protocol.agent import (
    AGENT_INPUT_SCHEMA_REVISION,
    bind_result_artifact,
    parse_agent_execution_input,
    request_from,
)
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    parse_and_verify_signed_command,
)


def _json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _input(*, application: bool = True) -> agent_pb2.AgentExecutionInputV1:
    app = (
        {
            "id": 11,
            "name": "reviewer",
            "version_id": 22,
            "variables": None,
            "version_details": {"meta": {"step_limit": 17}},
        }
        if application
        else {"instructions": "Be concise"}
    )
    return agent_pb2.AgentExecutionInputV1(
        schema_revision=AGENT_INPUT_SCHEMA_REVISION,
        llm=_json(
            {
                "kwargs": {
                    "model": "gpt-test",
                    "max_tokens": 512,
                    "stream": True,
                    "api_key": "must-not-be-forwarded",
                    "base_url": "https://untrusted.example",
                }
            }
        ),
        chat_history=_json([{"role": "user", "content": "earlier"}]),
        user_input=_json("current"),
        thread_id="thread-1",
        tools=_json([]),
        application=_json(app),
        internal_tools=_json([]),
        mcp_tokens=_json({}),
        ignored_mcp_servers=_json([]),
        user_declined_mcp_servers=_json([]),
        hitl_decisions=_json([]),
        meta=_json({}),
        persona="generic",
        context_settings=_json({}),
        supports_vision=True,
        invoked_skills=_json([]),
        applied_skills=_json([]),
        attached_skills=_json([]),
        input_attachments=_json([]),
        parallel_reconcile=_json(None),
        parallel_terminal_errors=_json([]),
    )


def _request(*, application: bool = True):
    message = _input(application=application)
    return request_from(
        message,
        kind=(
            AgentExecutionKind.APPLICATION
            if application
            else AgentExecutionKind.ADHOC
        ),
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        request_entry_id="agent-request",
        request_immutable_version="v1",
        request_content_digest=b"r" * 32,
    )


def _signed_agent_command(*, application: bool) -> bytes:
    capability_id = (
        AGENT_EXECUTE_APPLICATION_CAPABILITY_ID
        if application
        else AGENT_EXECUTE_ADHOC_CAPABILITY_ID
    )
    command_type = (
        command_pb2.WORKER_COMMAND_TYPE_V1_AGENT_EXECUTE_APPLICATION
        if application
        else command_pb2.WORKER_COMMAND_TYPE_V1_AGENT_EXECUTE_ADHOC
    )
    command = command_pb2.WorkerCommandV1(
        protocol_revision=PROTOCOL_REVISION,
        command_id="command-1",
        idempotency_key="outbox-1",
        command_type=command_type,
        execution_id="execution-1",
        generation=1,
        dispatch_ordinal=1,
        root_execution_id="execution-1",
        tenant_id="tenant-1",
        resource_project_id="7",
        projection_project_id="7",
        principal_ref="user:11",
        input_bundle_ref=input_pb2.ExecutionInputBundleReferenceV1(
            input_bundle_id="bundle-1",
            immutable_version="v1",
            digest=common_pb2.DigestV1(
                algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
                value=b"b" * 32,
            ),
            byte_length=123,
            media_type="application/x-protobuf",
        ),
        capability_id=capability_id,
        capability_version="1",
        resource_class="agent",
        isolation_class="shared-claim-scoped-authority",
        priority=1,
        deadline_unix_millis=1_700_000_000_000,
        limits_revision=LIMITS_REVISION,
        agent_execution=agent_pb2.AgentExecutionCommandV1(
            request_entry_id="agent-request",
            client_stream_id="conversation-1",
            client_message_id="message-1",
            sio_event="chat_predict",
        ),
    )
    command_bytes = command.SerializeToString(deterministic=True)
    return envelope_pb2.SignedWorkerCommandEnvelopeV1(
        envelope_schema_revision=ENVELOPE_SCHEMA_REVISION,
        signature_profile=(
            envelope_pb2.SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256
        ),
        key_id=CONFORMANCE_HMAC_KEY_ID,
        signature=hmac.new(
            CONFORMANCE_HMAC_KEY,
            command_bytes,
            hashlib.sha256,
        ).digest(),
        worker_command_digest=common_pb2.DigestV1(
            algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
            value=hashlib.sha256(command_bytes).digest(),
        ),
        worker_command_bytes=command_bytes,
    ).SerializeToString(deterministic=True)


def test_agent_input_is_canonical_and_strictly_typed() -> None:
    message = _input()
    raw = message.SerializeToString(deterministic=True)

    parsed = parse_agent_execution_input(raw)
    request = request_from(
        parsed,
        kind=AgentExecutionKind.APPLICATION,
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        request_entry_id="agent-request",
        request_immutable_version="v1",
        request_content_digest=b"r" * 32,
    )

    assert request.payload.application["id"] == 11
    assert request.payload.user_input == "current"
    assert request.payload.supports_vision is True

    with pytest.raises(InvalidInput, match="canonical"):
        parse_agent_execution_input(raw + b"\xa0\x06\x01")


def test_agent_input_rejects_wrong_semantic_shapes() -> None:
    message = _input(application=False)
    message.llm = _json({"kwargs": {}})

    with pytest.raises(InvalidInput, match="model"):
        request_from(
            message,
            kind=AgentExecutionKind.ADHOC,
            input_bundle_id="bundle-1",
            input_bundle_digest=b"b" * 32,
            request_entry_id="agent-request",
            request_immutable_version="v1",
            request_content_digest=b"r" * 32,
        )


@pytest.mark.parametrize("application", [True, False])
def test_signed_agent_command_accepts_exact_current_entrypoint(application: bool) -> None:
    _, command = parse_and_verify_signed_command(
        _signed_agent_command(application=application),
        authenticator=TestOnlyConformanceHmacAuthenticator(),
    )

    assert command.agent_execution.request_entry_id == "agent-request"
    assert command.agent_execution.client_stream_id == "conversation-1"
    assert command.root_execution_id == command.execution_id
    assert command.WhichOneof("capability_command") == "agent_execution"


def test_signed_agent_command_rejects_capability_and_entrypoint_mismatch() -> None:
    signed = envelope_pb2.SignedWorkerCommandEnvelopeV1.FromString(
        _signed_agent_command(application=True)
    )
    command = command_pb2.WorkerCommandV1.FromString(signed.worker_command_bytes)
    command.command_type = command_pb2.WORKER_COMMAND_TYPE_V1_AGENT_EXECUTE_ADHOC
    command_bytes = command.SerializeToString(deterministic=True)
    signed.worker_command_bytes = command_bytes
    signed.worker_command_digest.value = hashlib.sha256(command_bytes).digest()
    signed.signature = hmac.new(
        CONFORMANCE_HMAC_KEY,
        command_bytes,
        hashlib.sha256,
    ).digest()

    with pytest.raises(UnsupportedCapability):
        parse_and_verify_signed_command(
            signed.SerializeToString(deterministic=True),
            authenticator=TestOnlyConformanceHmacAuthenticator(),
        )


class _Port:
    def __init__(self) -> None:
        self.application_calls = 0
        self.adhoc_calls = 0

    def execute_application(self, payload):
        self.application_calls += 1
        return {"result": payload.user_input}

    def execute_adhoc(self, payload):
        self.adhoc_calls += 1
        return {"paused": True, "pause_type": "mcp_auth"}


def test_handler_delegates_once_to_each_current_entrypoint() -> None:
    port = _Port()
    handler = AgentExecutionHandler(port)

    application = handler.execute(_request())
    adhoc = handler.execute(_request(application=False))

    assert application.sdk_result == {"result": "current"}
    assert adhoc.sdk_result["pause_type"] == "mcp_auth"
    assert (port.application_calls, port.adhoc_calls) == (1, 1)

    artifact = bind_result_artifact(
        adhoc,
        artifact_id="artifact-1",
        immutable_version="v1",
        byte_length=123,
        digest=hashlib.sha256(b"result").digest(),
    )
    assert (
        artifact.terminal_state
        == agent_pb2.AGENT_EXECUTION_TERMINAL_STATE_V1_PAUSED_MCP_AUTH
    )
    assert artifact.request_entry_id == "agent-request"


class _Executor:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.calls: list[tuple[dict[str, Any], dict[str, Any]]] = []

    def invoke(self, value, config):
        self.calls.append((value, config))
        return self.result


class _Client:
    def __init__(self) -> None:
        self.application_executor = _Executor({"mode": "application"})
        self.adhoc_executor = _Executor({"mode": "adhoc"})
        self.application_calls: list[dict[str, Any]] = []
        self.llm_calls: list[tuple[str, dict[str, Any]]] = []
        self.adhoc_calls: list[dict[str, Any]] = []

    def application(self, **kwargs):
        self.application_calls.append(kwargs)
        return self.application_executor

    def get_llm(self, *, model_name, model_config):
        self.llm_calls.append((model_name, model_config))
        return SimpleNamespace(model=model_name)

    def predict_agent(self, **kwargs):
        self.adhoc_calls.append(kwargs)
        return self.adhoc_executor


def _adapter(client: _Client) -> EliteaSdkAgentAdapter:
    adapter = object.__new__(EliteaSdkAgentAdapter)
    adapter._client = client  # type: ignore[attr-defined]
    adapter._memory = "checkpoint-store"  # type: ignore[attr-defined]
    adapter._callbacks = ["current-callback"]  # type: ignore[attr-defined]
    return adapter


def test_sdk_adapter_preserves_constructor_split_without_forwarding_authority() -> None:
    client = _Client()
    adapter = _adapter(client)

    assert adapter.execute_application(_request().payload) == {"mode": "application"}
    assert adapter.execute_adhoc(_request(application=False).payload) == {
        "mode": "adhoc"
    }

    assert client.application_calls[0]["application_id"] == 11
    assert client.application_calls[0]["application_version_id"] == 22
    assert client.application_calls[0]["memory"] == "checkpoint-store"
    assert client.application_calls[0]["tools"] is None
    assert client.application_executor.calls[0][1]["recursion_limit"] == 17
    assert client.application_executor.calls[0][1]["configurable"] == {
        "thread_id": "thread-1"
    }
    assert client.application_executor.calls[0][1]["callbacks"] == [
        "current-callback"
    ]
    assert client.llm_calls[0][0] == "gpt-test"
    assert "api_key" not in client.llm_calls[0][1]
    assert "base_url" not in client.llm_calls[0][1]
    assert client.adhoc_calls[0]["instructions"] == "Be concise"
    assert client.adhoc_calls[0]["memory"] == "checkpoint-store"
    assert client.adhoc_calls[0]["chat_history"] == [
        {"role": "user", "content": "earlier"}
    ]
    assert len(client.application_executor.calls[0][0]["messages"]) == 2


def test_sdk_adapter_rejects_an_unrecoverable_random_thread() -> None:
    request = _request()
    object.__setattr__(request.payload, "thread_id", None)
    object.__setattr__(request.payload, "conversation_id", None)

    with pytest.raises(UnsupportedCapability, match="durable agent thread"):
        _adapter(_Client()).execute_application(request.payload)


def test_sdk_adapter_submits_projected_history_on_one_checkpoint_thread() -> None:
    client = _Client()
    adapter = _adapter(client)
    first = _request().payload
    second = _request().payload
    object.__setattr__(first, "chat_history", [])
    object.__setattr__(
        second,
        "chat_history",
        [
            {"role": "user", "content": "first turn"},
            {"role": "assistant", "content": "first response"},
        ],
    )
    object.__setattr__(first, "thread_id", "conversation-1")
    object.__setattr__(second, "thread_id", "conversation-1")
    object.__setattr__(first, "conversation_id", "conversation-1")
    object.__setattr__(second, "conversation_id", "conversation-1")
    object.__setattr__(first, "user_input", "first turn")
    object.__setattr__(second, "user_input", "second turn")

    adapter.execute_application(first)
    adapter.execute_application(second)

    assert len(client.application_executor.calls) == 2
    first_input, first_config = client.application_executor.calls[0]
    second_input, second_config = client.application_executor.calls[1]
    assert first_config["configurable"]["thread_id"] == "conversation-1"
    assert second_config["configurable"]["thread_id"] == "conversation-1"
    assert [message.content for message in first_input["messages"]] == ["first turn"]
    assert [
        message.get("content") if isinstance(message, dict) else message.content
        for message in second_input["messages"]
    ] == ["first turn", "first response", "second turn"]


class _CheckpointMemory:
    def __init__(self, pending_writes) -> None:
        self.pending_writes = pending_writes
        self.deleted_threads: list[str] = []

    def get_tuple(self, _config):
        return SimpleNamespace(pending_writes=self.pending_writes)

    def delete_thread(self, thread_id: str) -> None:
        self.deleted_threads.append(thread_id)


def test_sdk_adapter_repairs_only_an_explicit_failed_checkpoint() -> None:
    client = _Client()
    adapter = _adapter(client)
    memory = _CheckpointMemory(
        [("failed-task", "__error__", RuntimeError("redacted"))]
    )
    adapter._memory = memory  # type: ignore[attr-defined]

    adapter.execute_adhoc(_request(application=False).payload)

    assert memory.deleted_threads == ["thread-1"]
    assert len(client.adhoc_executor.calls) == 1


@pytest.mark.parametrize(
    "pending_writes",
    [
        [],
        [("paused-task", "__interrupt__", {"type": "hitl"})],
        [("paused-task", "messages", [])],
    ],
)
def test_sdk_adapter_preserves_clean_pause_checkpoints(pending_writes) -> None:
    client = _Client()
    adapter = _adapter(client)
    memory = _CheckpointMemory(pending_writes)
    adapter._memory = memory  # type: ignore[attr-defined]

    adapter.execute_adhoc(_request(application=False).payload)

    assert memory.deleted_threads == []
    assert len(client.adhoc_executor.calls) == 1


def test_sdk_adapter_rejects_unimplemented_resume_instead_of_drifting() -> None:
    request = _request()
    object.__setattr__(request.payload, "should_continue", True)

    with pytest.raises(UnsupportedCapability, match="parity path"):
        _adapter(_Client()).execute_application(request.payload)
