"""Regenerate Rust agent-input fixtures with the committed Python protobuf.

Run from the elitea-platform repository root:

    python services/elitea-worker-rust/tests/fixtures/generate_agent_input_fixtures.py

The script prints patch-ready hexadecimal payloads. It does not write files so
fixture review remains explicit.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any


PLATFORM_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(PLATFORM_ROOT / "libs/proto/gen/python"))

from elitea.runtime.v1 import agent_pb2  # noqa: E402


def encoded_json(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")


def execution_input(*, application: bool) -> agent_pb2.AgentExecutionInputV1:
    definition = (
        {
            "id": 11,
            "name": "reviewer",
            "variables": None,
            "version_details": {"meta": {"step_limit": 17}},
            "version_id": 22,
        }
        if application
        else {"instructions": "Be concise"}
    )
    return agent_pb2.AgentExecutionInputV1(
        schema_revision="elitea.runtime.agent-execution-input.v1",
        llm=encoded_json(
            {
                "kwargs": {
                    "model": "fixture-model",
                    "provider_limit": 999,
                    "stream": True,
                }
            }
        ),
        chat_history=encoded_json([{"content": "earlier", "role": "user"}]),
        user_input=encoded_json(
            [
                {"text": "current", "type": "text"},
                {"ordinal": 2, "type": "fixture"},
            ]
        ),
        thread_id="thread-1",
        checkpoint_id="checkpoint-1",
        debug=True,
        tools=encoded_json([{"settings": None, "type": "github"}]),
        application=encoded_json(definition),
        internal_tools=encoded_json(["lazy_tools_mode"]),
        steps_limit=17,
        mcp_tokens=encoded_json({"server": "non-secret-fixture-reference"}),
        ignored_mcp_servers=encoded_json(["ignored"]),
        user_declined_mcp_servers=encoded_json(["declined"]),
        should_continue=True,
        hitl_resume=True,
        hitl_action="approve",
        hitl_value="",
        hitl_decisions=encoded_json([]),
        execution_generation="generation-2",
        is_regenerate=True,
        meta=encoded_json({"source": "python"}),
        conversation_id="conversation-1",
        persona="reviewer",
        context_settings=encoded_json({"project": "fixture"}),
        supports_vision=True,
        return_chat_history=True,
        invoked_skills=encoded_json(["review"]),
        applied_skills=encoded_json(["review"]),
        auto_approve_sensitive_actions=True,
        attached_skills=encoded_json([{"name": "review"}]),
        input_attachments=encoded_json([{"artifact_id": "artifact-1"}]),
        parallel_reconcile=encoded_json(None),
        parallel_terminal_errors=encoded_json([]),
        exception_handling_enabled=True,
        debug_mode=False,
        next_input_suggestion=encoded_json(
            {
                "enabled": True,
                "min_response_chars": 151,
                "timeout_seconds": 16,
            }
        ),
    )


for name, is_application in (("application", True), ("adhoc", False)):
    raw = execution_input(application=is_application).SerializeToString(
        deterministic=True
    )
    print(f"{name}={raw.hex()}")
