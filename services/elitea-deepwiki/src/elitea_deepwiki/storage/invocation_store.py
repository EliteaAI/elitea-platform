"""Durable invocation state — the PostgreSQL :class:`InvocationStore`.

spec-provider-service requires it:

    A restarted service MUST NOT silently reinterpret a known accepted
    operation as never having existed.

The in-memory store cannot satisfy that, and has been saying so in
``GET /health`` (``durable_invocations: false``) since the SPI shell landed.
This is the implementation that flips it.

The interface is unchanged — that was the point of defining it in the first
place. Routes, projection, drain semantics and the 404 rules all stay where
they are; only where the rows live moves.

TWO THINGS THIS BUYS BEYOND SURVIVING A RESTART.
------------------------------------------------
**Reconciliation.** A row still ``running`` whose ``owner`` is a process that
no longer exists is work nobody is doing. :meth:`reconcile_orphans` turns those
into a terminal error at startup, so a caller polling across a restart gets an
answer instead of ``InProgress`` forever. Silence would be the worse failure:
the invocation genuinely is dead, and only the record disagrees.

**Atomic event drain.** ``custom_events`` are read-once — a poll returns what
accumulated since the last one and clears it. As a jsonb array that is
read-modify-write under a lock; as rows it is one ``DELETE … RETURNING``, so
two concurrent pollers can neither both receive an event nor lose one.

Read-once stays the contract. It is the legacy contract and the P0 fixtures
pin it; making events durable does not make them re-readable.

Requires the ``storage-postgres`` extra.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import time
from typing import Any

from ..invocations import Invocation, InvocationStatus

logger = logging.getLogger(__name__)


def _owner_id() -> str:
    """Identify this process well enough to spot a predecessor's rows.

    Hostname plus pid: in Kubernetes the hostname is the pod name, so a
    restarted pod has a new one, and a restarted process in the same pod has a
    new pid. Either change makes the previous owner's rows recognisable.
    """
    return f"{os.environ.get('HOSTNAME', socket.gethostname())}/{os.getpid()}"


class PostgresInvocationStore:
    """Invocation state that survives a restart.

    ``durable`` is ``True``, and that is not decoration: ``GET /health``
    reports it, and an operator uses it to tell a compliant deployment from a
    dev one.
    """

    durable = True

    def __init__(self, connection_factory, *, owner: str | None = None) -> None:
        self._connect = connection_factory
        self.owner = owner or _owner_id()

    # -- lifecycle --------------------------------------------------------

    async def create(self, invocation: Invocation) -> None:
        await self._run(
            "INSERT INTO invocations "
            "(invocation_id, toolkit_name, tool_name, status, owner) "
            "VALUES (%s, %s, %s, %s, %s)",
            (
                invocation.invocation_id,
                invocation.toolkit_name,
                invocation.tool_name,
                invocation.status,
                self.owner,
            ),
        )

    async def get(
        self, toolkit_name: str, tool_name: str, invocation_id: str
    ) -> Invocation | None:
        rows = await self._fetch(
            "SELECT invocation_id, toolkit_name, tool_name, status, "
            "       stop_requested, result, "
            "       EXTRACT(EPOCH FROM finished_at) "
            "FROM invocations "
            "WHERE toolkit_name = %s AND tool_name = %s AND invocation_id = %s",
            (toolkit_name, tool_name, invocation_id),
        )
        if not rows:
            return None
        row = rows[0]
        return Invocation(
            invocation_id=row[0],
            toolkit_name=row[1],
            tool_name=row[2],
            status=row[3],
            stop_requested=bool(row[4]),
            result=row[5],
            finished_at=float(row[6]) if row[6] is not None else None,
        )

    async def update(self, invocation: Invocation) -> None:
        """Write the row back.

        Unlike the in-memory store — where the dataclass IS the state and this
        was a no-op — here it is the only thing that persists a change. A
        caller that mutates an :class:`Invocation` and forgets to call this
        gets an object that disagrees with the database, which is exactly the
        bug the no-op version could not have.
        """
        await self._run(
            "UPDATE invocations SET status = %s, stop_requested = %s, "
            "       result = %s, "
            "       finished_at = CASE WHEN %s THEN now() ELSE finished_at END "
            "WHERE invocation_id = %s",
            (
                invocation.status,
                invocation.stop_requested,
                json.dumps(invocation.result) if invocation.result else None,
                invocation.is_terminal(),
                invocation.invocation_id,
            ),
        )

    # -- events -----------------------------------------------------------

    async def append_event(self, invocation_id: str, message: str) -> None:
        await self._run(
            "INSERT INTO invocation_events (invocation_id, message) VALUES (%s, %s)",
            (invocation_id, message),
        )

    async def drain_events(self, invocation: Invocation) -> list[dict[str, Any]]:
        """Return and remove this invocation's pending events, atomically.

        One statement, so the read and the clear cannot interleave with
        another poller's.
        """
        rows = await self._fetch(
            "DELETE FROM invocation_events WHERE invocation_id = %s "
            "RETURNING message, id",
            (invocation.invocation_id,),
        )
        rows.sort(key=lambda row: row[1])
        return [{"data": {"message": row[0]}} for row in rows]

    # -- housekeeping -----------------------------------------------------

    async def prune(self, older_than_seconds: float) -> int:
        rows = await self._fetch(
            "DELETE FROM invocations "
            "WHERE finished_at IS NOT NULL "
            "  AND finished_at < now() - make_interval(secs => %s) "
            "RETURNING invocation_id",
            (float(older_than_seconds),),
        )
        return len(rows)

    async def reconcile_orphans(self) -> int:
        """Terminate in-flight rows left behind by a previous owner.

        Called at startup. A row still ``pending``/``running`` under a
        different owner is work no live process is doing; leaving it would make
        a poll return ``InProgress`` forever. It becomes a terminal error whose
        message says what happened, which is an answer the caller can act on.
        """
        from ..errors import tool_error  # noqa: PLC0415

        rows = await self._fetch(
            "SELECT invocation_id, tool_name FROM invocations "
            "WHERE finished_at IS NULL AND owner IS DISTINCT FROM %s",
            (self.owner,),
        )
        for invocation_id, tool_name in rows:
            body = tool_error(
                invocation_id,
                tool_name,
                RuntimeError(
                    "The service restarted while this invocation was running, "
                    "so it did not complete. Start it again."
                ),
            )
            await self._run(
                "UPDATE invocations SET status = %s, result = %s, "
                "       finished_at = now(), owner = %s "
                "WHERE invocation_id = %s",
                (InvocationStatus.STOPPED, json.dumps(body), self.owner, invocation_id),
            )

        if rows:
            logger.warning(
                "reconciled %d invocation(s) orphaned by a previous process", len(rows)
            )
        return len(rows)

    async def count(self) -> int:
        rows = await self._fetch("SELECT count(*) FROM invocations", ())
        return int(rows[0][0])

    # -- plumbing ---------------------------------------------------------

    async def _run(self, sql: str, params: tuple) -> None:
        await self._fetch(sql, params, expect_rows=False)

    async def _fetch(
        self, sql: str, params: tuple, *, expect_rows: bool = True
    ) -> list[tuple]:
        import asyncio  # noqa: PLC0415

        def work() -> list[tuple]:
            connection = self._connect()
            try:
                with connection.cursor() as cursor:
                    cursor.execute(sql, params)
                    rows = (
                        cursor.fetchall()
                        if expect_rows and cursor.description is not None
                        else []
                    )
                connection.commit()
                return rows
            finally:
                connection.close()

        # psycopg is synchronous; the event loop must not block on it, and the
        # engine already runs its own work in threads.
        return await asyncio.to_thread(work)


def build_store(database_url: str) -> PostgresInvocationStore:
    import psycopg  # noqa: PLC0415

    return PostgresInvocationStore(lambda: psycopg.connect(database_url))


__all__ = ["PostgresInvocationStore", "build_store"]
