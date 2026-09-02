"""``tools_table`` is the legacy routing table. This proves it, by reading it.

The table was lifted out of ``_handle_inventory_tool`` and
``_handle_inventory_search_tool`` and written down as data, because dispatch by
attribute lookup would serve any ``_tool_*`` method the copy happens to define —
and the copy defines five whose legacy router never named them.

Lifting it created a second copy of the same fact, which is the failure mode
these tests exist for: a re-copy that changes the legacy routing must fail HERE,
loudly, rather than at the first invocation of whichever tool moved.

Nothing here imports the engine: the copied handlers are parsed as source.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

from elitea_inventory import tools_table
from elitea_inventory.v1_overrides import DEFERRED_TOOLS

PACKAGE_DIR = Path(__file__).resolve().parents[2] / "src" / "elitea_inventory"
TOOL_OPERATIONS = ast.parse(
    (PACKAGE_DIR / "tool_operations.py").read_text(encoding="utf-8")
)


def _method(name: str) -> ast.FunctionDef:
    for node in ast.walk(TOOL_OPERATIONS):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            return node
    raise AssertionError(f"{name} is not in the copied tool layer")


def _dispatch_dict(method_name: str, variable: str) -> dict[str, str]:
    """The literal ``{tool: self._handler}`` dict a legacy handler routes with."""
    for node in ast.walk(_method(method_name)):
        if not isinstance(node, ast.Assign):
            continue
        target = node.targets[0]
        if not (isinstance(target, ast.Name) and target.id == variable):
            continue
        if not isinstance(node.value, ast.Dict):
            continue
        routes = {}
        for key, value in zip(node.value.keys, node.value.values):
            assert isinstance(key, ast.Constant)
            if isinstance(value, ast.Attribute):  # self._tool_x
                routes[key.value] = value.attr
            elif isinstance(value, ast.Constant):  # the name-mapping dict
                routes[key.value] = value.value
        return routes
    raise AssertionError(f"no {variable} dict in {method_name}")


def test_the_inventory_table_is_the_legacy_routing_table_minus_the_stub():
    """Everything the legacy router carried, except one deliberate removal.

    ``delta_update`` was routed and reachable, and its handler is a stub that
    answered "Not yet implemented" as a SUCCESS. It is refused here instead
    (``DEFERRED_TOOLS``), so the tables differ by exactly that name — and the
    difference is asserted rather than allowed, because "the tables differ a
    bit" is how a second tool quietly stops being served.
    """
    legacy = _dispatch_dict("_handle_inventory_tool", "tools")
    assert set(legacy) - set(tools_table.INVENTORY_TOOLS) == {"delta_update"}
    assert not set(tools_table.INVENTORY_TOOLS) - set(legacy)
    for tool, handler in tools_table.INVENTORY_TOOLS.items():
        assert legacy[tool] == handler, tool


def test_the_search_table_routes_what_the_legacy_name_mapping_named():
    """The search family routed in two hops: a name mapping, then a dict.

    ``search_knowledge_graph`` → ``search_graph`` → ``_tool_search_graph``.
    This flattens both hops and compares the result, so a rename in either
    fails.
    """
    mapping = _dispatch_dict("_handle_inventory_search_tool", "tool_mapping")
    handlers = _dispatch_dict("_handle_inventory_search_tool", "tools")
    flattened = {
        external: handlers[internal] for external, internal in mapping.items()
    }
    assert tools_table.SEARCH_TOOLS == flattened


@pytest.mark.parametrize("tool", sorted(DEFERRED_TOOLS))
def test_a_deferred_tool_has_a_handler_and_was_never_routed(tool):
    """The five the legacy descriptor advertised and the router never carried.

    Both halves matter. That a handler EXISTS is why the refusal has to be
    explicit — the method is one line of dispatch away from being served, with
    no test behind it. That the legacy router never named it is the evidence
    that it has never run on this platform, which is what the refusal claims.
    """
    _method(f"_tool_{tool}")  # raises if the handler is gone
    assert tool not in tools_table.INVENTORY_TOOLS
    assert tool not in tools_table.SEARCH_TOOLS


def test_query_graph_is_served_on_the_search_family_only():
    """It is declared on BOTH families and was routed on only one.

    Serving it on ``inventory`` would be a new tool, not a port: nothing has
    ever called it there, and its handler takes the search family's parameter
    shape.
    """
    assert "query_graph" in tools_table.SEARCH_TOOLS
    assert "query_graph" not in tools_table.INVENTORY_TOOLS


def test_every_routed_handler_exists_in_the_copy():
    for family, table in tools_table.FAMILIES.items():
        for tool, handler in table.items():
            _method(handler), (family, tool)


def test_investigate_is_the_only_signature_exception():
    """Every other handler takes ``(params, graph_path, request_data)``.

    ``investigate`` takes the project and toolkit ids because it drives the
    chat agent, which resolves its own graph. The runner branches on this
    tuple; a second exception added to the copy and not to the tuple would be
    called with the wrong arguments.
    """
    assert tools_table.SIGNATURE_EXCEPTIONS == ("investigate",)
    for family, table in tools_table.FAMILIES.items():
        for tool, handler in table.items():
            if tool in tools_table.SIGNATURE_EXCEPTIONS:
                continue
            arguments = [
                argument.arg for argument in _method(handler).args.args if argument.arg != "self"
            ]
            assert arguments == ["params", "graph_path", "request_data"], (family, tool)
