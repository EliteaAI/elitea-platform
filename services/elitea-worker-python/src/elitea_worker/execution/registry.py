"""Static versioned capability registry."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from elitea_worker.execution.errors import UnsupportedCapability


Handler = Callable[[Any], Any]


@dataclass(frozen=True, slots=True)
class CapabilityRegistration:
    capability_id: str
    version: int
    handler: Handler


class CapabilityRegistry:
    def __init__(self, registrations: tuple[CapabilityRegistration, ...]) -> None:
        values = {(item.capability_id, item.version): item for item in registrations}
        if len(values) != len(registrations):
            raise ValueError("duplicate capability registration")
        self._values = values

    def resolve(self, capability_id: str, version: int) -> Handler:
        try:
            return self._values[(capability_id, version)].handler
        except KeyError as exc:
            raise UnsupportedCapability() from exc
