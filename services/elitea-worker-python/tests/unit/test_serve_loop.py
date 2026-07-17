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
        self._read = False
        self.reclaim_calls = 0

    async def read(self) -> tuple[RedisCommandDelivery, ...]:
        if not self._read:
            self._read = True
            return self._deliveries
        await asyncio.Event().wait()
        return ()

    async def reclaim_page(self, *, min_idle_ms: int, start_id: str = "0-0"):
        self.reclaim_calls += 1
        return "0-0", self._deliveries[:1]


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
        await runtime.run(stop)

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
            while consumer.reclaim_calls == 0:
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
        await runtime.run(stop)

        assert calls == 1

    asyncio.run(run())


def test_serve_loop_reclaims_pending_delivery_without_new_read() -> None:
    async def run() -> None:
        delivery = RedisCommandDelivery(
            "commands.v1",
            "1-0",
            {"signed_envelope": b"reference"},
        )

        class ReclaimOnly(FakeConsumer):
            async def read(self):
                await asyncio.Event().wait()

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
