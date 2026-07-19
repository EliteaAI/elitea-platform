#!/usr/bin/env python3
"""Export deterministic static interface evidence from current pylon_auth.

The catalog is intentionally source-oriented. It inventories Pylon interface
declarations, static runtime registrations, emitted events, migration heads,
configuration/source digests, and callable signatures without claiming that
those declarations are a complete behavioral contract. Golden request/result
and side-effect fixtures are added by later migration slices.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from collections import Counter
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
DECLARATION_KINDS = {
    "event": "event",
    "method": "method",
    "route": "http_route",
    "rpc": "rpc",
    "sio": "socket_io",
}
HASHED_SOURCE_SUFFIXES = {".py", ".yaml", ".yml"}


def _dotted_name(node: ast.AST) -> str:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _normalise_literal(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            str(key): _normalise_literal(item)
            for key, item in sorted(value.items(), key=lambda pair: str(pair[0]))
        }
    if isinstance(value, (list, tuple)):
        return [_normalise_literal(item) for item in value]
    if isinstance(value, set):
        return sorted(_normalise_literal(item) for item in value)
    if value is Ellipsis:
        return {"python_literal": "..."}
    if isinstance(value, bytes):
        return {"python_bytes_hex": value.hex()}
    if value is None or isinstance(value, (bool, float, int, str)):
        return value
    return {"python_literal": repr(value)}


def _value(node: ast.AST | None) -> dict[str, Any]:
    if node is None:
        return {"literal": True, "value": None}
    try:
        return {
            "literal": True,
            "value": _normalise_literal(ast.literal_eval(node)),
        }
    except (TypeError, ValueError):
        return {"expression": ast.unparse(node), "literal": False}


def _arguments(nodes: list[ast.AST]) -> list[dict[str, Any]]:
    return [_value(node) for node in nodes]


def _keywords(nodes: list[ast.keyword]) -> dict[str, dict[str, Any]]:
    return {
        keyword.arg or "**": _value(keyword.value)
        for keyword in nodes
    }


def _parameter(
    node: ast.arg,
    *,
    kind: str,
    default: ast.AST | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {"kind": kind, "name": node.arg}
    if node.annotation is not None:
        result["annotation"] = ast.unparse(node.annotation)
    if default is not None:
        result["default"] = _value(default)
    return result


def _signature(node: ast.FunctionDef | ast.AsyncFunctionDef) -> list[dict[str, Any]]:
    arguments = node.args
    positional = [*arguments.posonlyargs, *arguments.args]
    first_default = len(positional) - len(arguments.defaults)
    parameters: list[dict[str, Any]] = []

    for index, argument in enumerate(arguments.posonlyargs):
        default = arguments.defaults[index - first_default] if index >= first_default else None
        parameters.append(_parameter(argument, kind="positional_only", default=default))

    offset = len(arguments.posonlyargs)
    for local_index, argument in enumerate(arguments.args):
        index = offset + local_index
        default = arguments.defaults[index - first_default] if index >= first_default else None
        parameters.append(_parameter(argument, kind="positional_or_keyword", default=default))

    if arguments.vararg is not None:
        parameters.append(_parameter(arguments.vararg, kind="var_positional"))

    for argument, default in zip(
        arguments.kwonlyargs,
        arguments.kw_defaults,
        strict=True,
    ):
        parameters.append(_parameter(argument, kind="keyword_only", default=default))

    if arguments.kwarg is not None:
        parameters.append(_parameter(arguments.kwarg, kind="var_keyword"))

    return parameters


def _literal_names(arguments: list[ast.AST], fallback: str | None = None) -> list[str]:
    names = [
        value
        for argument in arguments
        if (value := _value(argument).get("value")) is not None
        and isinstance(value, str)
    ]
    if not names and fallback is not None and not arguments:
        return [fallback]
    return names


class CatalogVisitor(ast.NodeVisitor):
    def __init__(self, *, source: str, plugin: str) -> None:
        self.source = source
        self.plugin = plugin
        self.class_names: list[str] = []
        self.declarations: list[dict[str, Any]] = []
        self.runtime_registrations: list[dict[str, Any]] = []
        self.emitted_events: list[dict[str, Any]] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
        self.class_names.append(node.name)
        self.generic_visit(node)
        self.class_names.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        dotted = _dotted_name(node.func)
        callee = dotted.rsplit(".", 1)[-1]

        if self.source.endswith("module.py") and (
            callee.startswith("register_") or callee.startswith("unregister_")
        ):
            self.runtime_registrations.append(
                {
                    "arguments": _arguments(node.args),
                    "callee": dotted,
                    "keywords": _keywords(node.keywords),
                    "line": node.lineno,
                    "plugin": self.plugin,
                    "source": self.source,
                }
            )

        if callee == "fire_event" and node.args:
            self.emitted_events.append(
                {
                    "event": _value(node.args[0]),
                    "line": node.lineno,
                    "plugin": self.plugin,
                    "source": self.source,
                }
            )

        self.generic_visit(node)

    def _visit_callable(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        callable_name = ".".join([*self.class_names, node.name])
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            dotted = _dotted_name(decorator.func)
            parts = dotted.split(".")
            if len(parts) < 2 or parts[-2] != "web":
                continue
            kind = DECLARATION_KINDS.get(parts[-1])
            if kind is None:
                continue

            record: dict[str, Any] = {
                "arguments": _arguments(decorator.args),
                "callable": callable_name,
                "kind": kind,
                "keywords": _keywords(decorator.keywords),
                "line": decorator.lineno,
                "plugin": self.plugin,
                "signature": _signature(node),
                "source": self.source,
            }
            if kind == "http_route":
                record["paths"] = _literal_names(decorator.args[:1])
                methods = next(
                    (
                        value
                        for keyword in decorator.keywords
                        if keyword.arg == "methods"
                        for value in [_value(keyword.value).get("value")]
                        if isinstance(value, list)
                    ),
                    ["GET"],
                )
                record["http_methods"] = methods
            elif kind in {"rpc", "method", "event", "socket_io"}:
                record["exported_names"] = _literal_names(
                    decorator.args,
                    fallback=node.name if kind == "method" else None,
                )
            self.declarations.append(record)

        self.generic_visit(node)


def _source_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _plugin_metadata(path: Path) -> dict[str, Any]:
    metadata_path = path / "metadata.json"
    if not metadata_path.is_file():
        return {}
    try:
        metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return {"metadata_error": "invalid JSON"}
    return {
        key: metadata[key]
        for key in ("name", "version")
        if key in metadata
    }


def _migration_record(tree: ast.Module, *, source: str, plugin: str) -> dict[str, Any] | None:
    if "/db/migrations/" not in f"/{source}":
        return None
    assignments: dict[str, dict[str, Any]] = {}
    for statement in tree.body:
        if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
            continue
        target = statement.targets[0]
        if isinstance(target, ast.Name) and target.id in {"revision", "down_revision"}:
            assignments[target.id] = _value(statement.value)
    if "revision" not in assignments:
        return None
    return {
        "down_revision": assignments.get("down_revision", {"literal": True, "value": None}),
        "plugin": plugin,
        "revision": assignments["revision"],
        "source": source,
    }


def build_catalog(plugins_root: Path) -> dict[str, Any]:
    plugins_root = plugins_root.resolve()
    if not plugins_root.is_dir():
        raise ValueError(f"plugins root does not exist: {plugins_root}")

    declarations: list[dict[str, Any]] = []
    runtime_registrations: list[dict[str, Any]] = []
    emitted_events: list[dict[str, Any]] = []
    migrations: list[dict[str, Any]] = []
    parse_errors: list[dict[str, Any]] = []
    source_files: dict[str, str] = {}

    plugin_paths = sorted(
        path
        for path in plugins_root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    )
    plugin_metadata = {
        path.name: _plugin_metadata(path)
        for path in plugin_paths
    }

    for path in sorted(plugins_root.rglob("*")):
        if not path.is_file() or any(
            part in {".git", ".venv", "__pycache__"} for part in path.parts
        ):
            continue
        if path.suffix not in HASHED_SOURCE_SUFFIXES:
            continue

        source = path.relative_to(plugins_root).as_posix()
        source_files[source] = _source_digest(path)
        if path.suffix != ".py":
            continue

        plugin = Path(source).parts[0]
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=source)
        except (SyntaxError, UnicodeDecodeError) as exc:
            parse_errors.append(
                {"error": type(exc).__name__, "plugin": plugin, "source": source}
            )
            continue

        visitor = CatalogVisitor(source=source, plugin=plugin)
        visitor.visit(tree)
        declarations.extend(visitor.declarations)
        runtime_registrations.extend(visitor.runtime_registrations)
        emitted_events.extend(visitor.emitted_events)
        migration = _migration_record(tree, source=source, plugin=plugin)
        if migration is not None:
            migrations.append(migration)

    declarations.sort(
        key=lambda item: (
            item["plugin"],
            item["source"],
            item["line"],
            item["kind"],
            item["callable"],
        )
    )
    runtime_registrations.sort(
        key=lambda item: (item["plugin"], item["source"], item["line"], item["callee"])
    )
    emitted_events.sort(
        key=lambda item: (item["plugin"], item["source"], item["line"])
    )
    migrations.sort(key=lambda item: (item["plugin"], item["source"]))

    declaration_counts = Counter(item["kind"] for item in declarations)
    dynamic_declarations = sum(
        1
        for declaration in declarations
        if any(not argument["literal"] for argument in declaration["arguments"])
        or any(not value["literal"] for value in declaration["keywords"].values())
    )
    plugin_summaries: dict[str, dict[str, int]] = {}
    for plugin in plugin_metadata:
        counts = Counter(
            item["kind"] for item in declarations if item["plugin"] == plugin
        )
        plugin_summaries[plugin] = {
            "emitted_events": sum(1 for item in emitted_events if item["plugin"] == plugin),
            "event_declarations": counts["event"],
            "http_route_declarations": counts["http_route"],
            "method_declarations": counts["method"],
            "migrations": sum(1 for item in migrations if item["plugin"] == plugin),
            "rpc_declarations": counts["rpc"],
            "runtime_registrations": sum(
                1 for item in runtime_registrations if item["plugin"] == plugin
            ),
            "socket_io_declarations": counts["socket_io"],
        }

    return {
        "declarations": declarations,
        "emitted_events": emitted_events,
        "migrations": migrations,
        "parse_errors": parse_errors,
        "plugin_metadata": plugin_metadata,
        "plugin_summaries": plugin_summaries,
        "runtime_registrations": runtime_registrations,
        "schema_version": SCHEMA_VERSION,
        "source_files_sha256": dict(sorted(source_files.items())),
        "source_root": "pylon_auth/plugins",
        "summary": {
            "declarations_by_kind": dict(sorted(declaration_counts.items())),
            "dynamic_declarations": dynamic_declarations,
            "emitted_events": len(emitted_events),
            "migrations": len(migrations),
            "parse_errors": len(parse_errors),
            "plugins": len(plugin_metadata),
            "runtime_registrations": len(runtime_registrations),
            "source_files": len(source_files),
        },
    }


def _encoded(catalog: dict[str, Any]) -> bytes:
    return (json.dumps(catalog, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugins-root", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the existing output differs instead of rewriting it",
    )
    args = parser.parse_args()

    encoded = _encoded(build_catalog(args.plugins_root))
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != encoded:
            raise SystemExit("Auth baseline catalog is missing or stale")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
