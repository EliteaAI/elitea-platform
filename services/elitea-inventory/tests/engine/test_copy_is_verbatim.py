"""Guards on the engine copy. No engine dependencies needed.

None of these import an engine module — they hash bytes and parse source — so
they run in any environment, including the shell image's, which does not carry
the SDK.
"""

from __future__ import annotations

import ast
import hashlib
import json
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[2]
PACKAGE_DIR = SERVICE_ROOT / "src" / "elitea_inventory"
ENGINE_DIR = PACKAGE_DIR / "engine"
MANIFEST_PATH = ENGINE_DIR / "COPY_MANIFEST.json"
REFRESH_TOOL = SERVICE_ROOT / "tools" / "refresh_engine_copy.py"

MANIFEST = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def engine_files() -> list[Path]:
    return sorted(
        path for path in ENGINE_DIR.rglob("*.py") if "__pycache__" not in path.parts
    )


def test_manifest_pins_a_revision_and_a_plausible_tree():
    assert MANIFEST["source_revision"], "the legacy revision must be pinned"
    assert MANIFEST["source_repository"] == "inventory_plugin"
    # ~24k lines across ~30 files. A manifest that suddenly covered five files
    # would still "pass" every digest check it listed.
    assert MANIFEST["file_count"] >= 28
    assert MANIFEST["total_bytes"] > 700_000


def test_every_copied_file_matches_its_digest():
    """The engine copy is verbatim, byte for byte.

    The claim that the analysis layer MOVED rather than being rewritten is only
    checkable if a modification is detectable, and at ~24k lines it is not
    checkable by reading.
    """
    mismatched = []
    for relative, entry in MANIFEST["files"].items():
        path = ENGINE_DIR / relative
        if not path.is_file():
            mismatched.append(f"missing: {relative}")
            continue
        if hashlib.sha256(path.read_bytes()).hexdigest() != entry["sha256"]:
            mismatched.append(f"modified: {relative}")
    assert not mismatched, "\n".join(mismatched)


def test_no_engine_file_is_unrecorded():
    """A file added to the engine tree and not to the manifest is invisible.

    The digest loop above iterates the MANIFEST, so a new file that nothing
    records passes it while being, by construction, unreviewed.
    """
    recorded = set(MANIFEST["files"]) | set(MANIFEST["rewritten"])
    unrecorded = [
        path.relative_to(ENGINE_DIR).as_posix()
        for path in engine_files()
        if path.relative_to(ENGINE_DIR).as_posix() not in recorded
    ]
    assert not unrecorded, f"unrecorded engine files: {unrecorded}"


def test_the_kubernetes_ingestion_path_is_not_in_the_copy():
    """v1 runs ingestion in the sidecar; there is no Job and no worker image.

    Copying these two modules would put a `kubernetes` import and a manifest
    builder for an image nobody publishes into the package, and the legacy
    `_run_ingestion_job` would have something real to call.
    """
    for relative in (
        "inventory/k8s_ingestion_job_manager.py",
        "inventory/ingestion_job_worker.py",
    ):
        assert not (ENGINE_DIR / relative).exists(), relative
        assert relative in MANIFEST["not_copied"]


def test_the_refresh_tool_agrees_that_the_copy_is_current():
    """`--check` is the gate CI runs; run it here so a stale copy fails locally."""
    completed = subprocess.run(  # noqa: S603
        [sys.executable, str(REFRESH_TOOL), "--check"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert completed.returncode == 0, completed.stdout + completed.stderr


def test_the_tool_files_are_the_declared_transformation():
    """The two tool-layer files are the copy tool's output, unedited by hand.

    They are NOT verbatim — Pylon is removed and the imports are repointed —
    so what is pinned is the digest of the RESULT together with the digest of
    the legacy SOURCE it was derived from. Editing the result by hand fails
    here; the legacy source moving under us fails the next re-copy.
    """
    for source_relative, entry in MANIFEST["tool_files"].items():
        target = PACKAGE_DIR / entry["target"]
        assert target.is_file(), source_relative
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        assert digest == entry["result_sha256"], (
            f"{entry['target']} was edited by hand; change "
            f"tools/refresh_engine_copy.py and re-run it instead"
        )
        assert entry["source_sha256"], source_relative


def test_no_pylon_survives_the_tool_layer():
    """ADR-0022 decision 1: nothing of Pylon reaches the service.

    The stub in `pylon_shim` exists for three copied ENGINE files whose logger
    import is verbatim. The TOOL layer is transformed, so a Pylon import
    surviving there means a substitution stopped matching.
    """
    for relative in ("tool_operations.py", "chat_operations.py"):
        tree = ast.parse((PACKAGE_DIR / relative).read_text(encoding="utf-8"))
        imported = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported.update(alias.name.split(".")[0] for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module and node.level == 0:
                imported.add(node.module.split(".")[0])
        assert "pylon" not in imported, relative
        assert "tasknode_task" not in imported, relative


def test_no_web_method_decorator_survives_the_tool_layer():
    """Every `@web.method()` is removed; one left behind is a NameError at import.

    Read as decorators rather than as text: the generated header DESCRIBES the
    substitution, so a substring search finds `@web.method` in every file the
    tool has correctly transformed.
    """
    for relative in ("tool_operations.py", "chat_operations.py"):
        tree = ast.parse((PACKAGE_DIR / relative).read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            for decorator in node.decorator_list:
                rendered = ast.unparse(decorator)
                assert not rendered.startswith("web."), f"{relative}: {node.name}"
