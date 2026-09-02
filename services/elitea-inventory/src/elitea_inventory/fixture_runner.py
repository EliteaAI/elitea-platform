"""A canned engine, for a stack that proves the socket hop without the closure.

It answers the same result dict the real runner does — a text result and an
artifact list — so the Go host's composition and upload path can be exercised
end to end on a stack with no LLM, no repository and no ~700 MB of engine
dependencies. What it must never do is look like the real engine to a user:
every result says so in its first line.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

from .tools_table import FAMILIES
from .v1_overrides import DEFERRED_TOOLS, DeferredTool


class FixtureToolRunner:
    """Paced progress and a canned result."""

    name = "fixture"

    def __init__(self, settings=None) -> None:
        self._settings = settings
        self._step = float(getattr(settings, "fixture_step_seconds", 0.0) or 0.0)

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        family = arguments.get("family") or "inventory"
        table = FAMILIES.get(family)
        if table is None:
            raise ValueError(
                f"Unknown toolkit: {family}. Expected: inventory or inventory_search"
            )
        if tool_name in DEFERRED_TOOLS:
            raise DeferredTool(
                f"'{tool_name}' is not available: it was "
                f"{DEFERRED_TOOLS[tool_name]}, so no implementation has ever "
                f"run on this platform."
            )
        if tool_name not in table:
            raise ValueError(
                f"Unknown tool: {tool_name}. Available: {', '.join(sorted(table))}"
            )

        for step in (f"Received {tool_name}", "Reading the graph", "Done"):
            await context.checkpoint()
            await context.thinking(step)
            if self._step:
                await asyncio.sleep(self._step)

        params = arguments.get("params") or {}
        text = (
            f"[fixture] {family}/{tool_name} did not run the engine.\n"
            f"parameters: {json.dumps(params, default=str, sort_keys=True)}"
        )
        artifacts: list[dict[str, Any]] = []
        if tool_name == "run_ingestion":
            artifacts.append(
                {
                    "name": "graph.json",
                    "type": "application/json",
                    "data": json.dumps({"nodes": [], "edges": [], "_metadata": {"fixture": True}}),
                }
            )
        return {"success": True, "result": text, "artifacts": artifacts}

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        return None


__all__ = ["FixtureToolRunner"]
