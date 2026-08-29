"""The internal-tool set this worker image can actually build.

Both halves here were measured on the built image before they were written, by
toggling every switch on the agent form and sending one message. The turn died
in the SDK, and the browser got an assistant row flagged `is_error` with EMPTY
content — a failure that names neither the toggle nor the runtime:

    {"event":"agent_execution_internal_failure","exception_name":"PermissionError",
     "frames":[{"file":"sdk_adapter.py","function":"execute_application"},
               {"file":"client.py","function":"application"},
               {"file":"middleware.py","function":"__init__"},
               {"file":"wrapper.py","function":"setup_storage"},
               {"file":"wrapper.py","function":"__init__"},
               {"file":"pathlib.py","function":"mkdir"}],"stage":"execute"}

and, behind it, `RuntimeError: Deno is required for PyodideSandbox…`.

The distinction these tests protect is FIXED vs SKIPPED. `planner` failed for a
missing directory, which the worker can provide, so it must still reach the SDK.
`pyodide` failed for a missing sandbox backend this image does not ship, so it
must NOT reach the SDK — and it must be reported rather than dropped in silence,
because the agent then runs without a capability its author asked for.
"""

from __future__ import annotations

import json
import os
from typing import Any

import pytest

from elitea_worker.agents import internal_tools, sdk_adapter


ALL_FORM_TOOLS = [
    "attachments",
    "internal_mcp",
    "pyodide",
    "data_analysis",
    "planner",
    "swarm",
    "lazy_tools_mode",
]


@pytest.fixture
def no_sandbox_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    """The image this directory builds: no Deno, no remote sandbox."""

    monkeypatch.delenv("SANDBOX_SERVICE_URL", raising=False)
    monkeypatch.setattr(internal_tools.shutil, "which", lambda _name: None)


@pytest.fixture
def with_deno(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SANDBOX_SERVICE_URL", raising=False)
    monkeypatch.setattr(internal_tools.shutil, "which", lambda name: f"/usr/bin/{name}")


class TestSelection:
    def test_the_sandbox_tool_is_dropped_without_a_backend(
        self, no_sandbox_backend: None, capsys: pytest.CaptureFixture[str]
    ) -> None:
        served = internal_tools.serve_internal_tools(ALL_FORM_TOOLS)
        assert "pyodide" not in served

    def test_everything_else_still_reaches_the_sdk(
        self, no_sandbox_backend: None, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # `planner` in particular. It is the one that failed FIRST in
        # production, and fixing it by dropping it would have turned a missing
        # directory into a missing feature.
        served = internal_tools.serve_internal_tools(ALL_FORM_TOOLS)
        assert served == [name for name in ALL_FORM_TOOLS if name != "pyodide"]

    def test_a_skip_is_reported_once_per_name_in_the_runtimes_shared_shape(
        self, no_sandbox_backend: None, capsys: pytest.CaptureFixture[str]
    ) -> None:
        # Same event name and fields as the Rust runtime's warning
        # (services/elitea-worker-rust/src/agents/internal_tools.rs), so one
        # grep covers a deployment running either worker.
        internal_tools.serve_internal_tools(["pyodide", "pyodide", "planner"])
        lines = [line for line in capsys.readouterr().err.splitlines() if line.strip()]
        assert [json.loads(line) for line in lines] == [
            {
                "event": "agent_internal_tool_skipped",
                "internal_tool": "pyodide",
                "reason_code": "sandbox_backend_unavailable",
            }
        ]

    def test_nothing_is_reported_when_nothing_is_dropped(
        self, with_deno: None, capsys: pytest.CaptureFixture[str]
    ) -> None:
        assert internal_tools.serve_internal_tools(ALL_FORM_TOOLS) == ALL_FORM_TOOLS
        assert capsys.readouterr().err == ""

    def test_a_remote_sandbox_service_serves_the_tool_too(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        # The SDK takes a RemoteSandbox before it looks for Deno, so a
        # deployment that runs one must not have the tool pruned out from under
        # it.
        monkeypatch.setattr(internal_tools.shutil, "which", lambda _name: None)
        monkeypatch.setenv("SANDBOX_SERVICE_URL", "https://sandbox.internal")
        assert internal_tools.serve_internal_tools(["pyodide"]) == ["pyodide"]

    def test_a_blank_sandbox_url_is_not_a_backend(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(internal_tools.shutil, "which", lambda _name: None)
        monkeypatch.setenv("SANDBOX_SERVICE_URL", "   ")
        assert internal_tools.serve_internal_tools(["pyodide"]) == []

    def test_an_unknown_name_is_left_alone(self, no_sandbox_backend: None) -> None:
        # This module answers "can this IMAGE build it", not "is this a real
        # capability". The platform already refuses a name outside its own
        # catalogue (currentRuntimeInternalTools), and a second, narrower
        # allowlist here would silently drop the next tool the product adds.
        assert internal_tools.serve_internal_tools(["image_generation"]) == [
            "image_generation"
        ]


class TestStateDirectory:
    def test_an_operator_set_directory_is_never_relocated(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setenv("ELITEA_DIR", "/somewhere/an/operator/chose")
        assert (
            internal_tools.ensure_sdk_state_directory()
            == "/somewhere/an/operator/chose"
        )
        assert os.environ["ELITEA_DIR"] == "/somewhere/an/operator/chose"

    def test_an_unset_directory_becomes_a_private_writable_one(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
    ) -> None:
        # The defect: with ELITEA_DIR unset the SDK's FilesystemStorage falls
        # back to the RELATIVE path `.elitea/plans`, which in the worker
        # container resolves against `/` and cannot be created by uid 10001.
        monkeypatch.delenv("ELITEA_DIR", raising=False)
        monkeypatch.setattr(internal_tools.tempfile, "gettempdir", lambda: str(tmp_path))

        directory = internal_tools.ensure_sdk_state_directory()

        assert os.environ["ELITEA_DIR"] == directory
        assert os.path.isabs(directory)
        assert os.path.isdir(directory)
        # Plan files carry titles and step descriptions the model wrote, which
        # is conversation content.
        assert (os.stat(directory).st_mode & 0o777) == 0o700

    def test_it_is_idempotent(
        self, monkeypatch: pytest.MonkeyPatch, tmp_path: Any
    ) -> None:
        # Called on every run, beside `_apply_toolkit_guardrails`.
        monkeypatch.delenv("ELITEA_DIR", raising=False)
        monkeypatch.setattr(internal_tools.tempfile, "gettempdir", lambda: str(tmp_path))
        first = internal_tools.ensure_sdk_state_directory()
        second = internal_tools.ensure_sdk_state_directory()
        assert first == second


class TestVersionMetaPruning:
    """The stored-agent path prunes the VERSION META, not the payload field.

    `execute_application` never hands `payload.internal_tools` to the SDK. The
    SDK reads `version_details['meta']['internal_tools']` instead, and reads it
    twice — once to choose middleware, once to build tools — so the meta is the
    only place a prune can reach both.
    """

    def test_the_sandbox_tool_is_removed_from_the_frozen_meta(
        self, no_sandbox_backend: None
    ) -> None:
        version = {"meta": {"internal_tools": list(ALL_FORM_TOOLS), "step_limit": 7}}
        sdk_adapter._serve_version_internal_tools(version)
        assert version["meta"]["internal_tools"] == [
            name for name in ALL_FORM_TOOLS if name != "pyodide"
        ]
        assert version["meta"]["step_limit"] == 7

    @pytest.mark.parametrize(
        "version",
        [
            {},
            {"meta": None},
            {"meta": {}},
            {"meta": {"internal_tools": None}},
            {"meta": {"internal_tools": "pyodide"}},
            {"meta": {"internal_tools": ["pyodide", 7]}},
        ],
    )
    def test_a_shape_this_does_not_understand_is_left_untouched(
        self, no_sandbox_backend: None, version: dict[str, Any]
    ) -> None:
        # Removing names is this function's whole job. Repairing a malformed
        # value would change what the SDK sees for a reason that has nothing to
        # do with what this image can build.
        original = json.loads(json.dumps(version))
        sdk_adapter._serve_version_internal_tools(version)
        assert version == original
