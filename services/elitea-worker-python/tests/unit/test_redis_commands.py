from __future__ import annotations

import asyncio

import pytest

from elitea_worker.execution.errors import (
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
)
from elitea_worker.transport.redis_commands import RedisCommandConsumer, RedisCommandDelivery


class FakeTransaction:
    def __init__(self, redis: FakeRedis) -> None:
        self._redis = redis

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc, traceback):
        return None

    def xack(self, *args):
        self._redis.transaction_commands.append(("xack", args))
        return self

    def xdel(self, *args):
        self._redis.transaction_commands.append(("xdel", args))
        return self

    async def execute(self, *, raise_on_error=True):
        self._redis.execute_raise_on_error.append(raise_on_error)
        return self._redis.retirement_results


class FakeRedis:
    def __init__(
        self,
        fields: dict[bytes, bytes],
        max_bulk_reply_bytes: int = 48 * 1024,
        retirement_results: object = (1, 1),
    ) -> None:
        self.fields = fields
        self.max_bulk_reply_bytes = max_bulk_reply_bytes
        self.retirement_results = retirement_results
        self.pipeline_transactions: list[bool] = []
        self.transaction_commands: list[tuple[str, tuple]] = []
        self.execute_raise_on_error: list[bool] = []

    async def xreadgroup(self, **kwargs):
        return [(b"commands.v1", [(b"1-0", self.fields)])]

    async def xautoclaim(self, *args, **kwargs):
        return (b"0-0", [(b"1-0", self.fields)], [])

    def pipeline(self, *, transaction=True):
        self.pipeline_transactions.append(transaction)
        return FakeTransaction(self)


def _fields() -> dict[bytes, bytes]:
    return {b"signed_envelope": b"reference-only-envelope"}


def test_reads_reclaims_and_atomically_retires_only_reference_command() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )

        deliveries = await consumer.read()
        reclaimed = await consumer.reclaim(min_idle_ms=1_000)
        await consumer.ack_after_settlement(deliveries[0])

        assert deliveries[0].signed_envelope == b"reference-only-envelope"
        assert reclaimed[0].entry_id == "1-0"
        assert redis.pipeline_transactions == [True]
        assert redis.transaction_commands == [
            ("xack", ("commands.v1", "workers", "1-0")),
            ("xdel", ("commands.v1", "1-0")),
        ]
        assert redis.execute_raise_on_error == [False]

    asyncio.run(run())


@pytest.mark.parametrize(
    "results",
    [
        (0, 1),
        (1, 0),
        (0, 0),
        (1,),
        (1, 1, 1),
        (True, 1),
        (1, True),
        (1, "1"),
        None,
    ],
)
def test_retirement_fails_closed_unless_redis_confirms_exact_ack_and_delete(
    results: object,
) -> None:
    async def run() -> None:
        redis = FakeRedis(_fields(), retirement_results=results)
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        delivery = RedisCommandDelivery("commands.v1", "1-0", {"signed_envelope": b"ref"})

        with pytest.raises(DependencyUnavailable, match="atomic command"):
            await consumer.ack_after_settlement(delivery)

        assert redis.transaction_commands == [
            ("xack", ("commands.v1", "workers", "1-0")),
            ("xdel", ("commands.v1", "1-0")),
        ]

    asyncio.run(run())


def test_retirement_rejects_delivery_from_another_stream_before_redis() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        delivery = RedisCommandDelivery("other.v1", "1-0", {"signed_envelope": b"ref"})

        with pytest.raises(InvalidInput, match="another stream"):
            await consumer.ack_after_settlement(delivery)

        assert redis.pipeline_transactions == []
        assert redis.transaction_commands == []

    asyncio.run(run())


def test_rejects_result_or_input_body_field() -> None:
    fields = _fields()
    fields[b"result"] = b"must-not-enter-redis"

    async def run() -> None:
        consumer = RedisCommandConsumer(
            FakeRedis(fields), stream="commands.v1", group="workers", consumer="worker-1"
        )
        with pytest.raises(InvalidInput, match="unregistered"):
            await consumer.read()

    asyncio.run(run())


def test_rejects_control_entry_above_bound() -> None:
    fields = _fields()
    fields[b"signed_envelope"] = b"x" * 1_024

    async def run() -> None:
        consumer = RedisCommandConsumer(
            FakeRedis(fields, max_bulk_reply_bytes=256),
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
            max_entry_bytes=256,
            max_field_bytes=256,
        )
        with pytest.raises(ResourceExhausted):
            await consumer.read()

    asyncio.run(run())
