#!/usr/bin/env python3
"""Re-copy the engine from the legacy checkout and record its digests.

The engine under ``src/elitea_deepwiki/engine/`` is a plain copy of
``deepwiki_plugin/plugin_implementation/``. This tool performs that copy and
writes ``COPY_MANIFEST.json`` beside it, which
``tests/engine/test_copy_is_verbatim.py`` then enforces.

Two modes:

    python tools/refresh_engine_copy.py            re-copy and rewrite the manifest
    python tools/refresh_engine_copy.py --check    verify the copy against the manifest

``--check`` needs no legacy checkout — it hashes what is committed here — so it
is what CI runs. The default mode needs the legacy tree and is how a deliberate
re-sync is performed.

``__init__.py`` is never copied: the legacy one was empty and ours installs the
``plugin_implementation`` compatibility alias. It is excluded from the manifest
for the same reason.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path

SERVICE_ROOT = Path(__file__).resolve().parents[1]
ENGINE_DIR = SERVICE_ROOT / "src" / "elitea_deepwiki" / "engine"
MANIFEST = ENGINE_DIR / "COPY_MANIFEST.json"

#: Owned by this repository, not copied. These are RELATIVE PATHS, not bare
#: names: the engine has eight subpackage ``__init__.py`` files that ARE part
#: of the copy, and matching on the name alone would silently drop every one of
#: them from the manifest — leaving them unguarded while the count still looked
#: plausible.
NOT_COPIED = {"__init__.py", "COPY_MANIFEST.json"}

LEGACY_ENV_VAR = "DEEPWIKI_LEGACY_ROOT"
_DEFAULT_CANDIDATES = (
    "projects/eliteaai/legacy/plugins/deepwiki_plugin",
    "eliteaai/legacy/plugins/deepwiki_plugin",
)


def legacy_root() -> Path:
    import os

    override = os.environ.get(LEGACY_ENV_VAR)
    if override:
        path = Path(override).expanduser().resolve()
        if (path / "plugin_implementation").is_dir():
            return path
        raise SystemExit(f"{LEGACY_ENV_VAR}={path} is not a deepwiki_plugin checkout")

    for candidate in _DEFAULT_CANDIDATES:
        path = (Path.home() / candidate).resolve()
        if (path / "plugin_implementation").is_dir():
            return path

    raise SystemExit(
        f"deepwiki_plugin checkout not found; set {LEGACY_ENV_VAR} "
        "(read-only access is enough)"
    )


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def copied_files() -> list[Path]:
    """Every file the manifest covers, relative to the engine directory."""
    return sorted(
        path
        for path in ENGINE_DIR.rglob("*")
        if path.is_file()
        and "__pycache__" not in path.parts
        and path.relative_to(ENGINE_DIR).as_posix() not in NOT_COPIED
    )


def build_manifest(revision: str | None) -> dict:
    entries = {}
    for path in copied_files():
        relative = path.relative_to(ENGINE_DIR).as_posix()
        entries[relative] = {"bytes": path.stat().st_size, "sha256": sha256(path)}
    return {
        "source_repository": "deepwiki_plugin",
        "source_path": "plugin_implementation",
        "source_revision": revision,
        "file_count": len(entries),
        "total_bytes": sum(entry["bytes"] for entry in entries.values()),
        "not_copied": sorted(NOT_COPIED),
        "files": entries,
    }


def do_copy() -> str | None:
    root = legacy_root()
    source = root / "plugin_implementation"

    try:
        revision = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        revision = None

    keep = {}
    for name in NOT_COPIED:
        path = ENGINE_DIR / name
        if path.is_file():
            keep[name] = path.read_bytes()

    if ENGINE_DIR.exists():
        shutil.rmtree(ENGINE_DIR)
    shutil.copytree(
        source, ENGINE_DIR, ignore=shutil.ignore_patterns("__pycache__", "*.pyc")
    )

    for name in NOT_COPIED:
        target = ENGINE_DIR / name
        if name in keep:
            target.write_bytes(keep[name])
        elif target.is_file():
            target.unlink()

    return revision


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the committed copy against the manifest (no legacy checkout needed)",
    )
    args = parser.parse_args()

    if args.check:
        if not MANIFEST.is_file():
            print(f"{MANIFEST} is missing", file=sys.stderr)
            return 1
        manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
        current = build_manifest(manifest.get("source_revision"))

        if current["files"] == manifest["files"]:
            print(f"engine copy is verbatim ({current['file_count']} files)")
            return 0

        expected = set(manifest["files"])
        present = set(current["files"])
        for name in sorted(present - expected):
            print(f"  extra:    {name}", file=sys.stderr)
        for name in sorted(expected - present):
            print(f"  missing:  {name}", file=sys.stderr)
        for name in sorted(expected & present):
            if manifest["files"][name] != current["files"][name]:
                print(f"  modified: {name}", file=sys.stderr)
        return 1

    revision = do_copy()
    manifest = build_manifest(revision)
    MANIFEST.write_text(
        json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(
        f"copied {manifest['file_count']} files "
        f"({manifest['total_bytes']} bytes) from {revision}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
