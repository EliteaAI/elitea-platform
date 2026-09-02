#!/usr/bin/env python3
"""Derive descriptor revision legacy-v1 from legacy-v0, by adding four tools.

The four are implemented in the legacy plugin, ROUTED by the legacy plugin, and
called by the legacy UI — and were never declared in its descriptor. On the
legacy platform that worked because the UI called the provider's own HTTP
routes; under ADR-0022/0023 the facade admits a tool only if the descriptor
advertises it, so an undeclared tool is an unreachable one, and the graph view's
"expand neighbours" and the chat view's entity highlighting would be dead.

Generated rather than hand-edited so that the diff against legacy-v0 is exactly
the four insertions and nothing else — a hand edit of a 37 KB document cannot be
reviewed for what it did NOT change.

    python tools/build_descriptor_v1.py            rewrite the v1 fixture
    python tools/build_descriptor_v1.py --check    verify it is current
"""

from __future__ import annotations

import argparse
import collections
import json
import sys
from pathlib import Path

FIXTURES = (
    Path(__file__).resolve().parents[3]
    / "conformance"
    / "provider"
    / "fixtures"
    / "inventory"
    / "descriptor"
)
V0 = FIXTURES / "legacy-v0" / "provider_descriptor.json"
V1 = FIXTURES / "legacy-v1" / "provider_descriptor.json"


def _od(pairs):
    return collections.OrderedDict(pairs)


def _arg(type_, required, description, default=...):
    pairs = [("type", type_), ("required", required), ("description", description)]
    if default is not ...:
        pairs.append(("default", default))
    return _od(pairs)


#: The four, with args_schema taken from their legacy handlers' own parameter
#: reads (methods/invoke.py) — not invented: every name, type and default below
#: is what the handler does with the value it finds.
NEW_TOOLS = {
    "get_ingestion_status": _od(
        [
            ("name", "get_ingestion_status"),
            (
                "description",
                "Report the ingestion currently running for this toolkit, if any, "
                "with its progress. Used by the sources view to show a run in flight.",
            ),
            (
                "args_schema",
                _od(
                    [
                        (
                            "output_format",
                            _arg("String", False, "'json' or 'text'", "text"),
                        )
                    ]
                ),
            ),
            ("tool_result_type", "String"),
            ("sync_invocation_supported", True),
            ("async_invocation_supported", True),
        ]
    ),
    "get_entities_by_ids": _od(
        [
            ("name", "get_entities_by_ids"),
            (
                "description",
                "Fetch entities by their IDs together with the edges connecting them. "
                "Used by the chat view to display and highlight the entities a "
                "response drew on.",
            ),
            (
                "args_schema",
                _od(
                    [
                        ("entity_ids", _arg("JSON", True, "List of entity IDs to fetch", [])),
                        (
                            "include_edges",
                            _arg("Boolean", False, "Include the edges between the returned entities", True),
                        ),
                        (
                            "include_bridging",
                            _arg(
                                "Boolean",
                                False,
                                "Include bridging nodes that connect otherwise disjoint clusters",
                                True,
                            ),
                        ),
                        (
                            "max_bridge_length",
                            _arg(
                                "Integer",
                                False,
                                "Maximum path length when bridging (4 means up to 3 intermediate nodes)",
                                4,
                            ),
                        ),
                        ("output_format", _arg("String", False, "'json' or 'text'", "json")),
                    ]
                ),
            ),
            ("tool_result_type", "String"),
            ("sync_invocation_supported", True),
            ("async_invocation_supported", True),
        ]
    ),
    "get_entity_neighbors": _od(
        [
            ("name", "get_entity_neighbors"),
            (
                "description",
                "Get the neighbours of an entity up to a given depth, with the edges "
                "connecting them. Used by the graph view's context menu to expand "
                "connections 1-3 levels deep.",
            ),
            (
                "args_schema",
                _od(
                    [
                        ("entity_id", _arg("String", True, "ID of the entity to expand from")),
                        (
                            "depth",
                            _arg(
                                "Integer",
                                False,
                                "Number of hops to expand (1, 2 or 3); values outside that range are clamped",
                                1,
                            ),
                        ),
                        ("output_format", _arg("String", False, "'json' or 'text'", "json")),
                    ]
                ),
            ),
            ("tool_result_type", "String"),
            ("sync_invocation_supported", True),
            ("async_invocation_supported", True),
        ]
    ),
    "smart_normalize_types": _od(
        [
            ("name", "smart_normalize_types"),
            (
                "description",
                "Use the configured LLM to map uncommon entity types onto the "
                "canonical set. Runs automatically after a successful ingestion; "
                "exposed here so it can be re-run on an existing graph.",
            ),
            (
                "args_schema",
                _od(
                    [
                        (
                            "threshold",
                            _arg(
                                "Integer",
                                False,
                                "Only normalize types whose entity count is below this",
                                1000,
                            ),
                        ),
                        (
                            "dry_run",
                            _arg("Boolean", False, "Show the proposed mapping without applying it", False),
                        ),
                        (
                            "batch_size",
                            _arg("Integer", False, "Number of types to send per LLM call", 100),
                        ),
                        ("output_format", _arg("String", False, "'json' or 'text'", "json")),
                    ]
                ),
            ),
            ("tool_result_type", "String"),
            ("sync_invocation_supported", True),
            ("async_invocation_supported", True),
        ]
    ),
}

#: Where each new tool is inserted, so the list reads in the legacy ROUTING
#: order (_handle_inventory_tool's dict) rather than alphabetically.
INSERT_AFTER = {
    "cleanup_cache": ["get_ingestion_status"],
    "get_sources_status": ["get_entities_by_ids", "get_entity_neighbors"],
    "rebuild_indices": ["smart_normalize_types"],
}


def build() -> str:
    document = json.loads(V0.read_text(encoding="utf-8"), object_pairs_hook=collections.OrderedDict)
    for toolkit in document["provided_toolkits"]:
        if toolkit["name"] != "inventory":
            continue
        expanded = []
        for tool in toolkit["provided_tools"]:
            expanded.append(tool)
            for name in INSERT_AFTER.get(tool["name"], []):
                expanded.append(NEW_TOOLS[name])
        toolkit["provided_tools"] = expanded
    return json.dumps(document, indent=2, ensure_ascii=False) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    built = build()
    if args.check:
        current = V1.read_text(encoding="utf-8")
        if current != built:
            print("legacy-v1 is not what this tool builds; re-run it", file=sys.stderr)
            return 1
        print("ok")
        return 0
    V1.parent.mkdir(parents=True, exist_ok=True)
    V1.write_text(built, encoding="utf-8")
    print(f"wrote {V1}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
