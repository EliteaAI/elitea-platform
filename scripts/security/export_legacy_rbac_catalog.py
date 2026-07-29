#!/usr/bin/env python3
"""Export deterministic static RBAC evidence from legacy Pylon plugins.

The output is deliberately source-oriented: it records the exact guarded
callable and literal permission declarations without pretending that static
decorators are the effective database grant matrix. Runtime permission rows
must be captured separately from PostgreSQL.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 1
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put"}
GUARD_KINDS = {
    "check_api": "http",
    "check_slot": "slot",
    "sio_check": "socket_io",
}


def _dotted_name(node: ast.AST) -> str:
    parts: list[str] = []
    while isinstance(node, ast.Attribute):
        parts.append(node.attr)
        node = node.value
    if isinstance(node, ast.Name):
        parts.append(node.id)
    return ".".join(reversed(parts))


def _literal(node: ast.AST | None) -> tuple[Any, bool]:
    if node is None:
        return None, True
    try:
        return ast.literal_eval(node), True
    except (TypeError, ValueError):
        return ast.unparse(node), False


def _permissions_from_value(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, (list, tuple, set)):
        return sorted({item for item in value if isinstance(item, str)})
    return []


def _configuration_nodes(node: ast.AST | None) -> tuple[ast.AST | None, ast.AST | None]:
    """Return permission and recommended-role nodes from supported declarations."""
    if isinstance(node, ast.Dict):
        values = {
            key.value: value
            for key, value in zip(node.keys, node.values, strict=True)
            if isinstance(key, ast.Constant) and isinstance(key.value, str)
        }
        return values.get("permissions"), values.get("recommended_roles")
    if isinstance(node, ast.Call):
        values = {keyword.arg: keyword.value for keyword in node.keywords if keyword.arg}
        return values.get("permissions"), values.get("recommended_roles")
    return node, None


def _guard_record(
    decorator: ast.Call,
    *,
    kind: str,
    source: str,
    callable_name: str,
) -> dict[str, Any]:
    permission_node = decorator.args[0] if decorator.args else None
    if permission_node is None:
        permission_node = next(
            (keyword.value for keyword in decorator.keywords if keyword.arg == "permissions"),
            None,
        )

    permission_node, recommended_roles_node = _configuration_nodes(permission_node)
    value, literal = _literal(permission_node)
    permissions = _permissions_from_value(value) if literal else []
    recommended_roles, recommended_roles_literal = _literal(recommended_roles_node)

    record: dict[str, Any] = {
        "kind": kind,
        "source": source,
        "line": decorator.lineno,
        "callable": callable_name,
        "permissions": permissions,
        "literal": literal,
    }
    if recommended_roles is not None and recommended_roles_literal:
        record["recommended_roles"] = recommended_roles
    elif recommended_roles is not None:
        record["recommended_roles_expression"] = recommended_roles
    if not literal:
        record["expression"] = value
    return record


class CatalogVisitor(ast.NodeVisitor):
    def __init__(self, source: str) -> None:
        self.source = source
        self.class_names: list[str] = []
        self.guards: list[dict[str, Any]] = []
        self.http_handlers: list[dict[str, Any]] = []

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
        self.class_names.append(node.name)
        self.generic_visit(node)
        self.class_names.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def _visit_callable(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        callable_name = ".".join([*self.class_names, node.name])
        guard_kinds: list[str] = []
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            guard_name = _dotted_name(decorator.func).split(".")[-1]
            kind = GUARD_KINDS.get(guard_name)
            if kind is None:
                continue
            guard_kinds.append(kind)
            self.guards.append(
                _guard_record(
                    decorator,
                    kind=kind,
                    source=self.source,
                    callable_name=callable_name,
                )
            )

        source_parts = Path(self.source).parts
        if (
            self.class_names
            and node.name.lower() in HTTP_METHODS
            and "api" in source_parts
            and any(part.startswith("v") and part[1:].isdigit() for part in source_parts)
        ):
            self.http_handlers.append(
                {
                    "source": self.source,
                    "line": node.lineno,
                    "callable": callable_name,
                    "method": node.name.upper(),
                    "guarded": "http" in guard_kinds,
                }
            )

        self.generic_visit(node)


def _source_digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_catalog(plugins_root: Path) -> dict[str, Any]:
    plugins_root = plugins_root.resolve()
    if not plugins_root.is_dir():
        raise ValueError(f"plugins root does not exist: {plugins_root}")

    guards: list[dict[str, Any]] = []
    handlers: list[dict[str, Any]] = []
    source_files: dict[str, str] = {}
    parse_errors: list[dict[str, Any]] = []

    for path in sorted(plugins_root.rglob("*.py")):
        if any(part in {".git", ".venv", "__pycache__"} for part in path.parts):
            continue
        source = path.relative_to(plugins_root).as_posix()
        try:
            tree = ast.parse(path.read_text(encoding="utf-8"), filename=source)
        except (SyntaxError, UnicodeDecodeError) as exc:
            parse_errors.append({"source": source, "error": type(exc).__name__})
            continue

        visitor = CatalogVisitor(source)
        visitor.visit(tree)
        if visitor.guards or visitor.http_handlers:
            source_files[source] = _source_digest(path)
        guards.extend(visitor.guards)
        handlers.extend(visitor.http_handlers)

    guards.sort(key=lambda item: (item["source"], item["line"], item["kind"], item["callable"]))
    handlers.sort(key=lambda item: (item["source"], item["line"], item["method"], item["callable"]))
    unguarded = [handler for handler in handlers if not handler["guarded"]]
    literal_permissions = sorted(
        {permission for guard in guards for permission in guard["permissions"]}
    )
    kind_counts = {
        kind: sum(1 for guard in guards if guard["kind"] == kind)
        for kind in sorted(set(GUARD_KINDS.values()))
    }

    return {
        "schema_version": SCHEMA_VERSION,
        "source_root": "pylon_main/plugins",
        "summary": {
            "guard_declarations": len(guards),
            "guard_declarations_by_kind": kind_counts,
            "literal_permissions": len(literal_permissions),
            "dynamic_guard_declarations": sum(1 for guard in guards if not guard["literal"]),
            "http_handler_methods": len(handlers),
            "unguarded_http_handler_methods": len(unguarded),
            "parse_errors": len(parse_errors),
        },
        "literal_permissions": literal_permissions,
        "guards": guards,
        "http_handlers": handlers,
        "unguarded_http_handlers": unguarded,
        "source_files_sha256": dict(sorted(source_files.items())),
        "parse_errors": parse_errors,
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
            raise SystemExit("legacy RBAC catalog is missing or stale")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
