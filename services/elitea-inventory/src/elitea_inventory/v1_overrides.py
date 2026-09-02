"""What ADR-0023 H4c stage I3 REPLACES in the copied tool layer, rather than transforms.

``tool_operations.py`` and ``chat_operations.py`` are mechanical copies of the
legacy handlers (see ``tools/refresh_engine_copy.py``). Six of their methods
cannot be copied at all, because what they do is precisely what the v1 scope
removes. They are overridden here, in a mixin composed AHEAD of the copy, so
that the replacement is a readable file of its own instead of an invisible edit
inside 3900 generated lines — and so that a test can assert the override set is
exactly this one.

+---------------------------------+------------------------------------------+
| legacy method                   | why it cannot be copied                  |
+=================================+==========================================+
| ``_get_elitea_client``          | built a platform client from an ADMIN    |
| ``_get_platform_connection_``   | token in the plugin's descriptor config. |
| ``settings``                    | No such credential exists in this        |
|                                 | process (ADR-0022 decision 6).           |
+---------------------------------+------------------------------------------+
| ``_tool_run_ingestion``         | fetched the SOURCE toolkit's expanded    |
|                                 | credentials with that admin token, from  |
|                                 | a bare id the caller supplied; embedded  |
|                                 | with a local MiniLM; uploaded artifacts  |
|                                 | itself. v1: the facade expands the       |
|                                 | source, the gateway embeds, the HOST     |
|                                 | uploads.                                 |
+---------------------------------+------------------------------------------+
| ``_run_ingestion_job``          | launched a Kubernetes Job running a      |
|                                 | worker image v1 does not build.          |
+---------------------------------+------------------------------------------+
| ``_download_graph_from_``       | read the graph with the admin token and  |
| ``artifacts``                   | sniffed the response body for the string |
|                                 | ``"error"`` to decide it was missing.    |
+---------------------------------+------------------------------------------+
| ``_get_or_create_wrapper``      | the download call site, plus the         |
|                                 | embedding-space check the legacy code    |
|                                 | had no way to make.                      |
+---------------------------------+------------------------------------------+

and five tools the legacy plugin DECLARED in its descriptor and never routed —
``get_type_stats``, ``link_toolkits_to_tools``, ``connect_orphan_nodes``,
``validate_relationships`` and ``query_graph`` on the ``inventory`` family. The
handler bodies exist in ``methods/invoke.py`` (and are in the copy), but
``_handle_inventory_tool``'s routing table never named them, so on the legacy
platform every call to one answered "Unknown tool". They are refused HERE too —
a second time; the Go host refuses them at the door — because a body reachable
through the copy is a body one refactor away from being served untested.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from . import artifacts as artifact_transport
from . import embeddings as embedding_support
from . import sources as source_support

logger = logging.getLogger(__name__)

#: Tools whose legacy handler exists but which the legacy router never served.
#: The value is what a caller is told. ``resource_not_found`` is the category:
#: the tool is advertised and there is nothing behind it.
DEFERRED_TOOLS = {
    "get_type_stats": "declared in the legacy descriptor but never routed",
    "link_toolkits_to_tools": "declared in the legacy descriptor but never routed",
    "connect_orphan_nodes": "declared in the legacy descriptor but never routed",
    "validate_relationships": "declared in the legacy descriptor but never routed",
    # Routed by the legacy router, and a stub:
    #
    #     # TODO: Implement delta update using EliteAClient
    #     return f"Delta update from toolkit {toolkit_id} - Not yet implemented.", []
    #
    # which reached the caller as status Completed. This port refuses empty
    # successes everywhere else, so it refuses this one: an agent that reads
    # "Completed" cannot tell that its graph was not updated.
    "delta_update": "a stub whose legacy body answered 'Not yet implemented' as a success",
}


class DeferredTool(FileNotFoundError):
    """A tool the descriptor advertises and no implementation was ever served."""


class V1Overrides:
    """The replacements. Mixed in ahead of the copied ``Method`` mixins."""

    # -- the admin platform client: gone ----------------------------------

    def _get_elitea_client(self, project_id):  # noqa: ARG002
        """There is no admin platform client in this process.

        Raising rather than returning ``None``: the legacy callers treated
        ``None`` as "platform not configured" and returned a STRING beginning
        "Error: ..." as the tool's successful result, so a missing credential
        reached the user as a completed invocation whose text happened to start
        with the word Error. Any surviving call site is a bug, and it should
        look like one.
        """
        raise RuntimeError(
            "this service holds no platform admin credential: the source "
            "toolkit is expanded by the facade and forwarded per invoke, and "
            "every platform read is authorised by the request's llm_settings"
        )

    def _get_platform_connection_settings(self):
        return self._get_elitea_client(None)

    # -- the artifact read path -------------------------------------------

    @staticmethod
    def _settings_of(request_data: dict[str, Any] | None) -> dict[str, Any]:
        """The toolkit settings a call carries, under either legacy key.

        The tool layer builds ``configuration.parameters``; the CHAT layer
        builds ``configuration.settings`` (chat_operations calls
        ``_get_or_create_wrapper`` with exactly that, twice). Reading only the
        first would leave ``investigate`` — which drives the chat agent — with
        no bucket and no transport, so it would answer "no graph configured"
        for a graph that is in the bucket, on the one tool of the six that
        cannot fall back to a cached copy.
        """
        configuration = (request_data or {}).get("configuration") or {}
        for key in ("parameters", "settings"):
            value = configuration.get(key)
            if isinstance(value, dict) and value:
                return value
        return {}

    def _artifact_client(self, request_data: dict[str, Any] | None):
        """The download client for this invocation, or None with no transport."""
        llm_settings = self._settings_of(request_data).get("llm_settings") or {}
        return artifact_transport.client_from(llm_settings, self.tls_ca_file)

    def _download_graph_from_artifacts(
        self, graph_path, project_id, application_id, artifact_bucket, request_data=None
    ):  # noqa: ARG002
        """Populate the local cache from the bucket. True when a graph landed.

        The legacy signature is kept — the copied ``_get_or_create_wrapper``
        was its only caller and is overridden below, but a signature change
        would be an invisible break for anything else that copied it. The
        trailing ``request_data`` is new and defaulted, because the transport
        now comes from the request rather than from process configuration.
        """
        client = self._artifact_client(request_data)
        if client is None:
            logger.warning(
                "no artifact transport in this request, so %s cannot be "
                "downloaded; the tool will report no graph",
                graph_path,
            )
            return False

        graph_dir = Path(graph_path).parent
        try:
            graph_bytes = client.download(artifact_bucket, "graph.json")
        except Exception:
            logger.exception("downloading graph.json from %s failed", artifact_bucket)
            raise
        if graph_bytes is None:
            return False

        graph_dir.mkdir(parents=True, exist_ok=True)
        Path(graph_path).write_bytes(graph_bytes)
        logger.info("downloaded graph.json into %s", graph_path)

        # The status file and the per-source checkpoints are best effort: they
        # make the UI's source list and an incremental re-ingestion work, and
        # neither is needed to ANSWER a query. A failure here must not lose the
        # graph that already landed.
        for name in ("sources_status.json",):
            try:
                data = client.download(artifact_bucket, name)
                if data is not None:
                    (graph_dir / name).write_bytes(data)
            except Exception:  # noqa: BLE001 - best effort, logged
                logger.info("no %s in %s", name, artifact_bucket, exc_info=True)
        try:
            for key in client.list(artifact_bucket):
                if not key.startswith(".ingestion-checkpoint-"):
                    continue
                data = client.download(artifact_bucket, key)
                if data is not None:
                    (graph_dir / os.path.basename(key)).write_bytes(data)
        except Exception:  # noqa: BLE001 - best effort, logged
            logger.info("could not list checkpoints in %s", artifact_bucket, exc_info=True)
        return True

    def _get_or_create_wrapper(self, graph_path, request_data=None):
        """The retrieval wrapper for a graph, downloading it once if needed.

        Two things the legacy version did not do:

        * the download is authorised by the REQUEST, not by an admin token;
        * the loaded graph's embedding space is checked against the model this
          toolkit is configured with, and a mismatch refuses.
        """
        from .engine.inventory import InventoryRetrievalApiWrapper  # noqa: PLC0415

        configuration = (request_data or {}).get("configuration") or {}
        params = self._settings_of(request_data)

        if graph_path and not os.path.exists(graph_path) and request_data:
            bucket = artifact_transport.resolve_bucket(params)
            self._download_graph_from_artifacts(
                graph_path,
                configuration.get("project_id"),
                configuration.get("application_id"),
                bucket,
                request_data,
            )

        wrapper = self.graph_instances.get(graph_path)
        if wrapper is None:
            wrapper = InventoryRetrievalApiWrapper(
                graph_path=graph_path or "",
                base_directory=None,
                source_toolkits={},
            )
            self.graph_instances[graph_path] = wrapper

        embedding_support.check(
            wrapper._knowledge_graph, embedding_support.resolve_model(params)
        )
        return wrapper

    # -- ingestion ---------------------------------------------------------

    def _run_ingestion_job(self, params, graph_path, request_data):  # noqa: ARG002
        """v1 has no Kubernetes ingestion Job.

        Ingestion runs in this sidecar, under the Go host's invocation manager
        and its slot accounting (``internal/spi/slots.go``, which refuses jobs
        mode). There is no worker image, no namespace and no
        ``INVENTORY_JOBS_ENABLED`` — so this is unreachable, and says so rather
        than building a manifest for an image nobody publishes.
        """
        raise RuntimeError(
            "ingestion runs in this service, not as a Kubernetes Job: the "
            "ingestion worker image is not part of the ADR-0023 port"
        )

    def _tool_run_ingestion(self, params, graph_path, request_data):
        """Build or update the graph from ONE expanded source.

        The legacy shape, with the platform coupling removed:

        legacy                              v1
        ------                              --
        toolkit_id → admin fetch of the     the facade forwards the expanded
        source toolkit's credentials        ``source`` object; a body without
                                            one is refused as invalid input
        local MiniLM embeddings             the configured ``embedding_model``
                                            through the LLM gateway, stamped
                                            into the graph
        uploads graph/checkpoint/status     returns them inline; the HOST
        itself with the admin token         uploads through the transport the
                                            facade handed over
        """
        from .engine.inventory import IngestionPipeline  # noqa: PLC0415
        from .engine.utils import SourceStatusManager  # noqa: PLC0415

        configuration = (request_data or {}).get("configuration") or {}
        llm_settings = params.get("llm_settings") or {}
        output_format = params.get("output_format", "text")

        if not graph_path:
            raise ValueError(
                "no graph path could be derived for this toolkit: the request "
                "carried no project_id/application_id"
            )

        source = source_support.parse_source(
            params.get("source"), tuple(self.source_types)
        )
        self.invocation_thinking(f"Ingesting from {source.type} source {source.name}")

        graph_dir = Path(graph_path).parent
        graph_dir.mkdir(parents=True, exist_ok=True)

        status_manager = SourceStatusManager(str(graph_dir))
        status_manager.start_ingestion(
            toolkit_id=str(source.toolkit_id),
            toolkit_name=source.name,
            toolkit_type=source.type,
            branch=source.branch or params.get("branch"),
        )

        if params.get("full_rebuild") and os.path.exists(graph_path):
            logger.info("full rebuild: removing the existing graph at %s", graph_path)
            os.remove(graph_path)

        llm_model = params.get("llm_model") or params.get(
            "toolkit_configuration_llm_model"
        )
        if not llm_model:
            raise ValueError(
                "no LLM model is configured for this Inventory toolkit; set "
                "llm_model in the toolkit configuration"
            )
        llm = self.platform_llm(
            model_name=llm_model,
            model_config={"temperature": 0.0, "max_tokens": 4096},
        )

        # Embeddings. A toolkit with no embedding_model builds a graph with no
        # vectors — the legacy default was a local model, so this is the one
        # behaviour change a user can see, and it is the point: nothing embeds
        # outside the gateway.
        embedding_model = embedding_support.resolve_model(params)
        embeddings = None
        dimension = None
        if embedding_model:
            embeddings = embedding_support.build(embedding_model, llm_settings)
            dimension = embedding_support.dimension_of(embeddings)
            self.invocation_thinking(
                f"Embedding entities with {embedding_model}"
                + (f" ({dimension} dimensions)" if dimension else "")
            )

        def progress_callback(message, phase):
            self.invocation_thinking(f"[{phase}] {message}")
            status_manager.update_progress(
                toolkit_id=str(source.toolkit_id), progress_message=message
            )
            self.invocation_stop_checkpoint()

        pipeline = IngestionPipeline(
            llm=llm,
            elitea=None,
            graph_path=graph_path,
            embedding=embeddings,
            embedding_model=embedding_model,
            auto_generate_embeddings=bool(embeddings),
            progress_callback=progress_callback,
        )
        pipeline.register_toolkit(source.name, source_support.build_toolkit(source))

        whitelist = source.whitelist or _patterns(params.get("file_patterns"))
        blacklist = source.blacklist or _patterns(params.get("exclude_patterns"))

        result = pipeline.run(
            source=source.name,
            branch=source.branch or params.get("branch"),
            whitelist=whitelist,
            blacklist=blacklist,
            extract_relations=True,
        )

        # Whatever this pod cached for the old graph is now stale.
        self.graph_instances.pop(graph_path, None)

        if result.success:
            # Stamp the embedding space BEFORE the graph is read back for
            # upload, so the recorded model travels with the vectors. A graph
            # uploaded without it is one this service cannot later refuse to
            # search in the wrong space.
            _stamp_saved_graph(graph_path, embedding_model, dimension)
            status_manager.complete_ingestion(
                toolkit_id=str(source.toolkit_id),
                entities_count=result.entities_added,
                relations_count=result.relations_added,
                documents_processed=result.documents_processed,
            )
        else:
            status_manager.fail_ingestion(
                toolkit_id=str(source.toolkit_id),
                error_message=result.errors[0] if result.errors else "Unknown error",
                documents_processed=result.documents_processed,
            )

        objects = _artifact_objects(graph_path, graph_dir, source.name, result.success)
        text = _ingestion_report(source.name, result, output_format)
        return text, objects


def _patterns(raw: Any) -> list[str] | None:
    if not raw:
        return None
    if isinstance(raw, list):
        items = [str(item).strip() for item in raw if str(item).strip()]
    else:
        items = [item.strip() for item in str(raw).split(",") if item.strip()]
    return items or None


def _stamp_saved_graph(graph_path: str, model: str | None, dimension: int | None) -> None:
    """Write the embedding space into the SAVED graph document.

    The pipeline has already persisted the graph by the time this runs, and the
    in-memory object it stamped is about to be discarded, so the stamp is
    applied to the file — which is what gets uploaded and what a query replica
    later downloads.
    """
    if not model:
        return
    path = Path(graph_path)
    if not path.exists():
        return
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        logger.warning("could not stamp the embedding model into %s", graph_path, exc_info=True)
        return
    metadata = document.setdefault("_metadata", {})
    if not isinstance(metadata, dict):  # pragma: no cover - a graph we did not write
        return
    metadata[embedding_support.METADATA_MODEL_KEY] = model
    if dimension:
        metadata[embedding_support.METADATA_DIMENSION_KEY] = int(dimension)
    path.write_text(json.dumps(document, indent=2, default=str), encoding="utf-8")


def _artifact_objects(
    graph_path: str, graph_dir: Path, source_name: str, success: bool
) -> list[dict[str, Any]]:
    """The graph, its checkpoint and the source status, for the host to upload.

    ``sources_status.json`` goes up even on FAILURE — it is the only record the
    UI has of why a source is red, and the legacy code uploaded it on both
    paths for that reason. The graph does not: a failed run's graph is whatever
    the previous run left plus a partial write, and overwriting the good copy in
    the bucket with it is how a failed ingestion destroys a working graph.
    """
    objects: list[dict[str, Any]] = []

    def add(path: Path, name: str, content_type: str) -> None:
        if not path.exists():
            return
        objects.append(
            {
                "name": name,
                "type": content_type,
                "data": path.read_text(encoding="utf-8"),
            }
        )

    if success:
        add(Path(graph_path), "graph.json", "application/json")
        add(
            graph_dir / f".ingestion-checkpoint-{source_name}.json",
            f".ingestion-checkpoint-{source_name}.json",
            "application/json",
        )
    add(graph_dir / "sources_status.json", "sources_status.json", "application/json")
    return objects


def _ingestion_report(source_name: str, result: Any, output_format: str) -> str:
    """The legacy report text, verbatim in shape."""
    if output_format == "json":
        return json.dumps(
            {
                "success": result.success,
                "source": result.source,
                "documents_processed": result.documents_processed,
                "entities_added": result.entities_added,
                "relations_added": result.relations_added,
                "errors": list(result.errors[:10]) if result.errors else [],
                "duration_seconds": result.duration_seconds,
            }
        )
    if not result.success:
        lines = [f"Ingestion failed for {source_name}", ""]
        if result.errors:
            lines.append("Errors:")
            lines.extend(f"- {error}" for error in result.errors[:10])
        return "\n".join(lines)

    output = (
        f"# Ingestion Complete: {source_name}\n\n"
        f"**Source:** {result.source}\n"
        f"**Documents:** {result.documents_processed}\n"
        f"**Entities:** {result.entities_added}\n"
        f"**Relations:** {result.relations_added}\n"
        f"**Duration:** {result.duration_seconds:.1f}s\n"
    )
    if result.errors:
        output += f"\n**Warnings/Errors ({len(result.errors)}):**\n"
        output += "".join(f"- {error}\n" for error in result.errors[:5])
        if len(result.errors) > 5:
            output += f"... and {len(result.errors) - 5} more\n"
    return output


__all__ = ["DEFERRED_TOOLS", "DeferredTool", "V1Overrides"]
