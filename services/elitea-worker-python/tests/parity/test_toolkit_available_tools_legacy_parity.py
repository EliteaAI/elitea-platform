from __future__ import annotations

import importlib.util
import json
import sys
import types
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from elitea_worker.agents.sdk_adapter import EliteaSdkToolkitAdapter
from elitea_worker.handlers.toolkit_available_tools import (
    ToolkitAvailableToolsHandler,
    ToolkitAvailableToolsRequest,
)


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_ROOT = _SERVICE_ROOT.parents[1]
_PROJECTS_ROOT = _PLATFORM_ROOT.parent
_CORPUS_PATH = (
    _PLATFORM_ROOT
    / "testdata/proto/runtime/v1/toolkit-available-tools/legacy-parity-corpus.json"
)
_LEGACY_WRAPPER_PATH = (
    _PROJECTS_ROOT
    / "centry/pylon_indexer/plugins/indexer_worker/methods/"
    "indexer_toolkit_available_tools.py"
)


class _WebStub:
    @staticmethod
    def method():
        return lambda function: function


class _LogStub:
    def __init__(self) -> None:
        self.exception_calls = 0

    def exception(self, _message: str) -> None:
        self.exception_calls += 1


@pytest.fixture(scope="module")
def sdk() -> EliteaSdkToolkitAdapter:
    return EliteaSdkToolkitAdapter()


def test_target_matches_pinned_legacy_corpus(
    sdk: EliteaSdkToolkitAdapter,
) -> None:
    corpus = json.loads(_CORPUS_PATH.read_bytes())
    cases = {case["id"]: case for case in corpus["cases"]}
    handler = ToolkitAvailableToolsHandler(sdk)

    for case in corpus["cases"]:
        settings_case = cases.get(case.get("settings_ref"), case)
        expected_case = cases.get(case.get("expected_ref"), case)
        settings = settings_case["settings"]
        expected = expected_case["expected"]

        target = handler.execute(_request(case["toolkit_type"], settings))
        target_value = json.loads(target.artifact.content)

        assert target_value == expected, case["id"]
        assert target.artifact.content == _canonical(expected), case["id"]
        assert b"TEST_ONLY_CREDENTIAL_CANARY_NOT_A_SECRET" not in target.artifact.content


def test_target_matches_exact_legacy_wrapper_when_checkout_is_available(
    monkeypatch: pytest.MonkeyPatch,
    sdk: EliteaSdkToolkitAdapter,
) -> None:
    legacy, _ = _load_legacy_method(monkeypatch)
    corpus = json.loads(_CORPUS_PATH.read_bytes())
    cases = {case["id"]: case for case in corpus["cases"]}
    handler = ToolkitAvailableToolsHandler(sdk)

    for case in corpus["cases"]:
        settings_case = cases.get(case.get("settings_ref"), case)
        settings = settings_case["settings"]
        legacy_value = legacy.indexer_toolkit_available_tools(
            toolkit_type=case["toolkit_type"],
            settings=settings,
        )
        target = handler.execute(_request(case["toolkit_type"], settings))

        assert json.loads(target.artifact.content) == legacy_value, case["id"]


def test_adapter_invokes_public_sdk_entrypoint_once_with_exact_keywords(
    sdk: EliteaSdkToolkitAdapter,
) -> None:
    settings: dict[str, Any] = {}
    original = sdk._tools_module.get_toolkit_available_tools

    with patch.object(
        sdk._tools_module,
        "get_toolkit_available_tools",
        wraps=original,
    ) as call:
        result = ToolkitAvailableToolsHandler(sdk).execute(_request("openapi", settings))

    assert json.loads(result.artifact.content)["error"] == "OpenAPI spec is missing"
    call.assert_called_once_with(toolkit_type="openapi", settings=settings)


def test_escaping_exception_value_matches_legacy_without_target_log_side_channel(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    sdk: EliteaSdkToolkitAdapter,
) -> None:
    legacy, legacy_log = _load_legacy_method(monkeypatch)
    canary = "TEST_ONLY_EXCEPTION_CANARY_NOT_A_SECRET"

    with patch.object(
        sdk._tools_module,
        "get_toolkit_available_tools",
        side_effect=RuntimeError(canary),
    ) as call:
        legacy_value = legacy.indexer_toolkit_available_tools(
            toolkit_type="openapi",
            settings={},
        )
        caplog.clear()
        target = ToolkitAvailableToolsHandler(sdk).execute(_request("openapi", {}))

    expected = {"tools": [], "args_schemas": {}, "error": canary}
    assert legacy_value == expected
    assert json.loads(target.artifact.content) == expected
    assert call.call_count == 2
    assert legacy_log.exception_calls == 1
    assert canary not in caplog.text


def _load_legacy_method(monkeypatch: pytest.MonkeyPatch) -> tuple[Any, _LogStub]:
    if not _LEGACY_WRAPPER_PATH.is_file():
        pytest.skip(f"legacy evidence checkout is unavailable: {_LEGACY_WRAPPER_PATH}")
    log = _LogStub()
    tools = types.ModuleType("pylon.core.tools")
    tools.log = log
    tools.web = _WebStub()
    pylon = types.ModuleType("pylon")
    core = types.ModuleType("pylon.core")
    pylon.core = core
    core.tools = tools
    monkeypatch.setitem(sys.modules, "pylon", pylon)
    monkeypatch.setitem(sys.modules, "pylon.core", core)
    monkeypatch.setitem(sys.modules, "pylon.core.tools", tools)

    spec = importlib.util.spec_from_file_location(
        "elitea_legacy_indexer_toolkit_available_tools",
        _LEGACY_WRAPPER_PATH,
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Method(), log


def _request(toolkit_type: str, settings: dict[str, Any]) -> ToolkitAvailableToolsRequest:
    return ToolkitAvailableToolsRequest(
        toolkit_type=toolkit_type,
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        settings_entry_id="settings",
        settings_entry_version="1",
        settings_content_digest=b"s" * 32,
        settings=settings,
    )


def _canonical(value: dict[str, Any]) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
