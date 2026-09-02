"""The seam between the engine sidecar and the analysis engine.

The SPI — routes, the invocation registry, the error contract, composition
and upload — is the Go sub-application host's (ADR-0023). What this package
still serves, over the sidecar's Unix socket, is the engine: one tool call
with an already-derived keyword set, progress events and a stop checkpoint
through the context the sidecar hands in, and the index publish for a
completed generation.

Three implementations:

* :class:`ToolRunner` — the Protocol the sidecar depends on;
* :class:`UnavailableToolRunner` — the default. It **refuses** every tool with
  a ``resource_not_found`` error rather than returning an empty success. A
  runner that is not wired must look broken, not idle;
* :class:`elitea_deepwiki.legacy_runner.LegacyToolRunner` — the real one,
  which dispatches into the engine;
* :class:`elitea_deepwiki.fixture_runner.FixtureToolRunner` — canned results
  with paced progress, for a stack that proves the hop without the engine.
"""

from __future__ import annotations

from typing import Any, Protocol


class ToolRunner(Protocol):
    """What the sidecar needs from a tool implementation."""

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        """Run one tool with the legacy keyword set; answer the engine's result dict."""
        ...

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        """Publish a completed generation's index (a no-op without a database)."""
        ...


class UnavailableToolRunner:
    """The default runner: refuses everything, loudly.

    ``ELITEA_DEEPWIKI_RUNNER=legacy`` selects the real one. Until then the
    sidecar serves its protocol — invoke, stop, health — and every actual
    tool invocation terminates with an error a caller can read. A runner
    that answered ``success`` with an empty artifact set would let the host
    and the UI be built against a lie.
    """

    name = "unavailable"

    async def run_engine_tool(
        self, tool_name: str, arguments: dict[str, Any], context: Any
    ) -> Any:
        raise FileNotFoundError(
            f"No DeepWiki tool runner is configured, so '{tool_name}' cannot "
            f"run. Set ELITEA_DEEPWIKI_RUNNER=legacy and install the 'engine' "
            f"extra to enable the analysis engine."
        )

    async def publish(self, result: dict[str, Any], context: Any) -> None:
        return None


def build_runner(settings) -> ToolRunner:
    """Select the tool runner named by ``ELITEA_DEEPWIKI_RUNNER``.

    ``unavailable`` (the default) refuses every tool. ``legacy`` dispatches
    into the copied analysis engine and needs the ``engine`` extra installed;
    if that import fails, this raises at startup rather than degrading to a
    runner that refuses — a deployment that asked for the engine and did not
    get it must not come up looking healthy. ``fixture`` is the canned engine.
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
        f"ELITEA_DEEPWIKI_RUNNER={name!r} is not a known runner "
        f"(expected 'unavailable', 'legacy' or 'fixture')"
    )
