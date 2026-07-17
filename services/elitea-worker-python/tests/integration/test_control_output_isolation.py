from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from elitea.runtime.v1 import envelope_pb2

from elitea_worker.execution.errors import InvalidInput
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    parse_and_verify_signed_command,
)
from elitea_worker.transport.redis_commands import RedisCommandConsumer


_ROOT = Path(__file__).parents[4]
_FIXTURE = _ROOT / "testdata/proto/runtime/v1/configuration-validation/valid"


class RedisSpy:
    max_bulk_reply_bytes = 48 * 1024

    def __init__(self, fields: dict[bytes, bytes]) -> None:
        self.fields = fields
        self.calls: list[tuple[str, object]] = []

    async def xreadgroup(self, **kwargs: object):
        self.calls.append(("xreadgroup", kwargs))
        return [(b"configuration-validation.v1", [(b"1-0", self.fields)])]

    async def xautoclaim(self, *args: object, **kwargs: object):
        self.calls.append(("xautoclaim", (args, kwargs)))
        return (b"0-0", [], [])

    def pipeline(self, *, transaction: bool = True):
        self.calls.append(("pipeline", transaction))
        return RedisTransactionSpy(self.calls)


class RedisTransactionSpy:
    def __init__(self, calls: list[tuple[str, object]]) -> None:
        self._calls = calls

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    def xack(self, *args: object):
        self._calls.append(("xack", args))
        return self

    def xdel(self, *args: object):
        self._calls.append(("xdel", args))
        return self

    async def execute(self, *, raise_on_error: bool = True):
        self._calls.append(("execute", raise_on_error))
        return [1, 1]


def test_cross_language_redis_entry_is_one_reference_field_and_never_content_or_output() -> None:
    async def run() -> None:
        envelope = envelope_pb2.WorkerExecutionEnvelopeV1.FromString(
            (_FIXTURE / "envelope.pb").read_bytes()
        )
        signed = envelope.signed_command.SerializeToString(deterministic=True)
        settings = (_FIXTURE / "settings.json").read_bytes()
        expected_output = (_FIXTURE / "expected-output.pb").read_bytes()
        redis = RedisSpy({b"signed_envelope": signed})
        consumer = RedisCommandConsumer(
            redis,
            stream="configuration-validation.v1",
            group="elitea-worker-python",
            consumer="worker-1",
        )

        deliveries = await consumer.read()
        assert len(deliveries) == 1
        assert deliveries[0].fields == {"signed_envelope": signed}
        assert settings not in signed
        assert expected_output not in signed
        parsed_signed, command = parse_and_verify_signed_command(
            deliveries[0].signed_envelope,
            authenticator=TestOnlyConformanceHmacAuthenticator(),
        )
        assert parsed_signed == envelope.signed_command
        assert command.input_bundle_ref.input_bundle_id
        assert not hasattr(consumer, "publish")
        assert not hasattr(consumer, "xadd")

        await consumer.ack_after_settlement(deliveries[0])
        assert [name for name, _ in redis.calls] == [
            "xreadgroup",
            "pipeline",
            "xack",
            "xdel",
            "execute",
        ]
        assert all(settings not in repr(call).encode() for call in redis.calls)
        assert all(expected_output not in repr(call).encode() for call in redis.calls)

    asyncio.run(run())


@pytest.mark.parametrize("field", [b"settings", b"output", b"result", b"image"])
def test_redis_control_plane_rejects_any_inline_data_or_output_field(field: bytes) -> None:
    async def run() -> None:
        envelope = envelope_pb2.WorkerExecutionEnvelopeV1.FromString(
            (_FIXTURE / "envelope.pb").read_bytes()
        )
        fields = {
            b"signed_envelope": envelope.signed_command.SerializeToString(deterministic=True),
            field: b"forbidden-inline-body",
        }
        consumer = RedisCommandConsumer(
            RedisSpy(fields),
            stream="configuration-validation.v1",
            group="elitea-worker-python",
            consumer="worker-1",
        )
        with pytest.raises(InvalidInput, match="unregistered field"):
            await consumer.read()

    asyncio.run(run())
