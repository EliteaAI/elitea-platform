#!/usr/bin/env python3
"""Synchronize Main's built-in toolkit settings projection from the worker SDK.

The current indexer publishes ``elitea_sdk.runtime.toolkits.tools.get_toolkits``
schemas to Main. Main consumes only the top-level annotations used to expand
configuration references and derive a stable toolkit name. This script runs
that exact SDK registry from the source revision admitted by the worker lock
and emits only those consumed annotations.

Deployment-defined MCP servers are intentionally excluded from this immutable
built-in snapshot. They remain actor/project-visible dynamic schemas in Main.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import logging
import subprocess
import sys
import tomllib
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SDK_ROOT = REPO_ROOT.parent / "elitea-sdk"
DEFAULT_LOCK = REPO_ROOT / "services" / "elitea-worker-python" / "elitea-sdk.lock.json"
DEFAULT_SNAPSHOT = (
    REPO_ROOT
    / "services"
    / "elitea-main"
    / "internal"
    / "runtimecomposition"
    / "current_toolkit_schema_snapshot.json"
)
SCHEMA_VERSION = "elitea.current-toolkit-schema-snapshot.v1"
ANNOTATION_FIELDS = (
    "configuration_types",
    "configuration_model",
    "secret",
    "toolkit_name",
)
MAX_TOOLKIT_NAME_LENGTH = 4096


class ContractSyncError(RuntimeError):
    """The admitted SDK or its projected registry is incomplete or ambiguous."""


def _canonical(value: object) -> bytes:
    return (
        json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        ).encode()
        + b"\n"
    )


def _git(sdk_root: Path, *arguments: str, binary: bool = False) -> bytes | str:
    process = subprocess.run(
        ["git", "-C", str(sdk_root), *arguments],
        check=False,
        capture_output=True,
        text=not binary,
    )
    if process.returncode != 0:
        raise ContractSyncError("SDK Git source is unavailable")
    return process.stdout if binary else process.stdout.strip()


def _package_tree_digest(package_root: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    paths = sorted(
        path for path in package_root.rglob("*.py") if path.is_file()
    )
    for path in paths:
        relative = path.relative_to(package_root).as_posix().encode()
        content = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return len(paths), digest.hexdigest()


def _require_locked_patch_paths(
    sdk_root: Path,
    patch_revisions: object,
) -> None:
    if not isinstance(patch_revisions, list) or any(
        not isinstance(revision, str) or len(revision) != 40
        for revision in patch_revisions
    ):
        raise ContractSyncError("worker SDK patch lock is invalid")

    expected: set[str] = set()
    for revision in patch_revisions:
        paths = _git(
            sdk_root,
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
            revision,
            "--",
            "elitea_sdk",
            "pyproject.toml",
        )
        expected.update(path for path in paths.splitlines() if path)

    actual = _git(
        sdk_root,
        "diff",
        "--name-only",
        "HEAD",
        "--",
        "elitea_sdk",
        "pyproject.toml",
    )
    if {path for path in actual.splitlines() if path} != expected:
        raise ContractSyncError("SDK source changes do not match the worker patch lock")


def _require_sdk_identity(sdk_root: Path, lock_path: Path) -> dict[str, Any]:
    try:
        lock = json.loads(lock_path.read_bytes())
        revision = lock["source"]["revision"]
        version = lock["distribution_version"]
        archive_digest = lock["source"]["git_archive_sha256"]
        patch_revisions = lock["source"].get("patch_revisions", [])
        tree = lock["installed_package_tree"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ContractSyncError("worker SDK lock is invalid") from exc

    if _git(sdk_root, "rev-parse", "HEAD") != revision:
        raise ContractSyncError("SDK checkout does not match the worker lock")
    _require_locked_patch_paths(sdk_root, patch_revisions)

    try:
        project = tomllib.loads((sdk_root / "pyproject.toml").read_text())
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise ContractSyncError("SDK project metadata is invalid") from exc
    if project.get("project", {}).get("version") != version:
        raise ContractSyncError("SDK distribution version does not match the worker lock")

    archive = _git(sdk_root, "archive", "--format=tar", "HEAD", binary=True)
    if not isinstance(archive, bytes) or hashlib.sha256(archive).hexdigest() != archive_digest:
        raise ContractSyncError("SDK source archive does not match the worker lock")
    count, digest = _package_tree_digest(sdk_root / "elitea_sdk")
    if count != tree.get("file_count") or digest != tree.get("sha256"):
        raise ContractSyncError("SDK Python package tree does not match the worker lock")
    return lock


def _annotation_projection(
    properties: Mapping[str, Any],
) -> tuple[dict[str, dict[str, Any]], dict[str, Any]]:
    projected: dict[str, dict[str, Any]] = {}
    name_field: str | None = None
    max_length = 0
    for field, raw_schema in properties.items():
        if not isinstance(field, str) or not field or not isinstance(raw_schema, Mapping):
            raise ContractSyncError("toolkit schema contains an invalid property")
        annotations = {
            key: raw_schema[key]
            for key in ANNOTATION_FIELDS
            if key in raw_schema
        }
        if annotations:
            projected[field] = annotations
        if raw_schema.get("toolkit_name") is True and name_field is None:
            name_field = field
        if raw_schema.get("max_toolkit_length") and max_length == 0:
            try:
                max_length = int(raw_schema["max_toolkit_length"])
            except (TypeError, ValueError) as exc:
                raise ContractSyncError("toolkit name limit is invalid") from exc
            if not 0 < max_length <= MAX_TOOLKIT_NAME_LENGTH:
                raise ContractSyncError("toolkit name limit is outside the supported range")
    return projected, {"field": name_field, "max_length": max_length}


def project_toolkit_schemas(
    models: Iterable[Any],
    revision: str,
) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    for model in models:
        schema_method = getattr(model, "model_json_schema", None)
        if not callable(schema_method):
            schema_method = getattr(model, "schema", None)
        if not callable(schema_method):
            raise ContractSyncError("toolkit registry contains an invalid model")
        schema = schema_method()
        if not isinstance(schema, Mapping):
            raise ContractSyncError("toolkit model produced a non-object schema")
        type_name = schema.get("title")
        properties = schema.get("properties")
        if (
            not isinstance(type_name, str)
            or not type_name
            or type_name in seen
            or not isinstance(properties, Mapping)
        ):
            raise ContractSyncError("toolkit schema has an invalid or duplicate type")
        seen.add(type_name)
        projected, naming = _annotation_projection(properties)
        entries.append(
            {
                "type": type_name,
                "properties": projected,
                "naming": naming,
            }
        )
    if not entries:
        raise ContractSyncError("toolkit registry is empty")
    entries.sort(key=lambda entry: entry["type"])
    return {
        "schema_version": SCHEMA_VERSION,
        "sdk_revision": revision,
        "entries": entries,
    }


def generate_document(sdk_root: Path, lock_path: Path) -> dict[str, Any]:
    lock = _require_sdk_identity(sdk_root, lock_path)

    sys.path.insert(0, str(sdk_root))
    logging.getLogger("elitea_sdk.tools").setLevel(logging.ERROR)
    try:
        module = importlib.import_module("elitea_sdk.runtime.toolkits.tools")
        module_path = Path(module.__file__ or "").resolve()
        try:
            module_path.relative_to(sdk_root.resolve())
        except ValueError as exc:
            raise ContractSyncError("SDK import resolved outside the selected checkout") from exc
        dynamic_mcp_loader = module.get_mcp_config_toolkit_schemas
        module.get_mcp_config_toolkit_schemas = lambda: []
        try:
            models = module.get_toolkits()
        finally:
            module.get_mcp_config_toolkit_schemas = dynamic_mcp_loader
        failed_imports = getattr(importlib.import_module("elitea_sdk.tools"), "FAILED_IMPORTS", {})
        unexpected_failures = set(failed_imports) - {"inventory"}
        if unexpected_failures:
            raise ContractSyncError(
                "SDK toolkit imports failed: " + ", ".join(sorted(unexpected_failures))
            )
        return project_toolkit_schemas(models, lock["source"]["revision"])
    finally:
        sys.path.pop(0)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk-root", type=Path, default=DEFAULT_SDK_ROOT)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        document = generate_document(args.sdk_root.resolve(), args.lock.resolve())
        encoded = _canonical(document)
        if args.check:
            if not args.snapshot.is_file() or args.snapshot.read_bytes() != encoded:
                raise ContractSyncError("current toolkit schema snapshot is stale")
            print(
                "current toolkit schema snapshot is current "
                f"({len(document['entries'])} entries)"
            )
            return 0
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_bytes(encoded)
        print(
            f"updated {args.snapshot} "
            f"({len(document['entries'])} entries)"
        )
        return 0
    except (ContractSyncError, OSError, TypeError, ValueError) as exc:
        print(f"current toolkit schema sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
