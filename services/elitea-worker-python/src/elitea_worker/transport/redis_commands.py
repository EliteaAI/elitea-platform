"""Bounded, reference-only Redis Streams command intake and retirement.

This is intentionally the only worker module that knows the Redis command
client API. It has no output, result, callback or arbitrary publish method.

Runtime v1 assigns exactly one worker consumer group to each command stream.
Many worker processes may consume within that group. Once durable settlement
has succeeded, the owning worker retires exactly one entry with atomic
``XACK`` + ``XDEL``. Adding another group to the same stream requires a new
retention protocol because deleting an entry after this group's ACK would make
it unavailable to the other group.

The post-decode size checks here do not bound redis-py's RESP allocation before
decode. Production serve composition remains disabled until its Redis client
can enforce that separate transport bound.

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


class RedisStreamsClient(Protocol):
    @property
    def max_bulk_reply_bytes(self) -> int: ...

    async def xreadgroup(self, *args: Any, **kwargs: Any) -> Any: ...

    async def xautoclaim(self, *args: Any, **kwargs: Any) -> Any: ...

    def pipeline(self, *, transaction: bool = True) -> RedisTransaction: ...


class RedisTransaction(Protocol):
    async def __aenter__(self) -> RedisTransaction: ...

    async def __aexit__(self, exc_type: Any, exc: Any, traceback: Any) -> None: ...

    def xack(self, *args: Any, **kwargs: Any) -> RedisTransaction: ...

    def xdel(self, *args: Any, **kwargs: Any) -> RedisTransaction: ...

    async def execute(self, *, raise_on_error: bool = True) -> Any: ...


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
        if max_field_bytes > max_entry_bytes:
            raise ValueError("Redis field limit cannot exceed the complete entry limit")
        decoder_limit = getattr(client, "max_bulk_reply_bytes", None)
        if (
            isinstance(decoder_limit, bool)
            or not isinstance(decoder_limit, int)
            or decoder_limit < 1
            or decoder_limit > max_field_bytes
        ):
            raise ValueError(
                "Redis client must prove a bounded RESP bulk decoder no larger than max_field_bytes"
            )
        self._client = client
        self._stream = stream
        self._group = group
        self._consumer = consumer
        self._max_entry_bytes = max_entry_bytes
        self._max_field_bytes = max_field_bytes
        self._read_count = read_count
        self._block_ms = block_ms

    async def read(self) -> tuple[RedisCommandDelivery, ...]:
        response = await self._client.xreadgroup(
            groupname=self._group,
            consumername=self._consumer,
            streams={self._stream: ">"},
            count=self._read_count,
            block=self._block_ms,
        )
        return self._decode_read(response)

    async def reclaim(self, *, min_idle_ms: int, start_id: str = "0-0") -> tuple[RedisCommandDelivery, ...]:
        if min_idle_ms < 1:
            raise ValueError("min_idle_ms must be positive")
        response = await self._client.xautoclaim(
            self._stream,
            self._group,
            self._consumer,
            min_idle_ms,
            start_id,
            count=self._read_count,
        )
        entries = response[1] if response and len(response) > 1 else ()
        if len(entries) > self._read_count:
            raise ResourceExhausted("Redis reclaim response exceeds the bounded read count.")
        return tuple(self._decode_entry(self._stream, entry) for entry in entries)

    async def ack_after_settlement(self, delivery: RedisCommandDelivery) -> None:
        """Atomically retire one entry after its settlement is durable.

        The caller owns the ordering guarantee: this method must not be called
        before the durable settlement receipt has been validated.
        """
        if delivery.stream != self._stream:
            raise InvalidInput("The delivered command belongs to another stream.")
        async with self._client.pipeline(transaction=True) as transaction:
            transaction.xack(self._stream, self._group, delivery.entry_id)
            transaction.xdel(self._stream, delivery.entry_id)
            results = await transaction.execute(raise_on_error=False)
        if not _is_exact_retirement(results):
            raise DependencyUnavailable(
                "Redis did not confirm atomic command acknowledgement and deletion."
            )

    def _decode_read(self, response: Any) -> tuple[RedisCommandDelivery, ...]:
        deliveries: list[RedisCommandDelivery] = []
        for stream, entries in response or ():
            stream_name = _ascii(stream, "stream")
            if stream_name != self._stream:
                raise InvalidInput("Redis returned a command from an unexpected stream.")
            deliveries.extend(self._decode_entry(stream_name, entry) for entry in entries)
            if len(deliveries) > self._read_count:
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


def _is_exact_retirement(results: Any) -> bool:
    return (
        isinstance(results, (list, tuple))
        and len(results) == 2
        and type(results[0]) is int
        and results[0] == 1
        and type(results[1]) is int
        and results[1] == 1
    )
