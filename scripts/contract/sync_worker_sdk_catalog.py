#!/usr/bin/env python3
"""Synchronize the Go-readable worker SDK configuration binding catalog."""

from __future__ import annotations

import argparse
import hashlib
import importlib
import json
import subprocess
import sys
import tomllib
from collections.abc import Mapping
from contextlib import redirect_stdout
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
    / "current_sdk_configuration_catalog_snapshot.json"
)
DEFAULT_CATALOG_EVIDENCE = (
    REPO_ROOT
    / "testdata"
    / "proto"
    / "runtime"
    / "v1"
    / "configuration-validation"
    / "configuration-catalog.json"
)
SCHEMA_VERSION = "elitea.worker-sdk-configuration-catalog.v1"


class ContractSyncError(RuntimeError):
    pass


def _canonical(value: object) -> bytes:
    encoded = json.dumps(
        value,
        allow_nan=False,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    )
    return encoded.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029").encode()


def _git_revision(sdk_root: Path) -> str:
    process = subprocess.run(
        ["git", "-C", str(sdk_root), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
    )
    if process.returncode != 0:
        raise ContractSyncError("SDK root is not a readable Git checkout")
    return process.stdout.strip()


def _require_complete_imports(module: Any) -> None:
    failed_imports = getattr(module, "FAILED_IMPORTS", None)
    if not isinstance(failed_imports, dict) or failed_imports:
        raise ContractSyncError("SDK configuration imports are incomplete")


def _metadata(registered_type: str, model: Any) -> tuple[str, str]:
    model_config = getattr(model, "model_config", None)
    extra = model_config.get("json_schema_extra") if isinstance(model_config, Mapping) else None
    metadata = extra.get("metadata") if isinstance(extra, Mapping) else None
    type_name = metadata.get("type") if isinstance(metadata, Mapping) else None
    section = metadata.get("section") if isinstance(metadata, Mapping) else None
    if type_name != registered_type or not isinstance(section, str) or not section:
        raise ContractSyncError("SDK configuration metadata is inconsistent")
    return type_name, section


def generate_documents(
    sdk_root: Path,
    lock_path: Path,
) -> tuple[dict[str, object], dict[str, object]]:
    lock = json.loads(lock_path.read_bytes())
    revision = _git_revision(sdk_root)
    if revision != lock.get("source", {}).get("revision"):
        raise ContractSyncError("SDK checkout does not match the worker lock")
    sdk_project = tomllib.loads((sdk_root / "pyproject.toml").read_text())
    if sdk_project.get("project", {}).get("version") != lock.get("distribution_version"):
        raise ContractSyncError("SDK distribution version does not match the worker lock")

    sys.path.insert(0, str(sdk_root))
    with redirect_stdout(sys.stderr):
        module = importlib.import_module("elitea_sdk.configurations")
    module_path = Path(module.__file__).resolve()
    try:
        module_path.relative_to(sdk_root.resolve())
    except ValueError as exc:
        raise ContractSyncError("SDK import did not resolve from the selected checkout") from exc
    _require_complete_imports(module)
    registry = module.get_class_configurations()
    if not isinstance(registry, Mapping) or not registry:
        raise ContractSyncError("SDK configuration registry is empty")

    catalog_entries: list[dict[str, object]] = []
    binding_entries: list[dict[str, object]] = []
    for registered_type, model in sorted(registry.items()):
        if not isinstance(registered_type, str) or not registered_type:
            raise ContractSyncError("SDK configuration type is invalid")
        type_name, section = _metadata(registered_type, model)
        schema = model.model_json_schema()
        if not isinstance(schema, dict):
            raise ContractSyncError("SDK configuration schema is not an object")
        schema_digest = hashlib.sha256(_canonical(schema)).hexdigest()
        validation_supported = callable(getattr(model, "model_validate", None))
        connection_check_supported = callable(getattr(model, "check_connection", None))
        catalog_entries.append(
            {
                "connection_check_supported": connection_check_supported,
                "schema": schema,
                "section": section,
                "type": type_name,
                "validation_supported": validation_supported,
            }
        )
        binding_entries.append(
            {
                "configuration_type": type_name,
                "section": section,
                "schema_id": f"elitea.configuration.{type_name}",
                "schema_revision": revision,
                "schema_digest": f"sha256:{schema_digest}",
                "validation_supported": validation_supported,
                "connection_check_supported": connection_check_supported,
            }
        )

    canonical_catalog = {"entries": catalog_entries}
    catalog_digest = hashlib.sha256(_canonical(canonical_catalog)).hexdigest()
    binding_catalog = {
        "schema_version": SCHEMA_VERSION,
        "sdk_revision": revision,
        "catalog_revision": revision,
        "catalog_digest": f"sha256:{catalog_digest}",
        "complete": True,
        "entry_count": len(binding_entries),
        "entries": binding_entries,
    }
    return binding_catalog, canonical_catalog


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--sdk-root", type=Path, default=DEFAULT_SDK_ROOT)
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument(
        "--catalog-evidence",
        type=Path,
        default=DEFAULT_CATALOG_EVIDENCE,
    )
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        document, canonical_catalog = generate_documents(
            args.sdk_root.resolve(), args.lock.resolve()
        )
        encoded = _canonical(document) + b"\n"
        catalog_encoded = _canonical(canonical_catalog)
        if args.check:
            if not args.snapshot.is_file() or args.snapshot.read_bytes() != encoded:
                raise ContractSyncError("worker SDK catalog snapshot is stale")
            if (
                not args.catalog_evidence.is_file()
                or args.catalog_evidence.read_bytes() != catalog_encoded
            ):
                raise ContractSyncError("worker SDK canonical catalog evidence is stale")
            print(f"worker SDK catalog is current ({document['entry_count']} entries)")
            return 0
        args.snapshot.parent.mkdir(parents=True, exist_ok=True)
        args.snapshot.write_bytes(encoded)
        args.catalog_evidence.parent.mkdir(parents=True, exist_ok=True)
        args.catalog_evidence.write_bytes(catalog_encoded)
        print(f"updated {args.snapshot} ({document['entry_count']} entries)")
        return 0
    except (ContractSyncError, OSError, ValueError, TypeError) as exc:
        print(f"worker SDK catalog sync failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
