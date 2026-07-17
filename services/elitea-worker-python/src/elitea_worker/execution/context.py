"""Typed immutable execution identity; no credential or arbitrary payload fields."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class ExecutionContext:
    command_id: str
    execution_id: str
    generation: int
    claim_attempt: int
    lease_epoch: int
    fence_token: str
    tenant_id: str
    resource_project_id: str
    projection_project_id: str

    def __post_init__(self) -> None:
        required = (
            self.command_id,
            self.execution_id,
            self.fence_token,
            self.tenant_id,
            self.resource_project_id,
            self.projection_project_id,
        )
        if any(not value for value in required):
            raise ValueError("execution identity fields must be non-empty")
        if self.generation < 1 or self.claim_attempt < 1 or self.lease_epoch < 1:
            raise ValueError("generation and fence counters must be positive")
