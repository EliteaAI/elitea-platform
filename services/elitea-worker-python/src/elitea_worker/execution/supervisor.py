"""Worker execution admission, drain, and synchronous SDK ownership."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any, Protocol, TypeVar

from elitea_worker.execution.sync_executor import (
    BoundedAdmissionGate,
    BoundedSyncExecutor,
    SyncExecutorReservation,
)

T = TypeVar("T")


class ExecutionRunner(Protocol):
    async def run(self, operation: Callable[[], Awaitable[T]]) -> T: ...

    async def run_sync(
        self,
        operation: Callable[..., T],
        /,
        *args: Any,
        **kwargs: Any,
    ) -> T: ...

    async def reserve_sync(self) -> SyncExecutorReservation: ...


class ExecutionSupervisor:
    """Bounds whole deliveries and owns the side-effect-free sync bridge."""

    def __init__(
        self,
        *,
        max_workers: int,
        max_in_flight: int,
        admission_timeout_seconds: float,
        drain_timeout_seconds: float,
        max_deliveries: int | None = None,
    ) -> None:
        if drain_timeout_seconds <= 0:
            raise ValueError("drain timeout must be positive")
        delivery_capacity = max_in_flight if max_deliveries is None else max_deliveries
        self._admission = BoundedAdmissionGate(
            capacity=delivery_capacity,
            timeout_seconds=admission_timeout_seconds,
        )
        self._sync = BoundedSyncExecutor(
            max_workers=max_workers,
            max_in_flight=max_in_flight,
            admission_timeout_seconds=admission_timeout_seconds,
            drain_timeout_seconds=drain_timeout_seconds,
        )
        self._drain_timeout = drain_timeout_seconds
        self._active = 0
        self._drained = asyncio.Event()
        self._drained.set()
        self._closed = False
        self._close_task: asyncio.Task[None] | None = None

    async def run(self, operation: Callable[[], Awaitable[T]]) -> T:
        await self._admission.acquire()
        self._active += 1
        self._drained.clear()
        try:
            return await operation()
        finally:
            self._active -= 1
            self._admission.release()
            if self._active == 0:
                self._drained.set()

    async def run_sync(
        self,
        operation: Callable[..., T],
        /,
        *args: Any,
        **kwargs: Any,
    ) -> T:
        return await self._sync.run(operation, *args, **kwargs)

    async def reserve_sync(self) -> SyncExecutorReservation:
        return await self._sync.reserve()

    def stop_admission(self) -> None:
        """Reject and wake whole-delivery and synchronous-call waiters."""
        self._admission.stop()
        self._sync.stop_admission()

    async def drain(self, *, timeout_seconds: float | None = None) -> None:
        timeout = self._drain_timeout if timeout_seconds is None else timeout_seconds
        if timeout <= 0:
            raise ValueError("drain timeout must be positive")
        deadline = asyncio.get_running_loop().time() + timeout
        await self._drain_until(deadline)

    async def shutdown(self, *, timeout_seconds: float | None = None) -> None:
        if self._closed:
            return
        loop = asyncio.get_running_loop()
        close_task = self._close_task
        if close_task is None:
            close_task = loop.create_task(
                self._close(timeout_seconds=timeout_seconds),
                name="elitea-execution-supervisor-close",
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

    async def __aenter__(self) -> ExecutionSupervisor:
        await self._sync.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        await self.shutdown()

    async def _drain_until(self, deadline: float) -> None:
        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError("execution supervisor did not drain before the deadline")
        try:
            await asyncio.wait_for(self._drained.wait(), timeout=remaining)
        except TimeoutError as exc:
            raise TimeoutError(
                "execution supervisor did not drain before the deadline"
            ) from exc

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError("execution supervisor did not drain before the deadline")
        try:
            await self._sync.drain(timeout_seconds=remaining)
        except TimeoutError as exc:
            raise TimeoutError(
                "execution supervisor did not drain before the deadline"
            ) from exc

    async def _close(self, *, timeout_seconds: float | None) -> None:
        timeout = self._drain_timeout if timeout_seconds is None else timeout_seconds
        if timeout <= 0:
            raise ValueError("drain timeout must be positive")
        deadline = asyncio.get_running_loop().time() + timeout
        self.stop_admission()
        await self._drain_until(deadline)

        remaining = deadline - asyncio.get_running_loop().time()
        if remaining <= 0:
            raise TimeoutError("execution supervisor did not close before the deadline")
        await self._sync.shutdown(timeout_seconds=remaining)
        self._closed = True

    def _reset_failed_close(self, close_task: asyncio.Task[None]) -> None:
        if not close_task.done():
            return
        if close_task.cancelled() or close_task.exception() is not None:
            if self._close_task is close_task:
                self._close_task = None


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
