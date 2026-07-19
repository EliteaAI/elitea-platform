"""Opt-in Redis 7 service test for the Python command-entry lifecycle.

This proves the restricted redis-py Lua heartbeat and retirement operations
against a service. It does not exercise PostgreSQL settlement, gRPC/HTTPS, a
worker subprocess, or redis-py's pre-decode RESP allocation behavior.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import time
from typing import Any

import pytest

from elitea_worker.execution.delivery import (
    DeliveryDisposition,
    DeliveryResult,
)
from elitea_worker.execution.errors import DependencyUnavailable
from elitea_worker.serve import WorkerServeLoop
from elitea_worker.transport.redis_asyncio import RedisAsyncioControlClient
from elitea_worker.transport.redis_commands import (
    RedisCommandConsumer,
    RedisCommandDelivery,
)


_REDIS_URL_ENV = "ELITEA_TEST_REDIS_URL"


class _LifecycleRedisClient:
    """Restricts the test client to command intake and retirement methods."""

    def __init__(self, client: Any) -> None:
        self._client = client
        self._restricted = RedisAsyncioControlClient(
            client,
            client.connection_pool,
        )

    async def xreadgroup(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xreadgroup(*args, **kwargs)

    async def xautoclaim(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xautoclaim(*args, **kwargs)

    async def heartbeat_owned_pending(self, **kwargs: Any) -> Any:
        return await self._restricted.heartbeat_owned_pending(**kwargs)

    async def retire_delivery(self, **kwargs: Any) -> Any:
        return await self._restricted.retire_delivery(**kwargs)


def test_reclaim_moves_retirement_authority_and_stale_owner_cannot_delete() -> None:
    redis_url = os.environ.get(_REDIS_URL_ENV)
    if not redis_url:
        pytest.skip(f"set {_REDIS_URL_ENV} to run the real-Redis lifecycle test")
    redis_async = importlib.import_module("redis.asyncio")

    async def run() -> None:
        admin_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        first_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        restarted_client = None
        stream = f"elitea:test:python-command-lifecycle:{time.time_ns()}"
        index = f"{stream}:delivery-index.v1"
        group = "elitea-worker-python-test"
        stable_delivery_id = f"outbox-{time.time_ns()}"
        signed_envelope = b"reference-only-test-envelope"
        try:
            assert await admin_client.ping()
            await admin_client.xgroup_create(stream, group, id="0-0", mkstream=True)
            entry_id = await admin_client.xadd(
                stream,
                {b"signed_envelope": signed_envelope},
            )
            await admin_client.hset(index, stable_delivery_id, entry_id)
            first_consumer = RedisCommandConsumer(
                _LifecycleRedisClient(first_client),
                stream=stream,
                group=group,
                consumer="worker-1",
            )

            undelivered = RedisCommandDelivery(
                stream,
                entry_id.decode("ascii"),
                {"signed_envelope": signed_envelope},
            )
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await first_consumer.ack_after_settlement(
                    undelivered,
                    stable_delivery_id,
                )
            assert await admin_client.xlen(stream) == 1
            assert await admin_client.hget(index, stable_delivery_id) == entry_id

            deliveries = await first_consumer.read()
            assert len(deliveries) == 1
            assert deliveries[0].entry_id == entry_id.decode("ascii")
            pending = await admin_client.xpending_range(stream, group, "-", "+", 10)
            assert len(pending) == 1
            assert pending[0]["consumer"] == b"worker-1"

            # Simulate a process/client restart without acknowledging the
            # delivery. The new consumer must recover it from the PEL.
            await first_client.aclose()
            first_client = None
            await asyncio.sleep(0.01)
            restarted_client = redis_async.Redis.from_url(
                redis_url,
                decode_responses=False,
                socket_connect_timeout=2,
                socket_timeout=2,
                retry_on_timeout=False,
            )
            restarted_consumer = RedisCommandConsumer(
                _LifecycleRedisClient(restarted_client),
                stream=stream,
                group=group,
                consumer="worker-after-restart",
            )
            reclaimed = await restarted_consumer.reclaim(min_idle_ms=1)
            assert len(reclaimed) == 1
            assert reclaimed[0] == deliveries[0]
            pending = await admin_client.xpending_range(stream, group, "-", "+", 10)
            assert len(pending) == 1
            assert pending[0]["consumer"] == b"worker-after-restart"

            stale_owner = RedisCommandConsumer(
                _LifecycleRedisClient(restarted_client),
                stream=stream,
                group=group,
                consumer="worker-1",
            )
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await stale_owner.ack_after_settlement(
                    reclaimed[0],
                    stable_delivery_id,
                )
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await restarted_consumer.ack_after_settlement(
                    reclaimed[0],
                    "another-outbox",
                )
            forged = RedisCommandDelivery(
                stream,
                reclaimed[0].entry_id,
                {"signed_envelope": b"different-signed-envelope"},
            )
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await restarted_consumer.ack_after_settlement(
                    forged,
                    stable_delivery_id,
                )
            assert await admin_client.xlen(stream) == 1
            pending = await admin_client.xpending_range(
                stream, group, "-", "+", 10
            )
            assert len(pending) == 1
            assert await admin_client.hget(index, stable_delivery_id) == entry_id

            # Losing only the delivery-index mapping is an inconsistent
            # partial state. Retirement must not mutate the live entry or PEL.
            assert await admin_client.hdel(index, stable_delivery_id) == 1
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await restarted_consumer.ack_after_settlement(
                    reclaimed[0],
                    stable_delivery_id,
                )
            assert await admin_client.xlen(stream) == 1
            pending = await admin_client.xpending_range(
                stream, group, "-", "+", 10
            )
            assert len(pending) == 1
            assert pending[0]["consumer"] == b"worker-after-restart"
            assert await admin_client.hset(
                index, stable_delivery_id, entry_id
            ) == 1

            await restarted_consumer.ack_after_settlement(
                reclaimed[0],
                stable_delivery_id,
            )

            # A missing exact entry with a surviving mapping and PEL record is
            # another partial state, never the all-absent idempotent outcome.
            partial_stable_id = f"partial-{time.time_ns()}"
            partial_entry_id = await admin_client.xadd(
                stream,
                {b"signed_envelope": signed_envelope},
            )
            await admin_client.hset(
                index,
                partial_stable_id,
                partial_entry_id,
            )
            partial_deliveries = await restarted_consumer.read()
            assert len(partial_deliveries) == 1
            assert partial_deliveries[0].entry_id == partial_entry_id.decode("ascii")
            assert await admin_client.xdel(stream, partial_entry_id) == 1
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await restarted_consumer.ack_after_settlement(
                    partial_deliveries[0],
                    partial_stable_id,
                )
            assert (
                await admin_client.hget(index, partial_stable_id)
                == partial_entry_id
            )
            pending = await admin_client.xpending_range(
                stream, group, partial_entry_id, partial_entry_id, 1
            )
            assert len(pending) == 1
            assert pending[0]["consumer"] == b"worker-after-restart"
            assert await admin_client.xack(
                stream, group, partial_entry_id
            ) == 1
            assert await admin_client.hdel(index, partial_stable_id) == 1

            assert await admin_client.xlen(stream) == 0
            assert await admin_client.xrange(stream, min="-", max="+") == []
            assert (
                await admin_client.xpending_range(stream, group, "-", "+", 10)
                == []
            )
            assert await admin_client.hlen(index) == 0
            # A response-loss retry observes the complete terminal
            # postcondition and receives explicit idempotent success.
            await restarted_consumer.ack_after_settlement(
                reclaimed[0],
                stable_delivery_id,
            )
        finally:
            await admin_client.delete(stream, index)
            if first_client is not None:
                await first_client.aclose()
            if restarted_client is not None:
                await restarted_client.aclose()
            await admin_client.aclose()

    asyncio.run(run())


def test_pending_heartbeat_is_owner_conditional_across_reclaim() -> None:
    redis_url = os.environ.get(_REDIS_URL_ENV)
    if not redis_url:
        pytest.skip(f"set {_REDIS_URL_ENV} to run the real-Redis lifecycle test")
    redis_async = importlib.import_module("redis.asyncio")

    async def run() -> None:
        admin = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        owner_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        peer_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        stream = f"elitea:test:python-pel-heartbeat:{time.time_ns()}"
        group = "elitea-worker-python-heartbeat-test"
        try:
            await admin.xgroup_create(stream, group, id="0-0", mkstream=True)
            entry_id = await admin.xadd(
                stream,
                {b"signed_envelope": b"reference-only-test-envelope"},
            )
            owner = RedisCommandConsumer(
                _LifecycleRedisClient(owner_client),
                stream=stream,
                group=group,
                consumer="worker-owner",
            )
            peer = RedisCommandConsumer(
                _LifecycleRedisClient(peer_client),
                stream=stream,
                group=group,
                consumer="worker-peer",
            )
            deliveries = await owner.read()
            assert len(deliveries) == 1
            await asyncio.sleep(0.12)

            refreshed = await owner.heartbeat_pending((deliveries[0].entry_id,))
            assert refreshed == (entry_id.decode("ascii"),)
            assert await peer.reclaim(min_idle_ms=100) == ()

            pending = await admin.xpending_range(stream, group, "-", "+", 1)
            assert len(pending) == 1
            assert pending[0]["consumer"] == b"worker-owner"

            # The owner pauses long enough for a valid peer reclaim, then
            # resumes with stale local state. Its heartbeat must not steal the
            # PEL entry back from the peer.
            await asyncio.sleep(0.12)
            reclaimed = await peer.reclaim(min_idle_ms=100)
            assert reclaimed == deliveries
            pending = await admin.xpending_range(stream, group, "-", "+", 1)
            assert pending[0]["consumer"] == b"worker-peer"

            assert await owner.heartbeat_pending((deliveries[0].entry_id,)) == ()
            pending = await admin.xpending_range(stream, group, "-", "+", 1)
            assert pending[0]["consumer"] == b"worker-peer"
            assert await peer.heartbeat_pending((deliveries[0].entry_id,)) == (
                deliveries[0].entry_id,
            )
        finally:
            await admin.delete(stream)
            if owner_client is not None:
                await owner_client.aclose()
            await peer_client.aclose()
            await admin.aclose()

    asyncio.run(run())


def test_two_workers_cannot_reclaim_fetched_batch_during_shutdown_drain() -> None:
    redis_url = os.environ.get(_REDIS_URL_ENV)
    if not redis_url:
        pytest.skip(f"set {_REDIS_URL_ENV} to run the real-Redis lifecycle test")
    redis_async = importlib.import_module("redis.asyncio")

    async def run() -> None:
        admin = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        owner_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        peer_client = redis_async.Redis.from_url(
            redis_url,
            decode_responses=False,
            socket_connect_timeout=2,
            socket_timeout=2,
            retry_on_timeout=False,
        )
        stream = f"elitea:test:python-drain-heartbeat:{time.time_ns()}"
        group = "elitea-worker-python-drain-test"
        stop = asyncio.Event()
        release = asyncio.Event()
        runtime_task: asyncio.Task[None] | None = None
        try:
            await admin.xgroup_create(stream, group, id="0-0", mkstream=True)
            entry_ids: list[bytes] = []
            for _ in range(3):
                entry_ids.append(
                    await admin.xadd(
                        stream,
                        {b"signed_envelope": b"reference-only-test-envelope"},
                    )
                )
            owner = RedisCommandConsumer(
                _LifecycleRedisClient(owner_client),
                stream=stream,
                group=group,
                consumer="worker-owner",
                read_count=3,
                block_ms=100,
            )
            peer = RedisCommandConsumer(
                _LifecycleRedisClient(peer_client),
                stream=stream,
                group=group,
                consumer="worker-peer",
                read_count=3,
                block_ms=100,
            )
            processing = asyncio.Event()
            processed: list[str] = []

            async def process(delivery: RedisCommandDelivery) -> DeliveryResult:
                processed.append(delivery.entry_id)
                if len(processed) == 1:
                    processing.set()
                    await release.wait()
                return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

            runtime = WorkerServeLoop(
                consumer=owner,
                process_delivery=process,
                max_concurrency=1,
                queue_capacity=1,
                reclaim_idle_millis=100,
                reclaim_interval_millis=20,
                dependency_retry_millis=20,
                shutdown_timeout_millis=1_000,
            )
            runtime_task = asyncio.create_task(runtime.run(stop))
            await asyncio.wait_for(processing.wait(), timeout=1)

            pending = await admin.xpending_range(stream, group, "-", "+", 10)
            assert len(pending) == 2
            assert {row["consumer"] for row in pending} == {b"worker-owner"}

            stop.set()
            await asyncio.sleep(0.15)
            assert await peer.reclaim(min_idle_ms=100) == ()
            assert not runtime_task.done()

            release.set()
            await asyncio.wait_for(runtime_task, timeout=1)
            assert processed == [
                entry_id.decode("ascii") for entry_id in entry_ids[:2]
            ]
        finally:
            stop.set()
            release.set()
            if runtime_task is not None and not runtime_task.done():
                runtime_task.cancel()
                await asyncio.gather(runtime_task, return_exceptions=True)
            await admin.delete(stream)
            await owner_client.aclose()
            await peer_client.aclose()
            await admin.aclose()

    asyncio.run(run())
