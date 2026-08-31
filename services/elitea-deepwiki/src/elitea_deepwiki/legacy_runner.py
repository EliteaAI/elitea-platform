"""Dispatch and result composition — the port of ``perform_invoke_request``.

This is the only part of the legacy ``methods/invoke.py`` that survives, and it
survives here rather than in the copied engine because it is not engine code:
it is the adapter between the SPI's invocation model and the engine's tool
functions. The 1767-line legacy method also carried an LLM factory, an artifact
HTTP client, credential derivation and a registry write; every one of those is
either replaced elsewhere or deliberately dropped, and the notes below say
which.

What IS ported, because the P0 fixtures pin it:

* the toolkit-parameter / tool-parameter merge, including its asymmetry;
* per-tool dispatch for the three toolkit families;
* the composed ``generate_wiki`` artifact set — message, wiki_structure,
  wiki_manifest, wiki_page, repository_context — in the legacy order, with the
  legacy object types, extensions, encodings and bucket;
* the partial-failure messages (``⚠️ Partial issues detected``, failed pages,
  errors);
* the manifest-vs-structure classification of JSON artifacts, including the
  content sniff for a nameless body;
* the ``ask``/``deep_research`` response shapes, including ``ask``'s separate
  sources message.

What is NOT ported, and why:

* **The LLM factory.** ``create_llm`` built ChatOpenAI / ChatAnthropic against
  the platform proxy. The engine builds its own models from ``llm_settings``;
  duplicating a second factory in the adapter was how the legacy code ended up
  with two.
* **``extract_artifact_settings``.** It derived the artifact API base URL by
  regex-stripping ``/llm`` off the LLM base URL, and defaulted an ``X-SECRET``
  header to the literal string ``"secret"``. ADR-0022 decision 6 retires both:
  the facade passes artifact credentials explicitly, and no surface of this
  service sends ``X-SECRET``.
* **``verify=False``.** Every legacy artifact call disabled TLS verification.
  It does not appear here, and ADR-0022 forbids it appearing.
* **The registry write.** ``register_wiki`` did a read-modify-write on one JSON
  blob in the artifact bucket under no lock. Its successor is the ``wikis``
  table from migration 0001, written by the generation path.
* **Tracebacks in caller-visible messages.** Handled by
  :mod:`elitea_deepwiki.errors`, which logs them instead.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Callable, Sequence

from .invocations import InvocationContext
from .repo_config import _extract_repo_config_from_toolkit
from .security.egress import EgressPolicy, check_repo_config
from .toolkits import ToolkitFamily, validate_tool

logger = logging.getLogger(__name__)

#: The legacy bucket every artifact object was tagged with at invoke time.
#: Note it disagrees with the descriptor, which advertises ``"wiki"``; the
#: invoke-time value is the one that reached the platform, so it is the one
#: that is preserved.
DEFAULT_BUCKET = "wiki-artifacts"


def merge_parameters(request_data: dict[str, Any]) -> dict[str, Any]:
    """Merge toolkit configuration with tool arguments, legacy rules intact.

    The legacy line is ``if key not in params or value``. Two consequences,
    both preserved because a caller may depend on either:

    * a tool argument absent from the toolkit configuration always lands;
    * a tool argument that is present in the configuration only overrides it
      when the tool's value is **truthy** — so passing ``exclude_tests=False``
      explicitly does NOT override a configured ``True``.

    The second is surprising enough to be worth a test rather than a comment,
    and it has one.
    """
    toolkit_params = (request_data.get("configuration") or {}).get("parameters") or {}
    tool_params = request_data.get("parameters") or {}

    params = dict(toolkit_params)
    for key, value in tool_params.items():
        if key not in params or value:
            params[key] = value
    return params


def _message(data: str) -> dict[str, Any]:
    return {
        "object_type": "message",
        "result_target": "response",
        "result_encoding": "plain",
        "data": data,
    }


def _artifact(
    name: str | None,
    object_type: str,
    extension: str,
    data: str,
) -> dict[str, Any]:
    return {
        "name": name,
        "object_type": object_type,
        "result_target": "artifact",
        "result_extension": extension,
        "result_encoding": "plain",
        "result_bucket": DEFAULT_BUCKET,
        "data": data,
    }


def _classify_json_artifact(artifact: dict[str, Any]) -> tuple[str, str]:
    """Return ``(object_type, name)`` for a JSON artifact.

    Ported from the legacy branch verbatim, sniff included: a name containing
    ``wiki_manifest_`` is a manifest; otherwise a body that parses as an object
    with both ``wiki_version_id`` and a ``pages`` list is *also* treated as a
    manifest, and anything else is the structure. The sniff exists because the
    worker could emit a manifest with no name at all.
    """
    raw_name = artifact.get("name")
    name = raw_name if isinstance(raw_name, str) else ""

    object_type = "wiki_structure"
    manifest_version_id = None

    if "wiki_manifest_" in name:
        object_type = "wiki_manifest"
    else:
        data = artifact.get("data")
        if isinstance(data, str) and data.strip().startswith("{"):
            try:
                parsed = json.loads(data)
            except Exception:  # noqa: BLE001 - legacy swallowed every error here
                parsed = None
            if (
                isinstance(parsed, dict)
                and parsed.get("wiki_version_id")
                and isinstance(parsed.get("pages"), list)
            ):
                object_type = "wiki_manifest"
                manifest_version_id = str(parsed.get("wiki_version_id"))

    if not name.strip():
        if object_type == "wiki_manifest":
            name = f"wiki_manifest_{manifest_version_id or 'unknown'}.json"
        else:
            name = "wiki_structure.json"

    return object_type, name


def _partial_failure_messages(result: dict[str, Any]) -> list[dict[str, Any]]:
    """The in-band warnings the legacy composer appended, in its order."""
    errors = result.get("errors") if isinstance(result.get("errors"), list) else []
    failed_pages = (
        result.get("failed_pages")
        if isinstance(result.get("failed_pages"), list)
        else []
    )
    if not errors and not failed_pages:
        return []

    objects: list[dict[str, Any]] = []

    summary = []
    if failed_pages:
        summary.append(f"Failed pages: {len(failed_pages)}")
    if errors:
        summary.append(f"Errors: {len(errors)}")
    objects.append(_message("⚠️ Partial issues detected:\n" + "\n".join(summary)))

    if failed_pages:
        lines = []
        for item in failed_pages:
            if isinstance(item, dict):
                page_id = item.get("page_id") or "(unknown)"
                title = item.get("title") or ""
                status = item.get("status") or ""
                lines.append(f"- {page_id} {title} ({status})".strip())
            else:
                lines.append(f"- {item}")
        objects.append(_message("Failed pages:\n" + "\n".join(lines)))

    if errors:
        objects.append(
            _message("Errors:\n" + "\n".join(f"- {error}" for error in errors))
        )

    return objects


def compose_result_objects(tool_name: str, result: dict[str, Any]) -> list[dict[str, Any]]:
    """Turn an engine result into the frozen result-object list.

    Pinned by ``conformance/fixtures/generation/composed_result.json``, which
    was recorded by running the legacy composer itself.
    """
    objects: list[dict[str, Any]] = []

    if tool_name == "ask":
        objects.append(_message(result.get("answer", "Question answered successfully")))
        sources = result.get("sources") or []
        if sources:
            rendered = "\n".join(
                f"- {source.get('source', 'unknown')}" for source in sources[:5]
            )
            objects.append(_message("\n\nSources:\n" + rendered))
    elif tool_name == "deep_research":
        objects.append(
            _message(
                result.get(
                    "report",
                    result.get("answer", "Deep research completed successfully"),
                )
            )
        )
    else:
        objects.append(
            _message(result.get("result", "Wiki generation completed successfully"))
        )

    objects.extend(_partial_failure_messages(result))

    for artifact in result.get("artifacts") or []:
        # Set by the Kubernetes-Job worker after it uploads content itself.
        # Re-emitting those would duplicate every page, because the legacy
        # result_objects path strips directory prefixes from artifact names.
        if artifact.get("_uploaded_directly"):
            continue

        if artifact.get("type") == "application/json":
            object_type, name = _classify_json_artifact(artifact)
            objects.append(
                _artifact(name, object_type, "json", artifact.get("data", ""))
            )
        elif artifact.get("type") == "text/markdown":
            objects.append(
                _artifact(
                    artifact.get("name"),
                    "wiki_page",
                    "md",
                    artifact.get("data", ""),
                )
            )

    if tool_name == "generate_wiki":
        repository_context = result.get("repository_context")
        if repository_context:
            wiki_id = result.get("wiki_id")
            name = (
                f"{wiki_id}/repository_context.txt"
                if wiki_id
                else "repository_context.txt"
            )
            objects.append(
                _artifact(name, "repository_context", "txt", repository_context)
            )

    return objects


class ToolHost:
    """The five hooks the copied tool layer expects from its Pylon module.

    ``tool_operations.Method`` is a mixin: every method it defines calls back
    into ``self`` for progress events, cancellation, child-process tracking and
    configuration. In the legacy service that ``self`` was the Pylon module.
    Here it is this object, which forwards to the invocation context and the
    service settings.

    Discovering that the tool layer needed exactly five hooks — and no Pylon
    behaviour beyond them — is what made copying it viable instead of
    rewriting 1400 lines.
    """

    def __init__(self, settings, context: InvocationContext) -> None:
        self._settings = settings
        self._context = context
        self._loop = None
        try:
            import asyncio  # noqa: PLC0415

            self._loop = asyncio.get_running_loop()
        except RuntimeError:  # pragma: no cover - only when built off-loop
            self._loop = None

    # -- configuration ----------------------------------------------------

    def runtime_config(self) -> dict[str, Any]:
        """The legacy ``runtime_config``: base_path plus the service URL.

        The tool layer reads ``base_path`` to place caches and worker
        scratch. ADR-0022 decision 4 makes that ephemeral pod storage, which
        is what ``scratch_path`` is.
        """
        return {
            "base_path": self._settings.scratch_path,
            "service_location_url": self._settings.service_location_url,
        }

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
        # thread, which is how a cancel actually stops the work.
        future.result()


def _install_postgres_read_path(settings) -> None:
    """Point the engine's read path at PostgreSQL, once, if configured.

    Done here rather than at import time because it needs settings, and at
    first tool use rather than at startup because a service with no database
    configured must still boot and serve the SPI.
    """
    if not getattr(settings, "database_url", None):
        return

    from .storage import install as storage_install  # noqa: PLC0415

    if storage_install.is_installed():
        return

    import psycopg  # noqa: PLC0415

    dsn = settings.database_url
    storage_install.install(lambda: psycopg.connect(dsn))


_JOB_PATH_INSTALLED = False


def _install_job_path() -> None:
    """Repoint the Kubernetes-Job manifest builder, once.

    Unconditional: unlike the PostgreSQL read path this needs no
    configuration, and a Job created with the legacy manifest would reference
    filesystem paths that do not exist in this image.
    """
    global _JOB_PATH_INSTALLED
    if _JOB_PATH_INSTALLED:
        return

    from .jobs import install as install_job_path  # noqa: PLC0415

    install_job_path()
    _JOB_PATH_INSTALLED = True


_BOUND_HOST_CACHE: dict[type, type] = {}


def _bound_host_class(method_mixin: type) -> type:
    """Compose the copied tool layer onto the host that satisfies it.

    ``tool_operations.Method`` is a mixin with no ``__init__``; the legacy
    service mixed it into the Pylon module. Here it is mixed into
    :class:`ToolHost`, which supplies the five hooks it calls back into.

    Cached because composing it per invocation would rebuild the class on
    every request.
    """
    cached = _BOUND_HOST_CACHE.get(method_mixin)
    if cached is None:
        cached = type("BoundToolHost", (method_mixin, ToolHost), {})
        _BOUND_HOST_CACHE[method_mixin] = cached
    return cached


class LegacyToolRunner:
    """Dispatches SPI invocations into the copied tool layer and engine.

    ``tools`` injects callables in place of the real tool layer. That is not a
    convenience: it is how the composition path is tested against the P0
    fixture without the engine's ~1.1 GB dependency closure, and it mirrors how
    the fixture was recorded.
    """

    name = "legacy"

    def __init__(
        self,
        settings=None,
        tools: dict[str, Callable[..., Any]] | None = None,
    ) -> None:
        self._settings = settings
        self._tools = tools

    def _bound_tool(self, name: str, context: InvocationContext) -> Callable[..., Any]:
        if self._tools is not None:
            try:
                return self._tools[name]
            except KeyError:
                raise FileNotFoundError(f"Unknown tool: {name}") from None

        # Imported here, not at module scope: the default image does not carry
        # the engine closure, and importing it at startup would make an
        # engine-less deployment fail to boot rather than refuse per tool.
        from .tool_operations import Method  # noqa: PLC0415

        if getattr(Method, name, None) is None:
            raise FileNotFoundError(f"Unknown tool: {name}")

        settings = self._settings
        if settings is None:
            from .config import Settings  # noqa: PLC0415

            settings = Settings.from_env()

        # The whole mixin is composed onto the host, not just the one method:
        # ``generate_wiki`` calls ``self._run_wiki_subprocess`` and
        # ``self._run_wiki_job``, ``ask`` calls ``self._run_ask_subprocess``,
        # and binding a single function leaves those unresolvable. Found by
        # running it.
        _install_postgres_read_path(settings)
        _install_job_path()

        host = _bound_host_class(Method)(settings, context)
        return getattr(host, name)

    async def invoke(
        self,
        *,
        family: ToolkitFamily,
        toolkit_name: str,
        tool_name: str,
        request_data: dict[str, Any],
        context: InvocationContext,
    ) -> dict[str, Any]:
        validate_tool(family, tool_name)

        if family is ToolkitFamily.QUERY:
            request_data = transform_query_request(request_data)

        params = merge_parameters(request_data)

        # BEFORE the engine sees the request, and therefore before the token in
        # it is ever written into a clone URL. ADR-0022 decision 6: "a clone to
        # a non-allowlisted git host is refused before any credential is
        # decrypted". The facade does the pre-decrypt half with the vault in
        # reach; this is the half that governs the socket.
        #
        # It runs for every tool, not just generate_wiki: ask and deep_research
        # take the same expanded code_toolkit and can re-clone when their cache
        # is cold.
        self._check_egress(params)

        await context.checkpoint()
        await context.thinking(f"Starting {tool_name}")

        result = await self._call(tool_name, params, context)

        if not isinstance(result, dict):
            raise RuntimeError(
                f"{tool_name} returned {type(result).__name__}, expected a dict"
            )

        if not result.get("success"):
            raise _engine_error(result)

        if tool_name == "generate_wiki":
            await self._publish(result, context)

        return {
            "invocation_id": context.invocation_id,
            "status": "Completed",
            "result": json.dumps(compose_result_objects(tool_name, result)),
            "result_type": "String",
        }

    def _check_egress(self, params: dict[str, Any]) -> None:
        """Refuse a clone destination that is not on the allowlist.

        Raises ``EgressRefused``, a ValueError, which the legacy classifier
        maps to ``invalid_input`` — the right category for a request naming a
        forbidden host, and one the caller already knows how to read.
        """
        settings = self._settings
        if settings is None:
            from .config import Settings  # noqa: PLC0415

            settings = Settings.from_env()

        repo_config = _extract_repo_config_from_toolkit(params)
        if not repo_config.get("provider_config") and not repo_config.get(
            "repository"
        ):
            # No repository in the request at all: the wiki_query tools operate
            # on the registry and clone nothing. Nothing to check, and refusing
            # would break them.
            return

        policy = EgressPolicy.parse(settings.git_allowlist)
        host = check_repo_config(policy, repo_config)
        logger.info("clone destination %s permitted by the egress allowlist", host)

    async def _publish(
        self, result: dict[str, Any], context: InvocationContext
    ) -> None:
        """Put the generated index into PostgreSQL before reporting success.

        Ordering matters: this runs BEFORE composition, so a publish failure
        can still be reported through the composed result's ``errors`` list,
        which the legacy composer renders as "⚠️ Partial issues detected".

        A failure does not fail the invocation. The pages, manifest and
        structure are genuine and will land; what is lost is the ability of
        *other* replicas to answer about this wiki. Discarding good artifacts
        over that would be worse, and passing silently would claim a queryable
        wiki that is not — so it is reported in band and logged loudly.
        """
        import asyncio  # noqa: PLC0415

        from .publishing import publish_generation  # noqa: PLC0415

        settings = self._settings
        if settings is None or not getattr(settings, "database_url", None):
            return

        await context.thinking("Publishing the index for query replicas")
        try:
            counts = await asyncio.to_thread(publish_generation, settings, result)
        except Exception as exc:  # noqa: BLE001 - reported, not swallowed
            logger.exception(
                "publishing the index for %s failed", result.get("wiki_id")
            )
            errors = result.get("errors")
            if not isinstance(errors, list):
                errors = []
                result["errors"] = errors
            errors.append(
                f"The wiki was generated but could not be published to the "
                f"index database, so replicas other than this one cannot "
                f"answer questions about it: {exc}"
            )
            await context.thinking("Publishing the index FAILED")
            return

        if counts is not None:
            await context.thinking(
                f"Published {counts['nodes']} nodes and "
                f"{counts['embeddings']} vectors"
            )

    async def _call(
        self, tool_name: str, params: dict[str, Any], context: InvocationContext
    ) -> Any:
        import asyncio  # noqa: PLC0415
        import functools  # noqa: PLC0415

        tool = self._bound_tool(tool_name, context)
        arguments = _arguments_for(tool_name, params)

        # The engine is synchronous and CPU/IO heavy. Running it on the event
        # loop would block every other invocation's poll, so it goes to a
        # worker thread; cancellation still arrives through the checkpoint.
        return await asyncio.to_thread(functools.partial(tool, **arguments))


def _arguments_for(tool_name: str, params: dict[str, Any]) -> dict[str, Any]:
    """The per-tool argument sets the legacy handler passed, defaults included.

    Pinned by ``composed_result.json``'s ``engine_call``, which recorded the
    exact keyword set the legacy handler passed to ``generate_wiki``.
    """
    common = {
        "llm_settings": params.get("llm_settings") or {},
        "embedding_model": params.get("embedding_model"),
    }

    if tool_name == "generate_wiki":
        return {
            **common,
            "query": params["query"],
            "repo_config": _extract_repo_config_from_toolkit(params),
            "active_branch": params.get("active_branch", "main"),
            "force_rebuild_index": params.get("force_rebuild_index", True),
            "indexing_method": params.get("indexing_method", "filesystem"),
            "planner_mode": params.get("planner_mode") or params.get("planner_type"),
            "exclude_tests": params.get("exclude_tests"),
            # The legacy handler hardcoded True. It stays the default — the
            # recorded engine_call has it — but is overridable, because
            # out-of-process execution is not repointed at this layout yet and
            # in-process is the only path that currently runs.
            "run_in_subprocess": params.get("run_in_subprocess", True),
        }

    if tool_name in ("ask", "deep_research"):
        arguments = {
            **common,
            "question": params.get("question", ""),
            "repo_config": _extract_repo_config_from_toolkit(params),
            "chat_history": params.get("chat_history", []),
            "k": params.get("k", 15),
            "repo_identifier_override": params.get("repo_identifier_override"),
            "analysis_key_override": params.get("analysis_key_override"),
        }
        if tool_name == "deep_research":
            arguments["research_type"] = params.get("research_type", "general")
            arguments["enable_subagents"] = params.get("enable_subagents", True)
        return arguments

    # wiki_query family: list_wikis, resolve_and_ask, resolve_and_deep_research,
    # delete_wiki. They take their own arguments straight from params.
    return {key: value for key, value in params.items() if not key.startswith("_")}


def _engine_error(result: dict[str, Any]) -> Exception:
    """Rebuild the exception the legacy handler raised for a failed result.

    The engine reports failure as ``{"success": False, "error": ...}`` with
    optional ``error_type`` / ``error_category`` hints from the subprocess
    workers. Those hints are honoured, because the classifier's category is
    part of the frozen error contract.
    """
    error = result.get("error")
    error_type = result.get("error_type")
    category = result.get("error_category")

    if isinstance(error, str) and error.strip().startswith("[SERVICE_BUSY]"):
        clean = error.strip()[len("[SERVICE_BUSY]") :].strip()
        return RuntimeError(clean or "DeepWiki service is busy. Please try again later.")

    if category == "invalid_input" or error_type == "ValueError":
        return ValueError(error or "Invalid input")

    return RuntimeError(error or "Unknown error")


def transform_query_request(request_data: dict[str, Any]) -> dict[str, Any]:
    """Rewrite a ``wikis_query`` request to reference the target toolkit.

    The legacy ``_transform_deepwiki_query_request`` resolved the referenced
    Wikis toolkit and copied its configuration in. Resolving a toolkit id means
    calling the platform's configuration API, which under ADR-0022 decision 6
    is the **facade's** job, not the service's: the facade already resolves
    credentials and can expand the referenced toolkit before it proxies.

    So this only normalises what the facade sends. If the toolkit reference
    arrives as a bare id rather than an expanded object, that is an unresolved
    request and it is refused rather than guessed at.
    """
    parameters = (request_data.get("configuration") or {}).get("parameters") or {}
    reference = parameters.get("wikis_toolkit") or parameters.get("deepwiki_toolkit")

    if not reference:
        raise ValueError(
            "wikis_toolkit parameter is required - specify which Wikis toolkit to use"
        )

    if not isinstance(reference, dict):
        raise ValueError(
            "wikis_toolkit must arrive expanded; this service does not resolve "
            "toolkit references, the facade does"
        )

    merged = dict(reference)
    for key in ("llm_settings", "llm_model", "embedding_model"):
        if key in parameters:
            merged[key] = parameters[key]

    return {
        "configuration": {"parameters": merged},
        "parameters": request_data.get("parameters") or {},
    }


__all__ = [
    "DEFAULT_BUCKET",
    "LegacyToolRunner",
    "ToolHost",
    "compose_result_objects",
    "merge_parameters",
    "transform_query_request",
]
