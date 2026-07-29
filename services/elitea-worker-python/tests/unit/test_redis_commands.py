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
        self.heartbeats: list[dict[str, object]] = []
        self.reads: list[dict[str, object]] = []
        self.reclaims: list[tuple[tuple[object, ...], dict[str, object]]] = []
        self.pending_owners = {"1-0": "worker-1", "2-0": "worker-1"}

    async def xreadgroup(self, **kwargs):
        self.reads.append(kwargs)
        return [(b"commands.v1", [(b"1-0", self.fields)])]

    async def xautoclaim(self, *args, **kwargs):
        self.reclaims.append((args, kwargs))
        return (b"0-0", [(b"1-0", self.fields)], [])

    async def heartbeat_owned_pending(self, **kwargs: object):
        self.heartbeats.append(kwargs)
        consumer = kwargs["consumer"]
        return [
            entry_id.encode("ascii")
            for entry_id in kwargs["entry_ids"]
            if self.pending_owners.get(entry_id) == consumer
        ]

    async def retire_delivery(self, **kwargs: object):
        self.retirements.append(kwargs)
        return self.retirement_results


def _fields() -> dict[bytes, bytes]:
    return {b"signed_envelope": b"reference-only-envelope"}


def test_rejects_read_count_above_runtime_heartbeat_bound() -> None:
    with pytest.raises(ValueError, match="read count exceeds"):
        RedisCommandConsumer(
            FakeRedis(_fields()),
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
            read_count=65,
        )


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


def test_read_and_reclaim_honor_a_smaller_capacity_bound() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
            read_count=4,
        )

        await consumer.read(count=1, block_ms=250)
        await consumer.read(count=1, block_ms=5_000)
        await consumer.reclaim_page(min_idle_ms=1_000, count=2)

        assert consumer.delivery_batch_size == 4
        assert redis.reads[0]["count"] == 1
        assert redis.reads[0]["block"] == 250
        assert redis.reads[1]["block"] == 1_000
        assert redis.reclaims[0][1]["count"] == 2
        with pytest.raises(ValueError, match="outside the configured read bound"):
            await consumer.read(count=5)
        with pytest.raises(ValueError, match="block time must be a positive integer"):
            await consumer.read(block_ms=0)

    asyncio.run(run())


def test_heartbeats_pending_ids_in_bounded_same_consumer_batches() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
            read_count=2,
        )

        refreshed = await consumer.heartbeat_pending(("1-0", "2-0"))

        assert refreshed == ("1-0", "2-0")
        assert redis.heartbeats == [
            {
                "stream": "commands.v1",
                "group": "workers",
                "consumer": "worker-1",
                "entry_ids": ("1-0", "2-0"),
            }
        ]

        with pytest.raises(ResourceExhausted, match="heartbeat exceeds"):
            await consumer.heartbeat_pending(("1-0", "2-0", "3-0"))
        assert len(redis.heartbeats) == 1

    asyncio.run(run())


def test_stale_consumer_heartbeat_cannot_reacquire_peer_owned_pending_entry() -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        stale = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )
        peer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-2",
        )

        assert await stale.heartbeat_pending(("1-0",)) == ("1-0",)
        redis.pending_owners["1-0"] = "worker-2"

        assert await stale.heartbeat_pending(("1-0",)) == ()
        assert redis.pending_owners["1-0"] == "worker-2"
        assert await peer.heartbeat_pending(("1-0",)) == ("1-0",)

    asyncio.run(run())


@pytest.mark.parametrize(
    "entry_ids",
    [
        ("",),
        ("1",),
        ("-0",),
        ("1-",),
        ("one-0",),
        ("1-two",),
        ("1-0", "1-0"),
    ],
)
def test_heartbeat_rejects_malformed_or_duplicate_entry_ids_before_redis(
    entry_ids: tuple[str, ...],
) -> None:
    async def run() -> None:
        redis = FakeRedis(_fields())
        consumer = RedisCommandConsumer(
            redis,
            stream="commands.v1",
            group="workers",
            consumer="worker-1",
        )

        with pytest.raises(InvalidInput, match="heartbeat entry IDs"):
            await consumer.heartbeat_pending(entry_ids)
        assert redis.heartbeats == []

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
