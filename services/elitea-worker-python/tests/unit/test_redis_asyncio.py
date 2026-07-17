from __future__ import annotations

import asyncio
import ssl
from types import SimpleNamespace

import pytest

from elitea_worker.transport import redis_asyncio as module
from elitea_worker.transport.redis_asyncio import RedisAsyncioControlClient


def test_real_redis_adapter_is_acl_binary_and_exact_ca_tls_only(monkeypatch) -> None:
    pools: list[dict[str, object]] = []
    evaluations: list[tuple[object, ...]] = []

    class Connection:
        def _connection_arguments(self):
            return {"host": "redis.internal", "port": 6379}

    class SSLConnection(Connection):
        pass

    class ConnectionPool:
        def __init__(self, **kwargs: object) -> None:
            pools.append(kwargs)
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

    class Redis:
        def __init__(self, *, connection_pool: object) -> None:
            self.connection_pool = connection_pool
            self.closed = False

        async def aclose(self) -> None:
            self.closed = True

        async def eval(self, *args: object):
            evaluations.append(args)
            return [1, 1, 1]

    redis = SimpleNamespace(ConnectionPool=ConnectionPool, Redis=Redis)
    connection = SimpleNamespace(
        Connection=Connection,
        SSLConnection=SSLConnection,
    )
    monkeypatch.setattr(module, "_load_redis", lambda: (redis, connection))
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)

    client = RedisAsyncioControlClient.connect(
        "rediss://elitea-worker@redis.internal:6379/0",
        password="redis-password",
        ssl_context=context,
        max_connections=8,
        socket_connect_timeout_seconds=2,
        socket_timeout_seconds=3,
    )

    assert len(pools) == 1
    arguments = pools[0]
    connection_class = arguments.pop("connection_class")
    assert arguments == {
        "host": "redis.internal",
        "port": 6379,
        "db": 0,
        "decode_responses": False,
        "username": "elitea-worker",
        "password": "redis-password",
        "max_connections": 8,
        "socket_connect_timeout": 2,
        "socket_timeout": 3,
        "retry_on_timeout": False,
        "health_check_interval": 30,
        "protocol": 2,
        "lib_name": None,
        "lib_version": None,
    }
    assert issubclass(connection_class, SSLConnection)
    assert connection_class()._connection_arguments()["ssl"] is context
    assert not hasattr(client, "publish")
    assert not hasattr(client, "xadd")
    assert not hasattr(client, "ensure_consumer_group")
    assert not hasattr(client, "eval")
    assert not hasattr(client, "pipeline")
    assert not hasattr(client, "execute_command")
    result = asyncio.run(
        client.retire_delivery(
            stream="configuration-validation.v1",
            group="elitea-worker-python",
            consumer="worker-1",
            entry_id="1-0",
            stable_delivery_id="outbox-1",
            signed_envelope=b"signed-reference-only-envelope",
        )
    )
    assert result == [1, 1, 1]
    assert len(evaluations) == 1
    script, key_count, stream, index, stable_id, entry_id, envelope, group, consumer = (
        evaluations[0]
    )
    assert "HGET" in script
    assert "XRANGE" in script
    assert "XPENDING" in script
    assert "XACK" in script
    assert "XDEL" in script
    assert "HDEL" in script
    assert "return {2, 0, 0}" in script
    assert key_count == 2
    assert stream == "configuration-validation.v1"
    assert index == "configuration-validation.v1:delivery-index.v1"
    assert stable_id == "outbox-1"
    assert entry_id == "1-0"
    assert envelope == b"signed-reference-only-envelope"
    assert group == "elitea-worker-python"
    assert consumer == "worker-1"
    asyncio.run(client.aclose())
    assert client._client.closed
    assert client._pool.closed


@pytest.mark.parametrize(
    "url",
    [
        "redis://elitea-worker@redis.internal:6379/0",
        "rediss://redis.internal:6379/0",
        "rediss://elitea-worker:secret@redis.internal:6379/0",
        "rediss://elitea-worker@redis.internal:6379/0?protocol=2",
        "rediss://elitea-worker@redis.internal:6379/0#fragment",
        "rediss://elitea-worker@redis.internal/0",
        "rediss://elitea-worker@redis.internal:0/0",
        "rediss://elitea-worker@redis.internal:06379/0",
        "rediss://elitea-worker@redis.internal:6379",
        "rediss://elitea-worker@redis.internal:6379/1",
        "rediss://elitea-worker@redis.internal:6379/01",
        "rediss://elitea%2Dworker@redis.internal:6379/0",
        "rediss://elitea+worker@redis.internal:6379/0",
        "rediss://elitea worker@redis.internal:6379/0",
        "rediss://elitéa-worker@redis.internal:6379/0",
    ],
)
def test_real_redis_adapter_rejects_noncanonical_url_before_dependency_load(
    monkeypatch,
    url: str,
) -> None:
    def unexpected_load() -> tuple[object, object]:
        pytest.fail("invalid Redis URL reached the Redis dependency loader")

    monkeypatch.setattr(module, "_load_redis", unexpected_load)

    with pytest.raises(ValueError, match="Redis TLS"):
        RedisAsyncioControlClient.connect(
            url,
            password="redis-password",
            ssl_context=ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT),
            max_connections=8,
            socket_connect_timeout_seconds=2,
            socket_timeout_seconds=3,
        )
