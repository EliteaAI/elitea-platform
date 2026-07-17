"""Opt-in Redis 7 service test for the Python command-entry lifecycle.

This proves the actual redis-py transaction against a service. It does not
exercise PostgreSQL settlement, gRPC/HTTPS, a worker subprocess, or redis-py's
pre-decode RESP allocation behavior.
"""

from __future__ import annotations

import asyncio
import importlib
import os
import time
from typing import Any

import pytest

from elitea_worker.execution.errors import DependencyUnavailable
from elitea_worker.transport.redis_commands import RedisCommandConsumer


_REDIS_URL_ENV = "ELITEA_TEST_REDIS_URL"


class _LifecycleRedisClient:
    """Adds only the constructor marker required by the intake boundary.

    This marker does not alter redis-py's parser and is not evidence of a
    pre-decode allocation bound; production serve remains disabled for that
    separate reason.
    """

    max_bulk_reply_bytes = 48 * 1024

    def __init__(self, client: Any) -> None:
        self._client = client

    async def xreadgroup(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xreadgroup(*args, **kwargs)

    async def xautoclaim(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xautoclaim(*args, **kwargs)

    def pipeline(self, *, transaction: bool = True):
        return self._client.pipeline(transaction=transaction)


def test_python_consumer_reclaims_after_restart_then_atomically_acks_and_deletes() -> None:
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
        group = "elitea-worker-python-test"
        try:
            assert await admin_client.ping()
            await admin_client.xgroup_create(stream, group, id="0-0", mkstream=True)
            entry_id = await admin_client.xadd(
                stream,
                {b"signed_envelope": b"reference-only-test-envelope"},
            )
            first_consumer = RedisCommandConsumer(
                _LifecycleRedisClient(first_client),
                stream=stream,
                group=group,
                consumer="worker-1",
            )

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

            await restarted_consumer.ack_after_settlement(reclaimed[0])

            assert await admin_client.xlen(stream) == 0
            assert await admin_client.xrange(stream, min="-", max="+") == []
            assert await admin_client.xpending_range(stream, group, "-", "+", 10) == []
            with pytest.raises(DependencyUnavailable, match="atomic command"):
                await restarted_consumer.ack_after_settlement(reclaimed[0])
        finally:
            await admin_client.delete(stream)
            if first_client is not None:
                await first_client.aclose()
            if restarted_client is not None:
                await restarted_client.aclose()
            await admin_client.aclose()

    asyncio.run(run())
