"""The engine seam.

The analysis engine itself (~90k LOC of ``plugin_implementation/``) has not
moved yet — that is the next slice of P1. Everything above this seam is the
frozen SPI; everything below it is the engine. Defining the boundary first
means the engine copy is a wiring change rather than another rewrite of the
routes.

Two implementations live here:

* :class:`Engine` — the Protocol the SPI shell depends on;
* :class:`UnavailableEngine` — the default. It **refuses** every tool with a
  ``resource_not_found`` error rather than returning an empty success. An
  engine that is not wired must look broken, not idle.

A fixture-backed fake lives in the tests, not here.
"""

from __future__ import annotations

from typing import Any, Protocol

from .invocations import InvocationContext
from .toolkits import ToolkitFamily


class Engine(Protocol):
    """What the SPI shell needs from the analysis engine.

    One method. The legacy handler's per-tool branching, parameter merge and
    result composition belong below this line, with the engine, because they
    are engine behaviour that the P0 ``composed_result.json`` fixture pins.
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


class UnavailableEngine:
    """The default engine: refuses everything, loudly.

    ``ELITEA_DEEPWIKI_ENGINE`` selects a real engine once one exists. Until
    then the service serves the whole SPI — descriptor, health, slots, accept,
    poll, cancel — and every actual tool invocation terminates with an error a
    caller can read. That is deliberate: a shell that answered ``Completed``
    with an empty artifact set would let the facade and the UI be built against
    a lie.
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
            f"The DeepWiki analysis engine is not available in this build, so "
            f"'{tool_name}' cannot run. This service currently serves the "
            f"provider SPI only."
        )
