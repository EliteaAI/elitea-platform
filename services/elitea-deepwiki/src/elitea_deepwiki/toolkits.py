"""Toolkit and tool admission — the port of ``perform_invoke_request``'s gate.

The legacy handler opened with three literal lists of accepted toolkit names
and a per-family list of accepted tools. Only three names are advertised by the
descriptor; the rest exist so toolkit configurations created before the
Deepwiki -> Wikis rename keep working. Dropping an alias silently breaks stored
user data, so the lists are ported verbatim and pinned by
``conformance/fixtures/spi/toolkit_aliases.json``.
"""

from __future__ import annotations

from enum import Enum


class ToolkitFamily(str, Enum):
    """Which handler an accepted toolkit name routes to."""

    MAIN = "main"
    QUERY = "query"
    WIKI_QUERY = "wiki_query"


#: Ported verbatim from ``methods/invoke.py::perform_invoke_request``.
MAIN_TOOLKIT_NAMES: tuple[str, ...] = (
    "WikiBuilderToolkit",
    "deepwiki",
    "Deepwiki",
    "wiki",
    "DeepWikiToolkit",
    "DeepWiki",
    "Wiki",
    "wikis",
    "Wikis",
)
QUERY_TOOLKIT_NAMES: tuple[str, ...] = (
    "wikis_query",
    "deepwiki_query",
    "DeepwikiQuery",
    "deepwiki-query",
)
WIKI_QUERY_TOOLKIT_NAMES: tuple[str, ...] = (
    "wiki_query",
    "WikiQuery",
    "wiki-query",
)

#: The names the descriptor advertises. Every one of these must also appear in
#: the alias lists above; a conformance test asserts it.
ADVERTISED_TOOLKIT_NAMES: tuple[str, ...] = ("Wikis", "wikis_query", "wiki_query")

MAIN_TOOLS: tuple[str, ...] = ("generate_wiki", "ask", "deep_research")
QUERY_TOOLS: tuple[str, ...] = ("ask", "deep_research")
WIKI_QUERY_TOOLS: tuple[str, ...] = (
    "list_wikis",
    "resolve_and_ask",
    "resolve_and_deep_research",
    "delete_wiki",
)

_FAMILY_BY_NAME: dict[str, ToolkitFamily] = {
    **{name: ToolkitFamily.MAIN for name in MAIN_TOOLKIT_NAMES},
    **{name: ToolkitFamily.QUERY for name in QUERY_TOOLKIT_NAMES},
    **{name: ToolkitFamily.WIKI_QUERY for name in WIKI_QUERY_TOOLKIT_NAMES},
}

_TOOLS_BY_FAMILY: dict[ToolkitFamily, tuple[str, ...]] = {
    ToolkitFamily.MAIN: MAIN_TOOLS,
    ToolkitFamily.QUERY: QUERY_TOOLS,
    ToolkitFamily.WIKI_QUERY: WIKI_QUERY_TOOLS,
}

#: Every accepted toolkit name, in the legacy list order — this exact sequence
#: is interpolated into the unknown-toolkit error message.
ALL_TOOLKIT_NAMES: tuple[str, ...] = (
    MAIN_TOOLKIT_NAMES + QUERY_TOOLKIT_NAMES + WIKI_QUERY_TOOLKIT_NAMES
)


def resolve_family(toolkit_name: str) -> ToolkitFamily:
    """Return the family for ``toolkit_name``.

    Raises ``FileNotFoundError`` for an unknown toolkit, which the legacy
    classifier maps to ``resource_not_found``. The exception type is part of
    the contract, not an implementation detail.
    """
    family = _FAMILY_BY_NAME.get(toolkit_name)
    if family is None:
        raise FileNotFoundError(
            f"Unknown toolkit: {toolkit_name}. "
            f"Expected: one of {list(ALL_TOOLKIT_NAMES)}"
        )
    return family


def validate_tool(family: ToolkitFamily, tool_name: str) -> None:
    """Check ``tool_name`` against ``family``.

    The exception types differ by family and that difference is recorded in the
    fixtures: the main family raises ``FileNotFoundError``
    (``resource_not_found``) while the two query families raise ``ValueError``
    (``invalid_input``).
    """
    allowed = _TOOLS_BY_FAMILY[family]
    if tool_name in allowed:
        return

    if family is ToolkitFamily.MAIN:
        raise FileNotFoundError(f"Unknown tool: {tool_name}")

    label = "deepwiki_query" if family is ToolkitFamily.QUERY else "wiki_query"
    raise ValueError(
        f"Tool '{tool_name}' not available in {label} toolkit. "
        f"Available: {', '.join(allowed)}"
    )
