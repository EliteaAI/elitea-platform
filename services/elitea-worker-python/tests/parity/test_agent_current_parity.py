from __future__ import annotations

import ast
import hashlib
from pathlib import Path

import pytest

from elitea.runtime.v1 import agent_pb2


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_ROOT = _SERVICE_ROOT.parents[1]
_PROJECTS_ROOT = _PLATFORM_ROOT.parent
_CURRENT_WORKER = (
    _PROJECTS_ROOT / "centry/pylon_indexer/plugins/indexer_worker/methods"
)
_APPLICATION = _CURRENT_WORKER / "indexer_agent.py"
_ADHOC = _CURRENT_WORKER / "indexer_predict_agent.py"
_CURRENT_WORKER_UTILS = (
    _PROJECTS_ROOT / "centry/pylon_indexer/plugins/indexer_worker/utils"
)
_MEMORY_HELPERS = _CURRENT_WORKER_UTILS / "agent_execution_common.py"
_MEMORY_CONFIG = _PROJECTS_ROOT / "centry/pylon_indexer/configs/indexer_worker.yml"
_APPLICATION_SHA256 = (
    "bbbdd75bb5228d55516e71677044430ee348396108f11f7bb7428f950ca8ca54"
)
_ADHOC_SHA256 = (
    "76b32ae4c4554c07c0819d54113239e763b78c1888662b0562524d215896d53f"
)
_MEMORY_HELPERS_SHA256 = (
    "4955df5e16ee30a87fcdc87b85da3d43f79594662a3e0774bdf978664d3e4d35"
)
_CURRENT_MAIN = _PROJECTS_ROOT / "centry/pylon_main/plugins/elitea_core"
_TRACE_WRITER = _CURRENT_MAIN / "utils/trace_step_writer.py"
_MESSAGE_STREAM = _CURRENT_MAIN / "utils/message_stream.py"
_TOOL_CALL_DEDUP = _CURRENT_MAIN / "utils/tool_call_dedup.py"
_TRACE_MODEL = _CURRENT_MAIN / "models/message_trace_step.py"
_TRACE_WRITER_SHA256 = (
    "ec82b3550fcb0824a16f1c737b24abf8e461c7f361709f0f0a5bffe90f5cf73b"
)
_MESSAGE_STREAM_SHA256 = (
    "efb37d190b56210018cd22aa28c46756ac022df43fa2c27f2484b7448ec32257"
)
_TOOL_CALL_DEDUP_SHA256 = (
    "ff9fbb389a6ed86886c49dadb6bf57c1111af427e93cf2c9e5b7e30659c81961"
)
_TRACE_MODEL_SHA256 = (
    "1f3ac28a493c937dab1326e5cfd28d93277d6a63f77c699353d4cc2ebe90f19c"
)


@pytest.mark.parametrize(
    ("path", "expected_digest"),
    ((_APPLICATION, _APPLICATION_SHA256), (_ADHOC, _ADHOC_SHA256)),
)
def test_agent_parity_evidence_is_bound_to_the_current_worker_source(
    path: Path,
    expected_digest: str,
) -> None:
    if not path.is_file():
        pytest.skip("current Centry agent-worker evidence checkout is unavailable")

    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_digest


def test_configured_agent_keeps_its_distinct_sdk_constructor_and_invoke() -> None:
    function = _current_function(_APPLICATION, "_indexer_agent_task_inner")

    assert _attribute_call_count(function, "application") == 1
    assert _attribute_call_count(function, "invoke") == 1
    assert _attribute_call_count(function, "get_llm") == 0
    assert _attribute_call_count(function, "predict_agent") == 0
    application_call = _attribute_calls(function, "application")[0]
    assert {keyword.arg for keyword in application_call.keywords} >= {
        "memory",
        "tools",
    }
    assert "ensure_thread_id" in {
        node.func.id
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }


def test_adhoc_agent_keeps_its_distinct_sdk_constructor_and_invoke() -> None:
    function = _current_function(_ADHOC, "_indexer_predict_agent_task_inner")

    assert _attribute_call_count(function, "get_llm") == 1
    assert _attribute_call_count(function, "predict_agent") == 1
    assert _attribute_call_count(function, "invoke") == 1
    assert _attribute_call_count(function, "application") == 0
    predict_call = _attribute_calls(function, "predict_agent")[0]
    assert {keyword.arg for keyword in predict_call.keywords} >= {
        "chat_history",
        "memory",
        "tools",
    }


@pytest.mark.parametrize(
    "path",
    (_APPLICATION, _ADHOC),
)
def test_complex_agent_paths_remain_explicit_production_admission_gates(
    path: Path,
) -> None:
    function_name = (
        "_indexer_agent_task_inner"
        if path == _APPLICATION
        else "_indexer_predict_agent_task_inner"
    )
    function = _current_function(path, function_name)
    names = {
        node.id for node in ast.walk(function) if isinstance(node, ast.Name)
    }
    calls = {
        node.func.id
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }

    assert {
        "should_continue",
        "hitl_resume",
        "hitl_decisions",
    } <= names
    assert {
        "get_child_dispatcher",
        "build_mcp_auth_pause_result",
        "apply_parallel_reconcile",
        "create_callbacks",
    } <= calls


def test_checkpoint_selection_is_bound_to_current_worker_source() -> None:
    if not _MEMORY_HELPERS.is_file():
        pytest.skip("current Centry checkpoint evidence checkout is unavailable")
    assert hashlib.sha256(_MEMORY_HELPERS.read_bytes()).hexdigest() == (
        _MEMORY_HELPERS_SHA256
    )

    setup = _current_function(_MEMORY_HELPERS, "setup_memory")
    setup_constants = {
        node.value
        for node in ast.walk(setup)
        if isinstance(node, ast.Constant) and isinstance(node.value, str)
    }
    assert {
        "agent_memory_config",
        "postgres",
        "connection_string",
        "postgresql+psycopg://",
        "postgresql://",
    } <= setup_constants

    create = _current_function(_MEMORY_HELPERS, "create_memory_saver")
    create_attributes = {
        node.func.attr
        for node in ast.walk(create)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }
    create_names = {
        node.func.id
        for node in ast.walk(create)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    assert {"connect", "close", "setup"} <= create_attributes
    assert "PostgresSaver" in create_names

    if not _MEMORY_CONFIG.is_file():
        pytest.skip("current Centry checkpoint configuration is unavailable")
    config = _MEMORY_CONFIG.read_text(encoding="utf-8")
    assert "agent_memory_config:" in config
    assert "/agentstate" in config
    assert "autocommit: true" in config


def test_language_neutral_input_covers_every_current_worker_kwarg() -> None:
    current_keys: set[str] = set()
    for path, function_name in (
        (_APPLICATION, "_indexer_agent_task_inner"),
        (_ADHOC, "_indexer_predict_agent_task_inner"),
    ):
        function = _current_function(path, function_name)
        current_keys.update(_kwargs_get_keys(function))

    contract_fields = {
        field.name
        for field in agent_pb2.AgentExecutionInputV1.DESCRIPTOR.fields
    }

    assert current_keys <= contract_fields


@pytest.mark.parametrize(
    ("path", "expected_digest"),
    (
        (_TRACE_WRITER, _TRACE_WRITER_SHA256),
        (_MESSAGE_STREAM, _MESSAGE_STREAM_SHA256),
        (_TOOL_CALL_DEDUP, _TOOL_CALL_DEDUP_SHA256),
        (_TRACE_MODEL, _TRACE_MODEL_SHA256),
    ),
)
def test_agent_persistence_evidence_is_bound_to_current_main_source(
    path: Path,
    expected_digest: str,
) -> None:
    if not path.is_file():
        pytest.skip("current Centry chat-persistence evidence checkout is unavailable")

    assert hashlib.sha256(path.read_bytes()).hexdigest() == expected_digest


def test_current_trace_model_remains_the_agent_activity_contract() -> None:
    model = _current_class(_TRACE_MODEL, "MessageTraceStep")
    annotated = {
        node.target.id
        for node in model.body
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name)
    }

    assert {
        "message_group_id",
        "kind",
        "run_id",
        "parent_agent_name",
        "parent_agent_call_id",
        "started_at",
        "finished_at",
        "is_error",
        "has_visible_content",
        "tool_name",
        "tool_inputs",
        "tool_output",
        "finish_reason",
        "step_type",
        "text",
        "thinking",
        "model_name",
        "attrs",
    } <= annotated


def test_current_trace_reconcile_keeps_delta_accumulation_and_stable_rows() -> None:
    function = _current_function(_TRACE_WRITER, "sync_trace_steps")
    calls = {
        node.func.id
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    attributes = {
        node.func.attr
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)
    }

    assert {
        "_reconstruct",
        "_dedupe_replayed_tool_calls",
        "_merge_thinking_steps",
        "_row_key",
        "_apply_row_values",
    } <= calls
    assert {"add", "delete"} <= attributes


def test_current_message_stream_persists_trace_deltas_outside_group_meta() -> None:
    function = _current_function(_MESSAGE_STREAM, "update_message_group_meta")
    calls = {
        node.func.id
        for node in ast.walk(function)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
    }
    popped_keys = {
        node.args[0].value
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "pop"
        and node.args
        and isinstance(node.args[0], ast.Constant)
        and isinstance(node.args[0].value, str)
    }

    assert "sync_trace_steps" in calls
    assert {"tool_calls", "thinking_steps"} <= popped_keys


def _current_function(path: Path, name: str) -> ast.FunctionDef:
    if not path.is_file():
        pytest.skip("current Centry agent-worker evidence checkout is unavailable")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == name
    )


def _current_class(path: Path, name: str) -> ast.ClassDef:
    if not path.is_file():
        pytest.skip("current Centry persistence evidence checkout is unavailable")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == name
    )


def _attribute_call_count(function: ast.FunctionDef, attribute: str) -> int:
    return sum(
        1
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == attribute
    )


def _attribute_calls(function: ast.FunctionDef, attribute: str) -> list[ast.Call]:
    return [
        node
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == attribute
    ]


def _kwargs_get_keys(function: ast.FunctionDef) -> set[str]:
    keys: set[str] = set()
    for node in ast.walk(function):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "kwargs"
            and node.func.attr == "get"
            and node.args
            and isinstance(node.args[0], ast.Constant)
            and isinstance(node.args[0].value, str)
        ):
            keys.add(node.args[0].value)
    return keys
