"""The DeepWiki analysis engine — a plain copy of the legacy implementation.

Every other module in this package is a **verbatim copy** of
``deepwiki_plugin/plugin_implementation/`` at revision
``ce679f11dc31c209cc67f13565b286d5bb28ce58``. ADR-0022 decision 1: the engine
moves, it is not rewritten. 101 files, ~90.5k lines, unmodified.

``COPY_MANIFEST.json`` records the SHA-256 of every file and
``tests/engine/test_copy_is_verbatim.py`` re-checks them, so an accidental
edit fails the build. A deliberate edit belongs in a commit that regenerates
the manifest (``tools/refresh_engine_copy.py``) and says why.

This file is the one exception. The legacy ``__init__.py`` was empty; this one
installs the compatibility alias described below.

WHY THE ALIAS.
--------------
Twenty call sites inside the engine import their siblings absolutely — e.g.
``from plugin_implementation.repo_providers import RepoProviderFactory`` — all
of them inside functions, all in the subprocess and Kubernetes-Job workers,
which the legacy deployment launched as separate processes with the plugin root
on ``PYTHONPATH``.

Rewriting them would make the copy no longer verbatim, and the whole parity
argument rests on it being verbatim. Registering the alias instead costs two
lines and keeps every one of those imports resolving to this package. It is
also the honest description of the situation: this *is* ``plugin_implementation``,
at a new import path.

The alias is installed on import of this package, so any code that can reach
an engine module has already been through here.

WHAT IS NOT COPIED.
-------------------
The Pylon shim — ``module.py``, ``methods/``, ``routes/``, ``events/`` — has no
successor here. Its job is done by the ASGI application, the invocation
manager and :mod:`elitea_deepwiki.legacy_engine`, which together replace it.
``plugin_implementation/`` had no dependency on any of it.
"""

from __future__ import annotations

import sys as _sys

# Registered before anything else can import an engine submodule. Both spellings
# are needed: the bare package name for `import plugin_implementation`, and the
# same object under its own name so `from plugin_implementation.x import y`
# resolves `x` through this package's __path__.
_sys.modules.setdefault("plugin_implementation", _sys.modules[__name__])

#: The legacy revision every file in this package was copied from.
SOURCE_REVISION = "ce679f11dc31c209cc67f13565b286d5bb28ce58"

#: The legacy repository and path.
SOURCE_PATH = "deepwiki_plugin/plugin_implementation"

__all__ = ["SOURCE_REVISION", "SOURCE_PATH"]
