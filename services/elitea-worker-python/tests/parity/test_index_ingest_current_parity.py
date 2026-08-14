from __future__ import annotations

import ast
import hashlib
import subprocess
from pathlib import Path

import pytest

from elitea_worker.constants import SDK_SOURCE_REVISION


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_ROOT = _SERVICE_ROOT.parents[1]
_PROJECTS_ROOT = _PLATFORM_ROOT.parent
_INDEXER_ROOT = _PROJECTS_ROOT / "centry/pylon_indexer/plugins/indexer_worker"
_WRAPPER = _INDEXER_ROOT / "methods/indexer_test_toolkit.py"
_DISPATCH = (
    _PROJECTS_ROOT
    / "centry/pylon_main/plugins/elitea_core/utils/application_tools.py"
)
_SDK_ROOT = _PROJECTS_ROOT / "elitea-sdk"
_SDK_CLIENT_PATH = "elitea_sdk/runtime/clients/client.py"
_WRAPPER_SHA256 = (
    "d34cb0fb1c77cf66a254cef796b0a3baeae8d42c327d72ca4ab028b8ffbfef9e"
)
_DISPATCH_SHA256 = (
    "9e508bd9f0834ae1b7a2f13c7526175c1429ede8dbfc1451d802e4469016256e"
)


def test_index_ingest_boundary_matches_current_index_data_source_evidence() -> None:
    if not _WRAPPER.is_file() or not _DISPATCH.is_file():
        pytest.skip("current Centry evidence checkout is unavailable")

    assert hashlib.sha256(_WRAPPER.read_bytes()).hexdigest() == _WRAPPER_SHA256
    assert hashlib.sha256(_DISPATCH.read_bytes()).hexdigest() == _DISPATCH_SHA256

    wrapper_tree = ast.parse(_WRAPPER.read_text(encoding="utf-8"))
    copy_imports = [
        alias
        for node in wrapper_tree.body
        if isinstance(node, ast.ImportFrom) and node.module == "copy"
        for alias in node.names
    ]
    assert [(alias.name, alias.asname) for alias in copy_imports] == [
        ("deepcopy", "copy")
    ]

    wrapper_function = _function(_WRAPPER, "_indexer_test_toolkit_tool_task")
    sdk_calls = [
        node
        for node in ast.walk(wrapper_function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "test_toolkit_tool"
    ]
    assert len(sdk_calls) == 1
    call = sdk_calls[0]
    assert [keyword.arg for keyword in call.keywords] == [
        "toolkit_config",
        "tool_name",
        "tool_params",
        "runtime_config",
        "llm_model",
        "llm_config",
        "mcp_tokens",
    ]
    keyword_values = {keyword.arg: keyword.value for keyword in call.keywords}
    for keyword_name, source_name in (
        ("toolkit_config", "toolkit_config"),
        ("tool_params", "tool_params"),
        ("llm_config", "llm_settings"),
    ):
        copied = keyword_values[keyword_name]
        assert isinstance(copied, ast.Call)
        assert isinstance(copied.func, ast.Name) and copied.func.id == "copy"
        assert len(copied.args) == 1
        assert isinstance(copied.args[0], ast.Name)
        assert copied.args[0].id == source_name
    for keyword_name, source_name in (
        ("runtime_config", "runtime_config"),
        ("llm_model", "llm_model"),
        ("mcp_tokens", "mcp_tokens"),
    ):
        direct = keyword_values[keyword_name]
        assert isinstance(direct, ast.Name) and direct.id == source_name
    tool_name = next(
        keyword.value for keyword in call.keywords if keyword.arg == "tool_name"
    )
    assert isinstance(tool_name, ast.Name) and tool_name.id == "tool_name"

    dispatch_function = _function(_DISPATCH, "start_index_task")
    # The verified current main checkout no longer contains the previously
    # recorded Pylon single-owner admission call. Keep this explicit source
    # evidence aligned with the open cutover gap instead of preserving a stale
    # security claim in the parity harness.
    admission_calls = [
        node
        for node in ast.walk(dispatch_function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Name)
        and node.func.id == "require_pylon_indexing_admission"
    ]
    assert admission_calls == []

    start_calls = [
        node
        for node in ast.walk(dispatch_function)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "start_task"
    ]
    assert len(start_calls) == 1
    start = start_calls[0]
    assert isinstance(start.args[0], ast.Constant)
    assert start.args[0].value == "indexer_test_toolkit_tool"
    pool = next(keyword.value for keyword in start.keywords if keyword.arg == "pool")
    assert isinstance(pool, ast.Constant) and pool.value == "agents"


def test_admitted_sdk_revision_contains_the_same_public_method() -> None:
    if not (_SDK_ROOT / ".git").exists():
        pytest.skip("current SDK evidence checkout is unavailable")
    process = subprocess.run(
        [
            "git",
            "-C",
            str(_SDK_ROOT),
            "show",
            f"{SDK_SOURCE_REVISION}:{_SDK_CLIENT_PATH}",
        ],
        check=False,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        pytest.skip("the admitted SDK revision is unavailable in the local checkout")
    tree = ast.parse(process.stdout)
    method = next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == "test_toolkit_tool"
    )
    arguments = [argument.arg for argument in method.args.args]
    assert arguments == [
        "self",
        "toolkit_config",
        "tool_name",
        "tool_params",
        "runtime_config",
        "llm_model",
        "llm_config",
        "mcp_tokens",
    ]


def _function(path: Path, name: str) -> ast.FunctionDef:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return next(
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef) and node.name == name
    )
