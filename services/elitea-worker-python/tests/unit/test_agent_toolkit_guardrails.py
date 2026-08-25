"""The per-run toolkit guardrails: decode, and application to the SDK.

The point of the field is that the admin Configuration page's policy takes
effect on the next call rather than on the next deployment. Before it, the SDK's
guardrail globals were populated only from ``ELITEA_SENSITIVE_TOOLS`` and its
siblings, so a policy change needed a redeploy and every tenant on a worker pool
shared one answer.

The distinction these tests exist to protect is ABSENT vs EMPTY: an absent field
must leave the environment configuration alone, and an empty object must be
applied as a real (empty) policy.
"""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest

from elitea.runtime.v1 import agent_pb2

from elitea_worker.agents import sdk_adapter
from elitea_worker.execution.errors import InvalidInput
from elitea_worker.handlers.agent import AgentExecutionKind
from elitea_worker.protocol.agent import AGENT_INPUT_SCHEMA_REVISION, request_from


def _json(value: Any) -> bytes:
    return json.dumps(value).encode()


def _input(**overrides: Any) -> agent_pb2.AgentExecutionInputV1:
    fields: dict[str, Any] = {
        "schema_revision": AGENT_INPUT_SCHEMA_REVISION,
        "llm": _json({"kwargs": {"model": "gpt-test", "stream": True}}),
        "chat_history": _json([]),
        "user_input": _json("hello"),
        "thread_id": "thread-1",
        "tools": _json([]),
        "application": _json({"id": 1, "version_id": 2, "version_details": {}}),
        "internal_tools": _json([]),
        "mcp_tokens": _json({}),
        "ignored_mcp_servers": _json([]),
        "user_declined_mcp_servers": _json([]),
        "hitl_decisions": _json([]),
        "meta": _json({}),
        "persona": "generic",
        "context_settings": _json({}),
        "invoked_skills": _json([]),
        "applied_skills": _json([]),
        "attached_skills": _json([]),
        "input_attachments": _json([]),
        "parallel_reconcile": _json(None),
        "parallel_terminal_errors": _json([]),
    }
    fields.update(overrides)
    return agent_pb2.AgentExecutionInputV1(**fields)


def _payload(**overrides: Any):
    return request_from(
        _input(**overrides),
        kind=AgentExecutionKind.APPLICATION,
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        request_entry_id="agent-request",
        request_immutable_version="v1",
        request_content_digest=b"r" * 32,
    ).payload


POLICY = {
    "blocked_toolkits": ["shell"],
    "blocked_tools": {"github": ["create_issue"]},
    "sensitive_tools": {"*": ["delete_file"]},
    "sensitive_action_company_name": "Acme",
    "sensitive_action_message_template": "{company_name} requires approval.",
}


class TestDecode:
    def test_an_absent_field_decodes_to_none_not_an_empty_policy(self) -> None:
        # None is what leaves the worker on its environment configuration. An
        # empty dict here would look like "the platform says nothing is
        # blocked", which is a different instruction.
        assert _payload().toolkit_guardrails is None

    def test_an_explicit_null_is_also_absent(self) -> None:
        assert _payload(toolkit_guardrails=_json(None)).toolkit_guardrails is None

    def test_an_empty_object_is_a_real_policy(self) -> None:
        assert _payload(toolkit_guardrails=_json({})).toolkit_guardrails == {}

    def test_a_full_policy_survives(self) -> None:
        assert _payload(toolkit_guardrails=_json(POLICY)).toolkit_guardrails == POLICY

    @pytest.mark.parametrize(
        "value",
        [
            ["shell"],
            "shell",
            {"unexpected": True},
            {"blocked_toolkits": "shell"},
            {"blocked_toolkits": [1]},
            {"blocked_tools": ["github"]},
            {"blocked_tools": {"github": "create_issue"}},
            {"blocked_tools": {"github": [1]}},
            {"sensitive_tools": {"github": None}},
            {"sensitive_action_company_name": 7},
        ],
    )
    def test_a_malformed_policy_is_refused(self, value: Any) -> None:
        # Refused, not coerced. A policy the worker cannot read is a disagreement
        # about the contract, and guessing at it would apply a guardrail the
        # platform did not send.
        with pytest.raises(InvalidInput):
            _payload(toolkit_guardrails=_json(value))


class _SecurityStub:
    def __init__(self) -> None:
        self.blocklist: list[dict[str, Any]] = []
        self.sensitive: list[dict[str, Any]] = []

    def configure_blocklist(self, **kwargs: Any) -> None:
        self.blocklist.append(kwargs)

    def configure_sensitive_tools(self, **kwargs: Any) -> None:
        self.sensitive.append(kwargs)


@pytest.fixture
def security(monkeypatch: pytest.MonkeyPatch) -> _SecurityStub:
    stub = _SecurityStub()
    real = sdk_adapter.importlib.import_module

    def fake(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "elitea_sdk.runtime.toolkits.security":
            return stub
        return real(name, *args, **kwargs)

    monkeypatch.setattr(sdk_adapter.importlib, "import_module", fake)
    return stub


class TestApply:
    def test_an_absent_policy_touches_nothing(self, security: _SecurityStub) -> None:
        # Both SDK functions set an `_initialized` flag as a side effect, so
        # calling them with empty arguments would permanently suppress the
        # environment fallback for the life of the process. A command carrying no
        # policy must therefore not call them at all.
        sdk_adapter._apply_toolkit_guardrails(_payload())
        assert security.blocklist == []
        assert security.sensitive == []

    def test_a_policy_is_handed_to_the_sdk_under_its_own_keyword_names(
        self, security: _SecurityStub
    ) -> None:
        sdk_adapter._apply_toolkit_guardrails(_payload(toolkit_guardrails=_json(POLICY)))
        assert security.blocklist == [
            {
                "blocked_toolkits": ["shell"],
                "blocked_tools": {"github": ["create_issue"]},
            }
        ]
        assert security.sensitive == [
            {
                "sensitive_tools": {"*": ["delete_file"]},
                "company_name": "Acme",
                "message_template": "{company_name} requires approval.",
            }
        ]

    def test_an_empty_policy_clears_rather_than_defers(
        self, security: _SecurityStub
    ) -> None:
        # The platform resolved a policy and it is empty. That is an instruction,
        # and it must reach the SDK — otherwise removing the last blocked toolkit
        # through the admin page would leave the previous run's globals in place
        # on a warm worker.
        sdk_adapter._apply_toolkit_guardrails(_payload(toolkit_guardrails=_json({})))
        assert security.blocklist == [{"blocked_toolkits": [], "blocked_tools": {}}]
        assert security.sensitive == [
            {"sensitive_tools": {}, "company_name": None, "message_template": None}
        ]

    def test_blank_copy_defers_to_the_sdk_default(self, security: _SecurityStub) -> None:
        # The SDK substitutes its own wording for a falsy value. Passing "" through
        # would interpolate an empty company name into the dialog.
        sdk_adapter._apply_toolkit_guardrails(
            _payload(
                toolkit_guardrails=_json(
                    {"sensitive_action_company_name": "", "sensitive_tools": {}}
                )
            )
        )
        assert security.sensitive[0]["company_name"] is None

    def test_a_broken_sdk_surface_fails_the_command(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # Continuing would run the agent under whatever the globals last held —
        # on a shared worker, the previous run's policy.
        def fake(name: str, *args: Any, **kwargs: Any) -> Any:
            if name == "elitea_sdk.runtime.toolkits.security":
                return SimpleNamespace()
            raise AssertionError(name)

        monkeypatch.setattr(sdk_adapter.importlib, "import_module", fake)
        with pytest.raises(AttributeError):
            sdk_adapter._apply_toolkit_guardrails(
                _payload(toolkit_guardrails=_json(POLICY))
            )
