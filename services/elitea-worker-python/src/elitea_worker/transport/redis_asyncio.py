"""Restricted redis.asyncio client for the reference-only command stream."""

from __future__ import annotations

import importlib
import ssl
from typing import Any
from urllib.parse import urlsplit


_RETIRE_DELIVERY_SCRIPT = """
local mapped_entry_id = redis.call('HGET', KEYS[2], ARGV[1])
local entries = redis.call('XRANGE', KEYS[1], ARGV[2], ARGV[2], 'COUNT', 1)
local pending = redis.call('XPENDING', KEYS[1], ARGV[4], ARGV[2], ARGV[2], 1)

-- Under the caller's validated durable terminal settlement, all-absent is the
-- complete desired-state postcondition. It is not proof that this exact Lua
-- call ran before. Keep it distinct from the first successful mutation so a
-- caller can never treat a partial state as idempotent success.
if not mapped_entry_id and #entries == 0 and #pending == 0 then
    return {2, 0, 0}
end

if mapped_entry_id ~= ARGV[2] then
    return {0, 0, 0}
end

if #entries ~= 1 or entries[1][1] ~= ARGV[2] then
    return {0, 0, 0}
end
local fields = entries[1][2]
if #fields ~= 2 or fields[1] ~= 'signed_envelope' or fields[2] ~= ARGV[3] then
    return {0, 0, 0}
end

if #pending ~= 1 or pending[1][1] ~= ARGV[2] or pending[1][2] ~= ARGV[5] then
    return {0, 0, 0}
end

local acknowledged = redis.call('XACK', KEYS[1], ARGV[4], ARGV[2])
local deleted = redis.call('XDEL', KEYS[1], ARGV[2])
local unmapped = redis.call('HDEL', KEYS[2], ARGV[1])
return {acknowledged, deleted, unmapped}
"""

_HEARTBEAT_OWNED_PENDING_SCRIPT = """
-- Runtime v1 permits at most 64 IDs per heartbeat. Keep the bound inside the
-- atomic ownership operation as defense in depth.
if #ARGV < 3 or #ARGV > 66 then
    return redis.error_reply('invalid bounded PEL heartbeat')
end

local group = ARGV[1]
local consumer = ARGV[2]
local refreshed = {}
for argument_index = 3, #ARGV do
    local entry_id = ARGV[argument_index]
    local pending = redis.call(
        'XPENDING', KEYS[1], group, entry_id, entry_id, 1
    )
    if #pending == 1
        and pending[1][1] == entry_id
        and pending[1][2] == consumer then
        local claimed = redis.call(
            'XCLAIM', KEYS[1], group, consumer, 0, entry_id, 'JUSTID'
        )
        if #claimed == 1 and claimed[1] == entry_id then
            refreshed[#refreshed + 1] = entry_id
        end
    end
end
return refreshed
"""

_MAX_HEARTBEAT_ENTRY_IDS = 64


class RedisAsyncioControlClient:
    """Expose intake/liveness/retirement; deliberately no publish, set or xadd."""

    def __init__(self, client: Any, pool: Any) -> None:
        self._client = client
        self._pool = pool

    @classmethod
    def connect(
        cls,
        url: str,
        *,
        password: str,
        ssl_context: ssl.SSLContext,
        max_connections: int,
        socket_connect_timeout_seconds: float,
        socket_timeout_seconds: float,
    ) -> RedisAsyncioControlClient:
        if (
            not _canonical_redis_url_text(url)
            or not url.startswith("rediss://")
            or not password
            or not isinstance(ssl_context, ssl.SSLContext)
            or max_connections < 1
            or min(socket_connect_timeout_seconds, socket_timeout_seconds) <= 0
        ):
            raise ValueError("Redis TLS client configuration is invalid")
        try:
            parsed = urlsplit(url)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("Redis TLS URL is invalid") from exc
        if (
            not parsed.hostname
            or port is None
            or port <= 0
            or not _valid_acl_username(parsed.username)
            or parsed.password is not None
            or parsed.path != "/0"
            or parsed.query
            or parsed.fragment
            or not _canonical_explicit_port(parsed.netloc, port)
        ):
            raise ValueError("Redis TLS URL is invalid")
        redis_asyncio, connection_module = _load_redis()
        connection_class = _exact_ca_connection_class(connection_module, ssl_context)
        pool = redis_asyncio.ConnectionPool(
            connection_class=connection_class,
            host=parsed.hostname,
            port=port,
            db=0,
            decode_responses=False,
            username=parsed.username,
            password=password,
            max_connections=max_connections,
            socket_connect_timeout=socket_connect_timeout_seconds,
            socket_timeout=socket_timeout_seconds,
            retry_on_timeout=False,
            health_check_interval=30,
            protocol=2,
            lib_name=None,
            lib_version=None,
        )
        client = redis_asyncio.Redis(connection_pool=pool)
        return cls(client, pool)

    async def ping(self) -> bool:
        return bool(await self._client.ping())

    async def xreadgroup(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xreadgroup(*args, **kwargs)

    async def xautoclaim(self, *args: Any, **kwargs: Any) -> Any:
        return await self._client.xautoclaim(*args, **kwargs)

    async def heartbeat_owned_pending(
        self,
        *,
        stream: str,
        group: str,
        consumer: str,
        entry_ids: tuple[str, ...],
    ) -> Any:
        """Atomically refresh only IDs still pending under this consumer."""

        if not 1 <= len(entry_ids) <= _MAX_HEARTBEAT_ENTRY_IDS:
            raise ValueError("Redis PEL heartbeat batch is invalid")
        return await self._client.eval(
            _HEARTBEAT_OWNED_PENDING_SCRIPT,
            1,
            stream,
            group,
            consumer,
            *entry_ids,
        )

    async def retire_delivery(
        self,
        *,
        stream: str,
        group: str,
        consumer: str,
        entry_id: str,
        stable_delivery_id: str,
        signed_envelope: bytes,
    ) -> Any:
        """Retire one exact pending delivery without exposing arbitrary Lua."""

        return await self._client.eval(
            _RETIRE_DELIVERY_SCRIPT,
            2,
            stream,
            f"{stream}:delivery-index.v1",
            stable_delivery_id,
            entry_id,
            signed_envelope,
            group,
            consumer,
        )

    async def aclose(self) -> None:
        try:
            await self._client.aclose()
        finally:
            # Redis(connection_pool=...) does not transfer pool ownership.
            # Explicitly close the custom pool; redis-py 6.2 close is idempotent.
            await self._pool.aclose()


def _load_redis() -> tuple[Any, Any]:
    redis_asyncio = importlib.import_module("redis.asyncio")
    connection = importlib.import_module("redis.asyncio.connection")
    return redis_asyncio, connection


def _valid_acl_username(value: str | None) -> bool:
    if not value or len(value) > 256:
        return False
    return all(
        character.isascii()
        and (character.isalnum() or character in (".", "_", "-"))
        for character in value
    )


def _canonical_redis_url_text(value: str) -> bool:
    return all(
        0x21 <= ord(character) <= 0x7E and character not in ("%", "?", "#")
        for character in value
    )


def _canonical_explicit_port(authority: str, port: int) -> bool:
    _, separator, host_and_port = authority.rpartition("@")
    if not separator:
        return False
    if host_and_port.startswith("["):
        closing = host_and_port.find("]")
        return closing > 0 and host_and_port[closing + 1 :] == f":{port}"
    host, separator, port_text = host_and_port.rpartition(":")
    return bool(host and separator and port_text == str(port))


def _exact_ca_connection_class(connection_module: Any, context: ssl.SSLContext) -> type:
    """Bind redis-py 6.2 SSL connections to one preloaded exact-CA context."""

    ssl_connection = connection_module.SSLConnection
    plain_connection = connection_module.Connection

    class ExactCAAsyncSSLConnection(ssl_connection):
        def _connection_arguments(self) -> dict[str, Any]:
            arguments = dict(plain_connection._connection_arguments(self))
            arguments["ssl"] = context
            return arguments

    ExactCAAsyncSSLConnection.__name__ = "ExactCAAsyncSSLConnection"
    return ExactCAAsyncSSLConnection
