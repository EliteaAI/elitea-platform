"""#606: an attached file has to reach the model.

Before this, ``_require_initial_agent_kernel`` refused any turn carrying
``input_attachments``, so the field existed on the wire and had no consumer.
These tests bind the three things that changed: the gate admits attachments
(and nothing else it used to refuse), the chunks are spliced into the human
message the way pylon's history projection does
(legacy/plugins/elitea_core/utils/chat_history.py:67-73), and document text is
read through the SDK artifact toolkit the way pylon's extraction step does
(legacy/plugins/elitea_core/rpc/chat_all.py:344-377).
"""

from __future__ import annotations

import json
import logging
from typing import Any

import pytest

from elitea.runtime.v1 import agent_pb2

from elitea_sdk.runtime.exceptions import BudgetExceededError

from elitea_worker.agents.sdk_adapter import EliteaSdkAgentAdapter, SdkBudgetExceeded
from elitea_worker.execution.errors import InvalidInput, UnsupportedCapability
from elitea_worker.handlers.agent import AgentExecutionKind
from elitea_worker.protocol.agent import AGENT_INPUT_SCHEMA_REVISION, request_from


_BUCKET = "chat-attachments"
_NAME = "8f1c/report.pdf"
_HEADER_TEXT = (
    f"Bucket: {_BUCKET}\n"
    f"Filename: {_NAME}\n"
    f"filepath: /{_BUCKET}/{_NAME}\n"
    "\n"
    "NOTE: File content may be EMBEDDED in the next message chunk."
)


def _json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def _document_chunk(
    *,
    bucket: str = _BUCKET,
    name: str = _NAME,
    needs_extraction: bool = True,
) -> dict[str, Any]:
    """The exact scaffold the Go admission path writes.

    services/elitea-main/internal/application/agentexecution/attachments.go,
    ``attachmentContentScaffold`` — a text chunk plus the namespaced
    ``elitea_attachment`` marker naming the object to read.
    """

    return {
        "type": "text",
        "text": _HEADER_TEXT,
        "elitea_attachment": {
            "needs_content_extraction": needs_extraction,
            "bucket": bucket,
            "name": name,
            "filepath": f"/{bucket}/{name}",
        },
    }


def _payload(
    *,
    attachments: list[Any] | None = None,
    user_input: Any = "summarise it",
    application: bool = True,
):
    message = agent_pb2.AgentExecutionInputV1(
        schema_revision=AGENT_INPUT_SCHEMA_REVISION,
        llm=_json({"kwargs": {"model": "gpt-test", "max_tokens": 512}}),
        chat_history=_json([]),
        user_input=_json(user_input),
        thread_id="thread-1",
        tools=_json([]),
        application=_json(
            {"id": 11, "version_id": 22, "version_details": {"meta": {}}}
            if application
            else {"instructions": "Be concise"}
        ),
        internal_tools=_json([]),
        mcp_tokens=_json({}),
        ignored_mcp_servers=_json([]),
        user_declined_mcp_servers=_json([]),
        hitl_decisions=_json([]),
        meta=_json({}),
        persona="generic",
        context_settings=_json({}),
        invoked_skills=_json([]),
        applied_skills=_json([]),
        attached_skills=_json([]),
        input_attachments=_json(attachments if attachments is not None else []),
        parallel_reconcile=_json(None),
        parallel_terminal_errors=_json([]),
    )
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
    ).payload


class _Executor:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, Any]] = []

    def invoke(self, value, config):
        self.calls.append((value, config))
        return {"mode": "application"}


class _Client:
    """An SDK client whose only interesting operation is the artifact read."""

    def __init__(self, outcome: Any = None) -> None:
        self.executor = _Executor()
        self.outcome = outcome
        self.tool_calls: list[dict[str, Any]] = []

    def application(self, **kwargs):
        return self.executor

    def get_llm(self, *, model_name, model_config):
        return object()

    def predict_agent(self, **kwargs):
        return self.executor

    def test_toolkit_tool(self, **kwargs):
        self.tool_calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


def _adapter(client: _Client) -> EliteaSdkAgentAdapter:
    adapter = object.__new__(EliteaSdkAgentAdapter)
    adapter._client = client  # type: ignore[attr-defined]
    adapter._memory = "checkpoint-store"  # type: ignore[attr-defined]
    adapter._callbacks = []  # type: ignore[attr-defined]
    return adapter


def _read_result(contents: dict[str, str]) -> dict[str, Any]:
    """The shape ``EliteAClient.test_toolkit_tool`` returns on success."""

    return {"success": True, "result": contents, "tool_name": "read_multiple_files"}


def _human_content(client: _Client) -> Any:
    messages = client.executor.calls[0][0]["messages"]
    return messages[-1].content


# ── The admission gate ────────────────────────────────────────────────────────


def test_the_gate_admits_attachments_and_still_refuses_the_undone_paths() -> None:
    """Exactly one disjunct left the refusal; the other three did not.

    The refusal was honest while nothing consumed the field. It stops being
    honest the moment the chunks are spliced into the message — but a
    checkpoint id or a parallel reconcile still names a path with no
    implementation behind it, and dropping those with it would turn a refusal
    into a wrong answer.
    """

    client = _Client(_read_result({_NAME: "extracted"}))
    admitted = _payload(attachments=[_document_chunk()])
    assert _adapter(client).execute_application(admitted) == {"mode": "application"}

    for field, value in (
        ("checkpoint_id", "checkpoint-9"),
        ("parallel_reconcile", {"children": []}),
        ("parallel_terminal_errors", [{"child": 1}]),
    ):
        payload = _payload(attachments=[_document_chunk()])
        object.__setattr__(payload, field, value)
        with pytest.raises(UnsupportedCapability):
            _adapter(_Client(_read_result({}))).execute_application(payload)


def test_a_turn_without_attachments_keeps_sending_its_bare_user_input() -> None:
    """The ordinary path must not become a content list."""

    client = _Client(None)
    assert _adapter(client).execute_application(_payload()) == {"mode": "application"}

    assert _human_content(client) == "summarise it"
    assert client.tool_calls == []


# ── Splicing into the human message ──────────────────────────────────────────


def test_text_input_and_attachments_become_one_ordered_content_list() -> None:
    """The user's question first, then the file — pylon's order.

    utils/chat_history.py:67-73 EXTENDS an attachment item's chunks into the
    message content list, after the text chunks that precede it.
    """

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    payload = _payload(attachments=[_document_chunk()])

    assert _adapter(client).execute_application(payload) == {"mode": "application"}

    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "PAGE ONE"},
    ]


def test_the_extraction_marker_is_stripped_before_the_model_sees_the_chunk() -> None:
    """`elitea_attachment` is worker-side routing metadata, not model input."""

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    payload = _payload(attachments=[_document_chunk()])

    _adapter(client).execute_application(payload)

    for chunk in _human_content(client):
        assert "elitea_attachment" not in chunk


def test_a_multimodal_user_input_list_keeps_its_own_chunks() -> None:
    """`user_input` is already allowed to be a content list (handlers/agent.py:33)."""

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    user_input = [
        {"type": "text", "text": "compare these"},
        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}},
    ]
    payload = _payload(attachments=[_document_chunk()], user_input=user_input)

    _adapter(client).execute_application(payload)

    assert _human_content(client) == [
        *user_input,
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "PAGE ONE"},
    ]


def test_an_empty_question_sends_the_attachment_without_an_empty_text_chunk() -> None:
    """Attaching a file with no question is a real turn, not an empty message."""

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    payload = _payload(attachments=[_document_chunk()], user_input="   ")

    _adapter(client).execute_application(payload)

    assert _human_content(client) == [
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "PAGE ONE"},
    ]


def test_splicing_does_not_mutate_the_immutable_payload() -> None:
    """The payload projects an immutable input binding; a retry re-reads it."""

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    attachments = [_document_chunk()]
    payload = _payload(attachments=attachments)

    _adapter(client).execute_application(payload)

    assert payload.input_attachments == attachments
    assert payload.user_input == "summarise it"


def test_the_adhoc_constructor_splices_attachments_too() -> None:
    """Both current entry points build the same human message."""

    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    payload = _payload(attachments=[_document_chunk()], application=False)

    assert _adapter(client).execute_adhoc(payload) == {"mode": "application"}

    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "PAGE ONE"},
    ]


# ── Parse-time validation ────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "attachments",
    [
        pytest.param(["/chat-attachments/report.pdf"], id="not-a-chunk"),
        pytest.param([{"text": "no type"}], id="missing-type"),
        pytest.param([{"type": 7, "text": "numeric type"}], id="non-string-type"),
        pytest.param([{"type": "audio", "audio": {}}], id="unadmitted-type"),
        pytest.param([{"type": "text", "text": {"nested": True}}], id="non-string-text"),
        pytest.param([{"type": "image_url", "image_url": "not-an-object"}], id="bad-image"),
        pytest.param(
            [{"type": "text", "text": "x", "elitea_attachment": "marker"}],
            id="non-object-marker",
        ),
        pytest.param(
            [
                {
                    "type": "text",
                    "text": "x",
                    "elitea_attachment": {"needs_content_extraction": "yes"},
                }
            ],
            id="non-boolean-flag",
        ),
        pytest.param(
            [
                {
                    "type": "text",
                    "text": "x",
                    "elitea_attachment": {"needs_content_extraction": True},
                }
            ],
            id="extraction-without-reference",
        ),
        pytest.param(
            [
                {
                    "type": "text",
                    "text": "x",
                    "elitea_attachment": {
                        "needs_content_extraction": True,
                        "bucket": _BUCKET,
                        "name": "x" * 257,
                    },
                }
            ],
            id="oversized-reference",
        ),
        pytest.param(
            [
                {
                    "type": "text",
                    "text": "x",
                    "elitea_attachment": {
                        "needs_content_extraction": True,
                        "bucket": _BUCKET,
                        "name": _NAME,
                        "surprise": 1,
                    },
                }
            ],
            id="unsupported-marker-field",
        ),
        pytest.param([_document_chunk()] * 129, id="above-the-admission-cap"),
    ],
)
def test_malformed_attachments_are_refused_at_parse_time(attachments) -> None:
    """A shape disagreement must not survive to the provider call.

    Passed through, each of these fails inside the model invocation — after the
    turn was admitted and (for a streaming turn) already billed — and arrives
    as an opaque provider error. Here it is a typed INVALID_INPUT on a turn
    that never started.
    """

    with pytest.raises(InvalidInput):
        _payload(attachments=attachments)


def test_an_image_chunk_without_a_marker_is_admitted_unchanged() -> None:
    """Images carry their bytes inline and never ask for extraction."""

    image = {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA"}}
    client = _Client(None)
    payload = _payload(attachments=[image])

    _adapter(client).execute_application(payload)

    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        image,
    ]
    assert client.tool_calls == []


# ── Extraction through the SDK artifact toolkit ──────────────────────────────


def test_extraction_calls_the_artifact_toolkit_once_per_bucket() -> None:
    """One batched read, pylon's toolkit config (utils/attachments.py:454-472)."""

    client = _Client(_read_result({_NAME: "PAGE ONE", "8f1c/notes.txt": "NOTES"}))
    payload = _payload(
        attachments=[
            _document_chunk(),
            _document_chunk(name="8f1c/notes.txt"),
        ]
    )

    _adapter(client).execute_application(payload)

    assert len(client.tool_calls) == 1
    call = client.tool_calls[0]
    assert call["toolkit_config"] == {
        "type": "artifact",
        "toolkit_name": "Attachments",
        "toolkit_id": None,
        "settings": {"bucket": _BUCKET},
    }
    assert call["tool_name"] == "read_multiple_files"
    assert call["tool_params"] == {"file_paths": [_NAME, "8f1c/notes.txt"]}
    assert call["llm_model"] == "gpt-test"
    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "PAGE ONE"},
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "NOTES"},
    ]


def test_a_chunk_that_already_carries_its_text_is_not_read_again() -> None:
    """Pylon's post-extraction storage shape: header, then its text chunk."""

    client = _Client(_read_result({_NAME: "RE-READ"}))
    payload = _payload(
        attachments=[
            _document_chunk(),
            {"type": "text", "text": "ALREADY EXTRACTED"},
        ]
    )

    _adapter(client).execute_application(payload)

    assert client.tool_calls == []
    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
        {"type": "text", "text": "ALREADY EXTRACTED"},
    ]


def test_a_marker_that_does_not_ask_for_extraction_is_inert() -> None:
    client = _Client(_read_result({_NAME: "PAGE ONE"}))
    payload = _payload(attachments=[_document_chunk(needs_extraction=False)])

    _adapter(client).execute_application(payload)

    assert client.tool_calls == []
    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
    ]


@pytest.mark.parametrize(
    "outcome",
    [
        pytest.param(RuntimeError("bucket is gone"), id="raised"),
        pytest.param({"success": False, "error": "toolkit failed"}, id="returned-failure"),
        pytest.param(
            # `success: False` is RETURNED, not raised, for a toolkit or tool
            # failure (SDK client.test_toolkit_tool), and a refused call's
            # payload is not file content: forwarding it would put the SDK's
            # own diagnostics in front of the model as if the user had
            # attached them.
            {"success": False, "error": "toolkit failed", "result": {_NAME: "Tool execution failed"}},
            id="failure-carrying-a-payload",
        ),
        pytest.param({"success": True, "result": {}}, id="no-content-for-the-file"),
        pytest.param({"success": True, "result": {_NAME: ""}}, id="empty-content"),
    ],
)
def test_a_failed_read_keeps_the_header_and_does_not_fail_the_turn(
    outcome: Any,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """Pylon logs and continues (rpc/chat_all.py:384-386), and so does this.

    The header still reaches the model: it names the file and tells the model
    that file-reading tools are available, which is the difference between a
    degraded answer and one about a file the model was never told existed.
    """

    client = _Client(outcome)
    payload = _payload(attachments=[_document_chunk()])

    with caplog.at_level(logging.WARNING):
        assert _adapter(client).execute_application(payload) == {"mode": "application"}

    assert _human_content(client) == [
        {"type": "text", "text": "summarise it"},
        {"type": "text", "text": _HEADER_TEXT},
    ]
    assert "extraction failed for 1 file(s)" in caplog.text
    assert _BUCKET not in caplog.text and _NAME not in caplog.text


def test_a_budget_rejection_during_extraction_stays_a_policy_outcome() -> None:
    """The one failure that must not be swallowed.

    A budget block has no recovery, so continuing would only reach the same
    wall at the agent invocation a moment later — with the attachment silently
    dropped and the rejection reported as an internal fault.
    """

    client = _Client(BudgetExceededError("blocked", "project_budget_exceeded"))
    payload = _payload(attachments=[_document_chunk()])

    with pytest.raises(SdkBudgetExceeded):
        _adapter(client).execute_application(payload)
