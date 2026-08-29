"""What this worker IMAGE can do with the platform's internal-tool catalogue.

The platform forwards the authored `meta.internal_tools` set as it stands and
lets each runtime decide (`currentRuntimeInternalTools` in
services/elitea-main/internal/application/agentexecution/start.go). The native
Rust runtime answers that by SKIPPING what it does not implement, with a logged
`agent_internal_tool_skipped`
(services/elitea-worker-rust/src/agents/internal_tools.rs). This module is the
Python worker's half of the same contract, and it exists because "the Python
worker serves the whole set" was written down in three places and was not true.

MEASURED, on the image this directory builds, with every switch on the agent
form toggled on:

  * `planner`. `EliteAClient.application()` constructs a `PlanningMiddleware`
    the moment `planner` appears in `meta.internal_tools`, always with
    `connection_string=None`, so its `PlanningWrapper` falls back to
    `FilesystemStorage`, whose base directory defaults to `$ELITEA_DIR/plans`
    and, with no `ELITEA_DIR`, to the RELATIVE path `.elitea/plans`. The worker
    container has no WORKDIR, so that resolves against `/`, which uid 10001
    cannot write:

      {"event":"agent_execution_internal_failure","exception_name":"PermissionError",
       "frames":[…{"file":"wrapper.py","function":"setup_storage"},
                 {"file":"wrapper.py","function":"__init__"},
                 {"file":"pathlib.py","function":"mkdir"}],"stage":"execute"}

    That is not a missing capability, it is a missing directory, so it is FIXED
    rather than skipped: `ensure_sdk_state_directory` points `ELITEA_DIR` at a
    private directory the worker can write in every deployment shape this
    repository ships — compose (writable image filesystem) and Kubernetes
    (`readOnlyRootFilesystem: true` plus a `/tmp` emptyDir,
    deploy/helm/elitea/templates/worker/deployment.yaml).

  * `pyodide`. The SDK materialises it through `SandboxToolkit.get_toolkit`,
    whose tool constructor initialises a sandbox eagerly and raises
    `RuntimeError("Deno is required for PyodideSandbox…")` when neither
    `SANDBOX_SERVICE_URL` nor a `deno` executable is present. This image ships
    neither, and cannot: Deno is a runtime download this build has no admitted,
    hash-pinned source for. So `pyodide` IS a capability this worker lacks, and
    it is skipped the way the Rust runtime skips what it lacks.

WHY SKIPPING AND NOT REFUSING. The whole turn dies on either failure — the
exception escapes `LangChainAssistant`'s constructor, and the browser gets an
assistant row flagged `is_error` with EMPTY content, naming neither the toggle
nor the runtime. An agent that answers without one tool is a smaller loss than
an agent that stops answering, and the skip is logged so an operator can see
which capability the deployment is not providing.

WHY NOT A WIDER TRY/EXCEPT. The construction that fails happens inside the
SDK's `get_tools()`, which builds every tool for the run in one pass; there is
no seam there this worker owns. Pruning the REQUEST is the lever the worker
does own, and it is exact: the name never reaches the SDK, so nothing partial
is built.

A name this module does not know is left alone. `attachments`, `internal_mcp`,
`swarm`, `data_analysis` and `lazy_tools_mode` all reach the SDK today and
either configure a mode or resolve to no tool; only a name with a measured,
image-level precondition belongs in `_PRECONDITIONS`.
"""

from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from collections.abc import Iterable
from typing import Callable

__all__ = [
    "ensure_sdk_state_directory",
    "serve_internal_tools",
    "unservable_internal_tools",
]


# The directory name is this worker's, not the SDK's: `ELITEA_DIR` is also the
# SDK CLI's configuration root, and a shared name would let a developer's
# `.elitea` tree and a worker's plan spool mean the same path.
_STATE_DIRECTORY_NAME = "elitea-worker-state"

_SANDBOX_TOOL = "pyodide"
_SANDBOX_REASON = "sandbox_backend_unavailable"


def _sandbox_backend_available() -> bool:
    """Mirror the SDK's own two ways of reaching a Python sandbox.

    `PyodideSandboxTool._initialize_sandbox` takes a remote sandbox when
    `SANDBOX_SERVICE_URL` is set and otherwise requires `deno` on PATH. Both are
    read here rather than assumed absent, so an image or a deployment that adds
    either one starts serving the tool without another change in this file.
    """

    if (os.environ.get("SANDBOX_SERVICE_URL") or "").strip():
        return True
    return shutil.which("deno") is not None


# name -> (precondition, reason_code). Only names with a MEASURED, image-level
# precondition belong here; see the module docstring.
_PRECONDITIONS: dict[str, tuple[Callable[[], bool], str]] = {
    _SANDBOX_TOOL: (_sandbox_backend_available, _SANDBOX_REASON),
}


def ensure_sdk_state_directory() -> str:
    """Point the SDK's filesystem state at a directory this worker can write.

    Idempotent, and callable on every run: it reads one environment variable and
    creates one directory with `exist_ok`.

    An `ELITEA_DIR` the operator set is left exactly as it is, including one
    that turns out to be unwritable. A deployment that names a directory has
    made a choice about where conversation-derived state lands, and silently
    relocating it would be worse than the error it would hide.
    """

    configured = (os.environ.get("ELITEA_DIR") or "").strip()
    if configured:
        return configured

    directory = os.path.join(tempfile.gettempdir(), _STATE_DIRECTORY_NAME)
    # 0700 twice: `makedirs` masks its mode with the process umask, so the
    # explicit chmod is what actually guarantees it. The files underneath carry
    # plan titles and step descriptions the model wrote, which is conversation
    # content and not something a second uid on the host should be able to read.
    os.makedirs(directory, mode=0o700, exist_ok=True)
    os.chmod(directory, 0o700)
    os.environ["ELITEA_DIR"] = directory
    return directory


def unservable_internal_tools(names: Iterable[str]) -> list[tuple[str, str]]:
    """The (name, reason_code) pairs this image cannot materialise, in order."""

    unservable: list[tuple[str, str]] = []
    for name in names:
        precondition = _PRECONDITIONS.get(name)
        if precondition is None:
            continue
        available, reason = precondition
        if not available():
            unservable.append((name, reason))
    return unservable


def serve_internal_tools(names: Iterable[str]) -> list[str]:
    """Return the subset the SDK can build here, reporting what was dropped.

    Order and duplicates are preserved: the platform already de-duplicated and
    ordered this list, and reordering it here would make two runs of the same
    agent send two different requests.
    """

    requested = list(names)
    dropped = dict(unservable_internal_tools(requested))
    if not dropped:
        return requested
    for name, reason in dropped.items():
        _report_skipped_internal_tool(name, reason)
    return [name for name in requested if name not in dropped]


def _report_skipped_internal_tool(name: str, reason: str) -> None:
    """One operator-facing line per skipped tool, in the runtime's own shape.

    Same event name and fields as the Rust runtime's `tracing::warn!`, so a
    deployment running either worker is grepped the same way. It carries no
    execution content — the tool name is platform vocabulary, not user input.
    """

    print(
        json.dumps(
            {
                "event": "agent_internal_tool_skipped",
                "internal_tool": name,
                "reason_code": reason,
            },
            sort_keys=True,
            separators=(",", ":"),
        ),
        file=sys.stderr,
        flush=True,
    )
