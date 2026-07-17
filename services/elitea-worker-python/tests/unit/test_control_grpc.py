from __future__ import annotations

import asyncio

import pytest
from elitea.runtime.v1 import control_pb2, input_pb2

from elitea_worker.constants import (
    MAX_GRPC_REQUEST_BYTES,
    MAX_GRPC_RESPONSE_BYTES,
    MAX_MANIFEST_BYTES,
)
from elitea_worker.execution.errors import ResourceExhausted
from elitea_worker.transport.control_grpc import (
    ExecutionControlClient,
    secure_control_channel,
)
from elitea_worker.transport.output_grpc import secure_output_channel


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


def test_grpc_channels_apply_fixed_directional_whole_message_limits(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    channels: list[tuple[str, tuple[tuple[str, int], ...]]] = []
    marker = object()

    monkeypatch.setattr(
        "grpc.ssl_channel_credentials",
        lambda **_: object(),
    )

    def secure_channel(target, credentials, *, options):
        assert credentials is not None
        channels.append((target, options))
        return marker

    monkeypatch.setattr("grpc.aio.secure_channel", secure_channel)

    for factory, target in (
        (secure_control_channel, "control.internal:8443"),
        (secure_output_channel, "output.internal:8444"),
    ):
        assert (
            factory(
                target,
                root_certificates=b"ca",
                certificate_chain=b"certificate",
                private_key=b"private-key",
            )
            is marker
        )

    expected = (
        ("grpc.max_send_message_length", MAX_GRPC_REQUEST_BYTES),
        ("grpc.max_receive_message_length", MAX_GRPC_RESPONSE_BYTES),
    )
    assert channels == [
        ("control.internal:8443", expected),
        ("output.internal:8444", expected),
    ]


def test_control_wire_request_and_response_enforce_exact_boundary() -> None:
    async def run() -> None:
        request_at_limit = control_pb2.ClaimCommandRequestV1()
        _set_string_for_exact_size(
            request_at_limit,
            MAX_GRPC_REQUEST_BYTES,
            lambda value: setattr(
                request_at_limit,
                "workload_session_id",
                value,
            ),
        )
        request_over_limit = control_pb2.ClaimCommandRequestV1()
        _set_string_for_exact_size(
            request_over_limit,
            MAX_GRPC_REQUEST_BYTES + 1,
            lambda value: setattr(
                request_over_limit,
                "workload_session_id",
                value,
            ),
        )
        response_at_limit = control_pb2.ClaimCommandResponseV1()
        _set_string_for_exact_size(
            response_at_limit,
            MAX_GRPC_RESPONSE_BYTES,
            lambda value: setattr(
                response_at_limit.rejection,
                "safe_message",
                value,
            ),
        )
        response_over_limit = control_pb2.ClaimCommandResponseV1()
        _set_string_for_exact_size(
            response_over_limit,
            MAX_GRPC_RESPONSE_BYTES + 1,
            lambda value: setattr(
                response_over_limit.rejection,
                "safe_message",
                value,
            ),
        )

        stub = Stub()
        stub.ClaimCommand.response = response_at_limit
        client = ExecutionControlClient(
            stub,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
        )
        assert await client.claim_command(request_at_limit) == response_at_limit

        with pytest.raises(ResourceExhausted, match="control request"):
            await client.claim_command(request_over_limit)
        assert len(stub.ClaimCommand.calls) == 1

        stub.ClaimCommand.response = response_over_limit
        with pytest.raises(ResourceExhausted, match="control response"):
            await client.claim_command(control_pb2.ClaimCommandRequestV1())

    asyncio.run(run())


def test_control_response_wire_limit_contains_maximum_manifest_and_receipt() -> None:
    manifest = input_pb2.ExecutionInputBundleV1()
    _set_string_for_exact_size(
        manifest,
        MAX_MANIFEST_BYTES,
        lambda value: setattr(manifest, "input_bundle_id", value),
    )
    response = control_pb2.ClaimCommandResponseV1()
    response.receipt.disposition = control_pb2.CLAIM_DISPOSITION_V1_ACCEPTED
    response.receipt.input_bundle.CopyFrom(manifest)
    response.receipt.claim_id = "claim-1"
    assert MAX_MANIFEST_BYTES < response.ByteSize() <= MAX_GRPC_RESPONSE_BYTES


def _set_string_for_exact_size(message, size: int, set_value) -> None:
    low, high = 0, size
    while low <= high:
        middle = low + (high - low) // 2
        set_value("x" * middle)
        encoded_size = message.ByteSize()
        if encoded_size < size:
            low = middle + 1
        elif encoded_size > size:
            high = middle - 1
        else:
            return
    raise AssertionError(f"cannot construct {type(message).__name__} at size {size}")
