"""A stub ``pylon.core.tools`` so the copied engine imports without Pylon.

Three copied engine modules — ``utils/cache_manager.py``,
``utils/source_status.py`` and ``utils/langfuse_callback.py`` — import Pylon's
logger at module scope with no fallback. They are copied BYTE FOR BYTE
(``COPY_MANIFEST.json`` pins their digests), so the import cannot be rewritten
without making the copy unverifiable.

The alternative to this shim is a substitution list that grows one entry per
copied file, which is how a "verbatim" copy quietly stops being one. A stub
module is the smaller lie and it is confined to one file: it provides a stdlib
logger under Pylon's name and an inert ``web.method`` decorator, and nothing
else. Any Pylon behaviour beyond those two would raise ``AttributeError`` here
rather than silently doing something Pylon-shaped.

ADR-0022 decision 1 says nothing of Pylon survives into the service. Nothing
does: this module imports no Pylon package and depends on none — it fabricates
the two names the copy references and registers them in ``sys.modules``.
"""

from __future__ import annotations

import logging
import sys
import types

MODULES = ("pylon", "pylon.core", "pylon.core.tools")


def _method(_name: str | None = None):
    """Pylon's ``web.method()`` decorator factory, inert.

    The copied ENGINE files do not use it — only the tool layer did, and those
    decorators are removed by the copy tool. It exists so that a future copied
    module carrying one fails at the behaviour, not at the import.
    """

    def decorate(function):
        return function

    return decorate


def install() -> None:
    """Register the stub, once. Idempotent, and never overwrites a real Pylon."""
    if "pylon.core.tools" in sys.modules:
        return

    pylon = sys.modules.setdefault("pylon", types.ModuleType("pylon"))
    core = types.ModuleType("pylon.core")
    tools = types.ModuleType("pylon.core.tools")
    tools.log = logging.getLogger("elitea_inventory.engine")
    web = types.ModuleType("pylon.core.tools.web")
    web.method = _method
    tools.web = web

    core.tools = tools
    pylon.core = core
    sys.modules["pylon.core"] = core
    sys.modules["pylon.core.tools"] = tools
    sys.modules["pylon.core.tools.web"] = web


__all__ = ["install"]
