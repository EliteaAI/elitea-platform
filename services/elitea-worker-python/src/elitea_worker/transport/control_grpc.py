"""Deadline-bound generated gRPC control client adapter."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from typing import Protocol

import grpc
from elitea.runtime.v1 import control_pb2


MetadataProvider = Callable[[], tuple[tuple[str, str], ...]]


class GeneratedControlStub(Protocol):
    """Structural protocol implemented by the generated control stub."""

    def ClaimCommand(
        self,
        request: control_pb2.ClaimCommandRequestV1,
        *,
        timeout: float,
        metadata: tuple[tuple[str, str], ...],
    ) -> Awaitable[control_pb2.ClaimCommandResponseV1]: ...

    def RenewLease(
        self,
        request: control_pb2.RenewLeaseRequestV1,
        *,
        timeout: float,
        metadata: tuple[tuple[str, str], ...],
    ) -> Awaitable[control_pb2.RenewLeaseResponseV1]: ...

    def ObserveDesiredState(
        self,
        request: control_pb2.ObserveDesiredStateRequestV1,
        *,
        timeout: float,
        metadata: tuple[tuple[str, str], ...],
    ) -> Awaitable[control_pb2.ObserveDesiredStateResponseV1]: ...

    def PrepareSettlement(
        self,
        request: control_pb2.PrepareSettlementRequestV1,
        *,
        timeout: float,
        metadata: tuple[tuple[str, str], ...],
    ) -> Awaitable[control_pb2.PrepareSettlementResponseV1]: ...


def secure_control_channel(
    target: str,
    *,
    root_certificates: bytes,
    certificate_chain: bytes,
    private_key: bytes,
    max_message_bytes: int = 64 * 1024,
) -> grpc.aio.Channel:
    if not target or not all((root_certificates, certificate_chain, private_key)):
        raise ValueError("verified target and workload certificates are required")
    if max_message_bytes < 1:
        raise ValueError("max_message_bytes must be positive")
    credentials = grpc.ssl_channel_credentials(
        root_certificates=root_certificates,
        private_key=private_key,
        certificate_chain=certificate_chain,
    )
    return grpc.aio.secure_channel(
        target,
        credentials,
        options=(
            ("grpc.max_send_message_length", max_message_bytes),
            ("grpc.max_receive_message_length", max_message_bytes),
        ),
    )


class ExecutionControlClient:
    """One attempt per call; operation retry policy belongs to the caller."""

    def __init__(
        self,
        stub: GeneratedControlStub,
        *,
        metadata: MetadataProvider,
        deadline_seconds: float = 5.0,
    ) -> None:
        if deadline_seconds <= 0:
            raise ValueError("deadline_seconds must be positive")
        self._stub = stub
        self._metadata = metadata
        self._deadline = deadline_seconds

    async def claim_command(
        self, request: control_pb2.ClaimCommandRequestV1
    ) -> control_pb2.ClaimCommandResponseV1:
        return await self._stub.ClaimCommand(
            request,
            timeout=self._deadline,
            metadata=_validated_metadata(self._metadata()),
        )

    async def renew_lease(
        self, request: control_pb2.RenewLeaseRequestV1
    ) -> control_pb2.RenewLeaseResponseV1:
        return await self._stub.RenewLease(
            request,
            timeout=self._deadline,
            metadata=_validated_metadata(self._metadata()),
        )

    async def observe_desired_state(
        self, request: control_pb2.ObserveDesiredStateRequestV1
    ) -> control_pb2.ObserveDesiredStateResponseV1:
        return await self._stub.ObserveDesiredState(
            request,
            timeout=self._deadline,
            metadata=_validated_metadata(self._metadata()),
        )

    async def prepare_settlement(
        self, request: control_pb2.PrepareSettlementRequestV1
    ) -> control_pb2.PrepareSettlementResponseV1:
        return await self._stub.PrepareSettlement(
            request,
            timeout=self._deadline,
            metadata=_validated_metadata(self._metadata()),
        )


def _validated_metadata(
    metadata: tuple[tuple[str, str], ...],
) -> tuple[tuple[str, str], ...]:
    allowed = {"x-elitea-workload-session"}
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for name, value in metadata:
        normalized = name.lower()
        if (
            normalized not in allowed
            or normalized in seen
            or not value
            or len(value.encode("utf-8")) > 256
            or "\r" in value
            or "\n" in value
        ):
            raise ValueError("control gRPC metadata is not allowlisted")
        seen.add(normalized)
        result.append((normalized, value))
    if seen != allowed:
        raise ValueError("control gRPC metadata is not allowlisted")
    return tuple(result)
