"""Slot accounting for ``GET /slots``.

The response shape is frozen (``available``, ``total``, ``active``,
``can_start``, ``mode``, plus the camelCase ``canStart`` alias the vendored UI
reads). One legacy *behaviour* is deliberately not preserved, and this is the
only intentional behavioural change in the SPI shell:

    Legacy ``_get_k8s_job_slots`` caught every Kubernetes failure — a missing
    client library, an API error, no cluster access — and returned the
    *subprocess* numbers with HTTP 200. A cluster outage therefore reported
    healthy capacity, and the caller learned otherwise only when the
    generation it started failed. See the recorded finding in
    ``conformance/fixtures/spi/slots.get.json``.

Here a jobs-mode deployment that cannot reach its backend answers with
``mode: "jobs"``, ``can_start: false`` and an ``error`` string. Refusing to
start is the truthful answer to "can I start?" when capacity is unknown.

Jobs mode itself is not implemented in this slice: no Kubernetes client is
wired yet. Configuring it is therefore an explicit unavailable answer, never a
silent downgrade to per-pod numbers.
"""

from __future__ import annotations

from typing import Any

from .config import Settings


def _normalise(payload: dict[str, Any]) -> dict[str, Any]:
    """Add the camelCase ``canStart`` alias (legacy ``_normalize_slots_payload``)."""
    if "canStart" not in payload and "can_start" in payload:
        payload["canStart"] = payload["can_start"]
    return payload


def subprocess_slots(settings: Settings, active: int) -> dict[str, Any]:
    """Per-pod availability from the in-process invocation manager.

    The legacy note is kept verbatim: these numbers describe one pod, not the
    cluster. That caveat is why ADR-0022 makes query replicas stateless — it
    does not make generation capacity cluster-wide.
    """
    total = settings.max_parallel_workers
    available = max(0, total - active)
    return _normalise(
        {
            "available": available,
            "total": total,
            "active": active,
            "can_start": active < total,
            "mode": "subprocess",
            "note": "Per-pod availability only (subprocess mode)",
        }
    )


def jobs_slots_unavailable(settings: Settings, reason: str) -> dict[str, Any]:
    """Jobs mode is configured but its backend cannot be consulted."""
    return _normalise(
        {
            "available": 0,
            "total": settings.max_concurrent_jobs,
            "active": 0,
            "can_start": False,
            "mode": "jobs",
            "namespace": settings.namespace,
            "error": reason,
        }
    )


def current_slots(settings: Settings, active: int) -> dict[str, Any]:
    """Answer ``GET /slots`` for the current configuration."""
    if settings.jobs_enabled:
        return jobs_slots_unavailable(
            settings,
            "Kubernetes Jobs mode is configured but not implemented in this "
            "build; capacity is unknown, so no generation may start.",
        )
    return subprocess_slots(settings, active)
