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
_APPLICATION_SHA256 = (
    "bbbdd75bb5228d55516e71677044430ee348396108f11f7bb7428f950ca8ca54"
)
_ADHOC_SHA256 = (
    "76b32ae4c4554c07c0819d54113239e763b78c1888662b0562524d215896d53f"
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


def test_adhoc_agent_keeps_its_distinct_sdk_constructor_and_invoke() -> None:
    function = _current_function(_ADHOC, "_indexer_predict_agent_task_inner")

    assert _attribute_call_count(function, "get_llm") == 1
    assert _attribute_call_count(function, "predict_agent") == 1
    assert _attribute_call_count(function, "invoke") == 1
    assert _attribute_call_count(function, "application") == 0


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


def _current_function(path: Path, name: str) -> ast.FunctionDef:
    if not path.is_file():
        pytest.skip("current Centry agent-worker evidence checkout is unavailable")
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == name
    )


def _attribute_call_count(function: ast.FunctionDef, attribute: str) -> int:
    return sum(
        1
        for node in ast.walk(function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == attribute
    )


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
