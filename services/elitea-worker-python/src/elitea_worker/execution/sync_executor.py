"""Bounded ownership bridge for synchronous, side-effect-free SDK validation.

This bridge is not sufficient by itself for effecting provider work. Such work
also needs durable effect identity, idempotency and cancellation/recovery rules
before a queued or monitor-driven failure can safely release ownership.
"""

from __future__ import annotations

import asyncio
from collections import deque
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from contextvars import ContextVar, Token, copy_context
from typing import Any, TypeVar

T = TypeVar("T")


class SyncExecutorAdmissionRejected(Exception):
    """The worker did not admit synchronous work before it began."""


class SyncExecutorSaturated(SyncExecutorAdmissionRejected):
    """The bounded running-plus-queued capacity remained full."""


class SyncExecutorNotAccepting(SyncExecutorAdmissionRejected):
    """The executor has entered drain or has shut down."""


class SyncExecutorReservation:
    """One task-bound executor slot reserved before durable execution begins."""

    def __init__(
        self,
        *,
        admission: BoundedAdmissionGate,
        variable: ContextVar[SyncExecutorReservation | None],
        token: Token[SyncExecutorReservation | None],
        owner: asyncio.Task[Any],
    ) -> None:
        self._admission = admission
        self._variable = variable
        self._token = token
        self._owner = owner
        self._consumed = False
        self._released = False

    def release(self) -> None:
        if self._released:
            return
        if asyncio.current_task() is not self._owner:
            raise RuntimeError("executor reservation cannot move between tasks")
        self._released = True
        self._variable.reset(self._token)
        if not self._consumed:
            self._admission.release()

    def _consume(self) -> None:
        if (
            self._released
            or self._consumed
            or asyncio.current_task() is not self._owner
        ):
            raise RuntimeError("executor reservation is not available")
        self._consumed = True


class BoundedAdmissionGate:
    """Event-loop-owned admission with bounded wait and deterministic drain wakeup."""

    def __init__(self, *, capacity: int, timeout_seconds: float) -> None:
        if (
            isinstance(capacity, bool)
            or not isinstance(capacity, int)
            or capacity < 1
            or timeout_seconds <= 0
        ):
            raise ValueError("admission limits are invalid")
        self._capacity = capacity
        self._available = capacity
        self._timeout = timeout_seconds
        self._accepting = True
        self._owner_loop: asyncio.AbstractEventLoop | None = None
        self._waiters: deque[asyncio.Future[bool]] = deque()

    async def acquire(self) -> None:
        loop = self._owned_running_loop()
        if not self._accepting:
            raise SyncExecutorNotAccepting()
        if self._available:
            self._available -= 1
            return

        waiter: asyncio.Future[bool] = loop.create_future()
        self._waiters.append(waiter)
        try:
            admitted = await asyncio.wait_for(
                asyncio.shield(waiter),
                timeout=self._timeout,
            )
        except TimeoutError as exc:
            self._withdraw(waiter)
            raise SyncExecutorSaturated() from exc
        except asyncio.CancelledError:
            self._withdraw(waiter)
            raise
        if not admitted:
            raise SyncExecutorNotAccepting()

    def release(self) -> None:
        if self._accepting:
            while self._waiters:
                waiter = self._waiters.popleft()
                if not waiter.done():
                    waiter.set_result(True)
                    return
        if self._available >= self._capacity:
            raise RuntimeError("admission capacity was released more than once")
        self._available += 1

    def stop(self) -> None:
        self._accepting = False
        while self._waiters:
            waiter = self._waiters.popleft()
            if not waiter.done():
                waiter.set_result(False)

    def _withdraw(self, waiter: asyncio.Future[bool]) -> None:
        if waiter.done() and not waiter.cancelled():
            if waiter.result():
                self.release()
            return
        waiter.cancel()
        try:
            self._waiters.remove(waiter)
        except ValueError:
            pass

    def _owned_running_loop(self) -> asyncio.AbstractEventLoop:
        loop = asyncio.get_running_loop()
        if self._owner_loop is None:
            self._owner_loop = loop
        elif self._owner_loop is not loop:
            raise RuntimeError("admission gate cannot move between event loops")
        return loop


class BoundedSyncExecutor:
    """Owns one dedicated pool and bounds every running or queued future."""

    def __init__(
        self,
        *,
        max_workers: int,
        max_in_flight: int,
        admission_timeout_seconds: float,
        drain_timeout_seconds: float,
    ) -> None:
        if (
            isinstance(max_workers, bool)
            or not isinstance(max_workers, int)
            or max_workers < 1
            or isinstance(max_in_flight, bool)
            or not isinstance(max_in_flight, int)
            or max_in_flight < max_workers
            or admission_timeout_seconds <= 0
            or drain_timeout_seconds <= 0
        ):
            raise ValueError("synchronous executor limits are invalid")
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix="elitea-sdk-sync",
        )
        self._admission = BoundedAdmissionGate(
            capacity=max_in_flight,
            timeout_seconds=admission_timeout_seconds,
        )
        self._drain_timeout = drain_timeout_seconds
        self._closed = False
        self._close_task: asyncio.Task[None] | None = None
        self._owner_loop: asyncio.AbstractEventLoop | None = None
        self._futures: set[Future[Any]] = set()
        self._reservation: ContextVar[SyncExecutorReservation | None] = ContextVar(
            f"elitea_sync_executor_reservation_{id(self)}",
            default=None,
        )
        self._drained = asyncio.Event()
        self._drained.set()

    async def reserve(self) -> SyncExecutorReservation:
        """Reserve one running-or-queued slot before a durable start RPC."""

        self._owned_running_loop()
        if self._closed:
            raise SyncExecutorNotAccepting()
        if self._reservation.get() is not None:
            raise RuntimeError("this task already owns an executor reservation")
        await self._admission.acquire()
        if self._closed:
            self._admission.release()
            raise SyncExecutorNotAccepting()
        owner = asyncio.current_task()
        if owner is None:
            self._admission.release()
            raise RuntimeError("executor reservation requires an asyncio task")
        reservation = SyncExecutorReservation.__new__(SyncExecutorReservation)
        token = self._reservation.set(reservation)
        SyncExecutorReservation.__init__(
            reservation,
            admission=self._admission,
            variable=self._reservation,
            token=token,
            owner=owner,
        )
        return reservation

    async def run(
        self,
        operation: Callable[..., T],
        /,
        *args: Any,
        **kwargs: Any,
    ) -> T:
        loop = self._owned_running_loop()
        if self._closed:
            raise SyncExecutorNotAccepting()

        admitted = False
        submitted: Future[T] | None = None
        try:
            reservation = self._reservation.get()
            if (
                reservation is None
                or asyncio.current_task() is not reservation._owner
            ):
                await self._admission.acquire()
                admitted = True
            else:
                reservation._consume()
                admitted = True

            if self._closed:
                raise SyncExecutorNotAccepting()

            context = copy_context()
            completion: asyncio.Future[None] = loop.create_future()
            submitted = self._executor.submit(
                context.run,
                operation,
                *args,
                **kwargs,
            )
            self._futures.add(submitted)
            self._drained.clear()
            submitted.add_done_callback(
                lambda future: loop.call_soon_threadsafe(
                    self._complete,
                    future,
                    completion,
                )
            )
            admitted = False

            try:
                await asyncio.shield(completion)
            except asyncio.CancelledError:
                # A queued future can be cancelled without touching any sibling.
                # A running Python thread cannot: retain coroutine/lease ownership
                # until the actual callable exits, then propagate cancellation.
                submitted.cancel()
                await _wait_for_completion(completion)
                raise
            return submitted.result()
        finally:
            if admitted:
                self._admission.release()

    def stop_admission(self) -> None:
        """Reject new calls and wake existing admission waiters."""
        self._admission.stop()

    async def drain(self, *, timeout_seconds: float | None = None) -> None:
        self._owned_running_loop()
        timeout = self._drain_timeout if timeout_seconds is None else timeout_seconds
        if timeout <= 0:
            raise ValueError("drain timeout must be positive")
        try:
            await asyncio.wait_for(self._drained.wait(), timeout=timeout)
        except TimeoutError as exc:
            raise TimeoutError("synchronous executor did not drain before the deadline") from exc

    async def shutdown(self, *, timeout_seconds: float | None = None) -> None:
        if self._closed:
            return
        loop = self._owned_running_loop()
        close_task = self._close_task
        if close_task is None:
            close_task = loop.create_task(
                self._close(timeout_seconds=timeout_seconds),
                name="elitea-sync-executor-close",
            )
            self._close_task = close_task
        try:
            await asyncio.shield(close_task)
        except asyncio.CancelledError:
            await _wait_for_task_completion(close_task)
            self._reset_failed_close(close_task)
            raise
        except BaseException:
            self._reset_failed_close(close_task)
            raise

    async def __aenter__(self) -> BoundedSyncExecutor:
        self._owned_running_loop()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        await self.shutdown()

    def _owned_running_loop(self) -> asyncio.AbstractEventLoop:
        loop = asyncio.get_running_loop()
        if self._owner_loop is None:
            self._owner_loop = loop
        elif self._owner_loop is not loop:
            raise RuntimeError("synchronous executor cannot move between event loops")
        return loop

    def _complete(
        self,
        future: Future[Any],
        completion: asyncio.Future[None],
    ) -> None:
        if future not in self._futures:
            return
        self._futures.remove(future)
        self._admission.release()
        if not self._futures:
            self._drained.set()
        if not completion.done():
            completion.set_result(None)

    async def _close(self, *, timeout_seconds: float | None) -> None:
        self.stop_admission()
        await self.drain(timeout_seconds=timeout_seconds)
        self._executor.shutdown(wait=True, cancel_futures=False)
        self._closed = True

    def _reset_failed_close(self, close_task: asyncio.Task[None]) -> None:
        if not close_task.done():
            return
        if close_task.cancelled() or close_task.exception() is not None:
            if self._close_task is close_task:
                self._close_task = None


async def _wait_for_completion(completion: asyncio.Future[None]) -> None:
    while not completion.done():
        try:
            await asyncio.shield(completion)
        except asyncio.CancelledError:
            # Repeated caller cancellation cannot abandon a still-running thread.
            continue


async def _wait_for_task_completion(task: asyncio.Task[None]) -> None:
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            continue
        except BaseException:
            break
    if task.done() and not task.cancelled():
        task.exception()
