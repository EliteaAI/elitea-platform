"""Production ``elitea-worker serve`` composition and bounded intake loop."""

from __future__ import annotations

import asyncio
import hashlib
import json
import signal
import sys
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

import grpc
import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from elitea.runtime.v1 import command_pb2, control_pb2_grpc, output_pb2_grpc

from elitea_worker.agents.sdk_adapter import EliteaSdkAdapter
from elitea_worker.config import (
    RuntimeDeployConfig,
    load_deploy_config,
    validate_private_directory,
)
from elitea_worker.execution.delivery import (
    ConfigurationValidationDeliveryProcessor,
    DeliveryDisposition,
    DeliveryResult,
)
from elitea_worker.execution.errors import DependencyUnavailable, WorkerError
from elitea_worker.execution.supervisor import ExecutionSupervisor
from elitea_worker.handlers.validation import ConfigurationValidationHandler
from elitea_worker.protocol.codec import (
    Ed25519CommandAuthenticator,
    parse_and_verify_signed_command,
)
from elitea_worker.security import RuntimeTrustMaterial
from elitea_worker.transport.control_grpc import (
    ExecutionControlClient,
    secure_control_channel,
)
from elitea_worker.transport.input_content import (
    ClaimBoundInputRequestBuilder,
    ScopedInputContentClient,
)
from elitea_worker.transport.output_grpc import OutputGrpcSession, secure_output_channel
from elitea_worker.transport.output_spool import EncryptedOutputSpool
from elitea_worker.transport.redis_asyncio import RedisAsyncioControlClient
from elitea_worker.transport.redis_commands import (
    RedisCommandConsumer,
    RedisCommandDelivery,
)


class DeliveryConsumer(Protocol):
    @property
    def delivery_batch_size(self) -> int: ...

    @property
    def heartbeat_batch_size(self) -> int: ...

    async def read(
        self,
        *,
        count: int | None = None,
        block_ms: int | None = None,
    ) -> tuple[RedisCommandDelivery, ...]: ...

    async def heartbeat_pending(
        self,
        entry_ids: tuple[str, ...],
    ) -> tuple[str, ...]: ...

    async def reclaim_page(
        self,
        *,
        min_idle_ms: int,
        start_id: str = "0-0",
        count: int | None = None,
    ) -> tuple[str, tuple[RedisCommandDelivery, ...]]: ...


@dataclass(slots=True)
class _ExecutionLock:
    lock: asyncio.Lock
    users: int = 0


@dataclass(slots=True)
class _ShutdownBudget:
    """One process-local deadline shared by drain and dependency closure."""

    timeout_seconds: float
    deadline: float | None = None
    armed: asyncio.Event = field(default_factory=asyncio.Event)

    def arm(self) -> float:
        if self.deadline is None:
            self.deadline = asyncio.get_running_loop().time() + self.timeout_seconds
            self.armed.set()
        return self.deadline

    def remaining(self) -> float:
        deadline = self.deadline
        if deadline is None:
            deadline = self.arm()
        return max(0.0, deadline - asyncio.get_running_loop().time())


class WorkerServeLoop:
    """Bounded read/reclaim queue with no data-plane publication surface."""

    def __init__(
        self,
        *,
        consumer: DeliveryConsumer,
        process_delivery: Callable[[RedisCommandDelivery], Awaitable[DeliveryResult]],
        max_concurrency: int,
        queue_capacity: int,
        reclaim_idle_millis: int,
        reclaim_interval_millis: int,
        dependency_retry_millis: int,
        shutdown_timeout_millis: int,
        event_sink: Callable[[str, WorkerError | None], None] | None = None,
    ) -> None:
        if (
            min(
                max_concurrency,
                queue_capacity,
                reclaim_idle_millis,
                reclaim_interval_millis,
                dependency_retry_millis,
                shutdown_timeout_millis,
            )
            < 1
            or queue_capacity < max_concurrency
        ):
            raise ValueError("worker serve-loop bounds are invalid")
        self._consumer = consumer
        self._process = process_delivery
        self._max_concurrency = max_concurrency
        self._queue: asyncio.Queue[RedisCommandDelivery | None] = asyncio.Queue(
            queue_capacity
        )
        self._reclaim_idle = reclaim_idle_millis
        self._reclaim_interval = reclaim_interval_millis / 1000
        self._dependency_retry = dependency_retry_millis / 1000
        self._shutdown_timeout = shutdown_timeout_millis / 1000
        self._owned_entry_ids: set[tuple[str, str]] = set()
        # One token covers each fetched, queued, or actively processed PEL entry.
        self._ownership_slots: asyncio.Queue[None] = asyncio.Queue(
            queue_capacity + max_concurrency
        )
        for _ in range(queue_capacity + max_concurrency):
            self._ownership_slots.put_nowait(None)
        self._event_sink = event_sink or (lambda _event, _error: None)

    async def run(self, stop: asyncio.Event) -> None:
        if stop.is_set():
            return
        intake = asyncio.create_task(
            self._intake_loop(stop),
            name="elitea-redis-intake",
        )
        heartbeat = asyncio.create_task(
            self._heartbeat_loop(),
            name="elitea-redis-heartbeat",
        )
        workers = tuple(
            asyncio.create_task(self._worker(), name=f"elitea-delivery-{index}")
            for index in range(self._max_concurrency)
        )
        stop_waiter = asyncio.create_task(
            stop.wait(),
            name="elitea-worker-stop",
        )
        background = (intake, heartbeat, *workers)
        shutdown_complete = False
        try:
            done, _ = await asyncio.wait(
                (stop_waiter, *background),
                return_when=asyncio.FIRST_COMPLETED,
            )
            if stop_waiter not in done:
                failed = next(task for task in background if task in done)
                await _raise_unexpected_background_exit(failed)

            intake.cancel()
            await asyncio.gather(intake, return_exceptions=True)
            drain = asyncio.create_task(
                self._queue.join(),
                name="elitea-delivery-drain",
            )
            try:
                drained, _ = await asyncio.wait(
                    (drain, heartbeat, *workers),
                    timeout=self._shutdown_timeout,
                    return_when=asyncio.FIRST_COMPLETED,
                )
                if drain not in drained:
                    failed = next(
                        (task for task in (heartbeat, *workers) if task in drained),
                        None,
                    )
                    if failed is not None:
                        await _raise_unexpected_background_exit(failed)
                    raise DependencyUnavailable(
                        "The worker did not drain before its shutdown deadline."
                    )
                await drain
            except asyncio.CancelledError:
                _detach_cancelled_tasks((drain, *workers))
                raise
            finally:
                if not drain.done():
                    _detach_cancelled_tasks((drain,))
                heartbeat.cancel()
                await asyncio.gather(heartbeat, return_exceptions=True)
            for _ in workers:
                await self._queue.put(None)
            await asyncio.gather(*workers)
            shutdown_complete = True
        finally:
            stop_waiter.cancel()
            await asyncio.gather(stop_waiter, return_exceptions=True)
            if not shutdown_complete:
                _detach_cancelled_tasks(background)

    async def _intake_loop(self, stop: asyncio.Event) -> None:
        """Fairly alternate bounded new reads with reclaim maintenance."""

        loop = asyncio.get_running_loop()
        cursor = "0-0"
        next_reclaim = loop.time() + self._reclaim_interval
        while not stop.is_set():
            reserved = 0
            operation = "read"
            reclaim_due = False
            try:
                reserved = await self._reserve_delivery_capacity()
                now = loop.time()
                reclaim_due = now >= next_reclaim
                if reclaim_due:
                    operation = "reclaim"
                    cursor, deliveries = await self._consumer.reclaim_page(
                        min_idle_ms=self._reclaim_idle,
                        start_id=cursor,
                        count=reserved,
                    )
                else:
                    # The read releases its reservation no later than the next
                    # reclaim turn. RedisCommandConsumer additionally caps this
                    # value by the deployment's configured XREADGROUP block.
                    block_ms = max(1, int((next_reclaim - now) * 1_000))
                    deliveries = await self._consumer.read(
                        count=reserved,
                        block_ms=block_ms,
                    )
                accepted_reservation = reserved
                reserved = 0
                await self._enqueue_reserved(
                    deliveries,
                    reserved=accepted_reservation,
                )
            except asyncio.CancelledError:
                raise
            except WorkerError as exc:
                self._event_sink(f"redis_{operation}_rejected", exc)
                if reclaim_due:
                    cursor = "0-0"
                await _wait_or_stop(stop, self._dependency_retry)
            except Exception:
                self._event_sink(
                    f"redis_{operation}_unavailable",
                    DependencyUnavailable(),
                )
                if reclaim_due:
                    cursor = "0-0"
                await _wait_or_stop(stop, self._dependency_retry)
            finally:
                if reclaim_due:
                    next_reclaim = loop.time() + self._reclaim_interval
                self._release_delivery_capacity(reserved)

    async def _heartbeat_loop(self) -> None:
        while True:
            await asyncio.sleep(self._reclaim_interval)
            try:
                await self._heartbeat_pending()
            except asyncio.CancelledError:
                raise
            except WorkerError as exc:
                self._event_sink("redis_heartbeat_rejected", exc)
            except Exception:
                self._event_sink("redis_heartbeat_unavailable", DependencyUnavailable())

    async def _heartbeat_pending(self) -> None:
        owned = tuple(sorted(self._owned_entry_ids))
        batch_size = self._consumer.heartbeat_batch_size
        if batch_size < 1:
            raise DependencyUnavailable("The Redis PEL heartbeat batch is invalid.")
        for offset in range(0, len(owned), batch_size):
            batch = owned[offset : offset + batch_size]
            entry_ids = tuple(entry_id for _, entry_id in batch)
            await self._consumer.heartbeat_pending(entry_ids)

    async def _reserve_delivery_capacity(self) -> int:
        await self._ownership_slots.get()
        reserved = 1
        while reserved < self._consumer.delivery_batch_size:
            try:
                self._ownership_slots.get_nowait()
            except asyncio.QueueEmpty:
                break
            reserved += 1
        return reserved

    def _release_delivery_capacity(self, count: int) -> None:
        for _ in range(count):
            self._ownership_slots.put_nowait(None)

    async def _enqueue_reserved(
        self,
        deliveries: tuple[RedisCommandDelivery, ...],
        *,
        reserved: int,
    ) -> None:
        """Register the complete fetched batch before a queue put can block."""

        if len(deliveries) > reserved:
            self._release_delivery_capacity(reserved)
            raise DependencyUnavailable(
                "Redis returned more deliveries than the worker reserved."
            )

        accepted: list[RedisCommandDelivery] = []
        for delivery in deliveries:
            key = (delivery.stream, delivery.entry_id)
            if key in self._owned_entry_ids:
                self._release_delivery_capacity(1)
                continue
            self._owned_entry_ids.add(key)
            accepted.append(delivery)
        self._release_delivery_capacity(reserved - len(deliveries))

        queued = 0
        try:
            for delivery in accepted:
                await self._queue.put(delivery)
                queued += 1
        except BaseException:
            for delivery in accepted[queued:]:
                key = (delivery.stream, delivery.entry_id)
                if key in self._owned_entry_ids:
                    self._owned_entry_ids.remove(key)
                    self._release_delivery_capacity(1)
            raise

    async def _worker(self) -> None:
        while True:
            delivery = await self._queue.get()
            if delivery is None:
                self._queue.task_done()
                return
            key = (delivery.stream, delivery.entry_id)
            try:
                result = await self._process(delivery)
                self._event_sink(result.disposition.value, None)
            except asyncio.CancelledError:
                raise
            except WorkerError as exc:
                self._event_sink("delivery_rejected", exc)
            except Exception:
                self._event_sink("delivery_unavailable", DependencyUnavailable())
            finally:
                if key in self._owned_entry_ids:
                    self._owned_entry_ids.remove(key)
                    self._release_delivery_capacity(1)
                self._queue.task_done()


class ProductionDeliveryProcessor:
    """Build exactly one execution-bound encrypted output spool per delivery."""

    def __init__(
        self,
        *,
        config: RuntimeDeployConfig,
        trust: RuntimeTrustMaterial,
        supervisor: ExecutionSupervisor,
        handler: ConfigurationValidationHandler,
        control: ExecutionControlClient,
        command_acker: RedisCommandConsumer,
        input_client: ScopedInputContentClient,
        output_stub: output_pb2_grpc.ExecutionOutputServiceStub,
    ) -> None:
        self._config = config
        self._trust = trust
        self._supervisor = supervisor
        self._handler = handler
        self._control = control
        self._acker = command_acker
        self._input = input_client
        self._input_builder = ClaimBoundInputRequestBuilder(
            origin=config.content_origin
        )
        self._output_stub = output_stub
        self._authenticator = Ed25519CommandAuthenticator(trust.signing_keys)
        self._spool_root = validate_private_directory(
            config.spool_root,
            description="output spool root",
        )
        self._locks: dict[bytes, _ExecutionLock] = {}
        self._metadata = (
            ("x-elitea-workload-session", config.workload_session_id),
            ("x-elitea-producer-id", config.producer_id),
        )

    async def process(self, delivery: RedisCommandDelivery) -> DeliveryResult:
        _, command = parse_and_verify_signed_command(
            delivery.signed_envelope,
            authenticator=self._authenticator,
        )
        binding = _execution_spool_binding(command, self._config.producer_id)
        lock_state = self._locks.get(binding)
        if lock_state is None:
            lock_state = _ExecutionLock(asyncio.Lock())
            self._locks[binding] = lock_state
        lock_state.users += 1
        try:
            async with lock_state.lock:
                return await self._process_bound(delivery, command, binding)
        finally:
            lock_state.users -= 1
            if lock_state.users == 0 and self._locks.get(binding) is lock_state:
                self._locks.pop(binding, None)

    async def _process_bound(
        self,
        delivery: RedisCommandDelivery,
        command: command_pb2.WorkerCommandV1,
        binding: bytes,
    ) -> DeliveryResult:
        spool_path = _prepare_execution_spool(self._spool_root, binding)
        limits = self._config.limits
        spool_overhead = limits.output_max_queued_frames * 64
        spool_key = HKDF(
            algorithm=hashes.SHA256(),
            length=32,
            salt=None,
            info=b"elitea.runtime.output-spool-key.v1\x00" + binding,
        ).derive(self._trust.spool_master_key)

        def output_session() -> OutputGrpcSession:
            spool = EncryptedOutputSpool(
                spool_path,
                key=spool_key,
                stream_aad=b"elitea.runtime.output-spool-aad.v1\x00" + binding,
                max_frames=limits.output_max_queued_frames,
                max_bytes=limits.output_max_queued_bytes + spool_overhead,
                max_frame_bytes=limits.output_max_frame_bytes,
            )
            return OutputGrpcSession(
                self._output_stub,
                spool=spool,
                metadata=lambda: self._metadata,
                max_queued_frames=limits.output_max_queued_frames,
                max_queued_bytes=limits.output_max_queued_bytes,
                max_frame_bytes=limits.output_max_frame_bytes,
                stream_deadline_seconds=limits.output_stream_deadline_millis / 1000,
            )

        processor = ConfigurationValidationDeliveryProcessor(
            supervisor=self._supervisor,
            handler=self._handler,
            control=self._control,
            command_acker=self._acker,
            input_client=self._input,
            input_request_builder=self._input_builder,
            output_session_factory=output_session,
            signed_command_authenticator=self._authenticator,
            workload_session_id=self._config.workload_session_id,
            producer_id=self._config.producer_id,
            clock_unix_millis=lambda: int(time.time() * 1000),
            output_ack_timeout_seconds=limits.output_ack_timeout_millis / 1000,
            max_output_sessions=limits.output_max_sessions,
            lease_poll_interval_seconds=limits.lease_poll_interval_millis / 1000,
        )
        result = await processor.process(delivery)
        if result.disposition not in {
            DeliveryDisposition.OWNED_ELSEWHERE_NOACK,
            DeliveryDisposition.RETRY_LATER_NOACK,
        }:
            _remove_empty_spool(spool_path)
        return result


async def serve_from_config(path: Path) -> None:
    """Load production config and run until SIGINT/SIGTERM requests drain."""

    config = load_deploy_config(path)
    await serve_deployment(config)


async def serve_deployment(
    config: RuntimeDeployConfig,
    *,
    stop: asyncio.Event | None = None,
) -> None:
    """Run one deployment and expose only stable failures to the CLI."""

    try:
        await _serve_deployment_inner(config, stop=stop)
    except WorkerError:
        raise
    except Exception as exc:
        # Startup and cleanup use the same safe public error boundary. Raw TLS,
        # filesystem, Redis and channel failures remain available only as the
        # chained cause for in-process diagnostics.
        raise DependencyUnavailable() from exc


async def _serve_deployment_inner(
    config: RuntimeDeployConfig,
    *,
    stop: asyncio.Event | None = None,
) -> None:
    own_stop = stop is None
    stop = stop or asyncio.Event()
    remove_signal_handlers = _install_signal_handlers(stop) if own_stop else lambda: None
    shutdown_budget = _ShutdownBudget(
        timeout_seconds=config.limits.shutdown_timeout_millis / 1000
    )
    if stop.is_set():
        shutdown_budget.arm()
    shutdown_observer = asyncio.create_task(
        _observe_shutdown(stop, shutdown_budget),
        name="elitea-shutdown-deadline",
    )
    redis_client: RedisAsyncioControlClient | None = None
    control_channel: grpc.aio.Channel | None = None
    output_channel: grpc.aio.Channel | None = None
    http_client: httpx.AsyncClient | None = None
    supervisor: ExecutionSupervisor | None = None
    try:
        trust = RuntimeTrustMaterial.load(config)
        validate_private_directory(config.spool_root, description="output spool root")
        limits = config.limits
        redis_client = RedisAsyncioControlClient.connect(
            config.redis_url,
            password=trust.redis_password,
            ssl_context=trust.http_client_context(),
            max_connections=limits.delivery_max_concurrency + 4,
            socket_connect_timeout_seconds=limits.grpc_deadline_millis / 1000,
            socket_timeout_seconds=(limits.redis_block_millis + 1_000) / 1000,
        )
        if not await _wait_for_redis(redis_client, config, stop):
            return
        consumer = RedisCommandConsumer(
            redis_client,
            stream=config.redis_stream,
            group=config.redis_group,
            consumer=config.consumer_id,
            max_entry_bytes=limits.redis_max_entry_bytes,
            max_field_bytes=limits.redis_max_field_bytes,
            read_count=limits.redis_read_batch,
            block_ms=limits.redis_block_millis,
        )
        metadata = (
            ("x-elitea-workload-session", config.workload_session_id),
            ("x-elitea-producer-id", config.producer_id),
        )
        control_channel = secure_control_channel(
            config.control_target,
            root_certificates=trust.ca_bytes,
            certificate_chain=trust.certificate_bytes,
            private_key=trust.private_key_bytes,
        )
        output_channel = secure_output_channel(
            config.output_target,
            root_certificates=trust.ca_bytes,
            certificate_chain=trust.certificate_bytes,
            private_key=trust.private_key_bytes,
        )
        control = ExecutionControlClient(
            control_pb2_grpc.RuntimeControlServiceStub(control_channel),
            metadata=lambda: metadata,
            deadline_seconds=limits.grpc_deadline_millis / 1000,
        )
        http_client = httpx.AsyncClient(
            verify=trust.http_client_context(),
            http1=False,
            http2=True,
            follow_redirects=False,
            max_redirects=0,
            trust_env=False,
            timeout=httpx.Timeout(limits.content_timeout_millis / 1000),
            limits=httpx.Limits(
                max_connections=limits.http_max_connections,
                max_keepalive_connections=limits.http_max_keepalive_connections,
            ),
        )
        content = ScopedInputContentClient(
            http_client,
            allowed_origins=frozenset({config.content_origin}),
            max_content_bytes=limits.content_max_body_bytes,
            timeout_seconds=limits.content_timeout_millis / 1000,
            require_http2=True,
        )
        supervisor = ExecutionSupervisor(
            max_workers=limits.sync_max_workers,
            max_in_flight=limits.sync_max_in_flight,
            max_deliveries=limits.delivery_max_concurrency,
            admission_timeout_seconds=limits.admission_timeout_millis / 1000,
            drain_timeout_seconds=limits.shutdown_timeout_millis / 1000,
        )
        await supervisor.__aenter__()
        processor = ProductionDeliveryProcessor(
            config=config,
            trust=trust,
            supervisor=supervisor,
            handler=ConfigurationValidationHandler(EliteaSdkAdapter()),
            control=control,
            command_acker=consumer,
            input_client=content,
            output_stub=output_pb2_grpc.ExecutionOutputServiceStub(output_channel),
        )
        runtime = WorkerServeLoop(
            consumer=consumer,
            process_delivery=processor.process,
            max_concurrency=limits.delivery_max_concurrency,
            queue_capacity=limits.delivery_queue_capacity,
            reclaim_idle_millis=limits.redis_reclaim_idle_millis,
            reclaim_interval_millis=limits.redis_reclaim_interval_millis,
            dependency_retry_millis=limits.dependency_retry_millis,
            shutdown_timeout_millis=limits.shutdown_timeout_millis,
            event_sink=_emit_runtime_event,
        )
        await _run_with_shutdown_budget(runtime, stop, shutdown_budget)
    finally:
        remove_signal_handlers()
        shutdown_observer.cancel()
        await asyncio.gather(shutdown_observer, return_exceptions=True)
        shutdown_budget.arm()
        await _close_runtime_resources(
            supervisor=supervisor,
            http_client=http_client,
            control_channel=control_channel,
            output_channel=output_channel,
            redis_client=redis_client,
            budget=shutdown_budget,
        )


async def _observe_shutdown(
    stop: asyncio.Event,
    budget: _ShutdownBudget,
) -> None:
    await stop.wait()
    budget.arm()


async def _run_with_shutdown_budget(
    runtime: WorkerServeLoop,
    stop: asyncio.Event,
    budget: _ShutdownBudget,
) -> None:
    """Give runtime drain no more than the process-wide shutdown budget."""

    runtime_task = asyncio.create_task(runtime.run(stop), name="elitea-worker-runtime")
    armed_task = asyncio.create_task(budget.armed.wait(), name="elitea-shutdown-armed")
    try:
        done, _ = await asyncio.wait(
            (runtime_task, armed_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if runtime_task in done:
            await runtime_task
            return

        remaining = budget.remaining()
        if remaining > 0:
            done, _ = await asyncio.wait((runtime_task,), timeout=remaining)
            if runtime_task in done:
                await runtime_task
                return

        runtime_task.cancel()
        _detach_cancelled_tasks((runtime_task,))
        raise DependencyUnavailable(
            "The worker did not drain before its shutdown deadline."
        )
    except asyncio.CancelledError:
        _detach_cancelled_tasks((runtime_task,))
        raise
    finally:
        armed_task.cancel()
        await asyncio.gather(armed_task, return_exceptions=True)


async def _close_runtime_resources(
    *,
    supervisor: ExecutionSupervisor | None,
    http_client: httpx.AsyncClient | None,
    control_channel: grpc.aio.Channel | None,
    output_channel: grpc.aio.Channel | None,
    redis_client: RedisAsyncioControlClient | None,
    budget: _ShutdownBudget,
) -> None:
    """Close every owned dependency concurrently within one remaining budget."""

    if supervisor is not None:
        supervisor.stop_admission()

    if all(
        resource is None
        for resource in (
            supervisor,
            http_client,
            control_channel,
            output_channel,
            redis_client,
        )
    ):
        return

    remaining = budget.remaining()
    if remaining <= 0:
        raise DependencyUnavailable(
            "The worker did not close before its shutdown deadline."
        )

    closers: list[Awaitable[object]] = []
    if supervisor is not None:
        closers.append(supervisor.shutdown(timeout_seconds=remaining))
    if http_client is not None:
        closers.append(http_client.aclose())
    if control_channel is not None:
        closers.append(control_channel.close(grace=remaining))
    if output_channel is not None:
        closers.append(output_channel.close(grace=remaining))
    if redis_client is not None:
        closers.append(redis_client.aclose())

    tasks = tuple(
        asyncio.create_task(closer, name=f"elitea-runtime-close-{index}")
        for index, closer in enumerate(closers)
    )
    try:
        done, pending = await asyncio.wait(tasks, timeout=budget.remaining())
    except BaseException:
        _detach_cancelled_tasks(tasks)
        raise
    if pending:
        _detach_cancelled_tasks(pending)

    failure: BaseException | None = None
    for task in done:
        try:
            task.result()
        except asyncio.CancelledError as exc:
            failure = failure or exc
        except BaseException as exc:
            failure = failure or exc

    if pending:
        raise DependencyUnavailable(
            "The worker did not close before its shutdown deadline."
        )
    if failure is not None:
        raise failure


def _detach_cancelled_tasks(
    tasks: tuple[asyncio.Task[object], ...] | set[asyncio.Task[object]],
) -> None:
    """Cancel deadline-expired tasks without extending the global deadline."""

    for task in tasks:
        task.cancel()
        task.add_done_callback(_consume_task_result)


def _consume_task_result(task: asyncio.Task[object]) -> None:
    try:
        task.exception()
    except asyncio.CancelledError:
        return


async def _raise_unexpected_background_exit(task: asyncio.Task[object]) -> None:
    """Turn any silent sibling exit into one stable process-level failure."""

    try:
        await task
    except asyncio.CancelledError as exc:
        raise DependencyUnavailable(
            "A worker runtime task was cancelled unexpectedly."
        ) from exc
    except Exception as exc:
        raise DependencyUnavailable(
            "A worker runtime task stopped unexpectedly."
        ) from exc
    raise DependencyUnavailable("A worker runtime task exited unexpectedly.")


async def _wait_for_redis(
    client: RedisAsyncioControlClient,
    config: RuntimeDeployConfig,
    stop: asyncio.Event,
) -> bool:
    retry = config.limits.dependency_retry_millis / 1000
    while not stop.is_set():
        try:
            acknowledged = await _ping_or_stop(client, stop)
            if acknowledged is None:
                return False
            if not acknowledged:
                raise RuntimeError("Redis ping was not acknowledged")
            return True
        except asyncio.CancelledError:
            raise
        except Exception:
            _emit_runtime_event("redis_startup_unavailable", DependencyUnavailable())
            await _wait_or_stop(stop, retry)
    return False


async def _ping_or_stop(
    client: RedisAsyncioControlClient,
    stop: asyncio.Event,
) -> bool | None:
    """Do not let a connecting Redis socket delay a requested shutdown."""

    ping_task = asyncio.create_task(client.ping(), name="elitea-redis-startup-ping")
    stop_task = asyncio.create_task(stop.wait(), name="elitea-redis-startup-stop")
    try:
        done, _ = await asyncio.wait(
            (ping_task, stop_task),
            return_when=asyncio.FIRST_COMPLETED,
        )
        if stop_task in done:
            _detach_cancelled_tasks((ping_task,))
            return None
        return await ping_task
    except asyncio.CancelledError:
        _detach_cancelled_tasks((ping_task,))
        raise
    finally:
        stop_task.cancel()
        await asyncio.gather(stop_task, return_exceptions=True)


def _execution_spool_binding(
    command: command_pb2.WorkerCommandV1,
    producer_id: str,
) -> bytes:
    values = (
        command.tenant_id,
        command.resource_project_id,
        command.projection_project_id,
        command.command_id,
        command.execution_id,
        str(command.generation),
        producer_id,
    )
    if any(not value for value in values):
        raise ValueError("execution spool identity is incomplete")
    encoded = tuple(value.encode("utf-8") for value in values)
    return b"elitea.runtime.execution-spool.v1\x00" + b"\x00".join(
        len(value).to_bytes(4, "big") + value for value in encoded
    )


def _prepare_execution_spool(root: Path, binding: bytes) -> Path:
    path = root / hashlib.sha256(binding).hexdigest()
    try:
        path.mkdir(mode=0o700, exist_ok=True)
    except OSError as exc:
        raise DependencyUnavailable(
            "The execution output spool is unavailable."
        ) from exc
    # ``exist_ok`` follows an existing directory symlink. Revalidate the exact
    # derived child before encrypted spool code can open anything beneath it.
    return validate_private_directory(path, description="execution output spool")


def _remove_empty_spool(path: Path) -> None:
    try:
        if path.is_dir() and not any(path.iterdir()):
            path.rmdir()
    except OSError:
        # Empty-directory cleanup is hygiene only; durable output was already
        # removed after its ACK and settlement. Never roll back command ACK.
        return


async def _wait_or_stop(stop: asyncio.Event, seconds: float) -> None:
    try:
        await asyncio.wait_for(stop.wait(), timeout=seconds)
    except TimeoutError:
        return


def _install_signal_handlers(stop: asyncio.Event) -> Callable[[], None]:
    loop = asyncio.get_running_loop()
    installed: list[signal.Signals] = []
    for event in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(event, stop.set)
            installed.append(event)
        except (NotImplementedError, RuntimeError):
            continue

    def remove() -> None:
        for event in installed:
            loop.remove_signal_handler(event)

    return remove


def _emit_runtime_event(event: str, error: WorkerError | None) -> None:
    diagnostic: dict[str, object] = {"event": event}
    if error is not None:
        diagnostic.update(
            code=error.code,
            retryable=error.retryable,
            safe_message=error.safe_message,
        )
    print(
        json.dumps(diagnostic, sort_keys=True, separators=(",", ":")),
        file=sys.stderr,
        flush=True,
    )


__all__ = [
    "ProductionDeliveryProcessor",
    "WorkerServeLoop",
    "serve_deployment",
    "serve_from_config",
]
