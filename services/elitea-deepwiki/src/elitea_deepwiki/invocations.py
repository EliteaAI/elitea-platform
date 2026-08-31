"""The invocation registry and its job manager — the arbiter TaskNode's successor.

The legacy service tracked invocations in an Arbiter ``TaskNode`` over a mock
event node, with an in-process dict keyed
``toolkit -> tool -> invocation_id``, a ``stop_requested`` flag, a list of
custom events drained on read, tracked subprocesses, a stored terminal result
and roughly one hour of retention. ADR-0022 decision 1 says none of Arbiter
survives; this module is the replacement.

What is preserved exactly, because the P0 SPI fixtures pin it:

* the state vocabulary ``pending / running / stopped / pruned`` and its
  projection onto the wire (``Started`` / ``InProgress`` / terminal result);
* ``custom_events`` accumulate and are **drained on read**;
* cancel sets a flag and returns 204 — the work stops cooperatively at the
  next checkpoint;
* a terminal result is returned on every poll until the entry is pruned;
* an unknown toolkit, tool or id are indistinguishable — all 404.

What is deliberately different: the store is behind
:class:`InvocationStore`, an interface with an in-memory implementation. The
spec's durable-operation-state requirement (a restarted service must not
reinterpret a known accepted operation as never having existed) is satisfied by
a later PostgreSQL implementation of this same interface, not by another
rewrite of the routes. The in-memory store is honest about that: see
:attr:`InvocationStore.durable`.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable, Iterable, Protocol

logger = logging.getLogger(__name__)

#: Legacy retention for a terminal task, in seconds. After this the entry is
#: pruned and further polls 404 — the legacy ``task_retention_period``.
DEFAULT_RETENTION_SECONDS = 3600

#: How often the housekeeping loop prunes expired entries (legacy
#: ``housekeeping_interval``).
DEFAULT_HOUSEKEEPING_INTERVAL = 60

#: Legacy ident prefix, kept so an invocation id is recognisable in logs on
#: both sides of the port.
INVOCATION_ID_PREFIX = "invocation_"


class InvocationStatus:
    """The legacy task-state vocabulary."""

    PENDING = "pending"
    RUNNING = "running"
    STOPPED = "stopped"


#: Wire projection of an in-flight status. Terminal invocations return their
#: stored result instead.
WIRE_STATUS = {
    InvocationStatus.PENDING: "Started",
    InvocationStatus.RUNNING: "InProgress",
}


def new_invocation_id() -> str:
    """Mint an invocation id in the legacy shape."""
    return f"{INVOCATION_ID_PREFIX}{uuid.uuid4().hex}"


@dataclass
class Invocation:
    """One accepted invocation."""

    invocation_id: str
    toolkit_name: str
    tool_name: str
    status: str = InvocationStatus.PENDING
    created_at: float = field(default_factory=time.monotonic)
    finished_at: float | None = None
    stop_requested: bool = False
    custom_events: list[dict[str, Any]] = field(default_factory=list)
    result: dict[str, Any] | None = None

    def is_terminal(self) -> bool:
        return self.status == InvocationStatus.STOPPED


class InvocationCancelled(Exception):
    """Raised inside a running tool when cancellation was requested.

    The legacy engine raised Arbiter's ``InterruptTaskThread`` from
    ``invocation_stop_checkpoint()``; this is the same cooperative signal
    without the Arbiter dependency.
    """


class InvocationStore(Protocol):
    """Where invocation state lives.

    ``durable`` tells the health endpoint — and any operator reading it —
    whether a restart loses accepted operations. It is ``False`` for the
    in-memory store on purpose: reporting an in-memory store as durable is
    exactly the false-green this port is trying not to ship.
    """

    durable: bool

    async def create(self, invocation: Invocation) -> None: ...

    async def get(
        self, toolkit_name: str, tool_name: str, invocation_id: str
    ) -> Invocation | None: ...

    async def update(self, invocation: Invocation) -> None: ...

    async def drain_events(self, invocation: Invocation) -> list[dict[str, Any]]: ...

    async def prune(self, older_than_seconds: float) -> int: ...


class InMemoryInvocationStore:
    """Process-local store, matching legacy behaviour exactly.

    Keyed ``toolkit -> tool -> invocation_id`` like the legacy dict, so the
    404-on-any-mismatch behaviour falls out of the same shape rather than
    being re-implemented.
    """

    durable = False

    def __init__(self) -> None:
        self._state: dict[str, dict[str, dict[str, Invocation]]] = {}
        self._lock = asyncio.Lock()

    async def create(self, invocation: Invocation) -> None:
        async with self._lock:
            self._state.setdefault(invocation.toolkit_name, {}).setdefault(
                invocation.tool_name, {}
            )[invocation.invocation_id] = invocation

    async def get(
        self, toolkit_name: str, tool_name: str, invocation_id: str
    ) -> Invocation | None:
        async with self._lock:
            return (
                self._state.get(toolkit_name, {})
                .get(tool_name, {})
                .get(invocation_id)
            )

    async def update(self, invocation: Invocation) -> None:
        # The dataclass is stored by reference; mutations are already visible.
        # The method exists so a durable implementation has a write point.
        return None

    async def drain_events(self, invocation: Invocation) -> list[dict[str, Any]]:
        async with self._lock:
            events = list(invocation.custom_events)
            invocation.custom_events.clear()
            return events

    async def prune(self, older_than_seconds: float) -> int:
        cutoff = time.monotonic() - older_than_seconds
        removed = 0
        async with self._lock:
            for tools in self._state.values():
                for invocations in tools.values():
                    expired = [
                        key
                        for key, inv in invocations.items()
                        if inv.finished_at is not None and inv.finished_at < cutoff
                    ]
                    for key in expired:
                        del invocations[key]
                        removed += 1
        return removed

    async def count(self) -> int:
        async with self._lock:
            return sum(
                len(invocations)
                for tools in self._state.values()
                for invocations in tools.values()
            )


ToolCall = Callable[["InvocationContext"], Awaitable[dict[str, Any]]]


class InvocationContext:
    """What a running tool is handed.

    Replaces the legacy module-level ``tasknode_task`` import plus the
    ``invocation_thinking`` / ``invocation_stop_checkpoint`` /
    ``invocation_process_add`` methods bound to the Pylon module. Passing it
    explicitly is the point: the legacy versions silently did nothing when the
    ambient task context was missing, so a lost progress event looked exactly
    like a tool that emitted none.
    """

    def __init__(self, invocation: Invocation, manager: "InvocationManager") -> None:
        self._invocation = invocation
        self._manager = manager

    @property
    def invocation_id(self) -> str:
        return self._invocation.invocation_id

    @property
    def toolkit_name(self) -> str:
        return self._invocation.toolkit_name

    @property
    def tool_name(self) -> str:
        return self._invocation.tool_name

    async def thinking(self, message: str) -> None:
        """Emit one progress event (legacy ``invocation_thinking``)."""
        self._invocation.custom_events.append({"data": {"message": message}})
        await self._manager.store.update(self._invocation)

    async def checkpoint(self) -> None:
        """Cooperative cancellation point (legacy ``invocation_stop_checkpoint``)."""
        if self._invocation.stop_requested:
            raise InvocationCancelled(self._invocation.invocation_id)

    @property
    def stop_requested(self) -> bool:
        return self._invocation.stop_requested


class InvocationManager:
    """Accepts invocations, runs them, and answers polls."""

    def __init__(
        self,
        store: InvocationStore | None = None,
        *,
        retention_seconds: float = DEFAULT_RETENTION_SECONDS,
        housekeeping_interval: float = DEFAULT_HOUSEKEEPING_INTERVAL,
    ) -> None:
        self.store: InvocationStore = store or InMemoryInvocationStore()
        self.retention_seconds = retention_seconds
        self.housekeeping_interval = housekeeping_interval
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._housekeeper: asyncio.Task[None] | None = None

    # -- lifecycle ---------------------------------------------------------

    async def start(self) -> None:
        if self._housekeeper is None:
            self._housekeeper = asyncio.create_task(self._housekeeping_loop())

    async def stop(self) -> None:
        """Cancel the housekeeper and every in-flight invocation."""
        if self._housekeeper is not None:
            self._housekeeper.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await self._housekeeper
            self._housekeeper = None

        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        for task in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await task
        self._tasks.clear()

    async def _housekeeping_loop(self) -> None:
        while True:
            try:
                await asyncio.sleep(self.housekeeping_interval)
                removed = await self.store.prune(self.retention_seconds)
                if removed:
                    logger.info("pruned %d terminal invocations", removed)
            except asyncio.CancelledError:
                raise
            except Exception:  # pragma: no cover - housekeeping must not die
                logger.exception("invocation housekeeping failed")

    # -- accept ------------------------------------------------------------

    async def submit(
        self, toolkit_name: str, tool_name: str, call: ToolCall
    ) -> Invocation:
        """Accept an invocation and start it. Returns immediately.

        The legacy service was async unconditionally — ``routes/invoke.py``
        never consulted ``sync_invocation_supported`` — and this keeps that.
        """
        invocation = Invocation(
            invocation_id=new_invocation_id(),
            toolkit_name=toolkit_name,
            tool_name=tool_name,
        )
        await self.store.create(invocation)
        task = asyncio.create_task(self._run(invocation, call))
        self._tasks[invocation.invocation_id] = task
        task.add_done_callback(
            lambda _t, key=invocation.invocation_id: self._tasks.pop(key, None)
        )
        return invocation

    async def _run(self, invocation: Invocation, call: ToolCall) -> None:
        from . import errors  # local import: avoids a cycle at module load

        invocation.status = InvocationStatus.RUNNING
        await self.store.update(invocation)
        context = InvocationContext(invocation, self)

        try:
            result = await call(context)
        except InvocationCancelled:
            result = errors.tool_error(
                invocation.invocation_id,
                invocation.tool_name,
                RuntimeError("Invocation cancelled"),
            )
        except asyncio.CancelledError:
            # Service shutdown. Record a terminal result so a poll that
            # survives the restart is not told the invocation never existed.
            invocation.status = InvocationStatus.STOPPED
            invocation.finished_at = time.monotonic()
            invocation.result = errors.tool_error(
                invocation.invocation_id,
                invocation.tool_name,
                RuntimeError("Service stopped while the invocation was running"),
            )
            await self.store.update(invocation)
            raise
        except Exception as exc:  # the tool's own failure
            result = errors.tool_error(
                invocation.invocation_id, invocation.tool_name, exc
            )

        invocation.status = InvocationStatus.STOPPED
        invocation.finished_at = time.monotonic()
        invocation.result = result
        await self.store.update(invocation)

    # -- poll / cancel -----------------------------------------------------

    async def poll(
        self, toolkit_name: str, tool_name: str, invocation_id: str
    ) -> dict[str, Any] | None:
        """Return the wire body for a poll, or ``None`` when unknown (404)."""
        invocation = await self.store.get(toolkit_name, tool_name, invocation_id)
        if invocation is None:
            return None

        events = await self.store.drain_events(invocation)
        envelope = {"custom_events": events} if events else {}

        if not invocation.is_terminal():
            return {
                "invocation_id": invocation_id,
                "status": WIRE_STATUS[invocation.status],
                **envelope,
            }

        # Terminal: the legacy route returned the stored result verbatim. Any
        # events that arrived since the last poll ride along with it, which is
        # the only way a caller that polls once ever sees them.
        assert invocation.result is not None
        return {**invocation.result, **envelope}

    async def cancel(
        self, toolkit_name: str, tool_name: str, invocation_id: str
    ) -> bool:
        """Request cooperative cancellation. ``False`` when unknown (404)."""
        invocation = await self.store.get(toolkit_name, tool_name, invocation_id)
        if invocation is None:
            return False
        invocation.stop_requested = True
        await self.store.update(invocation)
        return True

    def in_flight(self) -> int:
        return len(self._tasks)

    def in_flight_ids(self) -> Iterable[str]:
        return tuple(self._tasks)
