"""The consumer group's SHARED record of entries that must not run again.

The file-backed record beside this one (`execution/quarantine.py`) survives a
restart but is per filesystem: a second replica refuses an entry once and learns
it privately. This one is shared, because it lives where the entry lives — one
hash per (stream, group), which is exactly the scope of the decision. Runtime v1
binds one worker consumer group per command stream, and a second group has its
own pending list and its own call to make.

ACCESS. This needs `+hset +hkeys +hlen +expire` and a key pattern the `worker`
ACL user did not previously have; `deploy/scripts/gen-runtime-certs.sh` grants
them, confined to this namespace. Before that grant the worker held no write
primitive of its own, so a Redis-backed record failed NOPERM on every write
while unit tests over a fake client passed. If this store starts reporting
`quarantine_write_rejected` in a deployment, check the ACL first —
`/run/elitea-runtime/redis-users.acl`.

WHAT THIS IS NOT. Not a dead-letter queue, and it retires nothing. The entry
stays PENDING and recoverable; this records only that re-running it is pointless.
`clear` exists so the server-side recovery named in the refusal has something to
call, and is deliberately not reachable from the delivery path: a worker that
decided an entry is hopeless is not the component that may decide it is fixed.

BOUNDS. The cap is enforced inside the atomic operation, for the reason
`_HEARTBEAT_OWNED_PENDING_SCRIPT` gives about its own bound — a limit checked
only in the client stops being a limit as soon as a second client exists. Past
the cap the write is refused and the caller is told, so the degraded state is
announced rather than silently unbounded. The key also carries a refreshed TTL:
the cap is the real bound, and the TTL is the safety valve for a record nothing
ever recovers, so an abandoned one cannot pin the cap forever.
"""

from __future__ import annotations

from typing import Any, Protocol

from elitea_worker.execution.errors import InvalidInput, ResourceExhausted


# Returns 1 when the entry is recorded (or already was), 0 when the cap refused
# it. A code rather than an exception keeps "full" distinguishable from "stored"
# without a second round trip, and keeps the decision atomic.
QUARANTINE_ENTRY_SCRIPT = """
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if not cap or cap < 1 or not ttl or ttl < 1 then
    return redis.error_reply('invalid bounded quarantine write')
end

if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 0 then
    if redis.call('HLEN', KEYS[1]) >= cap then
        return 0
    end
    redis.call('HSET', KEYS[1], ARGV[1], ARGV[4])
end
redis.call('EXPIRE', KEYS[1], ttl)
return 1
"""

_MAX_RECORDED_ENTRIES = 4096
_MAX_ENTRY_ID_BYTES = 128


class RedisQuarantineClient(Protocol):
    async def quarantine_entry(
        self,
        *,
        key: str,
        entry_id: str,
        cap: int,
        ttl_seconds: int,
        recorded_reason: str,
    ) -> Any: ...

    async def quarantined_entries(self, *, key: str) -> Any: ...

    async def clear_quarantined_entry(self, *, key: str, entry_id: str) -> Any: ...


def quarantine_key(*, stream: str, group: str) -> str:
    """The one key name, derived so two groups never share a decision.

    Must stay inside the `~elitea:runtime:v1:quarantine:<stream>:*` pattern the
    runtime ACL grants, or every call answers NOPERM.
    """
    return f"elitea:runtime:v1:quarantine:{stream}:{group}"


class SharedQuarantineStore:
    """Bounded, per-(stream, group) record shared by every replica."""

    def __init__(
        self,
        client: RedisQuarantineClient,
        *,
        stream: str,
        group: str,
        cap: int = 256,
        ttl_seconds: int = 7 * 24 * 60 * 60,
    ) -> None:
        if not stream or not group:
            raise ValueError("stream and group are required")
        if not 1 <= cap <= _MAX_RECORDED_ENTRIES:
            raise ValueError("quarantine cap exceeds the runtime bound")
        if ttl_seconds < 1:
            raise ValueError("quarantine TTL must be positive")
        self._client = client
        self._key = quarantine_key(stream=stream, group=group)
        self._cap = cap
        self._ttl_seconds = ttl_seconds
        #: Set by `load`; read by the caller to report a damaged record.
        self.malformed_entries = 0

    @property
    def cap(self) -> int:
        return self._cap

    @property
    def key(self) -> str:
        return self._key

    async def load(self) -> frozenset[str]:
        """Every entry id this GROUP has refused, whichever replica refused it.

        A malformed MEMBER is skipped and counted, not raised — the same rule the
        file tier uses, and for a sharper reason here: this record is shared, so
        one bad field written by any replica (or by hand) would otherwise make
        every replica's load fail and disable sharing permanently, with no way to
        self-heal. Measured: a shell that did not word-split a list of ids wrote
        exactly such a field, and the strict version then refused to load at all
        — including refusing to read the field so it could be cleared.

        A malformed RESPONSE SHAPE still raises. That is the transport lying
        about its own contract, not one damaged row.
        """
        response = await self._client.quarantined_entries(key=self._key)
        if response is None:
            return frozenset()
        if not isinstance(response, (list, tuple, set, frozenset)):
            raise InvalidInput("The quarantine response is malformed.")
        if len(response) > _MAX_RECORDED_ENTRIES:
            raise ResourceExhausted("The quarantine exceeds the runtime bound.")
        entries: set[str] = set()
        malformed = 0
        for member in response:
            try:
                entries.add(_decode_entry_id(member))
            except InvalidInput:
                malformed += 1
        self.malformed_entries = malformed
        return frozenset(entries)

    async def clear_malformed(self) -> int:
        """Drop members this store cannot read, so the record can self-heal."""
        response = await self._client.quarantined_entries(key=self._key)
        if not isinstance(response, (list, tuple, set, frozenset)):
            return 0
        removed = 0
        for member in response:
            try:
                _decode_entry_id(member)
            except InvalidInput:
                raw = member.decode("latin-1") if isinstance(member, bytes) else str(member)
                await self._client.clear_quarantined_entry(key=self._key, entry_id=raw)
                removed += 1
        return removed

    async def add(self, entry_id: str, *, reason_code: str) -> bool:
        """Record one entry. False means the cap refused it, not that it failed."""
        _validate_entry_id(entry_id)
        response = await self._client.quarantine_entry(
            key=self._key,
            entry_id=entry_id,
            cap=self._cap,
            ttl_seconds=self._ttl_seconds,
            recorded_reason=reason_code,
        )
        if isinstance(response, bool):
            return response
        if not isinstance(response, int):
            raise InvalidInput("The quarantine write response is malformed.")
        return response == 1

    async def clear(self, entry_id: str) -> None:
        """Forget one entry, so a repaired command can run again."""
        _validate_entry_id(entry_id)
        await self._client.clear_quarantined_entry(key=self._key, entry_id=entry_id)


def _validate_entry_id(entry_id: str) -> None:
    if (
        not entry_id
        or len(entry_id.encode("utf-8")) > _MAX_ENTRY_ID_BYTES
        or not entry_id.isascii()
        or not entry_id.isprintable()
        # No whitespace. A Redis stream id never contains any, and accepting it
        # let a shell that did not word-split a list of ids record all four as
        # ONE entry — silently, because every character was printable ASCII.
        or any(character.isspace() for character in entry_id)
    ):
        raise InvalidInput("The quarantine entry ID is malformed.")


def _decode_entry_id(member: Any) -> str:
    if isinstance(member, bytes):
        try:
            decoded = member.decode("ascii")
        except UnicodeDecodeError as error:
            raise InvalidInput("The quarantine entry ID is malformed.") from error
    elif isinstance(member, str):
        decoded = member
    else:
        raise InvalidInput("The quarantine entry ID is malformed.")
    _validate_entry_id(decoded)
    return decoded


__all__ = [
    "QUARANTINE_ENTRY_SCRIPT",
    "RedisQuarantineClient",
    "SharedQuarantineStore",
    "quarantine_key",
]
