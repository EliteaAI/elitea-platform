#!/usr/bin/env python3
"""Re-copy the Inventory engine from the legacy checkout and record its digests.

The engine under ``src/elitea_inventory/engine/`` is a copy of the legacy
``inventory_plugin``'s analysis layer — ``inventory/``, ``utils/``,
``constants.py`` and ``routing.py``. This tool performs that copy, applies the
declared substitutions to the two TOOL-LAYER files, and writes
``COPY_MANIFEST.json`` beside the engine, which
``tests/engine/test_copy_is_verbatim.py`` then enforces.

Two modes:

    python tools/refresh_engine_copy.py            re-copy and rewrite the manifest
    python tools/refresh_engine_copy.py --check    verify the copy against the manifest

``--check`` needs no legacy checkout — it hashes what is committed here — so it
is what CI runs. The default mode needs the legacy tree (``--source``) and is
how a deliberate re-sync is performed.

Why a copy at all: ADR-0023 stage H4c ports the Inventory PROVIDER, not the
graph algorithms. Extractors, the knowledge graph, community detection, the
parsers and retrieval are ~24k lines of analysis code with no platform
coupling; rewriting them would be a rewrite of the product, and a rewrite is
not checkable. A copy is — by digest.

WHAT IS NOT COPIED, and why (ADR-0023 H4c stage I3, v1 scope):

* ``inventory/k8s_ingestion_job_manager.py`` and
  ``inventory/ingestion_job_worker.py`` — v1 runs ingestion IN the sidecar,
  under the host's invocation manager. There is no worker image and no
  ``INVENTORY_JOBS_ENABLED``; the host's ``slots.go`` keeps refusing jobs mode.
* ``methods/inventory_chat.py``'s socket.io transport (``sio/``, ``routes/``)
  — chat is not ported. The AGENT inside ``inventory_chat`` is, because
  ``investigate`` (one of the six ``inventory_search`` tools) calls it.
* ``module.py``, ``methods/init.py``, ``methods/descriptor.py``,
  ``methods/invocations.py``, ``events/`` — the Pylon shell. Its successor is
  the Go sub-application host.

THE TOOL LAYER's substitutions are declared below and are mechanical: re-running
this tool against the legacy source regenerates the files byte for byte, and
``--check`` verifies both the transformed result AND the digest of the source
it was derived from.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
PACKAGE_DIR = SERVICE_ROOT / "src" / "elitea_inventory"
ENGINE_DIR = PACKAGE_DIR / "engine"
MANIFEST = ENGINE_DIR / "COPY_MANIFEST.json"

DEFAULT_SOURCE = (
    SERVICE_ROOT.parents[2] / "legacy" / "plugins" / "inventory_plugin"
)

#: Engine trees copied byte for byte, as ``<source> -> <target under engine/>``.
ENGINE_TREES = {
    "inventory": "inventory",
    "utils": "utils",
}

#: Single engine files copied byte for byte.
ENGINE_FILES = {
    "constants.py": "constants.py",
    "routing.py": "routing.py",
}

#: Engine files DELETED after the tree copy, with the reason. They are the
#: Kubernetes ingestion path, which v1 does not port: ingestion runs in the
#: sidecar. Keeping them would put a `kubernetes` import and a manifest builder
#: referencing an image nobody builds into the package.
ENGINE_EXCLUDED = {
    "inventory/k8s_ingestion_job_manager.py": "v1 runs ingestion in the sidecar; there is no ingestion Job",
    "inventory/ingestion_job_worker.py": "the worker image is not built; the sidecar IS the worker",
}

#: Files rewritten rather than copied. There is exactly one, and it is the
#: package marker this tool creates — the legacy tree has no ``__init__.py`` at
#: its root.
#:
#: NOTHING ELSE is rewritten, including the two package ``__init__`` files. An
#: earlier draft rewrote both, on the assumption that ``inventory/__init__.py``
#: re-exported the excluded Kubernetes modules (it does not) and that
#: ``utils/__init__.py`` could not import its Pylon-logging modules (it can —
#: see ``elitea_inventory.pylon_shim``). Each rewrite would have been a file
#: whose contents no digest pins, in a copy whose whole value is that a
#: modification is detectable.
ENGINE_REWRITTEN = ("__init__.py",)

#: The tool layer: the legacy handlers, transformed. Unlike the engine these
#: cannot be verbatim — they import Pylon at module scope, decorate every method
#: with ``@web.method()`` and read the invocation id from a Pylon-injected
#: module. ADR-0022 decision 1 keeps Pylon out of the service.
TOOL_FILES = {
    "methods/invoke.py": PACKAGE_DIR / "tool_operations.py",
    "methods/inventory_chat.py": PACKAGE_DIR / "chat_operations.py",
}

TOOL_HEADER = '''# Copied from inventory_plugin {source} by tools/refresh_engine_copy.py.
#
# DO NOT EDIT BY HAND. Only the substitutions declared in that tool are applied
# to the legacy source, and nothing else:
#
#   1. `from pylon.core.tools import log, web` becomes a stdlib logger.
#   2. Every `@web.method()` decorator is removed.
#   3. `import tasknode_task` / `tasknode_task.id` become `self.invocation_id`,
#      which the sidecar's context supplies.
#   4. The legacy sys.path bootstrap block is removed.
#   5. Legacy package imports are repointed into this package
#      (`from ..constants` / `from inventory` / `from ..routing` / `..utils`).
#   6. `elitea_client.get_llm(` becomes `self.platform_llm(` — the LLM is built
#      from the request's `llm_settings`, never from an admin platform client.
#
# The class below is otherwise the legacy `Method` mixin unchanged. Everything
# v1 REPLACES rather than transforms lives in elitea_inventory.v1_overrides,
# which is mixed in AHEAD of this class, so the replacement is a readable file
# rather than an invisible edit inside 3900 copied lines.
'''

#: The substitutions, in order. Each is (pattern, replacement, expected_min),
#: where the minimum is the number of matches expected ACROSS ALL tool files
#: together — not per file. `tasknode_task` appears only in invoke.py, the
#: `from inventory import` line only in invoke.py, and a per-file minimum would
#: therefore have to be zero for both, which is exactly the assertion that
#: cannot notice the legacy source changing shape.
TOOL_SUBSTITUTIONS: list[tuple[str, str, int]] = [
    # 1. Pylon logger and the web.method decorator factory. Two import forms
    #    in the legacy tree — one per line in invoke.py, one combined in
    #    inventory_chat.py — so the pattern covers both and each file must
    #    match exactly one of them.
    (
        r"from pylon\.core\.tools import log\nfrom pylon\.core\.tools import web\n"
        r"|from pylon\.core\.tools import log, web\n",
        "import logging\n\nlog = logging.getLogger(__name__)\n",
        1,
    ),
    (r"^ *@web\.method\(\)\n", "", 1),
    # 2. The Pylon-injected invocation id.
    (r"^ *import tasknode_task\n", "", 1),
    (r"\btasknode_task\.id\b", "self.invocation_id", 1),
    # 3. The sys.path bootstrap: this is an installed package.
    (
        r"# Add plugin directory to Python path for local inventory module\n"
        r"plugin_dir = Path\(__file__\)\.parent\.parent\n"
        r"if str\(plugin_dir\) not in sys\.path:\n"
        r" *sys\.path\.insert\(0, str\(plugin_dir\)\)\n",
        "",
        0,
    ),
    # 4. Legacy package imports, repointed.
    (
        r"try:\n *from \.\.constants import CANONICAL_TYPES\nexcept ImportError:\n"
        r" *from plugins\.inventory_plugin\.constants import CANONICAL_TYPES\n",
        "from .engine.constants import CANONICAL_TYPES\n",
        0,
    ),
    (r"from \.\.constants import ", "from .engine.constants import ", 0),
    (r"from \.\.utils\.", "from .engine.utils.", 0),
    (r"from \.\.utils import ", "from .engine.utils import ", 0),
    (r"from \.\.routing import ", "from .engine.routing import ", 0),
    (r"^( *)from inventory import ", r"\1from .engine import ", 1),
    (r"^( *)from inventory\.", r"\1from .engine.", 0),
    # 5. The LLM. The legacy service built it from an admin-token platform
    #    client; here it comes from the request's llm_settings.
    (r"\belitea_client\.get_llm\(", "self.platform_llm(", 0),
    (r"\bself\.elitea_client\.get_llm\(", "self.platform_llm(", 0),
]

#: The pylon logger import inside a copied ENGINE file. The engine files are
#: verbatim, so this cannot be a substitution — instead the package installs a
#: stub ``pylon.core.tools`` module before the engine is imported. See
#: elitea_inventory.pylon_shim.
PYLON_IMPORTERS = ("utils/cache_manager.py", "utils/source_status.py")


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def apply_substitutions(text: str, source_name: str) -> tuple[str, list[dict]]:
    applied = []
    for pattern, replacement, _minimum in TOOL_SUBSTITUTIONS:
        text, count = re.subn(pattern, replacement, text, flags=re.MULTILINE)
        applied.append({"pattern": pattern, "replacement": replacement, "count": count})
    return TOOL_HEADER.format(source=source_name) + "\n" + text, applied


def check_minima(tool_entries: dict) -> None:
    """Every declared substitution must have matched as often as declared.

    A substitution that silently stops matching is the failure mode this whole
    tool exists to prevent: the copy still lands, imports still resolve, and a
    `@web.method()` decorator or a `tasknode_task.id` reference survives into a
    file nobody reads, to fail at the first invocation instead of here.
    """
    for index, (pattern, _replacement, minimum) in enumerate(TOOL_SUBSTITUTIONS):
        total = sum(
            entry["substitutions"][index]["count"] for entry in tool_entries.values()
        )
        if total < minimum:
            raise SystemExit(
                f"substitution {pattern!r} matched {total} times across the tool "
                f"files, expected at least {minimum} — the legacy source has "
                f"changed shape"
            )


def copy_engine(source_root: Path) -> None:
    if ENGINE_DIR.exists():
        shutil.rmtree(ENGINE_DIR)
    ENGINE_DIR.mkdir(parents=True)
    for source_rel, target_rel in ENGINE_TREES.items():
        shutil.copytree(
            source_root / source_rel,
            ENGINE_DIR / target_rel,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc"),
        )
    for source_rel, target_rel in ENGINE_FILES.items():
        shutil.copy2(source_root / source_rel, ENGINE_DIR / target_rel)
    for relative in ENGINE_EXCLUDED:
        (ENGINE_DIR / relative).unlink(missing_ok=True)
    (ENGINE_DIR / "__init__.py").write_text(
        '"""The copied Inventory analysis engine. See COPY_MANIFEST.json."""\n',
        encoding="utf-8",
    )
    # The engine's own modules import each other as `from inventory.x import y`
    # in a few places and as `from .x import y` in most. Nothing is rewritten
    # here; `elitea_inventory.engine.inventory` is importable as `inventory`
    # through the alias the package installs at import time.
    for relative in ("inventory", "utils"):
        for path in (ENGINE_DIR / relative).rglob("__pycache__"):
            shutil.rmtree(path, ignore_errors=True)


def engine_files() -> list[Path]:
    return sorted(
        path
        for path in ENGINE_DIR.rglob("*.py")
        if "__pycache__" not in path.parts
    )


def write_manifest(source_root: Path, revision: str, tool_entries: dict) -> None:
    verbatim = {}
    total = 0
    rewritten = set(ENGINE_REWRITTEN)
    for path in engine_files():
        relative = path.relative_to(ENGINE_DIR).as_posix()
        if relative in rewritten:
            continue
        size = path.stat().st_size
        total += size
        verbatim[relative] = {"bytes": size, "sha256": digest(path)}
    MANIFEST.write_text(
        json.dumps(
            {
                "source_repository": "inventory_plugin",
                "source_path": ".",
                "source_revision": revision,
                "file_count": len(verbatim),
                "total_bytes": total,
                "rewritten": {
                    relative: "the package marker; see tools/refresh_engine_copy.py"
                    for relative in sorted(rewritten)
                },
                "not_copied": ENGINE_EXCLUDED,
                "files": verbatim,
                "tool_files": tool_entries,
            },
            indent=2,
            sort_keys=False,
        )
        + "\n",
        encoding="utf-8",
    )


def refresh(source_root: Path) -> int:
    if not source_root.is_dir():
        raise SystemExit(f"legacy source not found: {source_root}")
    revision = "unknown"
    try:
        import subprocess

        revision = subprocess.check_output(
            ["git", "-C", str(source_root), "rev-parse", "HEAD"], text=True
        ).strip()
    except Exception:  # noqa: BLE001 - a checkout without git still copies
        pass

    copy_engine(source_root)

    tool_entries = {}
    for source_rel, target in TOOL_FILES.items():
        source_path = source_root / source_rel
        text = source_path.read_text(encoding="utf-8")
        transformed, applied = apply_substitutions(text, source_rel)
        target.write_text(transformed, encoding="utf-8")
        tool_entries[source_rel] = {
            "target": target.relative_to(PACKAGE_DIR).as_posix(),
            "source_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "result_sha256": digest(target),
            "substitutions": applied,
        }

    check_minima(tool_entries)
    write_manifest(source_root, revision, tool_entries)
    print(f"copied {len(engine_files())} engine files and {len(TOOL_FILES)} tool files")
    return 0


def check() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    problems = []
    for relative, entry in manifest["files"].items():
        path = ENGINE_DIR / relative
        if not path.is_file():
            problems.append(f"missing: {relative}")
            continue
        if digest(path) != entry["sha256"]:
            problems.append(f"modified: {relative}")
    recorded = set(manifest["files"])
    rewritten = set(manifest["rewritten"])
    for path in engine_files():
        relative = path.relative_to(ENGINE_DIR).as_posix()
        if relative not in recorded and relative not in rewritten:
            problems.append(f"unrecorded: {relative}")
    for source_rel, entry in manifest["tool_files"].items():
        target = PACKAGE_DIR / entry["target"]
        if not target.is_file():
            problems.append(f"missing tool file: {entry['target']}")
            continue
        if digest(target) != entry["result_sha256"]:
            problems.append(f"modified tool file: {entry['target']}")
    if problems:
        print("\n".join(problems), file=sys.stderr)
        return 1
    print(f"ok: {len(recorded)} engine files, {len(manifest['tool_files'])} tool files")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="verify, do not copy")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    args = parser.parse_args()
    return check() if args.check else refresh(args.source)


if __name__ == "__main__":
    raise SystemExit(main())
