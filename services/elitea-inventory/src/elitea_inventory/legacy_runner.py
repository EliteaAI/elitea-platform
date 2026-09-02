"""The engine's host — what survives of ``perform_invoke_request`` here.

The legacy ``methods/invoke.py`` carried dispatch, a parameter merge, result
composition, an artifact upload, an LLM factory and platform reads. Under
ADR-0023 the SPI, the merge, composition and the upload are the Go
sub-application host's (``services/elitea-subapp-host``,
``internal/apps/inventory/run``). What stays in Python is the part that needs
the engine: binding the copied tool layer to the hooks it calls back into,
resolving the graph path, running one tool off the event loop, and handing the
artifacts it produced back for the host to upload.

Mirrors ``elitea_deepwiki.legacy_runner``. Two things differ, both because
Inventory's tool layer is bigger than DeepWiki's three tools:

* the bound class is composed from THREE mixins, not one —
  :class:`~elitea_inventory.v1_overrides.V1Overrides` first, so its six
  replacements win over the copy; then the copied invoke and chat layers.
* dispatch is by TABLE (``tools_table``) rather than by attribute lookup, so a
  tool that exists on the class and was never routed cannot be served by
  accident. Five such handlers are in the copy.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from .errors import InvocationCancelled  # noqa: F401 - re-exported for the sidecar
from .tools_table import SIGNATURE_EXCEPTIONS, handler_for
from .v1_overrides import DEFERRED_TOOLS, DeferredTool, V1Overrides

logger = logging.getLogger(__name__)


class ToolHost:
    """The hooks the copied tool layer expects from its Pylon module.

    In the legacy service ``self`` was the Pylon module: it supplied the
    invocation id, progress events, the stop checkpoint, the graph cache, the
    plugin descriptor's config and an LLM factory. Here it is this object, which
    forwards to the sidecar's invocation context and the request's own settings.

    ``platform_llm`` is the one hook with no legacy counterpart of the same
    name: the copy substitutes it for ``elitea_client.get_llm(``, so the model
    is built from the per-invocation ``llm_settings`` the facade forwarded and
    never from a platform client holding an admin token.
    """

    def __init__(self, settings, context: Any, request_data: dict[str, Any]) -> None:
        self._settings = settings
        self._context = context
        self._request_data = request_data
        self.graph_instances: dict[str, Any] = {}
        self.tool_runs: dict[str, Any] = {}
        self._loop = None
        try:
            import asyncio  # noqa: PLC0415

            self._loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - only when built off-loop
            self._loop = None

    # -- configuration ----------------------------------------------------

    @property
    def invocation_id(self) -> str:
        return self._context.invocation_id

    @property
    def source_types(self) -> tuple[str, ...]:
        return tuple(getattr(self._settings, "source_types", ()) or ())

    @property
    def tls_ca_file(self) -> str | None:
        return getattr(self._settings, "tls_ca_file", None)

    @property
    def descriptor(self):
        """The legacy ``self.descriptor.config`` surface, emptied.

        Every value the legacy code read out of it is either gone (the admin
        token, the platform URL) or now per-request (the ingestion tuning). An
        empty mapping makes each of those reads take its own default, which is
        what the legacy code did when the key was unset.
        """
        return _EmptyDescriptor()

    @property
    def cache_manager(self):
        return _NullCacheManager()

    @property
    def ingestion_tracker(self):
        """Slot accounting is the Go host's (``internal/spi/slots.go``).

        The legacy tracker held a file lock per worker slot inside the plugin
        pod. Under ADR-0023 the host admits or refuses an invocation before the
        socket is dialled, so a second accounting layer here could only
        disagree with it.
        """
        raise RuntimeError(
            "ingestion slots are accounted by the sub-application host, not by "
            "the engine"
        )

    # -- the LLM ----------------------------------------------------------

    def platform_llm(self, model_name: str, model_config: dict[str, Any] | None = None):
        """A chat model against the platform gateway, from ``llm_settings``."""
        from langchain_openai import ChatOpenAI  # noqa: PLC0415

        llm_settings = self.llm_settings
        api_base = llm_settings.get("api_base") or llm_settings.get("openai_api_base")
        api_key = llm_settings.get("api_key") or llm_settings.get("openai_api_key")
        if not api_base or not api_key:
            raise ValueError(
                f"model {model_name!r} was requested but the request carried no "
                f"LLM transport (llm_settings.api_base / api_key)"
            )
        organization = (
            llm_settings.get("organization")
            or llm_settings.get("openai_organization")
            or llm_settings.get("project_id")
        )
        kwargs: dict[str, Any] = {
            "model": model_name,
            "base_url": str(api_base),
            "api_key": str(api_key),
        }
        if organization:
            kwargs["organization"] = str(organization)
        kwargs.update(model_config or {})
        return ChatOpenAI(**kwargs)

    @property
    def llm_settings(self) -> dict[str, Any]:
        parameters = (
            (self._request_data or {}).get("configuration", {}).get("parameters", {})
        )
        return parameters.get("llm_settings") or {}

    # -- invocation hooks -------------------------------------------------
    #
    # The tool layer is synchronous and runs in a worker thread, so these are
    # called from off the event loop. They marshal back onto it rather than
    # touching invocation state from another thread.

    def invocation_thinking(self, message: str) -> None:
        self._call_async(self._context.thinking(message))

    def invocation_stop_checkpoint(self) -> None:
        self._call_async(self._context.checkpoint())

    def invocation_process_add(self, process) -> None:
        self._context.process_add(process)

    def invocation_process_remove(self, process) -> None:
        self._context.process_remove(process)

    def _call_async(self, coroutine) -> None:
        import asyncio  # noqa: PLC0415

        if self._loop is None or not self._loop.is_running():
            coroutine.close()
            return
        future = asyncio.run_coroutine_threadsafe(coroutine, self._loop)
        # Propagates InvocationCancelled out of checkpoint() into the engine's
        # thread, which is how a stop actually stops the work.
        future.result()


class _EmptyDescriptor:
    config: dict[str, Any] = {}


class _NullCacheManager:
    """``cache_manager.touch`` recorded last-use for a disk eviction sweep.

    The sweep ran in the legacy plugin's own scheduler, which does not exist
    here; the scratch directory is ephemeral pod storage and the pod's lifetime
    is the eviction policy. Touching is therefore a no-op rather than a removed
    call site, so the copy stays verbatim.
    """

    def touch(self, *_args, **_kwargs) -> None:
        return None


_BOUND_HOST_CACHE: dict[tuple, type] = {}


def _bound_host_class() -> type:
    """Compose the copied tool layers onto the host that satisfies them.

    Order is load-bearing. ``V1Overrides`` comes FIRST, so the six methods it
    replaces win over the copied ones; ``ToolHost`` comes last, so a hook it
    defines never shadows a tool handler.
    """
    from .chat_operations import Method as ChatMethod  # noqa: PLC0415
    from .tool_operations import Method as ToolMethod  # noqa: PLC0415

    key = (V1Overrides, ToolMethod, ChatMethod, ToolHost)
    cached = _BOUND_HOST_CACHE.get(key)
    if cached is None:
        cached = type("BoundToolHost", key, {})
        _BOUND_HOST_CACHE[key] = cached
    return cached


class LegacyToolRunner:
    """Dispatches sidecar invocations into the copied tool layer and engine.

    ``tools`` injects callables in place of the real tool layer. That is not a
    convenience: it is how the dispatch and the artifact hand-back are tested
    without the engine's dependency closure.
    """

    name = "legacy"

    def __init__(
        self,
        settings=None,
        tools: dict[str, Callable[..., Any]] | None = None,
    ) -> None:
        self._settings = settings
        self._tools = tools

    # -- the graph's place on disk ----------------------------------------

    def graph_path(self, project_id: Any, application_id: Any) -> str | None:
        """Where this pod caches one toolkit's graph.

        The legacy path was the hardcoded ``/data/graphs/<project>/<app>/
        graph.json`` on a persistent volume that was the graph's only home. Here
        the bucket is the home and this is a cache, so it lives under the
        service's ephemeral scratch — losing it costs one download.
        """
        if not project_id or not application_id:
            return None
        scratch = getattr(self._settings, "scratch_path", "/var/scratch/inventory")
        return f"{scratch}/graphs/{project_id}/{application_id}/graph.json"

    # -- dispatch ----------------------------------------------------------

    def _bound(self, family: str, tool: str, context: Any, request_data: dict[str, Any]):
        if tool in DEFERRED_TOOLS:
            raise DeferredTool(
                f"'{tool}' is not available: it was {DEFERRED_TOOLS[tool]}, so no "
                f"implementation has ever run on this platform."
            )
        handler = handler_for(family, tool)
        if self._tools is not None:
            try:
                return self._tools[tool]
            except KeyError:
                raise FileNotFoundError(f"Unknown tool: {tool}") from None

        # Imported here, not at module scope: a container built without the
        # engine extra must still start and refuse per tool rather than fail to
        # boot.
        settings = self._settings
        if settings is None:
            from .config import Settings  # noqa: PLC0415

            settings = Settings.from_env()
        host = _bound_host_class()(settings, context, request_data)
        bound = getattr(host, handler, None)
        if bound is None:  # pragma: no cover - the table is checked by a test
            raise FileNotFoundError(f"Unknown tool: {tool}")
        return bound

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        """Run one tool and answer the result dict the host composes from.

        ``arguments`` is what the host's ``ArgumentsFor`` derived::

            {"family": "inventory", "params": {...},
             "project_id": 3, "application_id": 42}

        and the answer is::

            {"success": true, "result": "<text>", "artifacts": [...]}

        which is the shape ``internal/apps/inventory/run`` composes — the same
        contract DeepWiki's engine answers on.
        """
        import asyncio  # noqa: PLC0415

        family = arguments.get("family") or "inventory"
        params = arguments.get("params") or {}
        project_id = arguments.get("project_id")
        application_id = arguments.get("application_id")

        request_data = {
            "project_id": project_id,
            "configuration": {
                "project_id": project_id,
                "application_id": application_id,
                "parameters": params,
            },
            "parameters": params,
        }

        tool = self._bound(family, tool_name, context, request_data)
        path = self.graph_path(project_id, application_id)

        if tool_name in SIGNATURE_EXCEPTIONS:
            call = lambda: tool(params, project_id, application_id, request_data)  # noqa: E731
        else:
            call = lambda: tool(params, path, request_data)  # noqa: E731

        await context.thinking(f"Running {tool_name}")
        outcome = await asyncio.to_thread(call)
        return _result_dict(outcome)

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        """No index database in v1: the graph's home is the artifact bucket.

        DeepWiki publishes a generated index into PostgreSQL so query replicas
        are stateless. Inventory's equivalent is the graph object in the bucket,
        which every replica downloads on demand — so there is nothing to
        publish, and the sidecar's protocol keeps the hook rather than growing a
        per-application branch.
        """
        return None


def _result_dict(outcome: Any) -> dict[str, Any]:
    """Normalise a legacy handler's return value into the engine result dict.

    The legacy handlers answer either a string, or ``(string, artifacts)`` — the
    tuple branch ``_handle_inventory_tool`` checked with ``isinstance(result,
    tuple)``. Both are carried; anything else is coerced to text rather than
    dropped, because a handler that answered a dict once did so by accident and
    the caller still deserves to see it.
    """
    artifacts: list[Any] = []
    if isinstance(outcome, tuple):
        text, artifacts = (list(outcome) + [None, None])[:2]
        artifacts = artifacts or []
    else:
        text = outcome
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    return {"success": True, "result": text, "artifacts": artifacts}


__all__ = ["LegacyToolRunner", "ToolHost"]
