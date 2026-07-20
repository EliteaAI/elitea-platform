#!/usr/bin/env python3
"""Export bounded current-baseline pylon_main Auth HTTP contract evidence.

This exporter intentionally covers only the externally consumed PAT, Auth
current-user, and permission resources named below.  It fingerprints the exact
handler, principal-resolution, request-gate, and route-registration AST while
also producing a reviewable behavioral summary.  It is not an all-Auth parity
claim and it does not import Pylon, Flask, or product dependencies.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any


SCHEMA_VERSION = 3
AUTH_SOURCE_FILES = (
    "api/v2/permissions.py",
    "api/v2/token.py",
    "api/v2/user.py",
    "config.yml",
    "module.py",
    "rpc/user.py",
)
AUTH_CORE_SOURCE_FILES = (
    "config.yml",
    "db/migrations/202202021633_core.py",
    "db/db_tools.py",
    "methods/auth_context.py",
    "module.py",
    "requirements.txt",
    "rpc/auth_context.py",
    "rpc/tokens.py",
    "rpc/users.py",
    "tools/rpc_tools.py",
)
SHARED_API_SOURCE_FILES = (
    "module.py",
    "tools/api_tools.py",
    "tools/config.py",
)
PYLON_SOURCE_FILES = (
    "pylon/core/tools/module/descriptor.py",
    "pylon/core/tools/dict.py",
    "requirements.txt",
)
PROJECTS_SOURCE_FILES = ("rpc/poc.py",)
EXPECTED_RESOURCES = {
    "permissions": {
        "base": "Resource",
        "url_params": ["<string:mode>/<int:project_id>"],
        "methods": ["get"],
    },
    "token": {
        "base": "api_tools.APIBase",
        "url_params": ["", "<string:uid>"],
        "methods": ["delete", "get", "post"],
    },
    "user": {
        "base": "api_tools.APIBase",
        "url_params": ["<string:mode>", ""],
        "methods": ["get"],
    },
}
FINGERPRINT_TARGETS = {
    "api/v2/permissions.py": (("API", "get"),),
    "api/v2/token.py": (("API", "get"), ("API", "post"), ("API", "delete")),
    "api/v2/user.py": (("API", "get"),),
    "module.py": (
        ("Module", "_after_request_hook"),
        ("Module", "_before_request_hook"),
        ("Module", "access_denied_reply"),
        ("Module", "resolve_permissions"),
    ),
    "rpc/user.py": (("RPC", "current_user"),),
}
SHARED_API_FINGERPRINT_TARGETS = (
    ("APIBase", "delete"),
    ("APIBase", "get"),
    ("APIBase", "patch"),
    ("APIBase", "post"),
    ("APIBase", "proxy_method"),
    ("APIBase", "put"),
)
AUTH_CORE_CONTEXT_FINGERPRINT_TARGETS = (
    ("methods/auth_context.py", "Method", "get_auth_context"),
    ("module.py", "Module", "__init__"),
    ("module.py", "Module", "init"),
    ("rpc/auth_context.py", "RPC", "get_referenced_auth_context"),
)


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_sha256(path: Path) -> str:
    return _sha256(path.read_bytes())


def _run_git(repo: Path, *args: str, binary: bool = False) -> bytes | str:
    result = subprocess.run(
        ["git", "-C", str(repo), *args],
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=not binary,
    )
    if result.returncode != 0:
        error = result.stderr.decode() if binary else result.stderr
        raise ValueError(f"git {' '.join(args)} failed for {repo}: {error.strip()}")
    return result.stdout


def _nul_paths(raw: bytes) -> list[str]:
    return sorted(
        {
            os.fsdecode(item)
            for item in raw.split(b"\0")
            if item and not Path(os.fsdecode(item)).is_absolute()
        }
    )


def git_provenance(
    repo: Path,
    contract_paths: set[str],
) -> dict[str, Any]:
    head = str(_run_git(repo, "rev-parse", "HEAD")).strip()
    tracked = set()
    for options in ((), ("--cached",)):
        tracked.update(
            _nul_paths(
                _run_git(
                    repo,
                    "diff",
                    "--name-only",
                    "--no-ext-diff",
                    "-z",
                    *options,
                    "HEAD",
                    "--",
                    ".",
                    binary=True,
                )
            )
        )
    untracked = set(
        _nul_paths(
            _run_git(
                repo,
                "ls-files",
                "--others",
                "--exclude-standard",
                "-z",
                binary=True,
            )
        )
    )
    dirty = sorted(tracked | untracked)
    contract_dirty = sorted(contract_paths.intersection(dirty))
    return {
        "contract_sources_reconstructable_from_pinned_head": not contract_dirty,
        "contract_source_dirty_paths": contract_dirty,
        "pinned_head": head,
    }


def _parse(path: Path) -> ast.Module:
    try:
        return ast.parse(path.read_text(encoding="utf-8"), filename=path.as_posix())
    except (SyntaxError, UnicodeDecodeError) as exc:
        raise ValueError(f"cannot parse {path}: {exc}") from exc


def _class(tree: ast.Module, name: str) -> ast.ClassDef:
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == name:
            return node
    raise ValueError(f"class {name} not found")


def _method(tree: ast.Module, class_name: str, method_name: str) -> ast.FunctionDef:
    class_node = _class(tree, class_name)
    for node in class_node.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == method_name:
            if isinstance(node, ast.AsyncFunctionDef):
                raise ValueError(f"unexpected async method {class_name}.{method_name}")
            return node
    raise ValueError(f"method {class_name}.{method_name} not found")


def _function(tree: ast.Module, function_name: str) -> ast.FunctionDef:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == function_name:
            return node
    raise ValueError(f"function {function_name} not found")


def _literal_url_params(tree: ast.Module) -> list[str]:
    for statement in _class(tree, "API").body:
        if not isinstance(statement, ast.Assign):
            continue
        if not any(isinstance(target, ast.Name) and target.id == "url_params" for target in statement.targets):
            continue
        try:
            value = ast.literal_eval(statement.value)
        except (TypeError, ValueError) as exc:
            raise ValueError("API.url_params is not a literal list") from exc
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError("API.url_params must be a literal string list")
        return value
    raise ValueError("API.url_params not found")


def _class_http_methods(tree: ast.Module, class_name: str) -> list[str]:
    return sorted(
        node.name
        for node in _class(tree, class_name).body
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name in {"delete", "get", "head", "options", "patch", "post", "put"}
    )


def _http_methods(tree: ast.Module) -> list[str]:
    return _class_http_methods(tree, "API")


def _class_base_names(tree: ast.Module, class_name: str) -> list[str]:
    names: list[str] = []
    for base in _class(tree, class_name).bases:
        if isinstance(base, ast.Name):
            names.append(base.id)
        elif isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name):
            names.append(f"{base.value.id}.{base.attr}")
        else:
            names.append(ast.dump(base, annotate_fields=False, include_attributes=False))
    return names


def _method_fingerprint(node: ast.FunctionDef) -> dict[str, Any]:
    normalized = ast.dump(node, annotate_fields=True, include_attributes=False)
    return {
        "ast_sha256": _sha256(normalized.encode("utf-8")),
        "line": node.lineno,
    }


def _route_variants(resource: str, url_params: list[str]) -> list[str]:
    paths: list[str] = []
    base = f"/api/v2/auth/{resource}"
    for parameter in url_params:
        parameter = parameter.strip("/")
        path = f"{base}/{parameter}"
        paths.extend((path, f"{path}/"))
    return paths


def _direct_dispatch_routes(registered_routes: list[str]) -> list[str]:
    """Return raw rules that dispatch without Werkzeug slash canonicalization."""
    return [route for route in registered_routes if not route.endswith("//")]


def _validate_resource(resource: str, tree: ast.Module) -> tuple[list[str], list[str], str]:
    observed_params = _literal_url_params(tree)
    observed_methods = _http_methods(tree)
    observed_bases = _class_base_names(tree, "API")
    expected = EXPECTED_RESOURCES[resource]
    if observed_params != expected["url_params"]:
        raise ValueError(
            f"{resource} url_params changed: {observed_params!r}; review the contract exporter"
        )
    if observed_methods != expected["methods"]:
        raise ValueError(
            f"{resource} methods changed: {observed_methods!r}; review the contract exporter"
        )
    if expected["base"] not in observed_bases:
        raise ValueError(
            f"{resource} API base changed: {observed_bases!r}; review effective methods"
        )
    return observed_params, observed_methods, expected["base"]


def _setting_bool(text: str, key: str) -> bool:
    values = []
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line.startswith(f"{key}:"):
            continue
        value = line.split(":", 1)[1].strip().lower()
        if value not in {"true", "false"}:
            raise ValueError(f"{key} is not a literal YAML boolean")
        values.append(value == "true")
    if len(values) != 1:
        raise ValueError(f"expected one literal {key} setting, found {len(values)}")
    return values[0]


def _literal_yaml_scalar(text: str, key: str) -> str | None:
    values = []
    for raw_line in text.splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line.startswith(f"{key}:"):
            continue
        value = line.split(":", 1)[1].strip().strip('"').strip("'")
        if value:
            values.append(value)
    if len(values) > 1:
        raise ValueError(f"expected at most one literal {key}, found {len(values)}")
    return values[0] if values else None


def _literal_yaml_mapping_keys(text: str, key: str) -> list[str]:
    """Read immediate mapping keys without adding a YAML runtime dependency."""
    lines = text.splitlines()
    for index, raw_line in enumerate(lines):
        line = raw_line.split("#", 1)[0].rstrip()
        if not line.strip() or line.lstrip() != f"{key}:":
            continue
        parent_indent = len(line) - len(line.lstrip())
        keys: list[str] = []
        for child_raw in lines[index + 1 :]:
            child = child_raw.split("#", 1)[0].rstrip()
            if not child.strip():
                continue
            child_indent = len(child) - len(child.lstrip())
            if child_indent <= parent_indent:
                break
            if child_indent > parent_indent and ":" in child.strip():
                keys.append(child.strip().split(":", 1)[0])
        return sorted(keys)
    raise ValueError(f"literal YAML mapping {key} not found")


def _pat_post_contract(
    contract_id: str,
    contract_routes: list[str],
    *,
    item_route: bool,
) -> dict[str, Any]:
    global_gate = {
        "kind": "global_before_request",
        "local_permission_decorator": False,
        "reference": "global_auth_rpc_gate",
    }
    path_parameters = {}
    if item_route:
        path_parameters["uid"] = (
            "accepted into API.post(**kwargs) and ignored; it does not select or update a token"
        )
    return {
        "auth": {
            **global_gate,
            "dependency_exception_consequence": (
                "synthetic public current_user has id=None but is truthy; Auth Core accepts "
                "nullable token.user_id, so successful creation produces an ownerless token"
            ),
            "handler_falsy_user": (
                "403 with JSON null through Flask-RESTful; the synthetic public mapping is truthy and does "
                "not enter this branch"
            ),
        },
        "id": contract_id,
        "method": "POST",
        "outcomes": [
            {
                "body": "framework unsupported-media-type response",
                "condition": "request content type is not JSON when request.json is accessed",
                "status": 415,
            },
            {
                "body": "framework bad-request response",
                "condition": "request body declares JSON but JSON parsing fails",
                "status": 400,
            },
            {
                "body": "framework generic internal-server-error response",
                "condition": "parsed JSON is null, an array, or another non-mapping value",
                "error": "unhandled TypeError while indexing request.json by name",
                "status": 500,
            },
            {
                "body": {"error": "Name is required"},
                "content_type": "application/json",
                "condition": "request.json lacks the name key",
                "status": 400,
            },
            {
                "body": {"error": "expires measure be in <Python set repr>"},
                "content_type": "application/json",
                "condition": "truthy expires.measure is outside days/weeks/hours/minutes/seconds",
                "status": 400,
            },
            {
                "body": {"error": "expires must have \"measure\" key"},
                "content_type": "application/json",
                "condition": "truthy expires lacks measure",
                "status": 400,
            },
            {
                "body": {"error": "expires must be int, got <type(expires)>"},
                "content_type": "application/json",
                "condition": "int(expires.value) raises ValueError",
                "status": 400,
            },
            {
                "body": {"error": "expires must have \"value\" key"},
                "content_type": "application/json",
                "condition": "truthy expires lacks value",
                "status": 400,
            },
            {
                "body": "framework generic internal-server-error response",
                "condition": "expires is falsy but non-null and the downstream DateTime binding rejects the unchanged value",
                "error": "downstream RPC/database exception is uncaught by the HTTP handler",
                "status": 500,
            },
            {
                "body": "framework generic internal-server-error response",
                "condition": "truthy expires is non-mapping, measure is unhashable, int(value) raises TypeError/OverflowError, or datetime/timedelta construction fails",
                "error": "unhandled input exception",
                "status": 500,
            },
            {
                "body": "framework generic internal-server-error response",
                "condition": (
                    "current_user, auth.add_token, auth.get_token, auth.encode_token, "
                    "or their RPC transport fails outside an HTTP-handler catch"
                ),
                "error": "unhandled dependency exception",
                "partial_side_effect": (
                    "when auth.add_token completed first, AUTOCOMMIT can leave the new "
                    "token durable even though the client receives 500 or loses the response"
                ),
                "status": 500,
            },
            {
                "body": "JSON created token row with name=null and the full auth.encode_token(token_id) value",
                "content_type": "application/json",
                "condition": "name key is present with JSON null and the nullable Auth Core token.name insert succeeds",
                "status": 200,
            },
            {
                "body": "JSON created token row including the full auth.encode_token(token_id) value",
                "content_type": "application/json",
                "condition": "creation succeeds for any other name value accepted by the downstream RPC/database",
                "status": 200,
            },
        ],
        "request": {
            "json": {
                "expires": "missing or null means no expiration; any other falsy value bypasses parsing but is passed unchanged to the Auth Core DateTime insert; a truthy mapping needs a hashable allowed measure and int-coercible value",
                "name": "required by key presence only; JSON null and non-string JSON values are accepted by the HTTP handler and passed unchanged to auth.add_token",
            },
            "name_presence_semantics": {
                "missing": "handler returns 400 Name is required",
                "null": "handler passes Python None unchanged; Auth Core token.name is nullable Text, so the normal created response is 200 with name=null",
                "type_mismatch": "handler performs no type validation; a downstream RPC/driver/database rejection is uncaught here and reaches generic server-error handling rather than a normalized 400",
            },
            "path_parameters": path_parameters,
            "success_response_shape": {
                "expires": "null or Flask 3.1 JSON-provider HTTP-date string",
                "id": "integer",
                "name": "stored value, including null",
                "token": "full encoded token string; returned only on creation",
                "user_id": "integer or null",
                "uuid": "UUID string",
            },
            "unhandled_input_errors": [
                "parsed JSON is null or non-mapping",
                "downstream rejection of a non-string name value",
                "falsy non-null expires rejected by the downstream DateTime binding",
                "truthy non-mapping expires or an unhashable measure",
                "int(value) raises TypeError or OverflowError",
                "datetime/timedelta range errors",
            ],
        },
        "routes": contract_routes,
        "side_effects": [
            "expiration uses naive datetime.now() plus timedelta",
            "auth.add_token(current_user.id, name, expires); tracked effective AUTOCOMMIT can make the INSERT durable before later work",
            "auth.get_token(token_id)",
            "auth.encode_token(token_id)",
        ],
    }


def _behavior_contracts(
    handler_routes: dict[str, list[str]],
    registered_routes: dict[str, list[str]],
) -> list[dict[str, Any]]:
    global_gate = {
        "kind": "global_before_request",
        "local_permission_decorator": False,
        "reference": "global_auth_rpc_gate",
    }
    token_collection_routes = [
        route for route in handler_routes["token"] if "<string:uid>" not in route
    ]
    token_item_routes = [
        route for route in handler_routes["token"] if "<string:uid>" in route
    ]
    canonicalized_routes = sorted(
        route
        for resource_routes in registered_routes.values()
        for route in resource_routes
        if route.endswith("//")
    )
    return [
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "synthetic public current_user has id=None but is truthy; Auth Core "
                    "list_tokens(user_id=None) adds no WHERE clause and returns every token"
                ),
                "handler_falsy_user": "403 with JSON null through Flask-RESTful; the synthetic public current_user mapping is truthy and does not enter this branch",
            },
            "id": "pat.collection.get",
            "method": "GET",
            "outcomes": [
                {
                    "body": "JSON array filtered by the authenticated current_user.id; each row gains token='...' plus the last seven characters of encode_token(id)",
                    "content_type": "application/json",
                    "condition": "authoritative user or token principal",
                    "status": 200,
                },
                {
                    "body": "JSON array of every token row with each token redacted to its encoded last seven characters",
                    "content_type": "application/json",
                    "condition": "auth_authorize dependency exception produces synthetic public id=None",
                    "status": 200,
                },
                {
                    "body": "framework generic internal-server-error response",
                    "condition": (
                        "current_user, auth.list_tokens, any auth.encode_token call, "
                        "or their RPC transport fails"
                    ),
                    "error": "unhandled dependency exception",
                    "partial_side_effect": (
                        "rows encoded before a later failure may be mutated in process memory, "
                        "but no JSON response or persistent PAT mutation is completed here"
                    ),
                    "status": 500,
                },
            ],
            "request": {"path_parameters": {}},
            "routes": token_collection_routes,
            "side_effects": ["auth.list_tokens(current_user.id)", "auth.encode_token(id) for every row"],
        },
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "synthetic public current_user is truthy and item lookup remains global; "
                    "any existing token UUID can be returned"
                ),
                "handler_falsy_user": "403 with JSON null through Flask-RESTful; the synthetic public current_user mapping is truthy and does not enter this branch",
                "owner_check": False,
            },
            "id": "pat.item.get",
            "method": "GET",
            "outcomes": [
                {
                    "body": {"error": "token with uid <uid> not found"},
                    "content_type": "application/json",
                    "condition": "auth.get_token(uuid=uid) raises RuntimeError",
                    "status": 400,
                },
                {
                    "body": "JSON token row with token='...' plus the last seven characters of encode_token(id)",
                    "content_type": "application/json",
                    "condition": "token exists; source does not compare token.user_id to current_user.id",
                    "status": 200,
                },
                {
                    "body": "framework generic internal-server-error response",
                    "condition": (
                        "current_user or auth.encode_token fails, or auth.get_token/transport "
                        "fails with an exception not presented as the caught RuntimeError"
                    ),
                    "error": "unhandled dependency exception",
                    "status": 500,
                },
            ],
            "request": {"path_parameters": {"uid": "string; truthy branch selector"}},
            "routes": token_item_routes,
            "side_effects": ["auth.get_token(uuid=uid)", "auth.encode_token(token.id)"],
        },
        _pat_post_contract("pat.collection.post", token_collection_routes, item_route=False),
        _pat_post_contract("pat.item.post", token_item_routes, item_route=True),
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "public fallback does not change dispatch: API.delete still lacks required uid"
                ),
            },
            "id": "pat.collection.delete",
            "method": "DELETE",
            "outcomes": [
                {
                    "body": "framework generic internal-server-error response",
                    "condition": "Flask-RESTful dispatch invokes API.delete() without required uid",
                    "error": "unhandled TypeError before handler logic executes",
                    "status": 500,
                },
            ],
            "request": {"path_parameters": {}},
            "routes": token_collection_routes,
            "side_effects": [],
        },
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "synthetic public id=None can pass the owner check only for an ownerless "
                    "token whose nullable user_id is also None"
                ),
                "handler_falsy_user": "403 with JSON null through Flask-RESTful; the synthetic public current_user mapping is truthy and does not enter this branch",
                "owner_check": "token.user_id must equal current_user.id",
            },
            "id": "pat.item.delete",
            "method": "DELETE",
            "outcomes": [
                {"body": {"error": "token with uid <uid> not found"}, "condition": "lookup raises RuntimeError", "content_type": "application/json", "status": 400},
                {"body": "JSON null", "condition": "token belongs to another user", "content_type": "application/json", "status": 403},
                {"body": "empty", "condition": "owned token deleted", "status": 204},
                {
                    "body": "framework generic internal-server-error response",
                    "condition": (
                        "current_user or auth.delete_token fails, or auth.get_token/transport "
                        "fails with an exception not presented as the caught RuntimeError"
                    ),
                    "error": "unhandled dependency exception",
                    "partial_side_effect": (
                        "when auth.delete_token completed first, AUTOCOMMIT can leave the "
                        "deletion durable even though the client receives 500 or loses the response"
                    ),
                    "status": 500,
                },
            ],
            "request": {"path_parameters": {"uid": "required string"}},
            "routes": token_item_routes,
            "side_effects": [
                "auth.get_token(uuid=uid)",
                "auth.delete_token(token.id) only after owner check; tracked effective AUTOCOMMIT can make the DELETE durable before the response is observed",
            ],
        },
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "resolve_permissions sees public auth and returns an empty set; response is []"
                ),
            },
            "id": "rbac.permissions.get",
            "method": "GET",
            "outcomes": [
                {
                    "body": "JSON list converted from the resolved permission set; array order is unspecified",
                    "status": 200,
                }
            ],
            "request": {
                "path_parameters": {
                    "mode": "string passed unchanged to resolve_permissions",
                    "project_id": (
                        "Flask integer converter accepts 0; resolve_permissions receives it, "
                        "but treats 0 as absent and replaces it with project_get_id() or None "
                        "when that RPC raises"
                    ),
                }
            },
            "routes": handler_routes["permissions"],
            "side_effects": [
                "resolve_permissions returns user or token permissions for the requested mode/project",
                "project_id=0 invokes project_get_id() with a 15-second RPC timeout before permission resolution",
                "permission-resolution exceptions are caught by Module.resolve_permissions and become an empty set",
            ],
        },
        {
            "auth": {
                **global_gate,
                "dependency_exception_consequence": (
                    "current_user returns the truthy public mapping with id=None; the handler "
                    "continues into project and referenced-auth-context RPC work"
                ),
                "handler_falsy_user_check": False,
            },
            "id": "current_user.get",
            "method": "GET",
            "outcomes": [
                {
                    "body": "JSON authoritative Auth user mapping plus avatar and, when resolved, personal_project_id",
                    "condition": "authoritative user and downstream calls do not raise an uncaught exception",
                    "status": 200,
                },
                {
                    "body": "JSON public mapping with id=null, email, name, avatar and optional personal_project_id",
                    "condition": "auth_authorize dependency exception and downstream calls complete or raise only caught exceptions",
                    "status": 200,
                },
                {
                    "body": "framework generic internal-server-error response",
                    "condition": (
                        "current_user authoritative lookup/mapping fails, project RPC raises "
                        "anything except queue.Empty, or referenced-context RPC raises/returns "
                        "an unsubscriptable value such as None"
                    ),
                    "status": 500,
                },
            ],
            "request": {
                "path_parameters": {
                    "mode": "optional string accepted by one route variant and ignored by the handler"
                }
            },
            "routes": handler_routes["user"],
            "side_effects": [
                "projects_get_personal_project_id(user.id) with 15-second RPC timeout; only queue.Empty is ignored",
                "avatar reads referenced auth context provider_attr.attributes.picture; only AttributeError/KeyError become null",
                "the returned user mapping is mutated with derived fields",
                "a failure after personal_project_id mutation can end as 500 with only an in-memory partial response object",
                "a synthetic public current_user mapping can reach this handler after an auth_authorize dependency exception",
            ],
        },
        {
            "auth": global_gate,
            "id": "inherited.empty_mode_handlers.404",
            "method": ["DELETE", "PATCH", "POST", "PUT"],
            "outcomes": [
                {
                    "body": "Flask-RESTful abort(404) framework representation",
                    "condition": "an APIBase method not overridden by token/user calls proxy_method and inherited mode_handlers is empty",
                    "status": 404,
                }
            ],
            "routes": handler_routes["token"] + handler_routes["user"],
            "side_effects": ["APIBase.proxy_method logs missing mode handler and aborts before product logic"],
        },
        {
            "auth": global_gate,
            "id": "framework.head_via_get",
            "method": "HEAD",
            "outcomes": [
                {
                    "body": "empty HTTP body; GET handler is executed and its status and headers are retained",
                    "condition": "Werkzeug adds HEAD for GET and Flask MethodView falls back from head to get",
                    "status": "same as associated GET contract",
                }
            ],
            "routes": (
                handler_routes["permissions"]
                + handler_routes["token"]
                + handler_routes["user"]
            ),
            "side_effects": ["all associated GET side effects still execute"],
        },
        {
            "auth": {
                **global_gate,
                "condition": "request is allowed past the global gate",
            },
            "id": "framework.merge_slashes.redirect",
            "method": ["DELETE", "GET", "HEAD", "PATCH", "POST", "PUT"],
            "outcomes": [
                {
                    "body": "framework redirect response; HEAD transmits no body",
                    "condition": (
                        "Werkzeug merge_slashes canonicalizes a registered double-slash "
                        "collection rule before any resource handler dispatch"
                    ),
                    "location_paths": {
                        "/api/v2/auth/token//": "/api/v2/auth/token/",
                        "/api/v2/auth/user//": "/api/v2/auth/user/",
                    },
                    "status": 308,
                }
            ],
            "routes": canonicalized_routes,
            "side_effects": ["no PAT or current-user resource handler executes"],
        },
        {
            "auth": {
                **global_gate,
                "denial_masking": (
                    "Auth after_request replaces the response for OPTIONS when ALLOW_CORS=true, "
                    "including denial, redirect, 404/405, and automatic Allow responses"
                ),
            },
            "id": "framework.options.cors",
            "method": "OPTIONS",
            "outcomes": [
                {
                    "body": "empty",
                    "headers": {
                        "Access-Control-Allow-Credentials": "true",
                        "Access-Control-Allow-Headers": "*",
                        "Access-Control-Allow-Methods": "*",
                        "Access-Control-Allow-Origin": "*",
                    },
                    "status": 200,
                }
            ],
            "routes": (
                registered_routes["permissions"]
                + registered_routes["token"]
                + registered_routes["user"]
            ),
            "side_effects": [
                "global before_request Auth authorization still runs before automatic OPTIONS handling",
                "Auth after_request discards the original OPTIONS response and constructs a blank response",
                "Access-Control-Allow-Origin '*' combined with Allow-Credentials true is invalid for credentialed browser CORS",
            ],
        },
    ]


def _method_route_matrix(
    handler_routes: dict[str, list[str]],
) -> dict[str, dict[str, str]]:
    matrix: dict[str, dict[str, str]] = {}
    token_collection_routes = [
        route for route in handler_routes["token"] if "<string:uid>" not in route
    ]
    token_item_routes = [
        route for route in handler_routes["token"] if "<string:uid>" in route
    ]
    for route in token_collection_routes:
        matrix[route] = {
            "DELETE": "pat.collection.delete",
            "GET": "pat.collection.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "pat.collection.post",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in token_item_routes:
        matrix[route] = {
            "DELETE": "pat.item.delete",
            "GET": "pat.item.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "pat.item.post",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in handler_routes["user"]:
        matrix[route] = {
            "DELETE": "inherited.empty_mode_handlers.404",
            "GET": "current_user.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
            "PATCH": "inherited.empty_mode_handlers.404",
            "POST": "inherited.empty_mode_handlers.404",
            "PUT": "inherited.empty_mode_handlers.404",
        }
    for route in handler_routes["permissions"]:
        matrix[route] = {
            "GET": "rbac.permissions.get",
            "HEAD": "framework.head_via_get",
            "OPTIONS": "framework.options.cors",
        }
    return matrix


def _canonicalization_matrix(
    registered_routes: dict[str, list[str]],
) -> dict[str, dict[str, Any]]:
    canonical_targets = {
        "/api/v2/auth/token//": "/api/v2/auth/token/",
        "/api/v2/auth/user//": "/api/v2/auth/user/",
    }
    observed = {
        route
        for resource_routes in registered_routes.values()
        for route in resource_routes
        if route.endswith("//")
    }
    if observed != set(canonical_targets):
        raise ValueError(
            f"double-slash route registration changed: {sorted(observed)!r}; "
            "review canonicalization evidence"
        )
    matrix: dict[str, dict[str, Any]] = {}
    for route, target in sorted(canonical_targets.items()):
        matrix[route] = {
            "canonical_location_path": target,
            "methods": {
                method: {
                    "contract_id": "framework.merge_slashes.redirect",
                    "status": 308,
                }
                for method in ("DELETE", "GET", "HEAD", "PATCH", "POST", "PUT")
            }
            | {
                "OPTIONS": {
                    "contract_id": "framework.options.cors",
                    "redirect_response_replaced_by_auth_after_request": True,
                    "status": 200,
                }
            },
        }
    return matrix


def _guard_contract() -> dict[str, Any]:
    return {
        "authentication_mode": "rpc from pylon_main/configs/auth.yml",
        "authorization_request": {
            "cookies": "all request cookies",
            "headers": "all request headers",
            "source": ["method", "proto", "host", "uri", "ip", "target='rpc'", "scope=null"],
            "timeout_seconds": 15,
        },
        "cache": "successful auth_authorize results may be cached in Redis for 60 seconds by hashed Authorization header or session cookie",
        "denied": {
            "make_response": {
                "body": "auth_status.data",
                "session": "destroyed",
                "status": "auth_status.status_code",
            },
            "other": {
                "body": "Access Denied",
                "session": "kept",
                "status": 403,
            },
            "public_rule": {
                "effect": "convert to public principal and continue",
                "session": "kept",
            },
            "redirect": {
                "location": "auth_status.target",
                "session": "destroyed",
                "status": 302,
            },
        },
        "dependency_exception": {
            "effect": "auth_authorize exceptions are converted to public auth and request processing continues",
            "principal": {"id": "-", "reference": "-", "type": "public"},
        },
        "identity_headers": ["X-Auth-Type", "X-Auth-ID", "X-Auth-Reference"],
        "public_rules": [
            "/forward\\-auth/.*",
            "/applications/application_icon.*",
            "/datasources/datasource_icon.*",
            "/prompt_lib/prompt_icon.*",
        ],
        "reviewed_routes_match_public_rule": False,
    }


def _principal_contract() -> dict[str, Any]:
    return {
        "cache": "auth_data.user is returned when already attached",
        "public": {"email": "public@platform.user", "id": None, "name": "Public"},
        "token": "load token by auth_data.id, then load authoritative user by token.user_id, cache on auth_data.user",
        "user": "load authoritative user by auth_data.id and cache on auth_data.user",
    }


def _authoritative_user_contract() -> dict[str, Any]:
    return {
        "lookup": (
            "Auth Core RPC.get_user selects exactly one row by the first non-null selector "
            "in user_id, email, name order"
        ),
        "mapping": (
            "db_tools.sqlalchemy_mapping_to_dict copies the SQLAlchemy mapping and converts "
            "every mapping key to str while preserving values"
        ),
        "missing_user": (
            "SQLAlchemy NoResultFound becomes selector-specific RuntimeError; other failures "
            "are also transported as RuntimeError by wrap_exceptions"
        ),
        "current_user_consequence": (
            "user and token principals depend on this authoritative mapping; uncaught lookup "
            "or mapping failures can make reviewed HTTP handlers return generic 500"
        ),
    }


def _rpc_exception_contract() -> dict[str, Any]:
    return {
        "decorator": "Auth Core rpc_tools.wrap_exceptions(RuntimeError)",
        "behavior": {
            "existing_runtime_error": "re-raised unchanged",
            "other_base_exception": "wrapped as RuntimeError containing traceback.format_exc()",
        },
        "http_consequences": {
            "token_lookup": "GET and DELETE lookup handlers catch the transported RuntimeError and return their documented 400 JSON error",
            "uncaught_mutation_or_followup": "POST add/get and DELETE execution do not catch transported RuntimeError and reach generic 500 handling",
        },
    }


def _persistence_contract(
    base_isolation: str | None,
    override_isolation: str | None,
    base_isolation_at_head: str | None,
    override_isolation_at_head: str | None,
    base_db_option_keys: list[str],
    override_db_option_keys: list[str],
) -> dict[str, Any]:
    effective = override_isolation or base_isolation
    effective_at_head = override_isolation_at_head or base_isolation_at_head
    return {
        "base_plugin_db_options_isolation_level": base_isolation,
        "effective_tracked_isolation_level": effective,
        "effective_tracked_value_matches_pinned_heads": effective == effective_at_head,
        "effective_tracked_db_option_keys": sorted(
            set(base_db_option_keys) | set(override_db_option_keys)
        ),
        "module_wiring": (
            "Pylon ModuleDescriptor.load_config recursively merges plugin and tracked runtime "
            "config; Auth Core Module.__init__ reads merged descriptor.config.db_options and "
            "Module.init passes those options to sqlalchemy.create_engine"
        ),
        "plugin_base_db_option_keys": base_db_option_keys,
        "persistence_consequence": (
            "AUTOCOMMIT makes each PAT INSERT/DELETE durable without an explicit commit in "
            "rpc/tokens.py"
        ),
        "tracked_runtime_override_db_option_keys": override_db_option_keys,
        "tracked_runtime_override_isolation_level": override_isolation,
        "verification_limit": (
            "This is the effective merge of pinned plugin config and tracked pylon_auth "
            "config. A runtime config-provider payload can override db_options and is not "
            "executed or inspected by this static evidence."
        ),
    }


def _token_encoding_contract() -> dict[str, Any]:
    return {
        "algorithm": "HS512",
        "dependency_from_auth_core_requirements": "PyJWT==2.7.0",
        "payload": {
            "expires": "null or datetime.isoformat(timespec='minutes')",
            "uuid": "stored token UUID",
        },
        "byte_level_output_pinned": False,
        "limit": (
            "Exact JWT bytes vary with the generated UUID, expiration, application secret, "
            "and dependency execution; this fixture pins shape/algorithm, not token bytes."
        ),
    }


def _framework_contract(
    allow_cors: bool,
    allow_cors_at_head: bool,
) -> dict[str, Any]:
    return {
        "dependencies_from_pylon_requirements": {
            "Flask": "3.1.3",
            "Flask-RESTful": "0.3.10",
            "Werkzeug": "3.1.6",
        },
        "head": "Werkzeug exposes HEAD wherever GET exists; Flask MethodView dispatches HEAD through GET when no explicit head method exists",
        "options": "Flask supplies automatic OPTIONS because no reviewed resource defines an explicit options method",
        "registered_route_note": (
            "Pylon appends both '/<url_param>' and '/<url_param>/'; an empty url_param "
            "therefore registers slash and double-slash collection rules. With the pinned "
            "Werkzeug version, non-OPTIONS requests to reviewed double-slash rules receive "
            "a 308 merge-slashes redirect; Auth after_request replaces OPTIONS with blank 200."
        ),
        "runtime_cors": {
            "contract_value_matches_pinned_head": allow_cors == allow_cors_at_head,
            "observed_worktree_allow_cors": allow_cors,
            "pinned_head_allow_cors": allow_cors_at_head,
            "source_chain": [
                "shared Config accepts lowercase settings.allow_cors as ALLOW_CORS",
                "shared Module registers Config as tools.constants",
                "Auth Module._after_request_hook reads tools.constants.ALLOW_CORS",
            ],
            "source_selector": "centry:pylon_main/configs/shared.yml#settings.allow_cors",
        },
    }


def build_catalog(
    auth_root: Path,
    auth_core_root: Path,
    shared_api_root: Path,
    projects_root: Path,
    pylon_root: Path,
    main_auth_config: Path,
) -> dict[str, Any]:
    auth_root = auth_root.resolve()
    auth_core_root = auth_core_root.resolve()
    shared_api_root = shared_api_root.resolve()
    projects_root = projects_root.resolve()
    pylon_root = pylon_root.resolve()
    main_auth_config = main_auth_config.resolve()
    for relative in AUTH_SOURCE_FILES:
        if not (auth_root / relative).is_file():
            raise ValueError(f"missing Auth evidence source: {relative}")
    for relative in AUTH_CORE_SOURCE_FILES:
        if not (auth_core_root / relative).is_file():
            raise ValueError(f"missing Auth Core evidence source: {relative}")
    for relative in SHARED_API_SOURCE_FILES:
        if not (shared_api_root / relative).is_file():
            raise ValueError(f"missing shared API evidence source: {relative}")
    for relative in PROJECTS_SOURCE_FILES:
        if not (projects_root / relative).is_file():
            raise ValueError(f"missing Projects evidence source: {relative}")
    for relative in PYLON_SOURCE_FILES:
        if not (pylon_root / relative).is_file():
            raise ValueError(f"missing Pylon evidence source: {relative}")
    descriptor_path = pylon_root / PYLON_SOURCE_FILES[0]
    if not descriptor_path.is_file() or not main_auth_config.is_file():
        raise ValueError("missing route framework or pylon_main Auth runtime config evidence")

    trees = {
        relative: _parse(auth_root / relative)
        for relative in AUTH_SOURCE_FILES
        if relative.endswith(".py")
    }
    resources: dict[str, dict[str, Any]] = {}
    registered_routes: dict[str, list[str]] = {}
    handler_routes: dict[str, list[str]] = {}
    shared_api_tree = _parse(shared_api_root / "tools/api_tools.py")
    shared_api_methods = _class_http_methods(shared_api_tree, "APIBase")
    if shared_api_methods != ["delete", "get", "patch", "post", "put"]:
        raise ValueError(
            f"shared APIBase methods changed: {shared_api_methods!r}; review effective methods"
        )
    for resource in sorted(EXPECTED_RESOURCES):
        relative = f"api/v2/{resource}.py"
        url_params, direct_methods, resource_base = _validate_resource(
            resource, trees[relative]
        )
        inherited_methods = (
            sorted(set(shared_api_methods).difference(direct_methods))
            if resource_base == "api_tools.APIBase"
            else []
        )
        effective_methods = sorted(set(direct_methods) | set(inherited_methods))
        exposed_methods = sorted(
            set(effective_methods)
            | ({"head"} if "get" in effective_methods else set())
            | {"options"}
        )
        resource_registered_routes = _route_variants(resource, url_params)
        resource_handler_routes = _direct_dispatch_routes(resource_registered_routes)
        registered_routes[resource] = resource_registered_routes
        handler_routes[resource] = resource_handler_routes
        resources[resource] = {
            "direct_handler_methods": [method.upper() for method in direct_methods],
            "effective_handler_methods": [method.upper() for method in effective_methods],
            "exposed_http_methods": [method.upper() for method in exposed_methods],
            "framework_generated_methods": ["HEAD", "OPTIONS"],
            "handler_routes": resource_handler_routes,
            "inherited_handler_methods": [method.upper() for method in inherited_methods],
            "registered_routes": resource_registered_routes,
            "resource_base": resource_base,
            "source": relative,
            "url_params": url_params,
        }

    fingerprints: dict[str, dict[str, Any]] = {}
    for relative, targets in sorted(FINGERPRINT_TARGETS.items()):
        for class_name, method_name in targets:
            key = f"{relative}#{class_name}.{method_name}"
            fingerprints[key] = _method_fingerprint(
                _method(trees[relative], class_name, method_name)
            )
    descriptor_tree = _parse(descriptor_path)
    fingerprints["pylon/core/tools/module/descriptor.py#ModuleDescriptor.init_api"] = (
        _method_fingerprint(_method(descriptor_tree, "ModuleDescriptor", "init_api"))
    )
    fingerprints["pylon/core/tools/module/descriptor.py#ModuleDescriptor.load_config"] = (
        _method_fingerprint(_method(descriptor_tree, "ModuleDescriptor", "load_config"))
    )
    pylon_dict_tree = _parse(pylon_root / "pylon/core/tools/dict.py")
    fingerprints["pylon/core/tools/dict.py#recursive_merge"] = _method_fingerprint(
        _function(pylon_dict_tree, "recursive_merge")
    )
    auth_core_tokens_tree = _parse(auth_core_root / "rpc/tokens.py")
    fingerprints["auth_core/rpc/tokens.py#RPC.add_token"] = _method_fingerprint(
        _method(auth_core_tokens_tree, "RPC", "add_token")
    )
    fingerprints["auth_core/rpc/tokens.py#RPC.encode_token"] = _method_fingerprint(
        _method(auth_core_tokens_tree, "RPC", "encode_token")
    )
    auth_core_users_tree = _parse(auth_core_root / "rpc/users.py")
    fingerprints["auth_core/rpc/users.py#RPC.get_user"] = _method_fingerprint(
        _method(auth_core_users_tree, "RPC", "get_user")
    )
    auth_core_db_tools_tree = _parse(auth_core_root / "db/db_tools.py")
    fingerprints[
        "auth_core/db/db_tools.py#sqlalchemy_mapping_to_dict"
    ] = _method_fingerprint(
        _function(auth_core_db_tools_tree, "sqlalchemy_mapping_to_dict")
    )
    for relative, class_name, method_name in AUTH_CORE_CONTEXT_FINGERPRINT_TARGETS:
        tree = _parse(auth_core_root / relative)
        key = f"auth_core/{relative}#{class_name}.{method_name}"
        fingerprints[key] = _method_fingerprint(_method(tree, class_name, method_name))
    auth_core_rpc_tools_tree = _parse(auth_core_root / "tools/rpc_tools.py")
    fingerprints["auth_core/tools/rpc_tools.py#wrap_exceptions"] = _method_fingerprint(
        _function(auth_core_rpc_tools_tree, "wrap_exceptions")
    )
    for class_name, method_name in SHARED_API_FINGERPRINT_TARGETS:
        key = f"shared/tools/api_tools.py#{class_name}.{method_name}"
        fingerprints[key] = _method_fingerprint(
            _method(shared_api_tree, class_name, method_name)
        )
    projects_tree = _parse(projects_root / "rpc/poc.py")
    fingerprints["projects/rpc/poc.py#RPC.get_personal_project_id"] = (
        _method_fingerprint(_method(projects_tree, "RPC", "get_personal_project_id"))
    )

    auth_contract_paths = set(AUTH_SOURCE_FILES)
    auth_core_contract_paths = set(AUTH_CORE_SOURCE_FILES)
    shared_api_contract_paths = set(SHARED_API_SOURCE_FILES)
    projects_contract_paths = set(PROJECTS_SOURCE_FILES)
    pylon_contract_paths = set(PYLON_SOURCE_FILES)
    pylon_contract_path = PYLON_SOURCE_FILES[0]
    centry_repo = Path(str(_run_git(main_auth_config.parent, "rev-parse", "--show-toplevel")).strip())
    config_relative = main_auth_config.relative_to(centry_repo).as_posix()
    shared_runtime_config_relative = "pylon_main/configs/shared.yml"
    auth_core_runtime_config_relative = "pylon_auth/configs/auth_core.yml"
    shared_runtime_config = centry_repo / shared_runtime_config_relative
    auth_core_runtime_config = centry_repo / auth_core_runtime_config_relative
    if not shared_runtime_config.is_file() or not auth_core_runtime_config.is_file():
        raise ValueError("missing tracked Auth runtime config evidence")
    allow_cors = _setting_bool(shared_runtime_config.read_text(encoding="utf-8"), "allow_cors")
    allow_cors_at_head = _setting_bool(
        str(_run_git(centry_repo, "show", f"HEAD:{shared_runtime_config_relative}")),
        "allow_cors",
    )
    if not allow_cors or not allow_cors_at_head:
        raise ValueError("reviewed runtime no longer enables ALLOW_CORS; review OPTIONS semantics")
    runtime_config_provenance = git_provenance(
        centry_repo,
        {config_relative, auth_core_runtime_config_relative},
    )
    auth_provenance = git_provenance(auth_root, auth_contract_paths)
    auth_metadata = json.loads((auth_root / "metadata.json").read_text(encoding="utf-8"))
    auth_metadata_at_head = json.loads(str(_run_git(auth_root, "show", "HEAD:metadata.json")))
    init_after = auth_metadata.get("init_after")
    init_after_at_head = auth_metadata_at_head.get("init_after")
    if init_after != ["shared", "auth_core"] or init_after != init_after_at_head:
        raise ValueError("Auth init_after composition changed; review shared API inheritance")
    auth_core_config_text = (auth_core_root / "config.yml").read_text(encoding="utf-8")
    auth_core_config_at_head = str(_run_git(auth_core_root, "show", "HEAD:config.yml"))
    auth_core_runtime_config_text = auth_core_runtime_config.read_text(encoding="utf-8")
    auth_core_runtime_config_at_head = str(
        _run_git(centry_repo, "show", f"HEAD:{auth_core_runtime_config_relative}")
    )
    base_isolation = _literal_yaml_scalar(auth_core_config_text, "isolation_level")
    base_isolation_at_head = _literal_yaml_scalar(
        auth_core_config_at_head, "isolation_level"
    )
    override_isolation = _literal_yaml_scalar(
        auth_core_runtime_config_text, "isolation_level"
    )
    override_isolation_at_head = _literal_yaml_scalar(
        auth_core_runtime_config_at_head, "isolation_level"
    )
    base_db_option_keys = _literal_yaml_mapping_keys(
        auth_core_config_text, "db_options"
    )
    override_db_option_keys = _literal_yaml_mapping_keys(
        auth_core_runtime_config_text, "db_options"
    )
    if (override_isolation or base_isolation) != "AUTOCOMMIT" or (
        override_isolation_at_head or base_isolation_at_head
    ) != "AUTOCOMMIT":
        raise ValueError("tracked Auth Core isolation is not pinned AUTOCOMMIT")

    return {
        "authoritative_user_resolution": _authoritative_user_contract(),
        "behavior_contracts": _behavior_contracts(handler_routes, registered_routes),
        "behavior_fingerprints": fingerprints,
        "auth_core_persistence": _persistence_contract(
            base_isolation,
            override_isolation,
            base_isolation_at_head,
            override_isolation_at_head,
            base_db_option_keys,
            override_db_option_keys,
        ),
        "composition_evidence": {
            "auth_init_after": init_after,
            "contract_value_matches_pinned_head": init_after == init_after_at_head,
            "source_selector": "pylon_main/plugins/auth/metadata.json#init_after",
        },
        "canonicalization_matrix": _canonicalization_matrix(registered_routes),
        "framework_http_semantics": _framework_contract(allow_cors, allow_cors_at_head),
        "global_auth_rpc_gate": _guard_contract(),
        "inference_limits": [
            "This is static source, pinned dependency, and checked-in configuration evidence; it does not execute Flask, Redis, RPC, PostgreSQL, or Traefik.",
            "Only permissions.py, token.py, user.py, shared APIBase inheritance, the shared current_user RPC, and their global request/route composition are covered.",
            "The separately consumed Social current-author endpoint, administrative Auth APIs, browser login providers, UI behavior, and runtime-only config overrides are excluded.",
            "Python set-to-list and set-repr ordering is explicitly unspecified rather than normalized into a false byte-level promise.",
            "Framework generic 404/500 bodies are named but not byte-pinned because this evidence does not execute the configured Flask error pipeline.",
        ],
        "method_route_matrix": _method_route_matrix(handler_routes),
        "principal_resolution": _principal_contract(),
        "rpc_exception_translation": _rpc_exception_contract(),
        "provenance": {
            "auth_core_repo": {
                **git_provenance(auth_core_root, auth_core_contract_paths),
                "source_root": "pylon_auth/plugins/auth_core",
            },
            "auth_repo": {
                **auth_provenance,
                "source_root": "pylon_main/plugins/auth",
            },
            "projects_repo": {
                **git_provenance(projects_root, projects_contract_paths),
                "source_root": "pylon_main/plugins/projects",
            },
            "route_framework_repo": {
                **git_provenance(pylon_root, pylon_contract_paths),
                "source_root": "pylon",
            },
            "runtime_config_repo": {
                **runtime_config_provenance,
                "source_root": "centry",
            },
            "shared_api_repo": {
                **git_provenance(shared_api_root, shared_api_contract_paths),
                "source_root": "pylon_main/plugins/shared",
            },
        },
        "resources": resources,
        "schema_version": SCHEMA_VERSION,
        "scope": {
            "claim": "bounded current-baseline pylon_main Auth HTTP evidence",
            "covered_contract_ids": [
                "current_user.get",
                "framework.head_via_get",
                "framework.merge_slashes.redirect",
                "framework.options.cors",
                "inherited.empty_mode_handlers.404",
                "pat.collection.delete",
                "pat.collection.get",
                "pat.collection.post",
                "pat.item.delete",
                "pat.item.get",
                "pat.item.post",
                "rbac.permissions.get",
            ],
            "full_auth_parity_claim": False,
        },
        "source_reconstruction": {
            "contract_file_hashes": (
                "source_files_sha256 hashes reviewed worktree bytes; every listed file is "
                "absent from its repository's contract_source_dirty_paths and therefore "
                "reconstructable from that repository's pinned_head"
            ),
            "runtime_allow_cors_selector": (
                "Only pylon_main/configs/shared.yml#settings.allow_cors is evidence: the "
                "current semantic selector is compared with pinned HEAD, while unrelated "
                "fields and whole-file dirty state are intentionally non-gating"
            ),
        },
        "token_encoding": _token_encoding_contract(),
        "source_files_sha256": {
            "auth/" + relative: _file_sha256(auth_root / relative)
            for relative in AUTH_SOURCE_FILES
        }
        | {
            "auth_core/" + relative: _file_sha256(auth_core_root / relative)
            for relative in AUTH_CORE_SOURCE_FILES
        }
        | {
            "shared/" + relative: _file_sha256(shared_api_root / relative)
            for relative in SHARED_API_SOURCE_FILES
        }
        | {
            "projects/" + relative: _file_sha256(projects_root / relative)
            for relative in PROJECTS_SOURCE_FILES
        }
        | {
            "centry/" + config_relative: _file_sha256(main_auth_config),
            "centry/" + auth_core_runtime_config_relative: _file_sha256(
                auth_core_runtime_config
            ),
        }
        | {
            "pylon/" + relative: _file_sha256(pylon_root / relative)
            for relative in PYLON_SOURCE_FILES
        },
    }


def _serialized(catalog: dict[str, Any]) -> str:
    return json.dumps(catalog, indent=2, sort_keys=True) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--auth-root", type=Path, default=Path("../centry/pylon_main/plugins/auth"))
    parser.add_argument(
        "--auth-core-root",
        type=Path,
        default=Path("../centry/pylon_auth/plugins/auth_core"),
    )
    parser.add_argument(
        "--shared-api-root",
        type=Path,
        default=Path("../centry/pylon_main/plugins/shared"),
    )
    parser.add_argument(
        "--projects-root",
        type=Path,
        default=Path("../centry/pylon_main/plugins/projects"),
    )
    parser.add_argument("--pylon-root", type=Path, default=Path("../pylon"))
    parser.add_argument("--main-auth-config", type=Path, default=Path("../centry/pylon_main/configs/auth.yml"))
    parser.add_argument("--output", type=Path, default=Path("testdata/baseline/main-auth-http-contracts.json"))
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    try:
        rendered = _serialized(
            build_catalog(
                args.auth_root,
                args.auth_core_root,
                args.shared_api_root,
                args.projects_root,
                args.pylon_root,
                args.main_auth_config,
            )
        )
    except (OSError, ValueError) as exc:
        print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
        return 2

    if args.check:
        try:
            current = args.output.read_text(encoding="utf-8")
        except OSError as exc:
            print(json.dumps({"error": str(exc)}, sort_keys=True), file=sys.stderr)
            return 2
        if current != rendered:
            print(
                json.dumps(
                    {
                        "error": "reviewed pylon_main Auth HTTP evidence changed",
                        "output": args.output.as_posix(),
                    },
                    sort_keys=True,
                ),
                file=sys.stderr,
            )
            return 1
        print(json.dumps({"ok": True, "output": args.output.as_posix()}, sort_keys=True))
        return 0

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(rendered, encoding="utf-8")
    print(json.dumps({"ok": True, "output": args.output.as_posix()}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
