"""Locate and import legacy ``deepwiki_plugin`` modules without Pylon.

The legacy plugin is a Pylon module: every ``methods/*.py`` and ``routes/*.py``
file imports ``pylon.core.tools`` at module scope and decorates its callables
with ``@web.method()`` / ``@web.route()``.  None of that machinery is needed to
read the code's *values* — the descriptor is a plain literal dict built by a
method that only reads ``self.descriptor.config``.

This module installs a minimal in-process stub for ``pylon.core.tools`` so the
legacy files can be imported verbatim, and exposes helpers to find the legacy
checkout and to hash the files a fixture was derived from.

Nothing here writes to the legacy tree.  It is opened read-only.
"""

from __future__ import annotations

import hashlib
import importlib.util
import os
import subprocess
import sys
import types
from pathlib import Path
from typing import Any, Dict, Optional

#: Environment variable that overrides legacy checkout discovery.
LEGACY_ENV_VAR = "DEEPWIKI_LEGACY_ROOT"

#: Paths searched when ``DEEPWIKI_LEGACY_ROOT`` is unset, relative to $HOME.
_DEFAULT_CANDIDATES = (
    "projects/eliteaai/legacy/plugins/deepwiki_plugin",
    "eliteaai/legacy/plugins/deepwiki_plugin",
)


class LegacyNotFound(RuntimeError):
    """Raised when the legacy deepwiki_plugin checkout cannot be located."""


def legacy_root() -> Path:
    """Return the legacy ``deepwiki_plugin`` checkout root."""
    override = os.environ.get(LEGACY_ENV_VAR)
    if override:
        path = Path(override).expanduser().resolve()
        if not (path / "methods" / "descriptor.py").is_file():
            raise LegacyNotFound(
                f"{LEGACY_ENV_VAR}={path} does not look like a deepwiki_plugin checkout"
            )
        return path

    home = Path.home()
    for candidate in _DEFAULT_CANDIDATES:
        path = (home / candidate).resolve()
        if (path / "methods" / "descriptor.py").is_file():
            return path

    raise LegacyNotFound(
        "deepwiki_plugin checkout not found; set "
        f"{LEGACY_ENV_VAR} to the plugin root (read-only access is enough)"
    )


def install_pylon_stub() -> None:
    """Install a no-op ``pylon.core.tools`` package into ``sys.modules``.

    ``web.method`` / ``web.route`` / ``web.init`` / ``web.deinit`` / ``web.event``
    are decorator factories in Pylon; the stub returns the undecorated function
    so the legacy class bodies evaluate to plain Python methods.
    """
    if "pylon.core.tools" in sys.modules:
        return

    def _identity_decorator(*_args: Any, **_kwargs: Any):
        def wrap(func):
            return func

        return wrap

    web = types.ModuleType("pylon.core.tools.web")
    for name in ("method", "route", "init", "deinit", "event"):
        setattr(web, name, _identity_decorator)

    log = types.ModuleType("pylon.core.tools.log")
    for name in ("info", "warning", "error", "debug", "exception", "critical"):
        setattr(log, name, lambda *a, **kw: None)

    module = types.ModuleType("pylon.core.tools.module")

    class _ModuleModel:  # noqa: D401 - stub
        """Stub for ``pylon.core.tools.module.ModuleModel``."""

    module.ModuleModel = _ModuleModel

    tools = types.ModuleType("pylon.core.tools")
    tools.web = web
    tools.log = log
    tools.module = module

    core = types.ModuleType("pylon.core")
    core.tools = tools

    pylon = types.ModuleType("pylon")
    pylon.core = core

    sys.modules.update(
        {
            "pylon": pylon,
            "pylon.core": core,
            "pylon.core.tools": tools,
            "pylon.core.tools.web": web,
            "pylon.core.tools.log": log,
            "pylon.core.tools.module": module,
        }
    )


def load_legacy_module(relative_path: str, module_name: str):
    """Import one legacy source file by path, bypassing package machinery."""
    install_pylon_stub()
    source = legacy_root() / relative_path
    spec = importlib.util.spec_from_file_location(module_name, source)
    if spec is None or spec.loader is None:  # pragma: no cover - defensive
        raise LegacyNotFound(f"cannot load {source}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = mod
    spec.loader.exec_module(mod)
    return mod


def sha256_of(path: Path) -> str:
    """Return the hex SHA-256 of a file."""
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
    return digest.hexdigest()


def git_revision(root: Path) -> Optional[str]:
    """Return the HEAD commit of the repo containing ``root``, if any."""
    try:
        out = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            capture_output=True,
            text=True,
            check=True,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return out.stdout.strip() or None


def source_pin(relative_paths) -> Dict[str, Any]:
    """Build a provenance block pinning the legacy files a fixture came from."""
    root = legacy_root()
    files = []
    for rel in relative_paths:
        path = root / rel
        files.append(
            {
                "path": rel,
                "bytes": path.stat().st_size,
                "sha256": sha256_of(path),
            }
        )
    return {
        "source_repository": "deepwiki_plugin",
        "source_revision": git_revision(root),
        "files": files,
    }
