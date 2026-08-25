"""Durable record of command entries this worker must not execute again.

WHY IT HAS TO BE DURABLE. A delivery that fails non-retryably is never ACKed —
the output it owes was never delivered, and ACKing would discard the command —
so it stays in the PEL and XAUTOCLAIM offers it again on every reclaim turn.
Refusing it in process memory alone stops the spin only until the process ends:
the next start re-runs the command once and parks it again, which is the same
defect at a slower cadence.

WHAT THIS TIER IS FOR, now that there is a shared one beside it. The group's
shared record lives in Redis (`transport/redis_quarantine.py`) and is the tier
that makes the decision cross replicas. This file-backed tier is the one that
keeps working when Redis does not: a store outage would otherwise return the
worker to re-running a parked command on every restart, and the spool is already
exclusively the worker's (0700, its own uid, checked by
`validate_private_directory`) and already a persistent volume.

Kept deliberately, rather than deleted once the shared tier existed: the two
fail independently, and the composite in `CompositeQuarantineStore` treats a
record in EITHER as a refusal. A local-only record is still correct — it just is
not shared.
"""

from __future__ import annotations

import asyncio
from pathlib import Path

from elitea_worker.execution.errors import (
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
)


_MAX_ENTRY_ID_BYTES = 128
_MAX_RECORDED_ENTRIES = 4096
_FIELD_SEPARATOR = "\t"
#: Written instead of a refusal code for a row this replica adopted from
#: the shared record rather than refused itself.
_ADOPTED_REASON = "ADOPTED_FROM_SHARED"


class FileQuarantineStore:
    """Append-only, bounded record of entries that must not run again.

    One line per entry: `<entry_id>\\t<reason_code>`. The reason is written for
    the person who opens the file, not for the loader, which needs only the id.
    """

    def __init__(self, path: Path, *, cap: int = 256) -> None:
        if not 1 <= cap <= _MAX_RECORDED_ENTRIES:
            raise ValueError("quarantine cap exceeds the runtime bound")
        self._path = path
        self._cap = cap
        self._lock = asyncio.Lock()
        self._recorded: set[str] = set()
        self._loaded = False

    @property
    def cap(self) -> int:
        return self._cap

    @property
    def path(self) -> Path:
        return self._path

    async def load(self) -> frozenset[str]:
        """Read the record written by previous processes.

        A missing file is an empty record, not an error: the first run of a new
        deployment has nothing to adopt.

        A malformed line is SKIPPED rather than fatal, and counted into
        `malformed_lines` so the caller can report it. Refusing to start would
        turn one bad byte into an outage; skipping silently would resurrect the
        spin for that entry with nothing to show for it.
        """
        async with self._lock:
            entries, malformed = await asyncio.to_thread(self._read)
            self._recorded = set(entries)
            self._loaded = True
            self.malformed_lines = malformed
            return frozenset(self._recorded)

    async def add(self, entry_id: str, *, reason_code: str) -> bool:
        """Record one entry. False means the cap refused it, not that it failed."""
        _validate_entry_id(entry_id)
        async with self._lock:
            if entry_id in self._recorded:
                return True
            if len(self._recorded) >= self._cap:
                return False
            await asyncio.to_thread(self._append, entry_id, reason_code)
            self._recorded.add(entry_id)
            return True

    def _read(self) -> tuple[set[str], int]:
        try:
            raw = self._path.read_text(encoding="utf-8")
        except FileNotFoundError:
            return set(), 0
        entries: set[str] = set()
        malformed = 0
        for line in raw.splitlines():
            candidate = line.split(_FIELD_SEPARATOR, 1)[0].strip()
            if not candidate:
                continue
            try:
                _validate_entry_id(candidate)
            except InvalidInput:
                malformed += 1
                continue
            entries.add(candidate)
            if len(entries) > _MAX_RECORDED_ENTRIES:
                raise ResourceExhausted(
                    "The quarantine record exceeds the runtime bound."
                )
        return entries, malformed

    def _append(self, entry_id: str, reason_code: str) -> None:
        # Append and flush to the filesystem before returning. The whole point
        # is to survive a process that is about to be killed, so an entry that
        # is only in the page cache of this process is not recorded at all.
        self._path.parent.mkdir(parents=True, exist_ok=True)
        safe_reason = reason_code.replace(_FIELD_SEPARATOR, " ").replace("\n", " ")
        with self._path.open("a", encoding="utf-8") as handle:
            handle.write(f"{entry_id}{_FIELD_SEPARATOR}{safe_reason}\n")
            handle.flush()

    #: Set by `load`; read by the caller to report a damaged record.
    malformed_lines: int = 0


class CompositeQuarantineStore:
    """The shared record and the local one, read as a union and written to both.

    WHY BOTH. They fail independently and neither alone is sufficient:

      * shared only — a Redis outage returns the worker to re-running a parked
        command on every restart, which is the defect this whole change exists
        to remove.
      * local only — the decision never crosses a replica boundary.

    So a record in EITHER is a refusal, and a write goes to both. A write that
    only one tier accepts is still a success: the entry is recorded somewhere
    that outlives the process, which is the guarantee. Which tier failed is
    reported by the caller, because "not shared" and "not durable" need
    different responses.

    ORDER MATTERS on load. The shared tier is read first and its failure must
    not discard the local one — otherwise an unreachable Redis would silently
    cost the durability that already worked.
    """

    def __init__(
        self,
        *,
        shared: object,
        local: FileQuarantineStore,
    ) -> None:
        self._shared = shared
        self._local = local
        self.shared_failed = False
        self.local_failed = False
        #: Set by `load`: rows copied from the shared tier into the local one,
        #: and rows the local cap refused to copy.
        self.backfilled = 0
        self.backfill_refused = 0

    @property
    def cap(self) -> int:
        # The tighter of the two: a cap either tier would refuse is the real one.
        shared_cap = getattr(self._shared, "cap", None)
        if isinstance(shared_cap, int) and shared_cap > 0:
            return min(shared_cap, self._local.cap)
        return self._local.cap

    @property
    def malformed_lines(self) -> int:
        """Damaged rows in EITHER tier — one event covers both, because the
        response is the same: those entries each run once more before being
        parked again."""
        return self._local.malformed_lines + int(
            getattr(self._shared, "malformed_entries", 0)
        )

    async def load(self) -> frozenset[str]:
        shared_entries: set[str] = set()
        local_entries: set[str] = set()
        self.shared_failed = False
        self.local_failed = False
        self.backfilled = 0
        self.backfill_refused = 0
        try:
            shared_entries.update(await self._shared.load())  # type: ignore[attr-defined]
        except asyncio.CancelledError:
            raise
        except Exception:
            self.shared_failed = True
        try:
            local_entries.update(await self._local.load())
        except asyncio.CancelledError:
            raise
        except Exception:
            self.local_failed = True
        if self.shared_failed and self.local_failed:
            raise DependencyUnavailable("No quarantine record could be read.")
        await self._backfill_local(shared_entries - local_entries)
        return frozenset(shared_entries | local_entries)

    async def _backfill_local(self, shared_only: frozenset[str] | set[str]) -> None:
        """Copy the group's decisions into this replica's own record.

        WHY. Adoption alone is not durable: an entry learned from the shared tier
        lived only in this process, so the next Redis outage took it back and the
        replica re-ran a command the GROUP had already given up on. Writing it
        locally makes the two guarantees independent — shared gives reach, local
        gives survival — which is the whole reason there are two tiers.

        WHAT IT MEANS FOR THE FILE. The local record stops being "refusals this
        replica made" and becomes "decisions this replica honours". That is a
        real change in meaning, so the rows say so: they are written with
        `ADOPTED_FROM_SHARED` rather than a refusal code this replica never
        produced. The reason column exists to be read by a person, and inventing
        an AUTHORIZATION_FAILED here would tell them this worker hit a fence it
        never saw. The original reason is not available to copy — the ACL grants
        `hkeys`, not `hgetall`, so `load` returns ids only.

        SKIPPED when the local read failed: `_recorded` would then be empty or
        stale, and appending against it duplicates rows for entries already in
        the file. Skipped silently when there is nothing to copy.
        """
        if self.local_failed or not shared_only:
            return
        for entry_id in sorted(shared_only):
            try:
                stored = await self._local.add(
                    entry_id,
                    reason_code=_ADOPTED_REASON,
                )
            except asyncio.CancelledError:
                raise
            except Exception:
                # One failed row must not abandon the rest, and must not fail the
                # load: the entry is still quarantined in memory for this process.
                self.local_failed = True
                return
            if stored:
                self.backfilled += 1
            else:
                self.backfill_refused += 1

    async def add(self, entry_id: str, *, reason_code: str) -> bool:
        shared_stored = False
        local_stored = False
        self.shared_failed = False
        self.local_failed = False
        try:
            shared_stored = await self._shared.add(  # type: ignore[attr-defined]
                entry_id,
                reason_code=reason_code,
            )
        except asyncio.CancelledError:
            raise
        except Exception:
            self.shared_failed = True
        try:
            local_stored = await self._local.add(entry_id, reason_code=reason_code)
        except asyncio.CancelledError:
            raise
        except Exception:
            self.local_failed = True
        return shared_stored or local_stored


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
        or _FIELD_SEPARATOR in entry_id
    ):
        raise InvalidInput("The quarantine entry ID is malformed.")


__all__ = ["CompositeQuarantineStore", "FileQuarantineStore"]
