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


def _seconds(name: str, default: float) -> float:
    raw = _raw(name)
    if raw is None or raw == "":
        return default
    try:
        value = float(raw)
    except ValueError as exc:
        raise ValueError(f"{ENV_PREFIX}{name} must be a number of seconds, got {raw!r}") from exc
    if value < 0:
        raise ValueError(f"{ENV_PREFIX}{name} must not be negative, got {raw!r}")
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

    # -- security ---------------------------------------------------------


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
    #: How long the ``fixture`` runner pauses between its progress steps. Long
    #: enough for a browser test to see a run in flight and stop it; zero for
    #: unit tests.
    fixture_step_seconds: float = 1.0

    #: mTLS terminus (ADR-0022 decision 5). With a CA file the server demands
    #: and verifies a client certificate, and the middleware refuses any hop
    #: that reached it unauthenticated.
    tls_certfile: str | None = None
    tls_keyfile: str | None = None
    tls_ca_file: str | None = None

    #: Shared secret for the HMAC identity signature. The same scheme
    #: elitea-main signs with and the LLM gateway verifies.
    identity_secret: str | None = None

    #: Git hosts this deployment may clone from (ADR-0022 decision 6).
    #: UNSET REFUSES EVERY CLONE — an egress control that silently allows
    #: everything is worse than none, because it looks like it is there. Use
    #: '*' to disable the control explicitly.
    git_allowlist: str | None = None

    #: Hosts the engine may reach for model downloads. Separate from the git
    #: allowlist because it is a different trust decision — a deployment may
    #: well allow an internal model mirror and no public git host, or the
    #: reverse. Same fail-closed rule.
    model_allowlist: str | None = None

    #: DSN for the dedicated ``deepwiki`` database (ADR-0022 decision 3).
    #: When set, the engine's READ path is served from PostgreSQL and query
    #: replicas are stateless. When unset, retrieval falls back to the
    #: per-wiki scratch files, which only the pod that built them can serve —
    #: correct for a single-pod dev stack, and the thing decision 3 exists to
    #: remove in production.
    database_url: str | None = None

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
            runner=_choice("RUNNER", "unavailable", ("unavailable", "legacy", "fixture")),
            fixture_step_seconds=_seconds("FIXTURE_STEP_SECONDS", 1.0),
            database_url=_raw("DATABASE_URL") or None,
            tls_certfile=_raw("TLS_CERTFILE") or None,
            tls_keyfile=_raw("TLS_KEYFILE") or None,
            tls_ca_file=_raw("TLS_CA_FILE") or None,
            identity_secret=_raw("IDENTITY_SECRET") or None,
            git_allowlist=_raw("GIT_ALLOWLIST") or None,
            model_allowlist=_raw("MODEL_ALLOWLIST") or None,
        )
