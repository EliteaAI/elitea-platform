"""The seam between the frozen SPI and the analysis engine.

Everything above this line is the SPI: routes, the invocation registry, the
error contract. Everything below it is :mod:`elitea_deepwiki.engine`, the
verbatim copy of the legacy analysis engine. Naming the boundary first is what
made the engine copy a wiring change rather than another rewrite of the routes.

Three implementations:

* :class:`ToolRunner` — the Protocol the SPI depends on;
* :class:`UnavailableToolRunner` — the default. It **refuses** every tool with
  a ``resource_not_found`` error rather than returning an empty success. A
  runner that is not wired must look broken, not idle;
* :class:`elitea_deepwiki.legacy_runner.LegacyToolRunner` — the real one,
  which dispatches into the engine.

The module is called ``toolrunner`` rather than ``engine`` because ``engine``
is the copied package itself.
"""

from __future__ import annotations

from typing import Any, Protocol

from .invocations import InvocationContext
from .toolkits import ToolkitFamily


class ToolRunner(Protocol):
    """What the SPI needs from a tool implementation.

    One method. The legacy handler's per-tool branching, parameter merge and
    result composition live in :mod:`elitea_deepwiki.legacy_runner`, which
    implements this — they are engine-facing behaviour, pinned by the P0
    ``composed_result.json`` fixture, and they do not belong in the routes.
    """

    async def invoke(
        self,
        *,
        family: ToolkitFamily,
        toolkit_name: str,
        tool_name: str,
        request_data: dict[str, Any],
        context: InvocationContext,
    ) -> dict[str, Any]:
        """Run one tool and return its terminal body.

        The returned mapping is what a poll hands back verbatim: at minimum
        ``invocation_id``, ``status`` (``Completed`` or ``Error``), ``result``
        (a JSON *string* holding the result-object list) and ``result_type``.

        Raising is also allowed and is the normal path for a failure — the
        invocation manager converts the exception through the legacy category
        classifier.
        """
        ...


class UnavailableToolRunner:
    """The default runner: refuses everything, loudly.

    ``ELITEA_DEEPWIKI_RUNNER=legacy`` selects the real one. Until then the
    service serves the whole SPI — descriptor, health, slots, accept, poll,
    cancel — and every actual tool invocation terminates with an error a caller
    can read. That is deliberate: a shell that answered ``Completed`` with an
    empty artifact set would let the facade and the UI be built against a lie.
    """

    name = "unavailable"

    async def invoke(
        self,
        *,
        family: ToolkitFamily,
        toolkit_name: str,
        tool_name: str,
        request_data: dict[str, Any],
        context: InvocationContext,
    ) -> dict[str, Any]:
        raise FileNotFoundError(
            f"No DeepWiki tool runner is configured, so '{tool_name}' cannot "
            f"run. Set ELITEA_DEEPWIKI_RUNNER=legacy and install the 'engine' "
            f"extra to enable the analysis engine."
        )


def build_runner(settings) -> ToolRunner:
    """Select the tool runner named by ``ELITEA_DEEPWIKI_RUNNER``.

    ``unavailable`` (the default) refuses every tool. ``legacy`` dispatches
    into the copied analysis engine and needs the ``engine`` extra installed;
    if that import fails, this raises at startup rather than degrading to a
    runner that refuses — a deployment that asked for the engine and did not
    get it must not come up looking healthy.
    """
    name = getattr(settings, "runner", "unavailable")

    if name == "unavailable":
        return UnavailableToolRunner()

    if name == "legacy":
        from .legacy_runner import LegacyToolRunner  # noqa: PLC0415

        return LegacyToolRunner()

    raise ValueError(
        f"ELITEA_DEEPWIKI_RUNNER={name!r} is not a known runner "
        f"(expected 'unavailable' or 'legacy')"
    )
