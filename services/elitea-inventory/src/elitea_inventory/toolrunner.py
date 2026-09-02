"""The seam between the engine sidecar and the analysis engine.

Three implementations, exactly as ``elitea_deepwiki.toolrunner`` has:

* :class:`ToolRunner` — the Protocol the sidecar depends on;
* :class:`UnavailableToolRunner` — the default. It **refuses** every tool with
  a ``resource_not_found`` error rather than returning an empty success. A
  runner that is not wired must look broken, not idle;
* :class:`~elitea_inventory.legacy_runner.LegacyToolRunner` — the real one;
* :class:`~elitea_inventory.fixture_runner.FixtureToolRunner` — a canned
  result with paced progress, for a stack that proves the socket hop without
  the engine's closure.
"""

from __future__ import annotations

from typing import Any, Protocol


class ToolRunner(Protocol):
    """What the sidecar needs from a tool implementation."""

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        """Run one tool with the host's derived arguments; answer a result dict."""
        ...

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        """Publish anything a completed run owes to other replicas."""
        ...


class UnavailableToolRunner:
    """The default runner: refuses everything, loudly."""

    name = "unavailable"

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        raise FileNotFoundError(
            f"No Inventory tool runner is configured, so '{tool_name}' cannot "
            f"run. Set ELITEA_INVENTORY_RUNNER=legacy and install the 'engine' "
            f"extra to enable the knowledge-graph engine."
        )

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        return None


def build_runner(settings) -> ToolRunner:
    """Select the tool runner named by ``ELITEA_INVENTORY_RUNNER``.

    ``legacy`` needs the ``engine`` extra installed; if that import fails this
    raises at startup rather than degrading to the refusing runner — a
    deployment that asked for the engine and did not get it must not come up
    looking healthy.
    """
    name = getattr(settings, "runner", "unavailable")

    if name == "unavailable":
        return UnavailableToolRunner()
    if name == "legacy":
        from .legacy_runner import LegacyToolRunner  # noqa: PLC0415

        return LegacyToolRunner(settings=settings)
    if name == "fixture":
        from .fixture_runner import FixtureToolRunner  # noqa: PLC0415

        return FixtureToolRunner(settings=settings)
    raise ValueError(
        f"ELITEA_INVENTORY_RUNNER={name!r} is not a known runner "
        f"(expected 'unavailable', 'legacy' or 'fixture')"
    )


__all__ = ["ToolRunner", "UnavailableToolRunner", "build_runner"]
