"""Fail-fast checks for the admitted current-baseline agent runtime."""

from __future__ import annotations

import importlib
import importlib.metadata
import sys
from collections.abc import Callable
from contextlib import redirect_stdout
from pathlib import Path
from typing import Any

from elitea_worker.execution.errors import DependencyUnavailable
from elitea_worker.indexing_runtime_capabilities import (
    _default_lock_path,
    _load_lock,
    _package_tree_digest,
    _profile_digest,
)


_PROFILE_SCHEMA = "elitea.agent-current-runtime-capability-profile.v1"


def require_agent_current_runtime_capabilities(
    *,
    lock_path: Path | None = None,
    distribution_version: Callable[[str], str] = importlib.metadata.version,
    import_module: Callable[[str], Any] = importlib.import_module,
    package_tree_digest: Callable[[Path], str] | None = None,
) -> str:
    """Verify the admitted current-baseline agent runtime before serving work.

    The public error remains intentionally stable and secret-free. The chained
    cause contains only admitted dependency identifiers and exception class
    names so image build drift is diagnosable without exposing configuration,
    credentials, endpoints, or filesystem paths.
    """

    try:
        lock = _load_lock(lock_path or _default_lock_path())
        profile = lock["agent_current_capability_profile"]
        if profile.get("schema_revision") != _PROFILE_SCHEMA:
            raise ValueError("profile-schema")
        expected_digest = profile.get("profile_sha256")
        if not isinstance(expected_digest, str) or (
            _profile_digest(profile) != expected_digest
        ):
            raise ValueError("profile-digest")

        failures: list[str] = []
        for distribution, expected in profile["verified_distributions"].items():
            try:
                actual = distribution_version(distribution)
            except Exception as exc:  # pragma: no branch - one stable failure path
                failures.append(
                    f"distribution:{distribution}:{type(exc).__name__}"
                )
                continue
            if actual != expected:
                failures.append(
                    f"distribution:{distribution}:version-mismatch"
                )

        sdk_module: Any | None = None
        for module_name in profile["required_imports"]:
            try:
                with redirect_stdout(sys.stderr):
                    module = import_module(module_name)
                if module_name == "elitea_sdk":
                    sdk_module = module
            except Exception as exc:
                failures.append(f"import:{module_name}:{type(exc).__name__}")

        if sdk_module is None:
            failures.append("sdk-package-tree:missing")
        else:
            package_file = getattr(sdk_module, "__file__", None)
            if package_file is None:
                failures.append("sdk-package-tree:missing")
            else:
                digest_package_tree = package_tree_digest or _package_tree_digest
                actual_tree = digest_package_tree(Path(package_file).resolve().parent)
                expected_tree = lock["installed_package_tree"]["sha256"]
                if actual_tree != expected_tree:
                    failures.append("sdk-package-tree:digest-mismatch")

        if failures:
            raise RuntimeError(",".join(failures))
        return expected_digest
    except DependencyUnavailable:
        raise
    except Exception as exc:
        raise DependencyUnavailable(
            "The agent current runtime capability profile is incomplete."
        ) from exc
