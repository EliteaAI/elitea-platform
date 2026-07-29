#!/usr/bin/env python3
"""Export deterministic static and bounded runtime evidence from current pylon_auth.

The catalog hashes every available tracked plugin file and the bounded
pylon_auth runtime manifests without serializing configuration values. It also
inventories Pylon interfaces, convention-based API handlers, permission guards
and registrations, migrations, configuration reads, emitted events, and
callable signatures. It does not claim these declarations are a complete
behavioral contract; request/result and side-effect fixtures remain separate.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import subprocess
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 2
DECLARATION_KINDS = {
    "event": "event",
    "method": "method",
    "route": "http_route",
    "rpc": "rpc",
    "sio": "socket_io",
}
HTTP_METHODS = {"delete", "get", "head", "options", "patch", "post", "put"}
SKIPPED_FILE_NAMES = {"pylon.db"}
SKIPPED_PATH_PARTS = {".git", ".venv", "__pycache__", "cache"}
SENSITIVE_CONFIG_KEYS = {
    "api_key",
    "client_secret",
    "credential",
    "credentials",
    "db_url",
    "database_url",
    "password",
    "passwd",
    "private_key",
    "redis_url",
    "secret",
    "sp_key",
    "token",
}


@dataclass
class ConfigOrigin:
    root: str
    expression: str
    keys: tuple[ast.AST, ...] = ()
    inferred_alias: bool = False


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


def _literal_string(node: ast.AST | None) -> str | None:
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return None


def _sensitive_config_path(keys: tuple[ast.AST, ...]) -> bool:
    if not keys:
        return False
    for key in keys:
        literal = _literal_string(key)
        if literal is None:
            return True
        normalized = literal.lower().replace("-", "_")
        if normalized in SENSITIVE_CONFIG_KEYS or any(
            normalized.endswith(f"_{marker}")
            for marker in SENSITIVE_CONFIG_KEYS
        ):
            return True
    return False


def _safe_configuration_value(
    node: ast.AST | None,
    *,
    sensitive: bool,
) -> dict[str, Any]:
    if node is None:
        return {"provided": False}
    value = _value(node)
    value["provided"] = True
    if not sensitive:
        return value

    literal_value = value.get("value") if value.get("literal") else None
    if literal_value in (None, "", [], {}):
        return value

    expression = ast.unparse(node)
    return {
        "expression_sha256": hashlib.sha256(expression.encode("utf-8")).hexdigest(),
        "literal": value.get("literal", False),
        "provided": True,
        "redacted": True,
    }


def _config_root(node: ast.AST) -> ConfigOrigin | None:
    dotted = _dotted_name(node)
    if not dotted:
        return None
    if dotted.endswith("descriptor.config") or dotted.endswith("app.config"):
        return ConfigOrigin(root="plugin_config", expression=dotted)
    if dotted.endswith("context.settings"):
        return ConfigOrigin(root="runtime_settings", expression=dotted)
    if dotted in {"self.config", "self.module.config", "this.config"}:
        return ConfigOrigin(root="plugin_config", expression=dotted)
    return None


def _config_origin(
    node: ast.AST,
    aliases: dict[str, ConfigOrigin],
) -> ConfigOrigin | None:
    dotted = _dotted_name(node)
    if dotted in aliases:
        origin = aliases[dotted]
        return ConfigOrigin(
            root=origin.root,
            expression=origin.expression,
            keys=origin.keys,
            inferred_alias=True,
        )

    root = _config_root(node)
    if root is not None:
        return root

    if (
        isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "get"
        and node.args
    ):
        parent = _config_origin(node.func.value, aliases)
        if parent is not None:
            return ConfigOrigin(
                root=parent.root,
                expression=parent.expression,
                keys=(*parent.keys, node.args[0]),
                inferred_alias=parent.inferred_alias,
            )

    if isinstance(node, ast.Subscript):
        parent = _config_origin(node.value, aliases)
        if parent is not None:
            return ConfigOrigin(
                root=parent.root,
                expression=parent.expression,
                keys=(*parent.keys, node.slice),
                inferred_alias=parent.inferred_alias,
            )
    return None


def _alias_name(node: ast.AST) -> str | None:
    if isinstance(node, (ast.Name, ast.Attribute)):
        return _dotted_name(node)
    return None


def _configuration_nodes(
    node: ast.AST | None,
) -> tuple[ast.AST | None, ast.AST | None]:
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


def _literal_permissions(node: ast.AST | None) -> list[str]:
    if node is None:
        return []
    value = _value(node)
    if not value.get("literal"):
        return []
    raw = value.get("value")
    if isinstance(raw, str):
        return [raw]
    if isinstance(raw, list):
        return sorted({item for item in raw if isinstance(item, str)})
    return []


def _permission_record(
    configuration: ast.AST | None,
    *,
    callable_name: str,
    line: int,
    plugin: str,
    source: str,
) -> dict[str, Any]:
    permissions_node, recommended_roles_node = _configuration_nodes(configuration)
    permissions_value = _value(permissions_node)
    record: dict[str, Any] = {
        "callable": callable_name,
        "line": line,
        "literal": permissions_value.get("literal", False),
        "permissions": _literal_permissions(permissions_node),
        "plugin": plugin,
        "source": source,
    }
    if not permissions_value.get("literal", False):
        record["permissions_expression"] = permissions_value.get("expression")
    if recommended_roles_node is not None:
        record["recommended_roles"] = _value(recommended_roles_node)
    return record


def _convention_route_context(tree: ast.Module, source: str) -> dict[str, Any] | None:
    source_parts = Path(source).parts
    try:
        api_index = source_parts.index("api")
    except ValueError:
        return None
    if api_index + 2 >= len(source_parts):
        return None
    version = source_parts[api_index + 1]
    if not (version.startswith("v") and version[1:].isdigit()):
        return None

    url_params: dict[str, Any] = {"literal": True, "value": None}
    modes_by_handler: dict[str, list[str]] = {}
    for statement in tree.body:
        if not isinstance(statement, ast.If):
            candidates = [statement]
        else:
            candidates = statement.body
        for candidate in candidates:
            if not isinstance(candidate, ast.ClassDef) or candidate.name != "API":
                continue
            for class_statement in candidate.body:
                if not isinstance(class_statement, ast.Assign):
                    continue
                targets = [
                    target.id
                    for target in class_statement.targets
                    if isinstance(target, ast.Name)
                ]
                if "url_params" in targets:
                    url_params = _value(class_statement.value)
                if "mode_handlers" not in targets or not isinstance(
                    class_statement.value, ast.Dict
                ):
                    continue
                for key, value in zip(
                    class_statement.value.keys,
                    class_statement.value.values,
                    strict=True,
                ):
                    mode = _literal_string(key)
                    handler = _dotted_name(value)
                    if mode is not None and handler:
                        modes_by_handler.setdefault(handler, []).append(mode)

    return {
        "api_version": version,
        "modes_by_handler": {
            handler: sorted(modes)
            for handler, modes in sorted(modes_by_handler.items())
        },
        "resource": Path(source).stem,
        "url_params": url_params,
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
    def __init__(
        self,
        *,
        source: str,
        plugin: str,
        route_context: dict[str, Any] | None,
    ) -> None:
        self.source = source
        self.plugin = plugin
        self.route_context = route_context
        self.class_names: list[str] = []
        self.callable_names: list[str] = []
        self.alias_scopes: list[dict[str, ConfigOrigin]] = [{}]
        self.configuration_reads: list[dict[str, Any]] = []
        self.declarations: list[dict[str, Any]] = []
        self.emitted_events: list[dict[str, Any]] = []
        self.guards: list[dict[str, Any]] = []
        self.http_handlers: list[dict[str, Any]] = []
        self.permission_registrations: list[dict[str, Any]] = []
        self.runtime_registrations: list[dict[str, Any]] = []

    @property
    def aliases(self) -> dict[str, ConfigOrigin]:
        return self.alias_scopes[-1]

    @property
    def current_callable(self) -> str:
        if self.callable_names:
            return self.callable_names[-1]
        return "<module>"

    def visit_ClassDef(self, node: ast.ClassDef) -> None:  # noqa: N802
        self.class_names.append(node.name)
        self.alias_scopes.append(dict(self.aliases))
        for statement in node.body:
            self.visit(statement)
        self.alias_scopes.pop()
        self.class_names.pop()

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:  # noqa: N802
        self._visit_callable(node)

    def visit_Assign(self, node: ast.Assign) -> None:  # noqa: N802
        self.visit(node.value)
        origin = _config_origin(node.value, self.aliases)
        for target in node.targets:
            name = _alias_name(target)
            if name is None:
                continue
            if origin is None:
                self.aliases.pop(name, None)
            else:
                self.aliases[name] = origin

    def visit_AnnAssign(self, node: ast.AnnAssign) -> None:  # noqa: N802
        if node.value is None:
            return
        self.visit(node.value)
        name = _alias_name(node.target)
        if name is None:
            return
        origin = _config_origin(node.value, self.aliases)
        if origin is None:
            self.aliases.pop(name, None)
        else:
            self.aliases[name] = origin

    def visit_Call(self, node: ast.Call) -> None:  # noqa: N802
        dotted = _dotted_name(node.func)
        callee = dotted.rsplit(".", 1)[-1]

        if (
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "get"
            and node.args
        ):
            parent = _config_origin(node.func.value, self.aliases)
            if parent is not None:
                self._record_configuration_read(
                    access="get",
                    default=node.args[1] if len(node.args) > 1 else None,
                    origin=ConfigOrigin(
                        root=parent.root,
                        expression=parent.expression,
                        keys=(*parent.keys, node.args[0]),
                        inferred_alias=parent.inferred_alias,
                    ),
                    line=node.lineno,
                )

        if dotted in {"os.getenv", "os.environ.get"} and node.args:
            self._record_configuration_read(
                access="getenv",
                default=node.args[1] if len(node.args) > 1 else None,
                origin=ConfigOrigin(
                    root="environment",
                    expression=dotted,
                    keys=(node.args[0],),
                ),
                line=node.lineno,
            )

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

        if callee in {"register_permissions", "unregister_permissions"}:
            configuration = node.args[0] if node.args else next(
                (
                    keyword.value
                    for keyword in node.keywords
                    if keyword.arg in {"configuration", "permissions"}
                ),
                None,
            )
            record = _permission_record(
                configuration,
                callable_name=self.current_callable,
                line=node.lineno,
                plugin=self.plugin,
                source=self.source,
            )
            record["action"] = (
                "register" if callee == "register_permissions" else "unregister"
            )
            record["callee"] = dotted
            self.permission_registrations.append(record)

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

    def visit_Subscript(self, node: ast.Subscript) -> None:  # noqa: N802
        parent = _config_origin(node.value, self.aliases)
        if parent is not None:
            self._record_configuration_read(
                access="subscript",
                default=None,
                origin=ConfigOrigin(
                    root=parent.root,
                    expression=parent.expression,
                    keys=(*parent.keys, node.slice),
                    inferred_alias=parent.inferred_alias,
                ),
                line=node.lineno,
            )
        elif _dotted_name(node.value) == "os.environ":
            self._record_configuration_read(
                access="environment_subscript",
                default=None,
                origin=ConfigOrigin(
                    root="environment",
                    expression="os.environ",
                    keys=(node.slice,),
                ),
                line=node.lineno,
            )
        self.generic_visit(node)

    def visit_Compare(self, node: ast.Compare) -> None:  # noqa: N802
        left = node.left
        for operator, comparator in zip(node.ops, node.comparators, strict=True):
            if isinstance(operator, (ast.In, ast.NotIn)):
                parent = _config_origin(comparator, self.aliases)
                if parent is not None and (not parent.keys or parent.inferred_alias):
                    self._record_configuration_read(
                        access="contains" if isinstance(operator, ast.In) else "not_contains",
                        default=None,
                        origin=ConfigOrigin(
                            root=parent.root,
                            expression=parent.expression,
                            keys=(*parent.keys, left),
                            inferred_alias=parent.inferred_alias,
                        ),
                        line=node.lineno,
                    )
            left = comparator
        self.generic_visit(node)

    def _record_configuration_read(
        self,
        *,
        access: str,
        default: ast.AST | None,
        origin: ConfigOrigin,
        line: int,
    ) -> None:
        self.configuration_reads.append(
            {
                "access": access,
                "callable": self.current_callable,
                "default": _safe_configuration_value(
                    default,
                    sensitive=_sensitive_config_path(origin.keys),
                ),
                "inferred_alias": origin.inferred_alias,
                "key_path": [_value(key) for key in origin.keys],
                "line": line,
                "plugin": self.plugin,
                "root": origin.root,
                "root_expression": origin.expression,
                "source": self.source,
            }
        )

    def _visit_callable(self, node: ast.FunctionDef | ast.AsyncFunctionDef) -> None:
        callable_name = ".".join([*self.class_names, node.name])
        check_api_guarded = False
        for decorator in node.decorator_list:
            if not isinstance(decorator, ast.Call):
                continue
            dotted = _dotted_name(decorator.func)
            parts = dotted.split(".")
            if parts[-1] == "check_api":
                configuration = decorator.args[0] if decorator.args else next(
                    (
                        keyword.value
                        for keyword in decorator.keywords
                        if keyword.arg in {"configuration", "permissions"}
                    ),
                    None,
                )
                guard = _permission_record(
                    configuration,
                    callable_name=callable_name,
                    line=decorator.lineno,
                    plugin=self.plugin,
                    source=self.source,
                )
                guard["kind"] = "check_api"
                self.guards.append(guard)
                check_api_guarded = True

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

        if (
            self.route_context is not None
            and self.class_names
            and node.name.lower() in HTTP_METHODS
        ):
            handler_class = self.class_names[-1]
            self.http_handlers.append(
                {
                    "api_version": self.route_context["api_version"],
                    "callable": callable_name,
                    "guarded": check_api_guarded,
                    "line": node.lineno,
                    "method": node.name.upper(),
                    "mode_keys": self.route_context["modes_by_handler"].get(
                        handler_class, []
                    ),
                    "path_literal": False,
                    "plugin": self.plugin,
                    "resource": self.route_context["resource"],
                    "source": self.source,
                    "url_params": self.route_context["url_params"],
                }
            )

        self.callable_names.append(callable_name)
        self.alias_scopes.append(dict(self.aliases))
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                self.visit(default)
        for statement in node.body:
            self.visit(statement)
        self.alias_scopes.pop()
        self.callable_names.pop()


def _file_bytes(path: Path) -> bytes:
    if path.is_symlink():
        return os.readlink(path).encode("utf-8", errors="surrogateescape")
    return path.read_bytes()


def _source_digest(path: Path) -> str:
    return hashlib.sha256(_file_bytes(path)).hexdigest()


def _git_tracked_files(root: Path) -> list[str] | None:
    try:
        result = subprocess.run(
            ["git", "-C", str(root), "ls-files", "-z", "--cached", "--", "."],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    return sorted(
        path
        for raw in result.stdout.split(b"\0")
        if raw
        for path in [os.fsdecode(raw)]
        if not Path(path).is_absolute() and ".." not in Path(path).parts
    )


def _git_provenance(
    root: Path,
    *,
    dirty_scope: set[str] | None = None,
) -> dict[str, Any]:
    try:
        head_result = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--verify", "HEAD"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        dirty_results = [
            subprocess.run(
                [
                    "git",
                    "-C",
                    str(root),
                    "diff",
                    "--relative",
                    "--name-only",
                    "--no-ext-diff",
                    "-z",
                    *options,
                    "HEAD",
                    "--",
                    ".",
                ],
                check=False,
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
            )
            for options in ([], ["--cached"])
        ]
    except FileNotFoundError:
        return {"head": None, "tracked_dirty_paths": []}

    if head_result.returncode != 0 or any(
        result.returncode != 0 for result in dirty_results
    ):
        return {"head": None, "tracked_dirty_paths": []}

    dirty_paths = sorted(
        {
            path
            for result in dirty_results
            for raw in result.stdout.split(b"\0")
            if raw
            for path in [os.fsdecode(raw)]
            if not Path(path).is_absolute()
            and ".." not in Path(path).parts
            and (dirty_scope is None or path in dirty_scope)
        }
    )
    return {
        "head": head_result.stdout.strip(),
        "tracked_dirty_paths": dirty_paths,
    }


def _fallback_evidence_files(root: Path) -> list[str]:
    return sorted(
        path.relative_to(root).as_posix()
        for path in root.rglob("*")
        if (path.is_file() or path.is_symlink())
        and path.name not in SKIPPED_FILE_NAMES
        and not any(part in SKIPPED_PATH_PARTS for part in path.relative_to(root).parts)
        and path.suffix not in {".pyc", ".pyo"}
    )


def _plugin_evidence_files(
    plugin_path: Path,
) -> tuple[list[Path], list[str], str]:
    tracked = _git_tracked_files(plugin_path)
    discovery = "git_tracked"
    if tracked is None:
        tracked = _fallback_evidence_files(plugin_path)
        discovery = "filesystem_fallback"

    files: list[Path] = []
    missing: list[str] = []
    for relative in tracked:
        path = plugin_path / relative
        if path.name in SKIPPED_FILE_NAMES or any(
            part in SKIPPED_PATH_PARTS for part in Path(relative).parts
        ):
            continue
        if path.exists() or path.is_symlink():
            files.append(path)
        else:
            missing.append(relative)
    return files, missing, discovery


def _runtime_evidence(auth_root: Path) -> list[dict[str, Any]]:
    tracked = _git_tracked_files(auth_root)
    tracked_discovery = tracked is not None
    if tracked is None:
        tracked = [
            path.relative_to(auth_root).as_posix()
            for path in [auth_root / "pylon.yml", *(auth_root / "configs").glob("**/*")]
            if path.is_file() or path.is_symlink()
        ]

    candidates: list[tuple[Path, str]] = []
    for relative in tracked:
        relative_path = Path(relative)
        if relative == "pylon.yml":
            kind = "pylon_config"
        elif relative_path.parts[:1] == ("configs",):
            kind = "runtime_config"
        else:
            continue
        path = auth_root / relative_path
        if path.is_file() or path.is_symlink():
            candidates.append((path, kind))

    return [
        {
            "kind": kind,
            "path": path.relative_to(auth_root).as_posix(),
            "sha256": _source_digest(path),
            "tracked": tracked_discovery,
        }
        for path, kind in sorted(candidates, key=lambda item: item[0].as_posix())
    ]


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
        "format": "python_alembic",
        "plugin": plugin,
        "revision": assignments["revision"],
        "source": source,
    }


def _sql_migration_record(*, source: str, plugin: str) -> dict[str, Any] | None:
    source_path = Path(source)
    if source_path.suffix.lower() != ".sql" or "migrations" not in source_path.parts:
        return None
    return {
        "format": "sql",
        "plugin": plugin,
        "revision": {"literal": True, "value": source_path.stem},
        "source": source,
    }


def build_catalog(
    plugins_root: Path,
    auth_root: Path | None = None,
) -> dict[str, Any]:
    plugins_root = plugins_root.resolve()
    if not plugins_root.is_dir():
        raise ValueError(f"plugins root does not exist: {plugins_root}")
    auth_root = (auth_root or plugins_root.parent).resolve()
    if not auth_root.is_dir():
        raise ValueError(f"auth root does not exist: {auth_root}")

    configuration_reads: list[dict[str, Any]] = []
    declarations: list[dict[str, Any]] = []
    emitted_events: list[dict[str, Any]] = []
    guards: list[dict[str, Any]] = []
    http_handlers: list[dict[str, Any]] = []
    migrations: list[dict[str, Any]] = []
    parse_errors: list[dict[str, Any]] = []
    permission_registrations: list[dict[str, Any]] = []
    runtime_registrations: list[dict[str, Any]] = []
    plugin_files: dict[str, str] = {}
    missing_plugin_files: list[dict[str, str]] = []
    plugin_file_discovery: dict[str, str] = {}
    plugin_git_provenance: dict[str, dict[str, Any]] = {}

    plugin_paths = sorted(
        path
        for path in plugins_root.iterdir()
        if path.is_dir() and not path.name.startswith(".")
    )
    plugin_metadata = {
        path.name: _plugin_metadata(path)
        for path in plugin_paths
    }

    for plugin_path in plugin_paths:
        evidence_files, missing_files, discovery = _plugin_evidence_files(plugin_path)
        plugin = plugin_path.name
        plugin_file_discovery[plugin] = discovery
        plugin_git_provenance[plugin] = _git_provenance(plugin_path)
        missing_plugin_files.extend(
            {"plugin": plugin, "source": f"{plugin}/{source}"}
            for source in missing_files
        )

        for path in evidence_files:
            source = path.relative_to(plugins_root).as_posix()
            plugin_files[source] = _source_digest(path)

            sql_migration = _sql_migration_record(source=source, plugin=plugin)
            if sql_migration is not None:
                migrations.append(sql_migration)
            if path.suffix != ".py":
                continue

            try:
                tree = ast.parse(
                    _file_bytes(path).decode("utf-8"),
                    filename=source,
                )
            except (SyntaxError, UnicodeDecodeError) as exc:
                parse_errors.append(
                    {"error": type(exc).__name__, "plugin": plugin, "source": source}
                )
                continue

            visitor = CatalogVisitor(
                source=source,
                plugin=plugin,
                route_context=_convention_route_context(tree, source),
            )
            visitor.visit(tree)
            configuration_reads.extend(visitor.configuration_reads)
            declarations.extend(visitor.declarations)
            emitted_events.extend(visitor.emitted_events)
            guards.extend(visitor.guards)
            http_handlers.extend(visitor.http_handlers)
            permission_registrations.extend(visitor.permission_registrations)
            runtime_registrations.extend(visitor.runtime_registrations)
            migration = _migration_record(tree, source=source, plugin=plugin)
            if migration is not None:
                migrations.append(migration)

    runtime_files = _runtime_evidence(auth_root)
    runtime_paths = {item["path"] for item in runtime_files}
    runtime_git_provenance = _git_provenance(
        auth_root,
        dirty_scope=runtime_paths,
    )

    declarations.sort(
        key=lambda item: (
            item["plugin"],
            item["source"],
            item["line"],
            item["kind"],
            item["callable"],
        )
    )
    configuration_reads.sort(
        key=lambda item: (
            item["plugin"],
            item["source"],
            item["line"],
            item["access"],
            item["callable"],
            json.dumps(item["key_path"], sort_keys=True),
        )
    )
    runtime_registrations.sort(
        key=lambda item: (item["plugin"], item["source"], item["line"], item["callee"])
    )
    emitted_events.sort(
        key=lambda item: (item["plugin"], item["source"], item["line"])
    )
    guards.sort(
        key=lambda item: (
            item["plugin"], item["source"], item["line"], item["callable"]
        )
    )
    http_handlers.sort(
        key=lambda item: (
            item["plugin"],
            item["source"],
            item["line"],
            item["method"],
            item["callable"],
        )
    )
    migrations.sort(key=lambda item: (item["plugin"], item["source"]))
    permission_registrations.sort(
        key=lambda item: (
            item["plugin"], item["source"], item["line"], item["callee"]
        )
    )
    missing_plugin_files.sort(key=lambda item: (item["plugin"], item["source"]))

    declaration_counts = Counter(item["kind"] for item in declarations)
    dynamic_declarations = sum(
        1
        for declaration in declarations
        if any(not argument["literal"] for argument in declaration["arguments"])
        or any(not value["literal"] for value in declaration["keywords"].values())
    )
    literal_permissions = sorted(
        {
            permission
            for record in [*guards, *permission_registrations]
            for permission in record["permissions"]
        }
    )
    unguarded_http_handlers = [
        handler for handler in http_handlers if not handler["guarded"]
    ]
    migration_counts = Counter(item["format"] for item in migrations)
    plugin_summaries: dict[str, dict[str, int]] = {}
    for plugin in plugin_metadata:
        counts = Counter(
            item["kind"] for item in declarations if item["plugin"] == plugin
        )
        plugin_summaries[plugin] = {
            "configuration_reads": sum(
                1 for item in configuration_reads if item["plugin"] == plugin
            ),
            "emitted_events": sum(1 for item in emitted_events if item["plugin"] == plugin),
            "event_declarations": counts["event"],
            "http_handler_methods": sum(
                1 for item in http_handlers if item["plugin"] == plugin
            ),
            "http_route_declarations": counts["http_route"],
            "method_declarations": counts["method"],
            "migrations": sum(1 for item in migrations if item["plugin"] == plugin),
            "permission_guards": sum(
                1 for item in guards if item["plugin"] == plugin
            ),
            "permission_registrations": sum(
                1 for item in permission_registrations if item["plugin"] == plugin
            ),
            "plugin_evidence_files": sum(
                1 for source in plugin_files if Path(source).parts[0] == plugin
            ),
            "rpc_declarations": counts["rpc"],
            "runtime_registrations": sum(
                1 for item in runtime_registrations if item["plugin"] == plugin
            ),
            "socket_io_declarations": counts["socket_io"],
        }

    return {
        "configuration_reads": configuration_reads,
        "declarations": declarations,
        "emitted_events": emitted_events,
        "http_handlers": http_handlers,
        "inference_limits": {
            "convention_http_paths": (
                "api/vN handler methods prove HTTP verb, plugin, version, resource, "
                "mode mapping and url_params expression only; api_tools and plugin "
                "registration compose the full runtime path, so no literal full path "
                "is inferred"
            ),
            "configuration_aliases": (
                "configuration aliases are followed within a callable by static "
                "assignment; dynamic mutation or interprocedural data flow remains "
                "expression evidence"
            ),
            "runtime_requirements": (
                "pylon_auth/requirements cache stamps and installed package trees are "
                "generated runtime state, not business or configuration contracts, "
                "and are excluded"
            ),
        },
        "literal_permissions": literal_permissions,
        "migrations": migrations,
        "missing_plugin_evidence_files": missing_plugin_files,
        "parse_errors": parse_errors,
        "permission_guards": guards,
        "permission_registrations": permission_registrations,
        "plugin_evidence_files_sha256": dict(sorted(plugin_files.items())),
        "plugin_file_discovery": dict(sorted(plugin_file_discovery.items())),
        "plugin_git_provenance": dict(sorted(plugin_git_provenance.items())),
        "plugin_metadata": plugin_metadata,
        "plugin_summaries": plugin_summaries,
        "runtime_evidence_files": runtime_files,
        "runtime_git_provenance": runtime_git_provenance,
        "runtime_registrations": runtime_registrations,
        "schema_version": SCHEMA_VERSION,
        "source_roots": {
            "plugins": "pylon_auth/plugins",
            "runtime": "pylon_auth",
        },
        "summary": {
            "configuration_reads": len(configuration_reads),
            "configuration_reads_by_root": dict(
                sorted(Counter(item["root"] for item in configuration_reads).items())
            ),
            "declarations_by_kind": dict(sorted(declaration_counts.items())),
            "dynamic_declarations": dynamic_declarations,
            "emitted_events": len(emitted_events),
            "http_handler_methods": len(http_handlers),
            "literal_permissions": len(literal_permissions),
            "migrations": len(migrations),
            "migrations_by_format": dict(sorted(migration_counts.items())),
            "missing_plugin_evidence_files": len(missing_plugin_files),
            "parse_errors": len(parse_errors),
            "permission_guards": len(guards),
            "permission_registrations": len(permission_registrations),
            "plugin_evidence_files": len(plugin_files),
            "plugins": len(plugin_metadata),
            "runtime_evidence_files": len(runtime_files),
            "runtime_untracked_evidence_files": sum(
                1 for item in runtime_files if not item["tracked"]
            ),
            "runtime_registrations": len(runtime_registrations),
            "unguarded_http_handler_methods": len(unguarded_http_handlers),
        },
        "unguarded_http_handlers": unguarded_http_handlers,
    }


def _encoded(catalog: dict[str, Any]) -> bytes:
    return (json.dumps(catalog, indent=2, sort_keys=True) + "\n").encode("utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--plugins-root", required=True, type=Path)
    parser.add_argument(
        "--auth-root",
        type=Path,
        help="pylon_auth root; defaults to the parent of --plugins-root",
    )
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--check",
        action="store_true",
        help="fail when the existing output differs instead of rewriting it",
    )
    args = parser.parse_args()

    encoded = _encoded(build_catalog(args.plugins_root, args.auth_root))
    if args.check:
        if not args.output.is_file() or args.output.read_bytes() != encoded:
            raise SystemExit("Auth baseline catalog is missing or stale")
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_bytes(encoded)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
