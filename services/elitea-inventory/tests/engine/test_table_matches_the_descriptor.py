"""The engine's routing table against the descriptor the host serves.

Three copies of "which tools exist" exist by necessity — the descriptor (what
the facade admits), the Go admission table (what the host lets through) and this
package's routing table (what the engine can actually run). The Go side already
checks the first two against each other. This checks the first against the
third, which is the pair no Go test can see: a tool advertised and admitted, and
then unroutable in the engine, fails only at invocation.
"""

from __future__ import annotations

import json
from pathlib import Path

from elitea_inventory.tools_table import INVENTORY_TOOLS, SEARCH_TOOLS
from elitea_inventory.v1_overrides import DEFERRED_TOOLS

DESCRIPTOR = json.loads(
    (
        Path(__file__).resolve().parents[4]
        / "conformance"
        / "provider"
        / "fixtures"
        / "inventory"
        / "descriptor"
        / "legacy-v1"
        / "provider_descriptor.json"
    ).read_text(encoding="utf-8")
)

ADVERTISED = {
    toolkit["name"]: [tool["name"] for tool in toolkit["provided_tools"]]
    for toolkit in DESCRIPTOR["provided_toolkits"]
}


def test_nothing_is_routed_that_the_descriptor_does_not_advertise():
    """A servable tool nobody can reach is dead code that looks alive.

    It also means the descriptor is not the whole story of what this service
    does, which is the thing the descriptor is for.
    """
    assert not set(INVENTORY_TOOLS) - set(ADVERTISED["inventory"])
    assert not set(SEARCH_TOOLS) - set(ADVERTISED["inventory_search"])


def test_everything_advertised_is_either_routed_or_explicitly_deferred():
    """No third state. An advertised tool is served, or refused with a reason.

    The failure this prevents is the quiet one: a tool in the descriptor that
    is in neither table, so the engine answers "Unknown tool" — a message that
    says it does not exist, to a caller reading a document that says it does.
    """
    for family, table in (("inventory", INVENTORY_TOOLS), ("inventory_search", SEARCH_TOOLS)):
        unaccounted = set(ADVERTISED[family]) - set(table) - set(DEFERRED_TOOLS)
        if family == "inventory":
            # query_graph is deferred on this family alone — the search family
            # routes it — so it is not in the family-agnostic DEFERRED_TOOLS.
            unaccounted -= {"query_graph"}
        assert not unaccounted, f"{family}: neither served nor deferred: {sorted(unaccounted)}"


def test_the_counts_are_what_the_readme_and_the_commit_claim():
    """Stated numbers, checked. 33 advertised on `inventory`, 27 served, 6 refuse.

    Pinned because these numbers are quoted in the README, in the fixture
    directory's README and in the commit message, and a claim in prose that no
    test reads goes stale the first time a tool is added — as it did the moment
    `delta_update` moved from served to deferred.
    """
    assert len(ADVERTISED["inventory"]) == 33
    assert len(INVENTORY_TOOLS) == 27
    assert len(set(ADVERTISED["inventory"]) - set(INVENTORY_TOOLS)) == 6
    assert len(ADVERTISED["inventory_search"]) == len(SEARCH_TOOLS) == 6


def test_the_four_added_in_legacy_v1_are_routed():
    """Adding them to the descriptor and not the table would serve nothing."""
    for tool in (
        "get_entity_neighbors",
        "get_entities_by_ids",
        "get_ingestion_status",
        "smart_normalize_types",
    ):
        assert tool in ADVERTISED["inventory"], f"{tool} is not advertised"
        assert tool in INVENTORY_TOOLS, f"{tool} is advertised and unroutable"
