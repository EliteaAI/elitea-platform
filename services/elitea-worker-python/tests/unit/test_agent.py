from __future__ import annotations

import hashlib
import json
from types import SimpleNamespace
from typing import Any

import pytest

from elitea.runtime.v1 import agent_pb2

from elitea_worker.agents.sdk_adapter import EliteaSdkAgentAdapter
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
    assert client.application_executor.calls[0][1]["recursion_limit"] == 17
    assert client.llm_calls[0][0] == "gpt-test"
    assert "api_key" not in client.llm_calls[0][1]
    assert "base_url" not in client.llm_calls[0][1]
    assert client.adhoc_calls[0]["instructions"] == "Be concise"
    assert len(client.application_executor.calls[0][0]["messages"]) == 2


def test_sdk_adapter_rejects_unimplemented_resume_instead_of_drifting() -> None:
    request = _request()
    object.__setattr__(request.payload, "should_continue", True)

    with pytest.raises(UnsupportedCapability, match="parity path"):
        _adapter(_Client()).execute_application(request.payload)
