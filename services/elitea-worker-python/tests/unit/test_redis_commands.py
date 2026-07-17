from __future__ import annotations

import asyncio

import pytest

from elitea_worker.execution.errors import (
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
)
from elitea_worker.transport.redis_commands import RedisCommandConsumer, RedisCommandDelivery


class FakeRedis:
    def __init__(
        self,
        fields: dict[bytes, bytes],
        retirement_results: object = (1, 1, 1),
    ) -> None:
        self.fields = fields
        self.retirement_results = retirement_results
        self.retirements: list[dict[str, object]] = []

    async def xreadgroup(self, **kwargs):
        return [(b"commands.v1", [(b"1-0", self.fields)])]

    async def xautoclaim(self, *args, **kwargs):
        return (b"0-0", [(b"1-0", self.fields)], [])

    async def retire_delivery(self, **kwargs: object):
        self.retirements.append(kwargs)
        return self.retirement_results


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
        await consumer.ack_after_settlement(deliveries[0], "outbox-1")

        assert deliveries[0].signed_envelope == b"reference-only-envelope"
        assert reclaimed[0].entry_id == "1-0"
        assert redis.retirements == [
            {
                "stream": "commands.v1",
                "group": "workers",
                "consumer": "worker-1",
                "entry_id": "1-0",
                "stable_delivery_id": "outbox-1",
                "signed_envelope": b"reference-only-envelope",
            }
        ]

    asyncio.run(run())


def test_retirement_accepts_explicit_idempotent_terminal_postcondition() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields(), retirement_results=(2, 0, 0))
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        delivery = RedisCommandDelivery(
            "commands.v1", "1-0", {"signed_envelope": b"ref"}
        )

        await consumer.ack_after_settlement(delivery, "outbox-1")

        assert len(redis.retirements) == 1

    asyncio.run(run())


@pytest.mark.parametrize(
    "results",
    [
        (0, 1, 1),
        (1, 0, 1),
        (1, 1, 0),
        (0, 0, 0),
        (2, 1, 1),
        (2, 0, 1),
        (2, 1, 0),
        (3, 0, 0),
        (1,),
        (1, 1),
        (1, 1, 1, 1),
        (True, 1, 1),
        (1, True, 1),
        (1, 1, True),
        (1, 1, "1"),
        None,
    ],
)
def test_retirement_fails_closed_unless_redis_confirms_mutation_or_idempotency(
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
            await consumer.ack_after_settlement(delivery, "outbox-1")

        assert len(redis.retirements) == 1

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
            await consumer.ack_after_settlement(delivery, "outbox-1")

        assert redis.retirements == []

    asyncio.run(run())


@pytest.mark.parametrize(
    "stable_delivery_id",
    [
        "",
        "x" * 257,
        "é" * 129,
        "\ud800",
        "outbox\r1",
        "outbox\n1",
        "outbox\x001",
    ],
)
def test_retirement_rejects_malformed_stable_delivery_id_before_redis(
    stable_delivery_id: str,
) -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        delivery = RedisCommandDelivery(
            "commands.v1", "1-0", {"signed_envelope": b"ref"}
        )

        with pytest.raises(InvalidInput, match="stable delivery identity"):
            await consumer.ack_after_settlement(delivery, stable_delivery_id)

        assert redis.retirements == []

    asyncio.run(run())


@pytest.mark.parametrize("stable_delivery_id", ["x" * 256, "é" * 128])
def test_retirement_accepts_stable_delivery_id_at_exact_utf8_bound(
    stable_delivery_id: str,
) -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        delivery = RedisCommandDelivery(
            "commands.v1", "1-0", {"signed_envelope": b"ref"}
        )

        await consumer.ack_after_settlement(delivery, stable_delivery_id)

        assert redis.retirements[0]["stable_delivery_id"] == stable_delivery_id

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
            FakeRedis(fields),
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
            max_entry_bytes=256,
            max_field_bytes=256,
        )
        with pytest.raises(ResourceExhausted):
            await consumer.read()

    asyncio.run(run())
