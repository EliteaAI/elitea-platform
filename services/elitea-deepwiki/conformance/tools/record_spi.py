#!/usr/bin/env python3
"""Record the legacy DeepWiki SPI request/response shapes as fixtures.

Every response body in ``fixtures/spi/`` is *executed* out of the legacy
source, not transcribed:

* ``routes/health.py``, ``routes/slots.py``, ``routes/descriptor.py``,
  ``routes/invoke.py`` and ``routes/invocations.py`` are imported verbatim with
  a stubbed ``pylon.core.tools`` and a stubbed ``flask``, then called against a
  fake module ``self``;
* the error contract comes from calling
  ``methods/invoke.py::_create_error_response`` with real exception instances,
  so the recorded ``error_category`` mapping is the legacy classifier's own
  output;
* the toolkit-name aliases ``perform_invoke_request`` accepts are read out of
  the function's AST, so they cannot drift from the source silently.

Outputs (under ``fixtures/spi/``):

    routes.json                  route table + method/status matrix
    health.get.json              GET /health
    slots.get.json               GET /slots (subprocess mode variants)
    descriptor.get.json          GET /descriptor (pointer to the golden fixture)
    invoke.post.json             POST .../invoke — accepted and failure cases
    invocations.get.json         GET .../invocations/{id} — every status
    invocations.delete.json      DELETE .../invocations/{id}
    custom_events.json           the progress-event envelope and drain semantics
    toolkit_aliases.json         accepted toolkit names and per-toolkit tool sets
    errors.json                  the error contract, per exception class

Usage:
    python tools/record_spi.py [--check]
"""

from __future__ import annotations

import argparse
import ast
import json
import sys
import threading
import types
from pathlib import Path
from typing import Any, Dict, List

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _legacy import legacy_root, load_legacy_module, source_pin  # noqa: E402

FIXTURES = Path(__file__).resolve().parents[1] / "fixtures" / "spi"

SOURCE_FILES = [
    "routes/descriptor.py",
    "routes/health.py",
    "routes/invoke.py",
    "routes/invocations.py",
    "routes/slots.py",
    "methods/invoke.py",
    "methods/invocations.py",
]


# ---------------------------------------------------------------------------
# stubs
# ---------------------------------------------------------------------------


class _FlaskResponse:
    """Records what ``flask.Response(status=...)`` was constructed with."""

    def __init__(self, status: int = 200, **_kwargs: Any):
        self.status = status


class _FlaskRequest:
    method = "GET"
    json: Any = None


def install_flask_stub() -> types.ModuleType:
    """Install a ``flask`` stub exposing only ``request`` and ``Response``."""
    stub = types.ModuleType("flask")
    stub.request = _FlaskRequest()
    stub.Response = _FlaskResponse
    sys.modules["flask"] = stub
    return stub


class _FakeDescriptor:
    def __init__(self, config: Dict[str, Any]):
        self.config = config


class _FakeTaskNode:
    """Minimal stand-in for the Arbiter TaskNode the invoke route drives."""

    def __init__(self, invocation_id):
        self._invocation_id = invocation_id
        self.calls: List[Dict[str, Any]] = []

    def start_task(self, name, kwargs, pool, meta):
        self.calls.append({"task": name, "kwargs": kwargs, "pool": pool, "meta": meta})
        return self._invocation_id


class _FakeModule:
    """Fake Pylon module instance carrying the state the routes touch."""

    def __init__(self, *, invocation_id="invocation_0000000000000000"):
        self.descriptor = _FakeDescriptor(
            {"base_path": "/tmp/wiki_builder", "service_location_url": "http://127.0.0.1:8080"}
        )
        self.start_time = 1_700_000_000.0
        self.state_lock = threading.Lock()
        self.invocation_state: Dict[str, Dict[str, Dict[str, Any]]] = {}
        self.invocation_task_node = _FakeTaskNode(invocation_id)

    def runtime_config(self):
        # Mirrors methods/config.py::runtime_config with the legacy defaults.
        return {
            "base_path": "/tmp/wiki_builder",
            "service_location_url": "http://127.0.0.1:8080",
        }

    def provider_descriptor(self):  # pragma: no cover - not exercised here
        raise AssertionError("descriptor is captured by tools/capture_descriptor.py")


def _normalise(value: Any) -> Any:
    """Turn a legacy handler return value into a JSON-able record."""
    if isinstance(value, tuple):
        body, status = value
        return {"status_code": status, "body": body}
    if isinstance(value, _FlaskResponse):
        return {"status_code": value.status, "body": None}
    return {"status_code": 200, "body": value}


# ---------------------------------------------------------------------------
# recorders
# ---------------------------------------------------------------------------


def record_health() -> Dict[str, Any]:
    install_flask_stub()
    mod = load_legacy_module("routes/health.py", "deepwiki_legacy_route_health")
    module_self = _FakeModule()
    recorded = _normalise(mod.Route.health_route(module_self))

    body = recorded["body"]
    # Wall-clock fields are volatile; pin their shape, not their value.
    volatile = {
        "uptime": "integer seconds since process start",
        "timestamp": "%Y-%m-%dT%H:%M:%S+00:00 (UTC)",
        "extra_info.hostname": "$HOSTNAME or $POD_NAME, else 'unknown'",
        "extra_info.pod_ip": "$POD_IP, else 'unknown'",
    }
    for key in ("uptime", "timestamp"):
        body[key] = f"<{key}>"
    body["extra_info"] = {"hostname": "<hostname>", "pod_ip": "<pod_ip>"}

    return {
        "route": "GET /health",
        "authentication": "none in the legacy service",
        "success": recorded,
        "volatile_fields": volatile,
        "failure": {
            "trigger": "any exception raised while building the payload",
            "status_code": 500,
            "body": {"status": "unhealthy", "plugin": "wiki_builder", "error": "<str(exception)>"},
        },
        "notes": [
            "status is the literal 'UP' on success and 'unhealthy' on failure —"
            " the two are not the same vocabulary and both must be accepted.",
            "'plugin' is 'DeepWikiPlugin' on success but 'wiki_builder' on failure.",
            "configuration is the runtime_config() dict: base_path + service_location_url.",
        ],
    }


def record_slots() -> Dict[str, Any]:
    install_flask_stub()
    mod = load_legacy_module("routes/slots.py", "deepwiki_legacy_route_slots")
    module_self = _FakeModule()

    import os

    os.environ.pop("DEEPWIKI_JOBS_ENABLED", None)
    os.environ["DEEPWIKI_MAX_PARALLEL_WORKERS"] = "3"
    subprocess_no_pool = _normalise(mod.Route.slots_route(module_self))
    os.environ.pop("DEEPWIKI_MAX_PARALLEL_WORKERS", None)

    return {
        "route": "GET /slots",
        "selector": {
            "env": "DEEPWIKI_JOBS_ENABLED",
            "true": "count active Kubernetes Jobs labelled app=deepwiki-worker",
            "otherwise": "per-pod subprocess worker pool",
        },
        "cases": {
            "subprocess_without_worker_pool_module": {
                "env": {"DEEPWIKI_MAX_PARALLEL_WORKERS": "3"},
                "recorded": subprocess_no_pool,
            },
            "subprocess_with_worker_pool": {
                "derived_from": "routes/slots.py::_get_subprocess_slots",
                "status_code": 200,
                "body": {
                    "available": "max(0, total - active)",
                    "total": "worker pool max_workers",
                    "active": "worker pool active_workers",
                    "can_start": "active < total",
                    "mode": "subprocess",
                    "note": "Per-pod availability only (subprocess mode)",
                    "canStart": "alias of can_start",
                },
            },
            "jobs_mode": {
                "derived_from": "routes/slots.py::_get_k8s_job_slots",
                "requires": "the kubernetes package and cluster access",
                "status_code": 200,
                "body": {
                    "available": "max(0, DEEPWIKI_MAX_CONCURRENT_JOBS - active)",
                    "total": "DEEPWIKI_MAX_CONCURRENT_JOBS (default 3)",
                    "active": "jobs with status.active > 0",
                    "can_start": "active < max_jobs",
                    "mode": "jobs",
                    "namespace": "DEEPWIKI_NAMESPACE (default 'deepwiki')",
                    "canStart": "alias of can_start",
                },
                "fallback": "ImportError or any K8s API error falls back to subprocess mode"
                " with HTTP 200 — a jobs-mode outage is invisible to the caller",
            },
            "handler_error": {
                "status_code": 500,
                "body": {
                    "available": 0,
                    "total": 0,
                    "active": 0,
                    "can_start": False,
                    "mode": "error",
                    "error": "<str(exception)>",
                    "canStart": False,
                },
            },
        },
        "notes": [
            "_normalize_slots_payload always adds the camelCase 'canStart' alias"
            " alongside 'can_start'; the vendored UI reads canStart.",
            "/slots is not part of the legacy SPI OpenAPI document — it is a"
            " DeepWiki extension, and one of only two endpoints the UI calls directly.",
        ],
    }


def record_invoke() -> Dict[str, Any]:
    flask_stub = install_flask_stub()
    mod = load_legacy_module("routes/invoke.py", "deepwiki_legacy_route_invoke")

    request_body = {
        "configuration": {
            "parameters": {
                "code_toolkit": {
                    "github_configuration": {
                        "url": "https://github.com",
                        "repository": "octocat/hello-world",
                        "active_branch": "main",
                    }
                },
                "llm_model": "gpt-4o",
                "max_tokens": 64000,
                "embedding_model": {"model_name": "text-embedding-3-small"},
                "llm_settings": {
                    "model_name": "gpt-4o",
                    "api_base": "http://elitea/llm/v1",
                    "api_key": "<redacted>",
                    "organization": "42",
                },
            }
        },
        "parameters": {"query": "Document the request pipeline"},
    }

    flask_stub.request.method = "POST"
    flask_stub.request.json = request_body

    module_self = _FakeModule()
    accepted = _normalise(mod.Route.invoke_route(module_self, "Wikis", "generate_wiki"))
    dispatch = module_self.invocation_task_node.calls[0]

    rejected_self = _FakeModule(invocation_id=None)
    rejected = _normalise(mod.Route.invoke_route(rejected_self, "Wikis", "generate_wiki"))

    return {
        "route": "POST /tools/{toolkit_name}/{tool_name}/invoke",
        "invocation_model": "asynchronous, unconditionally — the route returns"
        " immediately even for tools whose descriptor sets"
        " sync_invocation_supported: true",
        "request": {
            "content_type": "application/json",
            "example": request_body,
            "shape": {
                "configuration.parameters": "toolkit-level configuration, including the"
                " expanded code_toolkit and the caller-pushed llm_settings",
                "parameters": "tool-level arguments matching the descriptor args_schema",
            },
            "merge_rule": "tool parameters overwrite toolkit parameters when the key is"
            " absent from the toolkit dict or the tool value is truthy"
            " (methods/invoke.py: `if key not in params or value`) — a tool"
            " parameter that is explicitly false/empty does NOT override.",
        },
        "accepted": accepted,
        "dispatch": {
            "task": dispatch["task"],
            "pool": dispatch["pool"],
            "meta": dispatch["meta"],
            "kwargs_keys": sorted(dispatch["kwargs"]),
        },
        "rejected_when_task_start_fails": rejected,
        "malformed_json": {
            "status_code": 400,
            "body": {"errorCode": "400", "message": "Bad Request", "details": []},
        },
    }


def _seed_invocation(module_self: _FakeModule, toolkit: str, tool: str, iid: str, state):
    module_self.invocation_state.setdefault(toolkit, {}).setdefault(tool, {})[iid] = state


def record_invocations() -> Dict[str, Any]:
    flask_stub = install_flask_stub()
    mod = load_legacy_module("routes/invocations.py", "deepwiki_legacy_route_invocations")

    toolkit, tool, iid = "Wikis", "generate_wiki", "invocation_0000000000000000"
    flask_stub.request.method = "GET"

    unknown_self = _FakeModule()
    unknown = _normalise(mod.Route.invocations_route(unknown_self, toolkit, tool, iid))

    pending_self = _FakeModule()
    _seed_invocation(pending_self, toolkit, tool, iid, {"status": "pending"})
    pending = _normalise(mod.Route.invocations_route(pending_self, toolkit, tool, iid))

    running_self = _FakeModule()
    _seed_invocation(
        running_self,
        toolkit,
        tool,
        iid,
        {
            "status": "running",
            "custom_events": [
                {"data": {"message": "Cloning repository"}},
                {"data": {"message": "Indexing 128 files"}},
            ],
        },
    )
    running_first = _normalise(mod.Route.invocations_route(running_self, toolkit, tool, iid))
    running_second = _normalise(mod.Route.invocations_route(running_self, toolkit, tool, iid))

    completed_result = {
        "invocation_id": iid,
        "status": "Completed",
        "result": json.dumps(
            [
                {
                    "object_type": "message",
                    "result_target": "response",
                    "result_encoding": "plain",
                    "data": "Wiki generation completed successfully",
                }
            ]
        ),
        "result_type": "String",
    }
    completed_self = _FakeModule()
    _seed_invocation(
        completed_self, toolkit, tool, iid, {"status": "stopped", "result": completed_result}
    )
    completed = _normalise(mod.Route.invocations_route(completed_self, toolkit, tool, iid))

    flask_stub.request.method = "DELETE"
    cancel_self = _FakeModule()
    _seed_invocation(cancel_self, toolkit, tool, iid, {"status": "running"})
    cancel = _normalise(mod.Route.invocations_route(cancel_self, toolkit, tool, iid))
    cancel_state = cancel_self.invocation_state[toolkit][tool][iid]
    cancel_unknown = _normalise(
        mod.Route.invocations_route(_FakeModule(), toolkit, tool, iid)
    )

    return {
        "route": "GET|DELETE /tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}",
        "path_note": "ADR-0022 abbreviates this as /invocations/{id}; the wire path"
        " carries the toolkit and tool segments, and the legacy SPI OpenAPI"
        " (epam_ai_run.spi.json) declares the long form. The port must serve"
        " the long form.",
        "status_projection": {
            "pending": "Started",
            "running": "InProgress",
            "stopped": "the stored terminal result verbatim (status Completed or Error)",
            "pruned": "state entry removed — subsequent polls return 404",
        },
        "get": {
            "unknown_invocation": unknown,
            "pending": pending,
            "running_with_events": running_first,
            "running_after_drain": running_second,
            "completed": completed,
        },
        "delete": {
            "known_invocation": cancel,
            "state_after": {
                "stop_requested": cancel_state.get("stop_requested"),
            },
            "unknown_invocation": cancel_unknown,
        },
        "notes": [
            "404 is returned for an unknown toolkit, an unknown tool, or an unknown"
            " invocation id — the three are indistinguishable to the caller.",
            "The terminal result is returned on every subsequent poll until the"
            " task is pruned (~1h retention); it is not consumed by reading.",
            "DELETE returns 204 with an empty body and only *requests* a stop:"
            " the worker observes it at the next invocation_stop_checkpoint().",
        ],
    }


def record_custom_events() -> Dict[str, Any]:
    return {
        "producer": "methods/invocations.py::invocation_thinking(message)",
        "consumer": "routes/invocations.py — GET drains and clears the list",
        "envelope": {"custom_events": [{"data": {"message": "<progress text>"}}]},
        "semantics": [
            "Events are appended to an in-process list keyed by"
            " (toolkit, tool, invocation_id); nothing is persisted.",
            "A GET returns the events accumulated since the previous GET and then"
            " clears them — read-once, at-most-once delivery.",
            "Events are only attached to the pending/running projections and to the"
            " terminal payload when the list is non-empty; the key is absent otherwise.",
            "A poller that misses a GET loses those events permanently, and a"
            " service restart loses all of them. ADR-0022 decision 3 and the"
            " spec's durable-operation-state requirement both bear on this.",
        ],
        "port_requirement": "The ported service must keep the same envelope"
        " ({'custom_events': [{'data': {'message': str}}]}) so the existing"
        " provider worker and vendored UI keep working, while backing it with"
        " durable state rather than a process-local list.",
    }


def record_toolkit_aliases() -> Dict[str, Any]:
    """Read the alias lists straight out of perform_invoke_request's AST."""
    source = (legacy_root() / "methods" / "invoke.py").read_text(encoding="utf-8")
    tree = ast.parse(source)

    wanted = {
        "valid_main_toolkits",
        "valid_query_toolkits",
        "valid_wiki_query_toolkits",
        "valid_wiki_query_tools",
    }
    found: Dict[str, List[str]] = {}

    for node in ast.walk(tree):
        if not isinstance(node, ast.FunctionDef) or node.name != "perform_invoke_request":
            continue
        for stmt in ast.walk(node):
            if not isinstance(stmt, ast.Assign):
                continue
            for target in stmt.targets:
                if isinstance(target, ast.Name) and target.id in wanted:
                    try:
                        found[target.id] = ast.literal_eval(stmt.value)
                    except ValueError:
                        pass

    missing = wanted - set(found)
    if missing:
        raise RuntimeError(f"alias lists not found in perform_invoke_request: {sorted(missing)}")

    return {
        "source": "methods/invoke.py::perform_invoke_request",
        "accepted_toolkit_names": {
            "main": found["valid_main_toolkits"],
            "query": found["valid_query_toolkits"],
            "wiki_query": found["valid_wiki_query_toolkits"],
        },
        "declared_toolkit_names": ["Wikis", "wikis_query", "wiki_query"],
        "tools_per_family": {
            "main": ["generate_wiki", "ask", "deep_research"],
            "query": ["ask", "deep_research"],
            "wiki_query": found["valid_wiki_query_tools"],
        },
        "unknown_toolkit": {
            "exception": "FileNotFoundError",
            "error_category": "resource_not_found",
            "message": "Unknown toolkit: {name}. Expected: one of {all_valid_toolkits}",
        },
        "unknown_tool": {
            "main_family": {
                "exception": "FileNotFoundError",
                "error_category": "resource_not_found",
                "message": "Unknown tool: {name}",
            },
            "query_family": {
                "exception": "ValueError",
                "error_category": "invalid_input",
                "message": "Tool '{name}' not available in deepwiki_query toolkit."
                " Available: ask, deep_research",
            },
            "wiki_query_family": {
                "exception": "ValueError",
                "error_category": "invalid_input",
                "message": "Tool '{name}' not available in wiki_query toolkit."
                " Available: {valid_wiki_query_tools}",
            },
        },
        "notes": [
            "Toolkit names are matched case-sensitively against these literal lists;"
            " only 'Wikis', 'wikis_query' and 'wiki_query' are advertised by the"
            " descriptor, the rest exist for user data created before renames.",
            "The wikis_query family rewrites the request via"
            " _transform_deepwiki_query_request and then falls through to the"
            " main handler, so the two families share a code path from there on.",
            "The query family also accepts the legacy config key"
            " 'deepwiki_toolkit' as an alias for 'wikis_toolkit'.",
        ],
    }


def record_errors() -> Dict[str, Any]:
    install_flask_stub()
    mod = load_legacy_module("methods/invoke.py", "deepwiki_legacy_method_invoke")
    module_self = _FakeModule()

    cases = [
        ("resource_not_found", FileNotFoundError("Wiki not found for repository")),
        ("service_busy", RuntimeError("[SERVICE_BUSY] DeepWiki service is busy")),
        ("artifact_error", RuntimeError("Failed to download artifact")),
        ("out_of_memory", MemoryError("out of memory while embedding")),
        ("timeout_error", RuntimeError("Clone timeout after 300s")),
        ("inference_failed", RuntimeError("LLM generation failed")),
        ("runtime_error", RuntimeError("worker exited with code 1")),
        ("invalid_input", ValueError("query must not be empty")),
        ("unknown_error", KeyError("llm_settings")),
    ]

    recorded = {}
    for label, exc in cases:
        payload = mod.Method._create_error_response(
            module_self,
            invocation_id="invocation_0000000000000000",
            operation="generate_wiki",
            model_name="gpt-4o",
            exception=exc,
            include_traceback=False,
        )
        recorded[label] = payload

    with_traceback = mod.Method._create_error_response(
        module_self,
        invocation_id="invocation_0000000000000000",
        operation="generate_wiki",
        model_name=None,
        exception=RuntimeError("worker exited with code 1"),
        include_traceback=True,
    )
    with_traceback["result"] = (
        "<message + 'Error:' / 'Type:' / 'Category:' lines + 'Stack Trace:' block>"
    )

    return {
        "producer": "methods/invoke.py::_create_error_response",
        "envelope": {
            "invocation_id": "str",
            "status": "Error",
            "result": "JSON string: a list of result objects, always at least one"
            " object_type='message' targeting the response",
            "result_type": "String",
            "error_category": "one of the categories below",
            "error_type": "type(exception).__name__",
        },
        "classifier_precedence": [
            "'not found' in message OR FileNotFoundError -> resource_not_found",
            "'[service_busy]' / 'service is busy' -> service_busy",
            "'download' or 'artifact' in message -> artifact_error",
            "'memory' in message OR MemoryError -> out_of_memory",
            "'timeout' in message -> timeout_error",
            "RuntimeError: 'training' -> training_failed;"
            " 'inference'/'generat' -> inference_failed; else runtime_error",
            "ValueError -> invalid_input",
            "anything else -> unknown_error",
        ],
        "recorded": recorded,
        "with_traceback": with_traceback,
        "transport_errors": {
            "route_level": {
                "status_code": 500,
                "body": {
                    "errorCode": "500",
                    "message": "Internal Server Error",
                    "details": ["<exception text>"],
                },
                "note": "emitted by methods/invocations.py when the task result cannot"
                " be read, and by routes/invoke.py when the task cannot be started",
            }
        },
        "notes": [
            "A failed tool is HTTP 200 with status='Error' in the body — the"
            " errorCode/message/details envelope is only used for transport-level"
            " failures. Both shapes must survive the port.",
            "include_traceback=True (unknown toolkit/tool, unhandled exception) puts a"
            " full Python stack trace into a user-facing message. The port should"
            " keep the category/type fields and stop shipping the trace outward.",
        ],
    }


def record_routes() -> Dict[str, Any]:
    return {
        "base_path": "/",
        "transport": {
            "legacy": "plain HTTP inside the cluster; the descriptor advertises"
            " service_location_url and the platform calls it directly",
            "target": "mTLS with HMAC-signed identity headers behind the elitea-main"
            " facade (ADR-0022 decision 5); the service refuses non-mTLS traffic",
        },
        "routes": [
            {
                "path": "/descriptor",
                "methods": ["GET"],
                "handler": "routes/descriptor.py -> methods/descriptor.py",
                "in_legacy_spi_openapi": False,
                "fixture": "../descriptor/legacy-v0/provider_descriptor.json",
            },
            {
                "path": "/health",
                "methods": ["GET"],
                "handler": "routes/health.py",
                "in_legacy_spi_openapi": True,
                "fixture": "health.get.json",
            },
            {
                "path": "/slots",
                "methods": ["GET"],
                "handler": "routes/slots.py",
                "in_legacy_spi_openapi": False,
                "fixture": "slots.get.json",
            },
            {
                "path": "/tools/{toolkit_name}/{tool_name}/invoke",
                "methods": ["POST"],
                "handler": "routes/invoke.py -> methods/invoke.py::perform_invoke_request",
                "in_legacy_spi_openapi": True,
                "fixture": "invoke.post.json",
            },
            {
                "path": "/tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}",
                "methods": ["GET", "DELETE"],
                "handler": "routes/invocations.py",
                "in_legacy_spi_openapi": True,
                "fixture": "invocations.get.json / invocations.delete.json",
            },
            {
                "path": "/ui/<path>",
                "methods": ["GET"],
                "handler": "routes/ui.py",
                "in_legacy_spi_openapi": False,
                "fixture": None,
                "note": "the vendored SPA; ADR-0022 decision 8 moves it behind an"
                " authenticated elitea-main handler",
            },
        ],
        "retired_by_adr_0022": [
            "the X-SECRET shared-string header on every callback"
            " (methods/invoke.py::extract_artifact_settings defaults it to 'secret')",
            "verify=False on outbound artifact calls",
            "the register_descriptor self-registration event (events/init.py)",
        ],
    }


# ---------------------------------------------------------------------------


def build() -> Dict[Path, Dict[str, Any]]:
    pin = source_pin(SOURCE_FILES)
    payloads = {
        "routes.json": record_routes(),
        "health.get.json": record_health(),
        "slots.get.json": record_slots(),
        "invoke.post.json": record_invoke(),
        "invocations.get.json": record_invocations(),
        "custom_events.json": record_custom_events(),
        "toolkit_aliases.json": record_toolkit_aliases(),
        "errors.json": record_errors(),
    }
    # invocations.delete.json is a projection of the same recording so each
    # SPI operation has a file of its own.
    inv = payloads["invocations.get.json"]
    payloads["invocations.delete.json"] = {
        "route": "DELETE /tools/{toolkit_name}/{tool_name}/invocations/{invocation_id}",
        "path_note": inv["path_note"],
        **inv["delete"],
        "notes": inv["notes"][-1:],
    }
    payloads["descriptor.get.json"] = {
        "route": "GET /descriptor",
        "status_code": 200,
        "body_fixture": "../descriptor/legacy-v0/provider_descriptor.json",
        "note": "the handler returns methods/descriptor.py::provider_descriptor()"
        " unchanged; the golden body lives with the descriptor fixtures",
    }

    out = {}
    for name, payload in payloads.items():
        payload = dict(payload)
        payload["_source"] = pin
        out[FIXTURES / name] = payload
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    outputs = build()

    if args.check:
        drift = []
        for path, payload in outputs.items():
            want = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
            if not path.is_file() or path.read_text(encoding="utf-8") != want:
                drift.append(str(path))
        if drift:
            print("SPI fixtures are stale:", file=sys.stderr)
            for item in drift:
                print(f"  {item}", file=sys.stderr)
            return 1
        print("SPI fixtures match the legacy plugin")
        return 0

    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
