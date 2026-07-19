from __future__ import annotations

import asyncio
import hashlib
from types import SimpleNamespace

import pytest

import elitea_worker.serve as serve_module
from elitea_worker.execution.delivery import (
    DeliveryDisposition,
    DeliveryResult,
)
from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput
from elitea_worker.serve import (
    WorkerServeLoop,
    _ShutdownBudget,
    _close_runtime_resources,
    _prepare_execution_spool,
    _wait_for_redis,
)
from elitea_worker.transport.redis_commands import RedisCommandDelivery


class FakeConsumer:
    def __init__(self, deliveries: tuple[RedisCommandDelivery, ...]) -> None:
        self._deliveries = deliveries
        self._read_offset = 0
        self.read_counts: list[int] = []
        self.read_blocks: list[int] = []
        self.reclaim_counts: list[int] = []
        self.reclaim_calls = 0
        self.heartbeat_calls: list[tuple[str, ...]] = []

    @property
    def delivery_batch_size(self) -> int:
        return 2

    @property
    def heartbeat_batch_size(self) -> int:
        return 2

    async def read(
        self,
        *,
        count: int | None = None,
        block_ms: int | None = None,
    ) -> tuple[RedisCommandDelivery, ...]:
        assert count is not None
        assert block_ms is not None
        self.read_counts.append(count)
        self.read_blocks.append(block_ms)
        if self._read_offset < len(self._deliveries):
            end = self._read_offset + count
            deliveries = self._deliveries[self._read_offset : end]
            self._read_offset = end
            return deliveries
        await asyncio.sleep(block_ms / 1_000)
        return ()

    async def reclaim_page(
        self,
        *,
        min_idle_ms: int,
        start_id: str = "0-0",
        count: int | None = None,
    ):
        assert count is not None
        self.reclaim_counts.append(count)
        self.reclaim_calls += 1
        return "0-0", self._deliveries[:count][:1]

    async def heartbeat_pending(
        self,
        entry_ids: tuple[str, ...],
    ) -> tuple[str, ...]:
        self.heartbeat_calls.append(entry_ids)
        return entry_ids


def test_serve_loop_bounds_workers_and_drains() -> None:
    async def run() -> None:
        deliveries = tuple(
            RedisCommandDelivery(
                "commands.v1",
                f"{index}-0",
                {"signed_envelope": b"reference"},
            )
            for index in range(1, 4)
        )
        consumer = FakeConsumer(deliveries)
        stop = asyncio.Event()
        active = 0
        peak = 0
        processed: list[str] = []

        async def process(delivery: RedisCommandDelivery) -> DeliveryResult:
            nonlocal active, peak
            active += 1
            peak = max(peak, active)
            await asyncio.sleep(0.01)
            processed.append(delivery.entry_id)
            active -= 1
            if len(processed) == len(deliveries):
                stop.set()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=2,
            queue_capacity=2,
            reclaim_idle_millis=1,
            reclaim_interval_millis=100,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        await asyncio.wait_for(runtime.run(stop), timeout=0.2)

        assert sorted(processed) == ["1-0", "2-0", "3-0"]
        assert peak == 2

    asyncio.run(run())


def test_serve_loop_does_not_run_reclaimed_duplicate_concurrently() -> None:
    async def run() -> None:
        delivery = RedisCommandDelivery(
            "commands.v1",
            "1-0",
            {"signed_envelope": b"reference"},
        )
        consumer = FakeConsumer((delivery,))
        stop = asyncio.Event()
        calls = 0

        async def process(_: RedisCommandDelivery) -> DeliveryResult:
            nonlocal calls
            calls += 1
            while consumer.reclaim_calls == 0 or not consumer.heartbeat_calls:
                await asyncio.sleep(0)
            stop.set()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=1,
            queue_capacity=1,
            reclaim_idle_millis=1,
            reclaim_interval_millis=1,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        await asyncio.wait_for(runtime.run(stop), timeout=0.2)

        assert calls == 1
        assert consumer.reclaim_calls >= 1
        assert max(consumer.read_blocks) <= 1
        assert consumer.heartbeat_calls[0] == ("1-0",)

    asyncio.run(run())


def test_serve_loop_heartbeats_queued_and_active_entries_in_bounded_batches() -> None:
    async def run() -> None:
        deliveries = tuple(
            RedisCommandDelivery(
                "commands.v1",
                f"{index}-0",
                {"signed_envelope": b"reference"},
            )
            for index in range(1, 4)
        )
        consumer = FakeConsumer(deliveries)
        stop = asyncio.Event()

        async def process(_: RedisCommandDelivery) -> DeliveryResult:
            while len(consumer.heartbeat_calls) < 2:
                await asyncio.sleep(0)
            stop.set()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=1,
            queue_capacity=3,
            reclaim_idle_millis=100,
            reclaim_interval_millis=1,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        await runtime.run(stop)

        assert consumer.heartbeat_calls[:2] == [("1-0", "2-0"), ("3-0",)]

    asyncio.run(run())


def test_serve_loop_limits_fetch_to_unowned_delivery_capacity() -> None:
    async def run() -> None:
        deliveries = tuple(
            RedisCommandDelivery(
                "commands.v1",
                f"{index}-0",
                {"signed_envelope": b"reference"},
            )
            for index in range(1, 4)
        )

        class ThreeEntryBatch(FakeConsumer):
            @property
            def delivery_batch_size(self) -> int:
                return 3

            async def reclaim_page(
                self,
                *,
                min_idle_ms: int,
                start_id: str = "0-0",
                count: int | None = None,
            ):
                del min_idle_ms, count
                return start_id, ()

        consumer = ThreeEntryBatch(deliveries)
        stop = asyncio.Event()
        first_started = asyncio.Event()
        release_first = asyncio.Event()
        processed: list[str] = []

        async def process(delivery: RedisCommandDelivery) -> DeliveryResult:
            processed.append(delivery.entry_id)
            if delivery.entry_id == "1-0":
                first_started.set()
                await release_first.wait()
            if len(processed) == len(deliveries):
                stop.set()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=1,
            queue_capacity=1,
            reclaim_idle_millis=100,
            reclaim_interval_millis=1,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        running = asyncio.create_task(runtime.run(stop))
        await asyncio.wait_for(first_started.wait(), timeout=0.2)

        while not consumer.heartbeat_calls:
            await asyncio.sleep(0)
        assert consumer.read_counts == [2]
        assert consumer.heartbeat_calls[0] == ("1-0", "2-0")

        release_first.set()
        await asyncio.wait_for(running, timeout=0.5)
        assert processed == ["1-0", "2-0", "3-0"]

    asyncio.run(run())


def test_serve_loop_keeps_heartbeat_alive_while_shutdown_drains() -> None:
    async def run() -> None:
        delivery = RedisCommandDelivery(
            "commands.v1",
            "1-0",
            {"signed_envelope": b"reference"},
        )
        stop = asyncio.Event()
        heartbeat_after_stop = asyncio.Event()

        class ShutdownAwareConsumer(FakeConsumer):
            async def heartbeat_pending(
                self,
                entry_ids: tuple[str, ...],
            ) -> tuple[str, ...]:
                refreshed = await super().heartbeat_pending(entry_ids)
                if stop.is_set():
                    heartbeat_after_stop.set()
                return refreshed

        consumer = ShutdownAwareConsumer((delivery,))
        processing = asyncio.Event()
        release = asyncio.Event()

        async def process(_: RedisCommandDelivery) -> DeliveryResult:
            processing.set()
            await release.wait()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=1,
            queue_capacity=1,
            reclaim_idle_millis=100,
            reclaim_interval_millis=1,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        running = asyncio.create_task(runtime.run(stop))
        await asyncio.wait_for(processing.wait(), timeout=0.2)

        stop.set()
        await asyncio.wait_for(heartbeat_after_stop.wait(), timeout=0.2)
        assert not running.done()

        release.set()
        await asyncio.wait_for(running, timeout=0.2)

    asyncio.run(run())


def test_serve_loop_reclaims_pending_delivery_without_new_read() -> None:
    async def run() -> None:
        delivery = RedisCommandDelivery(
            "commands.v1",
            "1-0",
            {"signed_envelope": b"reference"},
        )

        class ReclaimOnly(FakeConsumer):
            async def read(
                self,
                *,
                count: int | None = None,
                block_ms: int | None = None,
            ):
                del count
                assert block_ms is not None
                await asyncio.sleep(block_ms / 1_000)
                return ()

        consumer = ReclaimOnly((delivery,))
        stop = asyncio.Event()
        processed: list[str] = []

        async def process(item: RedisCommandDelivery) -> DeliveryResult:
            processed.append(item.entry_id)
            stop.set()
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=process,
            max_concurrency=1,
            queue_capacity=1,
            reclaim_idle_millis=1,
            reclaim_interval_millis=1,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )
        await runtime.run(stop)

        assert processed == ["1-0"]
        assert consumer.reclaim_calls >= 1

    asyncio.run(run())


def test_serve_loop_fails_when_background_task_exits_unexpectedly() -> None:
    class ExitingHeartbeatRuntime(WorkerServeLoop):
        async def _heartbeat_loop(self) -> None:
            return

    async def run() -> None:
        consumer = FakeConsumer(())
        runtime = ExitingHeartbeatRuntime(
            consumer=consumer,
            process_delivery=lambda _delivery: asyncio.sleep(0),
            max_concurrency=1,
            queue_capacity=1,
            reclaim_idle_millis=100,
            reclaim_interval_millis=100,
            dependency_retry_millis=1,
            shutdown_timeout_millis=1000,
        )

        with pytest.raises(DependencyUnavailable, match="exited unexpectedly"):
            await asyncio.wait_for(runtime.run(asyncio.Event()), timeout=0.2)

    asyncio.run(run())


class _HungCloser:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def hang(self) -> None:
        self.started.set()
        try:
            await asyncio.Event().wait()
        finally:
            self.cancelled.set()


class _HungSupervisor(_HungCloser):
    def __init__(self) -> None:
        super().__init__()
        self.admission_stopped = False
        self.timeout_seconds: float | None = None

    def stop_admission(self) -> None:
        self.admission_stopped = True

    async def shutdown(self, *, timeout_seconds: float) -> None:
        self.timeout_seconds = timeout_seconds
        await self.hang()


class _HungHttpClient(_HungCloser):
    async def aclose(self) -> None:
        await self.hang()


class _HungChannel(_HungCloser):
    def __init__(self) -> None:
        super().__init__()
        self.grace: float | None = None

    async def close(self, *, grace: float) -> None:
        self.grace = grace
        await self.hang()


class _HungRedisClient(_HungCloser):
    async def aclose(self) -> None:
        await self.hang()


def test_runtime_dependency_closes_share_one_global_deadline() -> None:
    async def run() -> None:
        supervisor = _HungSupervisor()
        http_client = _HungHttpClient()
        control_channel = _HungChannel()
        output_channel = _HungChannel()
        redis_client = _HungRedisClient()
        closers = (
            supervisor,
            http_client,
            control_channel,
            output_channel,
            redis_client,
        )
        budget = _ShutdownBudget(timeout_seconds=0.05)
        budget.arm()
        started = asyncio.get_running_loop().time()

        with pytest.raises(DependencyUnavailable, match="shutdown deadline"):
            await _close_runtime_resources(
                supervisor=supervisor,  # type: ignore[arg-type]
                http_client=http_client,  # type: ignore[arg-type]
                control_channel=control_channel,  # type: ignore[arg-type]
                output_channel=output_channel,  # type: ignore[arg-type]
                redis_client=redis_client,  # type: ignore[arg-type]
                budget=budget,
            )

        elapsed = asyncio.get_running_loop().time() - started
        await asyncio.sleep(0)
        assert elapsed < 0.2
        assert supervisor.admission_stopped
        assert all(closer.started.is_set() for closer in closers)
        assert all(closer.cancelled.is_set() for closer in closers)
        assert supervisor.timeout_seconds is not None
        assert supervisor.timeout_seconds <= 0.05
        assert control_channel.grace is not None
        assert control_channel.grace <= 0.05
        assert output_channel.grace is not None
        assert output_channel.grace <= 0.05

    asyncio.run(run())


def test_shutdown_interrupts_hung_redis_startup_ping() -> None:
    class HungRedis:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.cancelled = asyncio.Event()

        async def ping(self) -> bool:
            self.started.set()
            try:
                await asyncio.Event().wait()
            finally:
                self.cancelled.set()
            return True

    async def run() -> None:
        redis = HungRedis()
        stop = asyncio.Event()
        config = SimpleNamespace(
            limits=SimpleNamespace(dependency_retry_millis=1000)
        )
        waiting = asyncio.create_task(
            _wait_for_redis(redis, config, stop)  # type: ignore[arg-type]
        )
        await redis.started.wait()
        stop.set()

        assert await asyncio.wait_for(waiting, timeout=0.2) is False
        await asyncio.sleep(0)
        assert redis.cancelled.is_set()

    asyncio.run(run())


def test_execution_spool_rejects_existing_directory_symlink(tmp_path) -> None:
    root = tmp_path / "spool"
    root.mkdir(mode=0o700)
    outside = tmp_path / "outside"
    outside.mkdir(mode=0o700)
    binding = b"execution-binding"
    derived = root / hashlib.sha256(binding).hexdigest()
    derived.symlink_to(outside, target_is_directory=True)

    with pytest.raises(InvalidInput, match="unsafe"):
        _prepare_execution_spool(root, binding)


def test_serve_deployment_maps_cleanup_failure_to_safe_error(monkeypatch) -> None:
    async def fail_during_cleanup(_config, *, stop=None) -> None:
        del stop
        raise OSError("private-runtime-path-must-not-leak")

    monkeypatch.setattr(serve_module, "_serve_deployment_inner", fail_during_cleanup)

    async def run() -> None:
        with pytest.raises(DependencyUnavailable) as caught:
            await serve_module.serve_deployment(object())  # type: ignore[arg-type]

        assert caught.value.safe_message == "A required runtime dependency is unavailable."
        assert "private-runtime-path-must-not-leak" not in str(caught.value)

    asyncio.run(run())
