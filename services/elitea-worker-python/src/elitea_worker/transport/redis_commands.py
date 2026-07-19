"""Bounded, reference-only Redis Streams command intake and retirement.

This is intentionally the only worker module that knows the Redis command
client API. It has no output, result, callback or arbitrary publish method.

Runtime v1 assigns exactly one worker consumer group to each command stream.
Many worker processes may consume within that group. Once durable settlement
has succeeded, the owning worker retires exactly one entry with a restricted
Lua operation. The operation binds the verified stable delivery ID, exact
signed bytes, stream entry, pending group and current consumer owner before
atomically applying ``XACK`` + ``XDEL`` + delivery-index ``HDEL``. Adding
another group to the same stream requires a new retention protocol because
deleting an entry after this group's ACK would make it unavailable to the
other group.

The post-decode size checks here do not bound redis-py's RESP allocation before
decode. Phase one therefore requires a dedicated TLS/ACL-protected control
Redis plus the producer-side stream capacity and entry-size gates. A custom
pre-decode parser limit remains defense-in-depth; this module does not pretend
that redis-py provides one.

Deleting settled entries also does not bound an outage backlog of unpublished,
unconsumed, or pending work. Runtime activation needs a non-dropping capacity
admission gate; approximate or exact ``MAXLEN`` trimming is unsafe because it
can discard commands that have not reached durable settlement.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

from elitea_worker.execution.errors import (
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
)


_COMMAND_FIELDS = frozenset({"signed_envelope"})
_MAX_STABLE_DELIVERY_ID_BYTES = 256
_MAX_READ_COUNT = 64


class RedisStreamsClient(Protocol):
    async def xreadgroup(self, *args: Any, **kwargs: Any) -> Any: ...

    async def xautoclaim(self, *args: Any, **kwargs: Any) -> Any: ...

    async def heartbeat_owned_pending(
        self,
        *,
        stream: str,
        group: str,
        consumer: str,
        entry_ids: tuple[str, ...],
    ) -> Any: ...

    async def retire_delivery(
        self,
        *,
        stream: str,
        group: str,
        consumer: str,
        entry_id: str,
        stable_delivery_id: str,
        signed_envelope: bytes,
    ) -> Any: ...


@dataclass(frozen=True, slots=True)
class RedisCommandDelivery:
    stream: str
    entry_id: str
    fields: dict[str, bytes]

    @property
    def signed_envelope(self) -> bytes:
        return self.fields["signed_envelope"]


class RedisCommandConsumer:
    def __init__(
        self,
        client: RedisStreamsClient,
        *,
        stream: str,
        group: str,
        consumer: str,
        max_entry_bytes: int = 64 * 1024,
        max_field_bytes: int = 48 * 1024,
        read_count: int = 8,
        block_ms: int = 1_000,
    ) -> None:
        if not stream or not group or not consumer:
            raise ValueError("stream, group and consumer are required")
        if min(max_entry_bytes, max_field_bytes, read_count, block_ms) < 1:
            raise ValueError("Redis command limits must be positive")
        if read_count > _MAX_READ_COUNT:
            raise ValueError("Redis command read count exceeds the runtime-v1 bound")
        if max_field_bytes > max_entry_bytes:
            raise ValueError("Redis field limit cannot exceed the complete entry limit")
        self._client = client
        self._stream = stream
        self._group = group
        self._consumer = consumer
        self._max_entry_bytes = max_entry_bytes
        self._max_field_bytes = max_field_bytes
        self._read_count = read_count
        self._block_ms = block_ms

    @property
    def delivery_batch_size(self) -> int:
        return self._read_count

    async def read(
        self,
        *,
        count: int | None = None,
        block_ms: int | None = None,
    ) -> tuple[RedisCommandDelivery, ...]:
        read_count = self._bounded_count(count)
        read_block_ms = self._bounded_block_millis(block_ms)
        response = await self._client.xreadgroup(
            groupname=self._group,
            consumername=self._consumer,
            streams={self._stream: ">"},
            count=read_count,
            block=read_block_ms,
        )
        return self._decode_read(response, max_count=read_count)

    async def reclaim(self, *, min_idle_ms: int, start_id: str = "0-0") -> tuple[RedisCommandDelivery, ...]:
        _, deliveries = await self.reclaim_page(
            min_idle_ms=min_idle_ms,
            start_id=start_id,
        )
        return deliveries

    async def reclaim_page(
        self,
        *,
        min_idle_ms: int,
        start_id: str = "0-0",
        count: int | None = None,
    ) -> tuple[str, tuple[RedisCommandDelivery, ...]]:
        if min_idle_ms < 1:
            raise ValueError("min_idle_ms must be positive")
        reclaim_count = self._bounded_count(count)
        response = await self._client.xautoclaim(
            self._stream,
            self._group,
            self._consumer,
            min_idle_ms,
            start_id,
            count=reclaim_count,
        )
        next_start_id = _ascii(response[0], "reclaim cursor") if response else "0-0"
        entries = response[1] if response and len(response) > 1 else ()
        if len(entries) > reclaim_count:
            raise ResourceExhausted("Redis reclaim response exceeds the bounded read count.")
        deliveries = tuple(self._decode_entry(self._stream, entry) for entry in entries)
        return next_start_id, deliveries

    @property
    def heartbeat_batch_size(self) -> int:
        return self._read_count

    async def heartbeat_pending(self, entry_ids: tuple[str, ...]) -> tuple[str, ...]:
        """Reset PEL idle for this consumer's bounded local ownership set.

        This is transport liveness only. It never grants the Go business claim,
        acknowledges a command, or retrieves the command body from Redis.
        """

        if not entry_ids:
            return ()
        if len(entry_ids) > self._read_count:
            raise ResourceExhausted("Redis PEL heartbeat exceeds the bounded batch size.")
        if len(set(entry_ids)) != len(entry_ids) or any(
            not _valid_entry_id(entry_id) for entry_id in entry_ids
        ):
            raise InvalidInput("Redis PEL heartbeat entry IDs are malformed.")
        response = await self._client.heartbeat_owned_pending(
            stream=self._stream,
            group=self._group,
            consumer=self._consumer,
            entry_ids=entry_ids,
        )
        if not isinstance(response, (list, tuple)):
            raise InvalidInput("Redis PEL heartbeat response is malformed.")
        if len(response) > len(entry_ids):
            raise ResourceExhausted("Redis PEL heartbeat response exceeds the bounded batch size.")
        refreshed = tuple(_ascii(value, "heartbeat entry ID") for value in response)
        if len(set(refreshed)) != len(refreshed) or not set(refreshed).issubset(entry_ids):
            raise InvalidInput("Redis PEL heartbeat response is malformed.")
        return refreshed

    async def ack_after_settlement(
        self,
        delivery: RedisCommandDelivery,
        stable_delivery_id: str,
    ) -> None:
        """Atomically retire one entry after its settlement is durable.

        The caller owns the ordering guarantee: this method must not be called
        before the durable settlement receipt has been validated.
        """
        if delivery.stream != self._stream:
            raise InvalidInput("The delivered command belongs to another stream.")
        if not _valid_stable_delivery_id(stable_delivery_id):
            raise InvalidInput("The stable delivery identity is malformed.")
        results = await self._client.retire_delivery(
            stream=self._stream,
            group=self._group,
            consumer=self._consumer,
            entry_id=delivery.entry_id,
            stable_delivery_id=stable_delivery_id,
            signed_envelope=delivery.signed_envelope,
        )
        if not _is_confirmed_retirement(results):
            raise DependencyUnavailable(
                "Redis did not confirm atomic command acknowledgement, deletion, and unmapping."
            )

    def _bounded_count(self, count: int | None) -> int:
        if count is None:
            return self._read_count
        if (
            isinstance(count, bool)
            or not isinstance(count, int)
            or not 1 <= count <= self._read_count
        ):
            raise ValueError("Redis command count is outside the configured read bound")
        return count

    def _bounded_block_millis(self, block_ms: int | None) -> int:
        if block_ms is None:
            return self._block_ms
        if isinstance(block_ms, bool) or not isinstance(block_ms, int) or block_ms < 1:
            raise ValueError("Redis command block time must be a positive integer")
        return min(block_ms, self._block_ms)

    def _decode_read(
        self,
        response: Any,
        *,
        max_count: int,
    ) -> tuple[RedisCommandDelivery, ...]:
        deliveries: list[RedisCommandDelivery] = []
        for stream, entries in response or ():
            stream_name = _ascii(stream, "stream")
            if stream_name != self._stream:
                raise InvalidInput("Redis returned a command from an unexpected stream.")
            deliveries.extend(self._decode_entry(stream_name, entry) for entry in entries)
            if len(deliveries) > max_count:
                raise ResourceExhausted("Redis read response exceeds the bounded read count.")
        return tuple(deliveries)

    def _decode_entry(self, stream: str, entry: Any) -> RedisCommandDelivery:
        entry_id_raw, raw_fields = entry
        entry_id = _ascii(entry_id_raw, "entry ID")
        fields: dict[str, bytes] = {}
        encoded_bytes = len(entry_id.encode("ascii"))
        for raw_key, raw_value in raw_fields.items():
            key = _ascii(raw_key, "field name")
            if key not in _COMMAND_FIELDS or key in fields:
                raise InvalidInput("Redis command contains an unregistered field.")
            if not isinstance(raw_value, (bytes, bytearray, memoryview)):
                raise InvalidInput("Redis command fields must use binary-safe decoding.")
            value = bytes(raw_value)
            if len(key.encode("ascii")) > self._max_field_bytes or len(value) > self._max_field_bytes:
                raise ResourceExhausted("A Redis command field exceeds the control-plane limit.")
            encoded_bytes += len(key.encode("ascii")) + len(value)
            if encoded_bytes > self._max_entry_bytes:
                raise ResourceExhausted("The Redis command exceeds the control-plane limit.")
            fields[key] = value
        if frozenset(fields) != _COMMAND_FIELDS:
            raise InvalidInput("Redis command must contain exactly one signed envelope field.")
        return RedisCommandDelivery(stream, entry_id, fields)


def _ascii(value: bytes | str, description: str) -> str:
    if isinstance(value, str):
        return value
    try:
        return bytes(value).decode("ascii")
    except (UnicodeDecodeError, TypeError, ValueError) as exc:
        raise InvalidInput(f"Redis {description} is malformed.") from exc


def _valid_stable_delivery_id(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return (
        len(encoded) <= _MAX_STABLE_DELIVERY_ID_BYTES
        and not any(character in value for character in ("\r", "\n", "\x00"))
    )


def _valid_entry_id(value: object) -> bool:
    if not isinstance(value, str) or len(value) > 64:
        return False
    timestamp, separator, sequence = value.partition("-")
    return bool(separator and timestamp.isascii() and sequence.isascii()) and (
        timestamp.isdecimal() and sequence.isdecimal()
    )


def _is_confirmed_retirement(results: Any) -> bool:
    if not isinstance(results, (list, tuple)) or len(results) != 3:
        return False
    if any(type(value) is not int for value in results):
        return False
    return tuple(results) in ((1, 1, 1), (2, 0, 0))
