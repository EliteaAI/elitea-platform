from __future__ import annotations

import asyncio

import pytest
from elitea.runtime.v1 import control_pb2

from elitea_worker.transport.control_grpc import ExecutionControlClient


class Unary:
    def __init__(self, response) -> None:
        self.calls: list[tuple] = []
        self.response = response

    async def __call__(self, request, **kwargs):
        self.calls.append((request, kwargs))
        return self.response


class Stub:
    def __init__(self) -> None:
        self.ClaimCommand = Unary(control_pb2.ClaimCommandResponseV1())
        self.RenewLease = Unary(control_pb2.RenewLeaseResponseV1())
        self.ObserveDesiredState = Unary(control_pb2.ObserveDesiredStateResponseV1())
        self.PrepareSettlement = Unary(control_pb2.PrepareSettlementResponseV1())


def test_control_call_has_identity_metadata_and_deadline_without_retry() -> None:
    async def run() -> None:
        stub = Stub()
        client = ExecutionControlClient(
            stub,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            deadline_seconds=1.25,
        )

        request = control_pb2.ClaimCommandRequestV1(
            workload_session_id="session-1",
            producer_id="worker-1",
        )
        assert await client.claim_command(request) == control_pb2.ClaimCommandResponseV1()
        assert stub.ClaimCommand.calls == [
            (
                request,
                {
                    "timeout": 1.25,
                    "metadata": (("x-elitea-workload-session", "session-1"),),
                },
            )
        ]

    asyncio.run(run())


def test_control_metadata_rejects_unapproved_or_duplicate_values() -> None:
    async def unapproved() -> None:
        client = ExecutionControlClient(
            Stub(),
            metadata=lambda: (("authorization", "secret"),),
        )
        with pytest.raises(ValueError, match="not allowlisted"):
            await client.claim_command(control_pb2.ClaimCommandRequestV1())

    async def duplicate() -> None:
        client = ExecutionControlClient(
            Stub(),
            metadata=lambda: (
                ("x-elitea-workload-session", "one"),
                ("X-Elitea-Workload-Session", "two"),
            ),
        )
        with pytest.raises(ValueError, match="not allowlisted"):
            await client.claim_command(control_pb2.ClaimCommandRequestV1())

    asyncio.run(unapproved())
    asyncio.run(duplicate())
