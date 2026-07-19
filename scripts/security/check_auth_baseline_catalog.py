#!/usr/bin/env python3
"""Validate the checked-in pylon_auth current-baseline snapshot integrity."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any


EXPECTED_PLUGINS = frozenset(
    {
        "auth_core",
        "auth_form",
        "auth_idp_rpc",
        "auth_init",
        "auth_mappers",
        "auth_oidc",
        "auth_saml",
        "bootstrap",
        "tracing",
    }
)
EXPECTED_DECLARATIONS = {
    "event": 1,
    "http_route": 15,
    "method": 40,
    "rpc": 101,
}
EXPECTED_AUTH_CORE_RPCS = 95
EXPECTED_SCHEMA_VERSION = 2
EXPECTED_LITERAL_PERMISSIONS = [
    "models.admin.audit_trail.view",
    "models.admin.tracing.view",
    "models.monitoring.tracing.collect",
    "models.monitoring.tracing.view",
]
EXPECTED_RUNTIME_FILES = [
    "configs/auth_core.yml",
    "configs/auth_form.yml",
    "configs/auth_init.yml",
    "configs/auth_oidc.yml",
    "configs/bootstrap.yml",
    "configs/tracing.yml",
    "pylon.yml",
]
EXPECTED_PLUGIN_HEADS = {
    "auth_core": "fcc4c7a35fe095fb8d67e72451e3a4f9b497f871",
    "auth_form": "376de1eb90a13a5d1b0e660940a75775158666ca",
    "auth_idp_rpc": "68441d9fd94d0e45ad35955a38ea569a7b597f1e",
    "auth_init": "f3e47ea0d3e64dc23d96e5475032e03dee256ab4",
    "auth_mappers": "5a6934d4f9a6953e926e47a05192d7268a5e5a96",
    "auth_oidc": "902a5c413e994e9a7ee5f27a46c255bde323a59b",
    "auth_saml": "636009c0c1cf61ec0ad9a84d08934e6ecf07583f",
    "bootstrap": "a8cdbd31a90544fda9d2b96e3f936bba3594a22d",
    "tracing": "0b3b6783d3c3b2e6fa9c6feb6fc8e14d072ee118",
}
EXPECTED_PLUGIN_DIRTY_PATHS = {
    plugin: ([] if plugin == "bootstrap" else ["metadata.json"])
    for plugin in EXPECTED_PLUGINS
}
EXPECTED_RUNTIME_HEAD = "6b3e59f7f41e41c9d5f1dcf7ca6e870d7391986c"
EXPECTED_RUNTIME_DIRTY_PATHS = ["pylon.yml"]
EXPECTED_SUMMARY = {
    "configuration_reads": 225,
    "configuration_reads_by_root": {
        "environment": 2,
        "plugin_config": 220,
        "runtime_settings": 3,
    },
    "declarations_by_kind": EXPECTED_DECLARATIONS,
    "dynamic_declarations": 0,
    "emitted_events": 3,
    "http_handler_methods": 4,
    "literal_permissions": 4,
    "migrations": 9,
    "migrations_by_format": {"python_alembic": 7, "sql": 2},
    "missing_plugin_evidence_files": 0,
    "parse_errors": 0,
    "permission_guards": 4,
    "permission_registrations": 1,
    "plugin_evidence_files": 195,
    "plugins": 9,
    "runtime_evidence_files": 7,
    "runtime_registrations": 19,
    "runtime_untracked_evidence_files": 0,
    "unguarded_http_handler_methods": 0,
}
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
GIT_HEAD_RE = re.compile(r"^(?:[0-9a-f]{40}|[0-9a-f]{64})$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("testdata/baseline/auth-static-catalog.json"),
    )
    return parser.parse_args()


def _records(
    catalog: dict[str, Any],
    key: str,
    failures: dict[str, object],
) -> list[dict[str, Any]]:
    value = catalog.get(key)
    if not isinstance(value, list):
        failures[f"{key}_shape"] = "expected list"
        return []
    invalid = [index for index, item in enumerate(value) if not isinstance(item, dict)]
    if invalid:
        failures[f"{key}_record_shape"] = invalid
    return [item for item in value if isinstance(item, dict)]


def _mapping(
    catalog: dict[str, Any],
    key: str,
    failures: dict[str, object],
) -> dict[str, Any]:
    value = catalog.get(key)
    if not isinstance(value, dict):
        failures[f"{key}_shape"] = "expected object"
        return {}
    return value


def _relative_path(value: Any) -> bool:
    if not isinstance(value, str) or not value or "\\" in value:
        return False
    path = PurePosixPath(value)
    return not path.is_absolute() and ".." not in path.parts


def _plugin_record_paths_valid(
    records: list[dict[str, Any]],
) -> list[int]:
    invalid: list[int] = []
    for index, record in enumerate(records):
        plugin = record.get("plugin")
        source = record.get("source")
        if (
            plugin not in EXPECTED_PLUGINS
            or not _relative_path(source)
            or not source.startswith(f"{plugin}/")
        ):
            invalid.append(index)
    return invalid


def _dynamic_declaration(record: dict[str, Any]) -> bool:
    arguments = record.get("arguments")
    keywords = record.get("keywords")
    if not isinstance(arguments, list) or not isinstance(keywords, dict):
        return True
    return any(
        not isinstance(argument, dict) or not argument.get("literal", False)
        for argument in arguments
    ) or any(
        not isinstance(value, dict) or not value.get("literal", False)
        for value in keywords.values()
    )


def _permissions(records: list[dict[str, Any]]) -> tuple[list[str], list[int]]:
    values: set[str] = set()
    invalid: list[int] = []
    for index, record in enumerate(records):
        permissions = record.get("permissions")
        if not isinstance(permissions, list) or any(
            not isinstance(permission, str) for permission in permissions
        ):
            invalid.append(index)
            continue
        values.update(permissions)
    return sorted(values), invalid


def _plugin_summaries(
    plugins: set[str],
    *,
    configuration_reads: list[dict[str, Any]],
    declarations: list[dict[str, Any]],
    emitted_events: list[dict[str, Any]],
    http_handlers: list[dict[str, Any]],
    migrations: list[dict[str, Any]],
    permission_guards: list[dict[str, Any]],
    permission_registrations: list[dict[str, Any]],
    plugin_files: dict[str, Any],
    runtime_registrations: list[dict[str, Any]],
) -> dict[str, dict[str, int]]:
    result: dict[str, dict[str, int]] = {}
    for plugin in sorted(plugins):
        counts = Counter(
            item.get("kind")
            for item in declarations
            if item.get("plugin") == plugin
        )
        result[plugin] = {
            "configuration_reads": sum(
                item.get("plugin") == plugin for item in configuration_reads
            ),
            "emitted_events": sum(
                item.get("plugin") == plugin for item in emitted_events
            ),
            "event_declarations": counts["event"],
            "http_handler_methods": sum(
                item.get("plugin") == plugin for item in http_handlers
            ),
            "http_route_declarations": counts["http_route"],
            "method_declarations": counts["method"],
            "migrations": sum(item.get("plugin") == plugin for item in migrations),
            "permission_guards": sum(
                item.get("plugin") == plugin for item in permission_guards
            ),
            "permission_registrations": sum(
                item.get("plugin") == plugin for item in permission_registrations
            ),
            "plugin_evidence_files": sum(
                source.startswith(f"{plugin}/") for source in plugin_files
            ),
            "rpc_declarations": counts["rpc"],
            "runtime_registrations": sum(
                item.get("plugin") == plugin for item in runtime_registrations
            ),
            "socket_io_declarations": counts["socket_io"],
        }
    return result


def check_catalog(catalog: dict[str, Any]) -> dict[str, object]:
    failures: dict[str, object] = {}

    configuration_reads = _records(catalog, "configuration_reads", failures)
    declarations = _records(catalog, "declarations", failures)
    emitted_events = _records(catalog, "emitted_events", failures)
    http_handlers = _records(catalog, "http_handlers", failures)
    migrations = _records(catalog, "migrations", failures)
    missing_plugin_files = _records(
        catalog, "missing_plugin_evidence_files", failures
    )
    parse_errors = _records(catalog, "parse_errors", failures)
    permission_guards = _records(catalog, "permission_guards", failures)
    permission_registrations = _records(
        catalog, "permission_registrations", failures
    )
    runtime_files = _records(catalog, "runtime_evidence_files", failures)
    runtime_registrations = _records(catalog, "runtime_registrations", failures)
    unguarded_handlers = _records(catalog, "unguarded_http_handlers", failures)

    plugin_files = _mapping(catalog, "plugin_evidence_files_sha256", failures)
    discovery = _mapping(catalog, "plugin_file_discovery", failures)
    plugin_provenance = _mapping(catalog, "plugin_git_provenance", failures)
    plugin_metadata = _mapping(catalog, "plugin_metadata", failures)
    plugin_summaries = _mapping(catalog, "plugin_summaries", failures)
    runtime_provenance = _mapping(catalog, "runtime_git_provenance", failures)
    summary = _mapping(catalog, "summary", failures)

    if catalog.get("schema_version") != EXPECTED_SCHEMA_VERSION:
        failures["schema_version"] = {
            "actual": catalog.get("schema_version"),
            "expected": EXPECTED_SCHEMA_VERSION,
        }

    plugins = set(plugin_metadata)
    if plugins != EXPECTED_PLUGINS:
        failures["plugins"] = {
            "actual": sorted(plugins),
            "expected": sorted(EXPECTED_PLUGINS),
        }

    plugin_scoped = {
        "configuration_reads": configuration_reads,
        "declarations": declarations,
        "emitted_events": emitted_events,
        "http_handlers": http_handlers,
        "migrations": migrations,
        "missing_plugin_evidence_files": missing_plugin_files,
        "parse_errors": parse_errors,
        "permission_guards": permission_guards,
        "permission_registrations": permission_registrations,
        "runtime_registrations": runtime_registrations,
    }
    for key, records in plugin_scoped.items():
        invalid = _plugin_record_paths_valid(records)
        if invalid:
            failures[f"{key}_plugin_paths"] = invalid

    declaration_counts = dict(
        sorted(
            Counter(
                item.get("kind")
                if isinstance(item.get("kind"), str)
                else "<invalid>"
                for item in declarations
            ).items()
        )
    )
    migration_counts = dict(
        sorted(
            Counter(
                item.get("format")
                if isinstance(item.get("format"), str)
                else "<invalid>"
                for item in migrations
            ).items()
        )
    )
    configuration_counts = dict(
        sorted(
            Counter(
                item.get("root")
                if isinstance(item.get("root"), str)
                else "<invalid>"
                for item in configuration_reads
            ).items()
        )
    )
    literal_permissions, invalid_permission_records = _permissions(
        [*permission_guards, *permission_registrations]
    )
    if invalid_permission_records:
        failures["permission_record_shape"] = invalid_permission_records
    derived_unguarded_handlers = [
        handler for handler in http_handlers if not handler.get("guarded", False)
    ]
    actual_summary = {
        "configuration_reads": len(configuration_reads),
        "configuration_reads_by_root": configuration_counts,
        "declarations_by_kind": declaration_counts,
        "dynamic_declarations": sum(
            _dynamic_declaration(item) for item in declarations
        ),
        "emitted_events": len(emitted_events),
        "http_handler_methods": len(http_handlers),
        "literal_permissions": len(literal_permissions),
        "migrations": len(migrations),
        "migrations_by_format": migration_counts,
        "missing_plugin_evidence_files": len(missing_plugin_files),
        "parse_errors": len(parse_errors),
        "permission_guards": len(permission_guards),
        "permission_registrations": len(permission_registrations),
        "plugin_evidence_files": len(plugin_files),
        "plugins": len(plugin_metadata),
        "runtime_evidence_files": len(runtime_files),
        "runtime_registrations": len(runtime_registrations),
        "runtime_untracked_evidence_files": sum(
            item.get("tracked") is not True for item in runtime_files
        ),
        "unguarded_http_handler_methods": len(derived_unguarded_handlers),
    }
    if summary != actual_summary:
        failures["summary_reconciliation"] = {
            "actual_collections": actual_summary,
            "declared": summary,
        }
    if summary != EXPECTED_SUMMARY:
        failures["summary"] = {"actual": summary, "expected": EXPECTED_SUMMARY}

    if catalog.get("literal_permissions") != literal_permissions:
        failures["literal_permissions_reconciliation"] = {
            "actual_records": literal_permissions,
            "declared": catalog.get("literal_permissions"),
        }
    if literal_permissions != EXPECTED_LITERAL_PERMISSIONS:
        failures["literal_permissions"] = {
            "actual": literal_permissions,
            "expected": EXPECTED_LITERAL_PERMISSIONS,
        }
    if catalog.get("unguarded_http_handlers") != derived_unguarded_handlers:
        failures["unguarded_http_handlers_reconciliation"] = True

    invalid_plugin_hashes = sorted(
        source
        for source, digest in plugin_files.items()
        if not _relative_path(source)
        or len(PurePosixPath(source).parts) < 2
        or PurePosixPath(source).parts[0] not in EXPECTED_PLUGINS
        or not isinstance(digest, str)
        or SHA256_RE.fullmatch(digest) is None
    )
    if invalid_plugin_hashes:
        failures["plugin_evidence_hashes"] = invalid_plugin_hashes

    runtime_paths = [
        item["path"]
        for item in runtime_files
        if isinstance(item.get("path"), str)
    ]
    if sorted(runtime_paths) != EXPECTED_RUNTIME_FILES:
        failures["runtime_evidence_files"] = {
            "actual": sorted(path for path in runtime_paths if isinstance(path, str)),
            "expected": EXPECTED_RUNTIME_FILES,
        }
    invalid_runtime_files = [
        index
        for index, item in enumerate(runtime_files)
        if not _relative_path(item.get("path"))
        or item.get("tracked") is not True
        or not isinstance(item.get("sha256"), str)
        or SHA256_RE.fullmatch(item["sha256"]) is None
        or (
            item.get("kind") != "pylon_config"
            if item.get("path") == "pylon.yml"
            else item.get("kind") != "runtime_config"
        )
    ]
    if invalid_runtime_files or len(set(runtime_paths)) != len(runtime_paths):
        failures["runtime_evidence_integrity"] = invalid_runtime_files

    if set(discovery) != EXPECTED_PLUGINS or any(
        value != "git_tracked" for value in discovery.values()
    ):
        failures["plugin_file_discovery"] = discovery

    if set(plugin_provenance) != EXPECTED_PLUGINS:
        failures["plugin_git_provenance_plugins"] = sorted(plugin_provenance)
    for plugin in sorted(EXPECTED_PLUGINS):
        provenance = plugin_provenance.get(plugin)
        if not isinstance(provenance, dict):
            failures[f"plugin_git_provenance.{plugin}"] = "expected object"
            continue
        head = provenance.get("head")
        dirty_paths = provenance.get("tracked_dirty_paths")
        if (
            not isinstance(head, str)
            or GIT_HEAD_RE.fullmatch(head) is None
            or head != EXPECTED_PLUGIN_HEADS[plugin]
            or not isinstance(dirty_paths, list)
            or any(not isinstance(path, str) for path in dirty_paths)
            or dirty_paths != sorted(set(dirty_paths))
            or dirty_paths != EXPECTED_PLUGIN_DIRTY_PATHS[plugin]
            or any(not _relative_path(path) for path in dirty_paths)
            or any(f"{plugin}/{path}" not in plugin_files for path in dirty_paths)
        ):
            failures[f"plugin_git_provenance.{plugin}"] = provenance

    runtime_head = runtime_provenance.get("head")
    runtime_dirty_paths = runtime_provenance.get("tracked_dirty_paths")
    if (
        not isinstance(runtime_head, str)
        or GIT_HEAD_RE.fullmatch(runtime_head) is None
        or runtime_head != EXPECTED_RUNTIME_HEAD
        or not isinstance(runtime_dirty_paths, list)
        or any(not isinstance(path, str) for path in runtime_dirty_paths)
        or runtime_dirty_paths != sorted(set(runtime_dirty_paths))
        or runtime_dirty_paths != EXPECTED_RUNTIME_DIRTY_PATHS
        or any(not _relative_path(path) for path in runtime_dirty_paths)
        or any(path not in runtime_paths for path in runtime_dirty_paths)
    ):
        failures["runtime_git_provenance"] = runtime_provenance

    expected_plugin_summaries = _plugin_summaries(
        plugins,
        configuration_reads=configuration_reads,
        declarations=declarations,
        emitted_events=emitted_events,
        http_handlers=http_handlers,
        migrations=migrations,
        permission_guards=permission_guards,
        permission_registrations=permission_registrations,
        plugin_files=plugin_files,
        runtime_registrations=runtime_registrations,
    )
    if plugin_summaries != expected_plugin_summaries:
        failures["plugin_summaries_reconciliation"] = {
            "actual_collections": expected_plugin_summaries,
            "declared": plugin_summaries,
        }

    auth_core_rpcs = sum(
        item.get("plugin") == "auth_core" and item.get("kind") == "rpc"
        for item in declarations
    )
    if auth_core_rpcs != EXPECTED_AUTH_CORE_RPCS:
        failures["auth_core_rpc_declarations"] = {
            "actual": auth_core_rpcs,
            "expected": EXPECTED_AUTH_CORE_RPCS,
        }

    if catalog.get("source_roots") != {
        "plugins": "pylon_auth/plugins",
        "runtime": "pylon_auth",
    }:
        failures["source_roots"] = catalog.get("source_roots")
    inference_limits = catalog.get("inference_limits")
    if not isinstance(inference_limits, dict) or set(inference_limits) != {
        "configuration_aliases",
        "convention_http_paths",
        "runtime_requirements",
    } or any(not isinstance(value, str) or not value for value in inference_limits.values()):
        failures["inference_limits"] = inference_limits

    return failures


def main() -> int:
    args = parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    if not isinstance(catalog, dict):
        print('{"error":"auth baseline catalog must be a JSON object"}', file=sys.stderr)
        return 1

    failures = check_catalog(catalog)
    if failures:
        print(
            json.dumps(
                {"error": "reviewed pylon_auth current baseline changed", **failures},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    print(
        json.dumps(
            {
                "auth_core_rpc_declarations": EXPECTED_AUTH_CORE_RPCS,
                "declarations_by_kind": EXPECTED_DECLARATIONS,
                "http_handler_methods": EXPECTED_SUMMARY["http_handler_methods"],
                "migrations": EXPECTED_SUMMARY["migrations_by_format"],
                "plugins": sorted(EXPECTED_PLUGINS),
                "scope": "reviewed pylon_auth current source and tracked runtime baseline",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
