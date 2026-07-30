#!/usr/bin/env python3
"""Synchronize the Go-readable current index-types snapshot.

The current Pylon endpoint is populated by
``indexer_worker.methods.indexer_file_loaders.file_loaders_request``. That
producer projects exactly three SDK constants:

* ``document_loaders_map`` -> ``document_types``
* ``image_loaders_map`` -> ``image_types``
* ``code_extensions`` -> ``code_types`` with ``text/plain``

This script reads those constants from the exact SDK revision admitted by the
Python worker lock. It deliberately does not import the SDK or duplicate a
partial extension list.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SDK_ROOT = REPO_ROOT.parent / "elitea-sdk"
DEFAULT_LOCK = REPO_ROOT / "services" / "elitea-worker-python" / "elitea-sdk.lock.json"
DEFAULT_SNAPSHOT = (
    REPO_ROOT
    / "services"
    / "elitea-main"
    / "internal"
    / "runtimecomposition"
    / "current_index_types_snapshot.json"
)
DEFAULT_UI_FIXTURE = (
    REPO_ROOT
    / "services"
    / "elitea-main"
    / "internal"
    / "api"
    / "v2"
    / "indextypes"
    / "testdata"
    / "current_index_types_ui_response.json"
)
SDK_CONSTANTS_PATH = "elitea_sdk/runtime/langchain/document_loaders/constants.py"
SCHEMA_VERSION = "elitea.current-index-types-snapshot.v1"
REVISION_PATTERN = re.compile(r"^[0-9a-f]{40}$")


class ContractSyncError(RuntimeError):
    pass


def _canonical(value: object) -> bytes:
    return json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode()


def _git_file_at_revision(sdk_root: Path, revision: str, path: str) -> bytes:
    if not REVISION_PATTERN.fullmatch(revision):
        raise ContractSyncError("worker lock contains an invalid SDK revision")
    process = subprocess.run(
        ["git", "-C", str(sdk_root), "show", f"{revision}:{path}"],
        check=False,
        capture_output=True,
    )
    if process.returncode != 0:
        raise ContractSyncError("pinned SDK source is unavailable")
    return process.stdout


def _assignments(source: bytes) -> dict[str, ast.expr]:
    try:
        tree = ast.parse(source, filename=SDK_CONSTANTS_PATH)
    except (SyntaxError, ValueError) as exc:
        raise ContractSyncError("SDK loader constants are not valid Python") from exc

    result: dict[str, ast.expr] = {}
    for statement in tree.body:
        if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
            continue
        target = statement.targets[0]
        if isinstance(target, ast.Name):
            if target.id in result:
                raise ContractSyncError(f"duplicate SDK assignment {target.id}")
            result[target.id] = statement.value
    return result


def _literal_string(node: ast.AST, field: str) -> str:
    try:
        value = ast.literal_eval(node)
    except (ValueError, TypeError, SyntaxError) as exc:
        raise ContractSyncError(f"{field} is not a literal string") from exc
    if not isinstance(value, str) or not value:
        raise ContractSyncError(f"{field} is not a non-empty string")
    return value


def _loader_mime_types(assignments: dict[str, ast.expr], name: str) -> dict[str, str]:
    node = assignments.get(name)
    if not isinstance(node, ast.Dict):
        raise ContractSyncError(f"SDK {name} is not a literal mapping")

    result: dict[str, str] = {}
    for key_node, config_node in zip(node.keys, node.values, strict=True):
        if key_node is None or not isinstance(config_node, ast.Dict):
            raise ContractSyncError(f"SDK {name} contains a non-literal loader")
        extension = _literal_string(key_node, f"{name} extension")
        mime_type: str | None = None
        for field_node, value_node in zip(
            config_node.keys, config_node.values, strict=True
        ):
            if field_node is None:
                continue
            field = _literal_string(field_node, f"{name} loader field")
            if field == "mime_type":
                if mime_type is not None:
                    raise ContractSyncError(
                        f"SDK {name} repeats mime_type for {extension}"
                    )
                mime_type = _literal_string(value_node, f"{name} mime_type")
        if mime_type is None:
            raise ContractSyncError(f"SDK {name} omits mime_type for {extension}")
        if extension in result:
            raise ContractSyncError(f"SDK {name} repeats extension {extension}")
        result[extension] = mime_type
    if not result:
        raise ContractSyncError(f"SDK {name} is empty")
    return dict(sorted(result.items()))


def _code_mime_types(assignments: dict[str, ast.expr]) -> dict[str, str]:
    node = assignments.get("code_extensions")
    if not isinstance(node, (ast.List, ast.Tuple)):
        raise ContractSyncError("SDK code_extensions is not a literal sequence")

    result: dict[str, str] = {}
    for item in node.elts:
        extension = _literal_string(item, "code extension")
        if extension in result:
            raise ContractSyncError(f"SDK repeats code extension {extension}")
        result[extension] = "text/plain"
    if not result:
        raise ContractSyncError("SDK code_extensions is empty")
    return dict(sorted(result.items()))


def generate_documents(
    sdk_root: Path,
    lock_path: Path,
) -> tuple[dict[str, object], dict[str, dict[str, str]]]:
    try:
        lock = json.loads(lock_path.read_bytes())
        revision = lock["source"]["revision"]
    except (OSError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise ContractSyncError("worker SDK lock is invalid") from exc
    if not isinstance(revision, str):
        raise ContractSyncError("worker SDK lock revision is invalid")

    source = _git_file_at_revision(sdk_root, revision, SDK_CONSTANTS_PATH)
    assignments = _assignments(source)
    response = {
        "document_types": _loader_mime_types(
            assignments, "document_loaders_map"
        ),
        "image_types": _loader_mime_types(assignments, "image_loaders_map"),
        "code_types": _code_mime_types(assignments),
    }
    entry_count = sum(len(category) for category in response.values())
    snapshot = {
        "schema_version": SCHEMA_VERSION,
        "sdk_revision": revision,
        "source_path": SDK_CONSTANTS_PATH,
        "source_digest": f"sha256:{hashlib.sha256(source).hexdigest()}",
        "snapshot_digest": f"sha256:{hashlib.sha256(_canonical(response)).hexdigest()}",
        "complete": True,
        "category_count": len(response),
        "entry_count": entry_count,
        "categories": response,
    }
    return snapshot, response


def _ui_response(response: dict[str, dict[str, str]]) -> bytes:
    # Preserve the current producer's outer insertion order. Inner maps are
    # sorted by the extraction functions for deterministic tracked evidence.
    return (
        json.dumps(
            response,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=False,
        ).encode()
        + b"\n"
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-root", type=Path, default=DEFAULT_SDK_ROOT)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--ui-fixture", type=Path, default=DEFAULT_UI_FIXTURE)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    try:
        snapshot, response = generate_documents(
            args.sdk_root.resolve(), args.lock.resolve()
        )
        snapshot_bytes = _canonical(snapshot) + b"\n"
        ui_bytes = _ui_response(response)
        if args.check:
            if (
                not args.snapshot.is_file()
                or args.snapshot.read_bytes() != snapshot_bytes
            ):
                raise ContractSyncError("current index-types snapshot is stale")
            if (
                not args.ui_fixture.is_file()
                or args.ui_fixture.read_bytes() != ui_bytes
            ):
                raise ContractSyncError("current index-types UI fixture is stale")
            print(
                "current index-types snapshot is current "
                f"({snapshot['entry_count']} category entries)"
            )
            return 0

        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_bytes(snapshot_bytes)
        args.ui_fixture.parent.mkdir(parents=True, exist_ok=True)
        args.ui_fixture.write_bytes(ui_bytes)
        print(
            f"updated {args.snapshot} "
            f"({snapshot['entry_count']} category entries)"
        )
        return 0
    except (ContractSyncError, OSError, TypeError, ValueError) as exc:
        print(f"current index-types sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
