"""Which tool the sidecar serves, and which legacy handler answers it.

This is the legacy routing table, lifted out of ``_handle_inventory_tool`` and
``_handle_inventory_search_tool`` and written down as data. It is data because
two tests read it: one checks it against the copied handlers' own dictionaries
(so a re-copy that changed the legacy routing fails here rather than at the
first invocation), and one checks it against the descriptor the Go host serves
(so a tool cannot be advertised and unserved, or served and unadvertised).

The five entries the legacy descriptor advertised and the legacy router never
carried are NOT here — see ``v1_overrides.DEFERRED_TOOLS``. ``query_graph`` is
here once, under ``inventory_search``, which is the only family that routed it.
"""

from __future__ import annotations

#: ``inventory`` family: tool name → the copied handler that answers it.
#: Handlers take ``(params, graph_path, request_data)``.
INVENTORY_TOOLS = {
    # Ingestion. `delta_update` is NOT here even though the legacy router
    # carried it: its handler is a stub that answers "Not yet implemented" as a
    # SUCCESS. See ``v1_overrides.DEFERRED_TOOLS``.
    "run_ingestion": "_tool_run_ingestion",
    "remove_source_entities": "_tool_remove_source_entities",
    # Graph management
    "list_ingested_sources": "_tool_list_ingested_sources",
    "list_graphs": "_tool_list_graphs",
    "load_graph": "_tool_load_graph",
    "get_graph_info": "_tool_get_graph_info",
    # Retrieval
    "search_graph": "_tool_search_graph",
    "get_entity": "_tool_get_entity",
    "get_entity_content": "_tool_get_entity_content",
    "impact_analysis": "_tool_impact_analysis",
    "get_related_entities": "_tool_get_related_entities",
    "get_cross_source_relations": "_tool_get_cross_source_relations",
    "get_stats": "_tool_get_stats",
    "list_entities_by_type": "_tool_list_entities_by_type",
    "list_entities_by_layer": "_tool_list_entities_by_layer",
    "list_entities_by_source": "_tool_list_entities_by_source",
    # Presets
    "list_presets": "_tool_list_presets",
    "get_preset_info": "_tool_get_preset_info",
    # Cache
    "get_cache_stats": "_tool_get_cache_stats",
    "cleanup_cache": "_tool_cleanup_cache",
    # Status
    "get_ingestion_status": "_tool_get_ingestion_status",
    "get_sources_status": "_tool_get_sources_status",
    # Batch / neighbour reads the legacy UI calls (implemented, never declared
    # until descriptor revision legacy-v1)
    "get_entities_by_ids": "_tool_get_entities_by_ids",
    "get_entity_neighbors": "_tool_get_entity_neighbors",
    # Maintenance
    "normalize_types": "_tool_normalize_types",
    "rebuild_indices": "_tool_rebuild_indices",
    "smart_normalize_types": "_tool_smart_normalize_types",
}

#: ``inventory_search`` family: the read-only surface another agent's toolkit
#: references. Four of the six are the same handlers under different names —
#: the legacy ``tool_mapping`` — and two are their own.
SEARCH_TOOLS = {
    "search_knowledge_graph": "_tool_search_graph",
    "get_entity_details": "_tool_get_entity",
    "get_related_entities": "_tool_get_related_entities",
    "query_graph": "_tool_query_graph",
    "list_entity_types": "_tool_list_entity_types_only",
    "investigate": "_tool_investigate",
}

#: The tools whose handler is NOT ``(params, graph_path, request_data)``.
#: ``investigate`` takes the project and toolkit ids instead of a path, because
#: it drives the chat agent, which resolves its own graph.
SIGNATURE_EXCEPTIONS = ("investigate",)

FAMILIES = {
    "inventory": INVENTORY_TOOLS,
    "inventory_search": SEARCH_TOOLS,
}


def handler_for(family: str, tool: str) -> str:
    """The handler name for one admitted call, or raise the legacy refusal."""
    table = FAMILIES.get(family)
    if table is None:
        raise ValueError(
            f"Unknown toolkit: {family}. Expected: inventory or inventory_search"
        )
    try:
        return table[tool]
    except KeyError:
        raise ValueError(
            f"Unknown tool: {tool}. Available: {', '.join(sorted(table))}"
        ) from None


__all__ = [
    "FAMILIES",
    "INVENTORY_TOOLS",
    "SEARCH_TOOLS",
    "SIGNATURE_EXCEPTIONS",
    "handler_for",
]
