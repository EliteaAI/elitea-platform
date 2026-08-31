"""Service settings, strict-parsed from the environment.

Strict-parsed means an unparsable value raises at startup rather than silently
falling back to a default. The legacy code did the opposite everywhere
(``int(os.environ.get(..., "3"))`` with a bare except around the caller), which
is how a mistyped ``DEEPWIKI_MAX_CONCURRENT_JOBS`` became "capacity 0, mode
error, HTTP 500" at request time instead of a boot failure.
"""

from __future__ import annotations

import os
from dataclasses import dataclass

ENV_PREFIX = "ELITEA_DEEPWIKI_"

#: Legacy names this service still reads, so an existing deployment's
#: environment keeps working during cutover. New names take precedence.
LEGACY_ALIASES = {
    "SLOTS_MODE": "DEEPWIKI_JOBS_ENABLED",
    "MAX_CONCURRENT_JOBS": "DEEPWIKI_MAX_CONCURRENT_JOBS",
    "MAX_PARALLEL_WORKERS": "DEEPWIKI_MAX_PARALLEL_WORKERS",
    "NAMESPACE": "DEEPWIKI_NAMESPACE",
}


class ConfigError(RuntimeError):
    """Raised when the environment cannot be parsed."""


def _raw(name: str, default: str | None = None) -> str | None:
    value = os.environ.get(ENV_PREFIX + name)
    if value is not None:
        return value
    alias = LEGACY_ALIASES.get(name)
    if alias is not None:
        value = os.environ.get(alias)
        if value is not None:
            return value
    return default


def _int(name: str, default: int, *, minimum: int = 0) -> int:
    raw = _raw(name)
    if raw is None or raw == "":
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise ConfigError(
            f"{ENV_PREFIX}{name} must be an integer, got {raw!r}"
        ) from exc
    if value < minimum:
        raise ConfigError(f"{ENV_PREFIX}{name} must be >= {minimum}, got {value}")
    return value


def _choice(name: str, default: str, allowed: tuple[str, ...]) -> str:
    raw = _raw(name)
    if raw is None or raw == "":
        return default
    value = raw.strip()
    if value not in allowed:
        raise ConfigError(
            f"{ENV_PREFIX}{name} must be one of {list(allowed)}, got {raw!r}"
        )
    return value


def _bool(name: str, default: bool) -> bool:
    raw = _raw(name)
    if raw is None or raw == "":
        return default
    lowered = raw.strip().lower()
    if lowered in ("1", "true", "yes", "on"):
        return True
    if lowered in ("0", "false", "no", "off"):
        return False
    raise ConfigError(f"{ENV_PREFIX}{name} must be a boolean, got {raw!r}")


@dataclass(frozen=True)
class Settings:
    """Everything the SPI shell reads from the environment."""

    #: Advertised in the descriptor. Deployment configuration, not contract.
    service_location_url: str = "http://127.0.0.1:8080"

    #: Ephemeral scratch for clones and intermediate build files. ADR-0022
    #: decision 4: nothing durable lives here.
    scratch_path: str = "/tmp/deepwiki"

    #: Slot accounting. ``jobs_enabled`` selects Kubernetes Jobs over local
    #: subprocess workers, as the legacy ``DEEPWIKI_JOBS_ENABLED`` did.
    jobs_enabled: bool = False
    max_concurrent_jobs: int = 3
    max_parallel_workers: int = 1
    namespace: str = "deepwiki"

    #: Terminal-invocation retention, seconds (legacy: one hour).
    invocation_retention_seconds: int = 3600

    #: Which tool runner to serve. ``unavailable`` refuses every tool;
    #: ``legacy`` dispatches into the copied analysis engine and requires the
    #: ``engine`` extra. The default is deliberately the refusing one: enabling
    #: a several-GB dependency closure is an explicit deployment decision, and
    #: an image built without it must not silently look like it has an engine.
    runner: str = "unavailable"

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            service_location_url=_raw("SERVICE_LOCATION_URL", "http://127.0.0.1:8080"),
            scratch_path=_raw("SCRATCH_PATH", "/tmp/deepwiki"),
            jobs_enabled=_bool("SLOTS_MODE", False),
            max_concurrent_jobs=_int("MAX_CONCURRENT_JOBS", 3, minimum=1),
            max_parallel_workers=_int("MAX_PARALLEL_WORKERS", 1, minimum=1),
            namespace=_raw("NAMESPACE", "deepwiki"),
            invocation_retention_seconds=_int(
                "INVOCATION_RETENTION_SECONDS", 3600, minimum=1
            ),
            runner=_choice("RUNNER", "unavailable", ("unavailable", "legacy")),
        )
