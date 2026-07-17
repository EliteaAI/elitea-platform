"""One delivered ``configuration.validate.v1`` execution transaction.

The processor keeps transport ownership explicit: Redis carries only the
signed reference command, control gRPC claims and settles, HTTPS retrieves the
claim-bound settings, and output gRPC carries the result. Redis is acknowledged
only after a server-proven no-authority terminal receipt or a terminal output
ACK and settlement receipt.
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import math
from collections.abc import Callable
from dataclasses import dataclass
from enum import Enum
from typing import Protocol

from elitea.runtime.v1 import (
    command_pb2,
    common_pb2,
    control_pb2,
    envelope_pb2,
    errors_pb2,
    output_pb2,
)

from elitea_worker.constants import (
    CONFIGURATION_CATALOG_REVISION,
    CONFIGURATION_CATALOG_SHA256,
    CONFIGURATION_TYPE,
    MAX_BUNDLE_ENTRIES,
    MAX_SAFE_STRING_BYTES,
    MAX_SETTINGS_BYTES,
    OPENAPI_SCHEMA_ID,
    OPENAPI_SCHEMA_REVISION,
    OPENAPI_SCHEMA_SHA256,
)
from elitea_worker.execution.errors import (
    AuthorizationFailure,
    DeadlineExceeded,
    DependencyUnavailable,
    ExecutionCancelled,
    IncompatibleVersion,
    InvalidInput,
    OutputCancellationWon,
    OutputDeadlineWon,
    ResourceExhausted,
    UnsupportedCapability,
    WorkerError,
)
from elitea_worker.execution.supervisor import ExecutionRunner
from elitea_worker.execution.sync_executor import SyncExecutorAdmissionRejected
from elitea_worker.fixtures.bundle import (
    FixtureContent,
    parse_settings_json,
    project_input_manifest_entries,
)
from elitea_worker.handlers.validation import ConfigurationValidationHandler
from elitea_worker.protocol.codec import (
    VerifiedWorkerCommand,
    SignedCommandAuthenticator,
    build_output_frame,
    parse_and_verify_signed_command,
    parse_execution_input_bundle,
    validation_request_from,
)
from elitea_worker.transport.input_content import (
    ClaimBoundInputReference,
    ClaimBoundInputRequestBuilder,
    ScopedInputContentClient,
)
from elitea_worker.transport.redis_commands import RedisCommandDelivery


_TERMINAL_OUTCOMES = frozenset(
    {
        common_pb2.EXECUTION_OUTCOME_V1_SUCCEEDED,
        common_pb2.EXECUTION_OUTCOME_V1_FAILED,
        common_pb2.EXECUTION_OUTCOME_V1_CANCELLED,
        common_pb2.EXECUTION_OUTCOME_V1_OUTCOME_UNKNOWN,
    }
)

_KNOWN_DESIRED_STATES = frozenset(
    {
        common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
        common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED,
        common_pb2.DESIRED_EXECUTION_STATE_V1_DRAINING,
    }
)
_DEADLINE_RETIREMENT_SAFE_MESSAGE = (
    "The execution deadline was exceeded before worker authority was granted."
)


class ControlPlane(Protocol):
    async def claim_command(
        self, request: control_pb2.ClaimCommandRequestV1
    ) -> control_pb2.ClaimCommandResponseV1: ...

    async def prepare_settlement(
        self, request: control_pb2.PrepareSettlementRequestV1
    ) -> control_pb2.PrepareSettlementResponseV1: ...

    async def renew_lease(
        self, request: control_pb2.RenewLeaseRequestV1
    ) -> control_pb2.RenewLeaseResponseV1: ...

    async def observe_desired_state(
        self, request: control_pb2.ObserveDesiredStateRequestV1
    ) -> control_pb2.ObserveDesiredStateResponseV1: ...

class CommandSettlementAcker(Protocol):
    async def ack_after_settlement(self, delivery: RedisCommandDelivery) -> None: ...


class OutputSession(Protocol):
    @property
    def has_pending_replay(self) -> bool: ...
    @property
    def pending_replay_frame(self) -> output_pb2.ExecutionOutputFrameV1 | None: ...
    def replays(self, frame: output_pb2.ExecutionOutputFrameV1) -> bool: ...
    async def replace_pending_exact(
        self,
        expected: output_pb2.ExecutionOutputFrameV1,
        replacement: output_pb2.ExecutionOutputFrameV1,
    ) -> None: ...
    async def start(self) -> None: ...
    async def send(self, frame: output_pb2.ExecutionOutputFrameV1) -> None: ...
    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None: ...
    async def close(self) -> None: ...


class DeliveryDisposition(Enum):
    EXECUTED_SETTLED_ACKED = "executed_settled_acked"
    RECOVERED_LOCAL_OUTPUT_SETTLED_ACKED = "recovered_local_output_settled_acked"
    RECOVERED_TERMINAL_SETTLED_ACKED = "recovered_terminal_settled_acked"
    RECOVERED_SETTLEMENT_ACKED = "recovered_settlement_acked"
    TERMINAL_REDELIVERY_ACKED = "terminal_redelivery_acked"
    OWNED_ELSEWHERE_NOACK = "owned_elsewhere_noack"
    RETRY_LATER_NOACK = "retry_later_noack"


@dataclass(frozen=True, slots=True)
class DeliveryResult:
    disposition: DeliveryDisposition
    output_frame: output_pb2.ExecutionOutputFrameV1 | None = None
    settlement_receipt_id: str | None = None


@dataclass(frozen=True, slots=True)
class _AcceptedClaim:
    verified: VerifiedWorkerCommand
    content: FixtureContent
    claim_id: str
    claim_handoff_watermark: int


class _ClaimLeaseMonitor:
    """Renew one unchanged claim fence and observe server-owned desired state."""

    def __init__(
        self,
        *,
        control: ControlPlane,
        receipt: control_pb2.ClaimReceiptV1,
        clock_unix_millis: Callable[[], int],
        interval_seconds: float,
    ) -> None:
        if interval_seconds <= 0:
            raise ValueError("lease polling interval must be positive")
        self._control = control
        self._identity = common_pb2.ExecutionIdentityV1.FromString(
            receipt.identity.SerializeToString(deterministic=True)
        )
        self._fence = common_pb2.ExecutionFenceV1.FromString(
            receipt.fence.SerializeToString(deterministic=True)
        )
        seed = (
            receipt.identity.SerializeToString(deterministic=True)
            + b"\x00"
            + receipt.fence.SerializeToString(deterministic=True)
            + b"\x00"
            + receipt.claim_id.encode("utf-8")
        )
        self._renewal_prefix = f"lease-renew:{hashlib.sha256(seed).hexdigest()}"
        self._clock = clock_unix_millis
        self._interval = interval_seconds
        self._lease_expires_at = int(receipt.lease_expires_at_unix_millis)
        self._renewal_sequence = 0
        self._failure: WorkerError | None = None
        self._cancellation: ExecutionCancelled | None = None
        self._stop = asyncio.Event()
        self._poll_lock = asyncio.Lock()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is not None:
            raise RuntimeError("lease monitor is already started")
        self._task = asyncio.create_task(self._run(), name="elitea-claim-lease")

    async def check_now(self) -> None:
        self._raise_fatal_failure()
        async with self._poll_lock:
            self._raise_fatal_failure()
            await self._poll_and_record()
        self.raise_if_failed()

    def raise_if_failed(self) -> None:
        self._raise_fatal_failure()
        if self._cancellation is not None:
            raise self._cancellation

    def _raise_fatal_failure(self) -> None:
        if self._failure is not None:
            raise self._failure

    async def stop(self) -> None:
        self._stop.set()
        if self._task is not None:
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    async def _run(self) -> None:
        loop = asyncio.get_running_loop()
        next_poll = loop.time() + self._interval
        while not self._stop.is_set():
            delay = next_poll - loop.time()
            if delay > 0:
                try:
                    await asyncio.wait_for(self._stop.wait(), timeout=delay)
                    return
                except TimeoutError:
                    pass
            try:
                async with self._poll_lock:
                    self._raise_fatal_failure()
                    await self._poll_and_record()
            except WorkerError:
                return

            next_poll += self._interval
            now = loop.time()
            if next_poll <= now:
                skipped = int((now - next_poll) // self._interval) + 1
                next_poll += skipped * self._interval

    async def _poll_and_record(self) -> None:
        try:
            await self._poll_once()
        except ExecutionCancelled as error:
            # Desired cancellation is remembered for the next execution
            # boundary, but is not a lease failure. Continue renewing while a
            # synchronous callable may still be running or producing effects.
            self._cancellation = error
        except WorkerError as error:
            self._failure = error
            raise
        except Exception as error:
            failure = DependencyUnavailable()
            self._failure = failure
            raise failure from error

    async def _poll_once(self) -> None:
        self._renewal_sequence += 1
        renewal = await self._control.renew_lease(
            control_pb2.RenewLeaseRequestV1(
                identity=self._identity,
                fence=self._fence,
                idempotency_key=f"{self._renewal_prefix}:{self._renewal_sequence}",
            )
        )
        if renewal.HasField("rejection"):
            raise _worker_error_from_runtime(renewal.rejection)
        renewed_expiry = int(renewal.lease_expires_at_unix_millis)

        observed = await self._control.observe_desired_state(
            control_pb2.ObserveDesiredStateRequestV1(
                identity=self._identity,
                fence=self._fence,
            )
        )
        if observed.HasField("rejection"):
            raise _worker_error_from_runtime(observed.rejection)
        now = _runtime_now(self._clock)
        minimum_margin_millis = math.ceil(self._interval * 2_000)
        if (
            renewed_expiry < self._lease_expires_at
            or renewed_expiry - now < minimum_margin_millis
        ):
            raise AuthorizationFailure("The renewed claim lease is malformed or expired.")
        self._lease_expires_at = renewed_expiry
        _require_running_desired_state(int(renewal.desired_state))
        _require_running_desired_state(int(observed.desired_state))


class ConfigurationValidationDeliveryProcessor:
    """Processes one Redis delivery without adding retry or business policy."""

    def __init__(
        self,
        *,
        supervisor: ExecutionRunner,
        handler: ConfigurationValidationHandler,
        control: ControlPlane,
        command_acker: CommandSettlementAcker,
        input_client: ScopedInputContentClient,
        input_request_builder: ClaimBoundInputRequestBuilder,
        output_session_factory: Callable[[], OutputSession],
        signed_command_authenticator: SignedCommandAuthenticator,
        workload_session_id: str,
        producer_id: str,
        clock_unix_millis: Callable[[], int],
        output_ack_timeout_seconds: float = 15.0,
        max_output_sessions: int = 2,
        lease_poll_interval_seconds: float = 10.0,
    ) -> None:
        if (
            not _bounded_text(workload_session_id)
            or not _bounded_text(producer_id)
            or output_ack_timeout_seconds <= 0
            or isinstance(max_output_sessions, bool)
            or not isinstance(max_output_sessions, int)
            or max_output_sessions < 1
            or max_output_sessions > 8
            or lease_poll_interval_seconds <= 0
        ):
            raise ValueError("delivered worker identity and limits are required")
        self._supervisor = supervisor
        self._handler = handler
        self._control = control
        self._command_acker = command_acker
        self._input_client = input_client
        self._input_request_builder = input_request_builder
        self._output_session_factory = output_session_factory
        self._signed_command_authenticator = signed_command_authenticator
        self._workload_session_id = workload_session_id
        self._producer_id = producer_id
        self._clock = clock_unix_millis
        self._output_ack_timeout = output_ack_timeout_seconds
        self._max_output_sessions = max_output_sessions
        self._lease_poll_interval = lease_poll_interval_seconds

    async def process(self, delivery: RedisCommandDelivery) -> DeliveryResult:
        try:
            return await self._supervisor.run(
                lambda: self._process_admitted(delivery)
            )
        except SyncExecutorAdmissionRejected:
            # Admission is decided before parsing, claim, input, output, or ACK.
            # The untouched Redis delivery can be retried on another worker.
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)

    async def _process_admitted(
        self,
        delivery: RedisCommandDelivery,
    ) -> DeliveryResult:
        signed, command = parse_and_verify_signed_command(
            delivery.signed_envelope,
            authenticator=self._signed_command_authenticator,
        )
        response = await self._control.claim_command(
            control_pb2.ClaimCommandRequestV1(
                workload_session_id=self._workload_session_id,
                producer_id=self._producer_id,
                signed_command=signed,
            )
        )
        receipt = _claim_receipt(response)
        _validate_receipt_identity(receipt, command)
        disposition = int(receipt.disposition)
        if (
            disposition != control_pb2.CLAIM_DISPOSITION_V1_RETIRED_ACK
            and receipt.HasField("retirement")
        ):
            raise InvalidInput(
                "The claim disposition has unexpected retirement material."
            )
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_RETIRED_ACK:
            _validate_retired_receipt(receipt)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(DeliveryDisposition.TERMINAL_REDELIVERY_ACKED)
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_OBSOLETE_ACK:
            _validate_obsolete_receipt(receipt)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(DeliveryDisposition.TERMINAL_REDELIVERY_ACKED)
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_SETTLED_ACK:
            _require_no_recovery(receipt)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(DeliveryDisposition.TERMINAL_REDELIVERY_ACKED)
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_ACTIVE_LEASE_NOACK:
            _require_no_recovery(receipt)
            _validate_active_fence(
                receipt,
                workload_session_id=self._workload_session_id,
                producer_id=self._producer_id,
                now_unix_millis=_runtime_now(self._clock),
            )
            output = self._output_session_factory()
            pending = output.pending_replay_frame
            if output.has_pending_replay != (pending is not None):
                raise InvalidInput("The durable output spool state is inconsistent.")
            if pending is None:
                return DeliveryResult(DeliveryDisposition.OWNED_ELSEWHERE_NOACK)
            _validate_pending_output(pending, command=command, receipt=receipt)
            return await self._recover_local_output(
                delivery=delivery,
                frame=pending,
                output=output,
                receipt=receipt,
                verified=_verified_claim_command(signed, command, receipt),
            )
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_RETRY_LATER_NOACK:
            _require_no_recovery(receipt)
            return DeliveryResult(DeliveryDisposition.RETRY_LATER_NOACK)
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_RECOVER_TERMINAL_ACK:
            now = _runtime_now(self._clock)
            _validate_active_fence(
                receipt,
                workload_session_id=self._workload_session_id,
                producer_id=self._producer_id,
                now_unix_millis=now,
            )
            recovery = _terminal_ack_recovery(receipt)
            settlement = await self._control.prepare_settlement(
                control_pb2.PrepareSettlementRequestV1(
                    identity=receipt.identity,
                    fence=receipt.fence,
                    proposal=recovery.proposal,
                    proposal_digest=recovery.proposal_digest,
                    idempotency_key=recovery.idempotency_key,
                )
            )
            receipt_id = _settlement_receipt(
                settlement,
                expected_outcome=int(recovery.proposal.requested_outcome),
            )
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(
                DeliveryDisposition.RECOVERED_TERMINAL_SETTLED_ACKED,
                settlement_receipt_id=receipt_id,
            )
        if disposition == control_pb2.CLAIM_DISPOSITION_V1_RECOVER_SETTLEMENT:
            _validate_active_fence(
                receipt,
                workload_session_id=self._workload_session_id,
                producer_id=self._producer_id,
                now_unix_millis=_runtime_now(self._clock),
            )
            recovery = _prepared_settlement_recovery(receipt)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(
                DeliveryDisposition.RECOVERED_SETTLEMENT_ACKED,
                settlement_receipt_id=recovery.settlement_receipt_id,
            )
        if disposition != control_pb2.CLAIM_DISPOSITION_V1_ACCEPTED:
            raise InvalidInput("The claim disposition is malformed.")

        _require_no_recovery(receipt)
        claim_now = _runtime_now(self._clock)
        accepted = _accepted_claim(
            signed=signed,
            command=command,
            receipt=receipt,
            workload_session_id=self._workload_session_id,
            producer_id=self._producer_id,
            now_unix_millis=claim_now,
        )

        output = self._output_session_factory()
        pending = output.pending_replay_frame
        if output.has_pending_replay != (pending is not None):
            raise InvalidInput("The durable output spool state is inconsistent.")
        if pending is not None:
            _validate_pending_output(pending, command=command, receipt=receipt)
            return await self._recover_local_output(
                delivery=delivery,
                frame=pending,
                output=output,
                receipt=receipt,
                verified=accepted.verified,
            )

        lease = _ClaimLeaseMonitor(
            control=self._control,
            receipt=receipt,
            clock_unix_millis=self._clock,
            interval_seconds=self._lease_poll_interval,
        )
        lease.start()
        try:
            cancellation: ExecutionCancelled | None = None
            try:
                await lease.check_now()
            except ExecutionCancelled as error:
                cancellation = error

            if cancellation is not None:
                outcome = cancellation
            else:
                try:
                    _raise_if_execution_deadline_exceeded(command, self._clock)
                    _validate_capability_identity(command)
                    grant = self._input_request_builder.build(
                        ClaimBoundInputReference(
                            execution_id=receipt.identity.execution_id,
                            generation=receipt.identity.generation,
                            content_id=accepted.content.content_id,
                            immutable_version=accepted.content.immutable_version,
                            claim_id=accepted.claim_id,
                            fence_token=bytes(receipt.fence.fence_token),
                            expected_length=accepted.content.byte_length,
                            expected_sha256=accepted.content.digest,
                            media_type=accepted.content.media_type,
                        )
                    )
                    raw_settings = await self._input_client.fetch(grant)
                    _raise_if_execution_deadline_exceeded(command, self._clock)
                except WorkerError as error:
                    outcome = error
                else:
                    try:
                        lease.raise_if_failed()
                    except ExecutionCancelled as error:
                        outcome = error
                    else:
                        try:
                            settings = parse_settings_json(raw_settings)
                            request = validation_request_from(
                                accepted.verified,
                                input_bundle_id=receipt.input_bundle.input_bundle_id,
                                input_bundle_digest=bytes(
                                    receipt.input_bundle_ref.digest.value
                                ),
                                settings_entry_version=accepted.content.immutable_version,
                                settings_content_digest=accepted.content.digest,
                                settings=settings,
                            )
                            _raise_if_execution_deadline_exceeded(
                                command,
                                self._clock,
                            )
                            outcome = await self._supervisor.run_sync(
                                self._handler.execute,
                                request,
                            )
                            # A synchronous SDK call cannot be cancelled safely.
                            # Retain claim ownership until it exits, then prevent a
                            # result completed after the durable command deadline
                            # from becoming the first output dispatch.
                            _raise_if_execution_deadline_exceeded(
                                command,
                                self._clock,
                            )
                        except SyncExecutorAdmissionRejected:
                            # No business callable was submitted. Leave the claim
                            # and Redis delivery unacknowledged so the lease can
                            # expire and the scheduler can admit it elsewhere.
                            return DeliveryResult(
                                DeliveryDisposition.RETRY_LATER_NOACK
                            )
                        except WorkerError as error:
                            outcome = error

                try:
                    await lease.check_now()
                except ExecutionCancelled as error:
                    outcome = error

            occurred_at = _runtime_now(self._clock)
            # This is the output linearization boundary. After the first
            # dispatch, stable spool/output identity must win even if the wall
            # clock later crosses the command deadline.
            if (
                not isinstance(outcome, ExecutionCancelled)
                and occurred_at >= int(command.deadline_unix_millis)
            ):
                outcome = DeadlineExceeded()
            frame = build_output_frame(
                accepted.verified,
                outcome,
                occurred_at_unix_millis=occurred_at,
                claim_handoff_watermark=accepted.claim_handoff_watermark,
            )
            frame = await self._publish_with_terminal_linearization(
                frame,
                verified=accepted.verified,
                claim_handoff_watermark=accepted.claim_handoff_watermark,
                initial_output=output,
            )
            # Publication returned only after a bound durable ACK. Do not apply a
            # later wall-clock deadline here: settlement must preserve and finish
            # that immutable output rather than synthesize a replacement.
            receipt_id = await self._prepare_frame_settlement(frame)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(
                DeliveryDisposition.EXECUTED_SETTLED_ACKED,
                output_frame=frame,
                settlement_receipt_id=receipt_id,
            )
        finally:
            await lease.stop()

    async def _recover_local_output(
        self,
        *,
        delivery: RedisCommandDelivery,
        frame: output_pb2.ExecutionOutputFrameV1,
        output: OutputSession,
        receipt: control_pb2.ClaimReceiptV1,
        verified: VerifiedWorkerCommand,
    ) -> DeliveryResult:
        lease = _ClaimLeaseMonitor(
            control=self._control,
            receipt=receipt,
            clock_unix_millis=self._clock,
            interval_seconds=self._lease_poll_interval,
        )
        lease.start()
        try:
            # Attempt the exact spooled frame before consulting a later desired
            # state. Its durable ACK proves that output already won; only the
            # frame-bound ErrOutputCancelled response may authorize replacement.
            frame = await self._publish_with_terminal_linearization(
                frame,
                verified=verified,
                claim_handoff_watermark=int(receipt.claim_handoff_watermark),
                initial_output=output,
            )
            receipt_id = await self._prepare_frame_settlement(frame)
            await self._command_acker.ack_after_settlement(delivery)
            return DeliveryResult(
                DeliveryDisposition.RECOVERED_LOCAL_OUTPUT_SETTLED_ACKED,
                output_frame=frame,
                settlement_receipt_id=receipt_id,
            )
        finally:
            await lease.stop()

    async def _publish_with_terminal_linearization(
        self,
        frame: output_pb2.ExecutionOutputFrameV1,
        *,
        verified: VerifiedWorkerCommand,
        claim_handoff_watermark: int,
        initial_output: OutputSession,
    ) -> output_pb2.ExecutionOutputFrameV1:
        try:
            await self._publish_output(frame, initial_output=initial_output)
            return frame
        except (RuntimeError, OutputCancellationWon, OutputDeadlineWon) as error:
            if _is_output_cancellation_winner(error):
                if _is_cancellation_frame(frame):
                    raise
                replacement_outcome: WorkerError = ExecutionCancelled()
            elif _is_output_deadline_winner(error):
                if _is_deadline_frame(frame):
                    raise
                replacement_outcome = DeadlineExceeded()
            else:
                raise

        replacement = build_output_frame(
            verified,
            replacement_outcome,
            # Preserve the original terminal occurrence time so a crash/replay
            # after the atomic spool CAS remains byte-for-byte identical.
            occurred_at_unix_millis=int(frame.occurred_at_unix_millis),
            claim_handoff_watermark=claim_handoff_watermark,
        )
        replacement_output = self._output_session_factory()
        pending = replacement_output.pending_replay_frame
        if pending is None or not replacement_output.has_pending_replay:
            raise AuthorizationFailure(
                "The durable output spool disappeared before terminal replacement."
            )
        await replacement_output.replace_pending_exact(frame, replacement)
        await self._publish_output(replacement, initial_output=replacement_output)
        return replacement

    async def _prepare_frame_settlement(
        self,
        frame: output_pb2.ExecutionOutputFrameV1,
    ) -> str:
        proposal_raw = frame.settlement_proposal.SerializeToString(deterministic=True)
        settlement = await self._control.prepare_settlement(
            control_pb2.PrepareSettlementRequestV1(
                identity=frame.identity,
                fence=frame.fence,
                proposal=frame.settlement_proposal,
                proposal_digest=common_pb2.DigestV1(
                    algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
                    value=hashlib.sha256(proposal_raw).digest(),
                ),
                idempotency_key=frame.settlement_proposal.prepare_idempotency_key,
            )
        )
        return _settlement_receipt(
            settlement,
            expected_outcome=int(frame.settlement_proposal.requested_outcome),
        )

    async def _publish_output(
        self,
        frame: output_pb2.ExecutionOutputFrameV1,
        *,
        initial_output: OutputSession | None = None,
    ) -> None:
        for attempt in range(self._max_output_sessions):
            output = (
                initial_output
                if attempt == 0 and initial_output is not None
                else self._output_session_factory()
            )
            if output.has_pending_replay and not output.replays(frame):
                raise AuthorizationFailure(
                    "The durable output spool does not match this execution frame."
                )
            try:
                await output.start()
                if not output.has_pending_replay:
                    await output.send(frame)
                await output.wait_for_ack(frame.sequence, self._output_ack_timeout)
                return
            except (RuntimeError, TimeoutError) as exc:
                if attempt + 1 >= self._max_output_sessions or not _reconnectable_output(exc):
                    raise
            finally:
                await output.close()
        raise AssertionError("bounded output session loop did not terminate")


def _claim_receipt(response: control_pb2.ClaimCommandResponseV1) -> control_pb2.ClaimReceiptV1:
    if response.HasField("rejection"):
        if response.HasField("receipt"):
            raise InvalidInput("The claim response is ambiguous.")
        raise _worker_error_from_runtime(response.rejection)
    if not response.HasField("receipt"):
        raise InvalidInput("The claim response is missing its receipt.")
    return response.receipt


def _accepted_claim(
    *,
    signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    command: command_pb2.WorkerCommandV1,
    receipt: control_pb2.ClaimReceiptV1,
    workload_session_id: str,
    producer_id: str,
    now_unix_millis: int,
) -> _AcceptedClaim:
    _validate_active_fence(
        receipt,
        workload_session_id=workload_session_id,
        producer_id=producer_id,
        now_unix_millis=now_unix_millis,
    )
    if receipt.desired_state != common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING:
        raise AuthorizationFailure("The accepted claim desired state is malformed.")
    if not receipt.HasField("input_bundle_ref") or receipt.input_bundle_ref != command.input_bundle_ref:
        raise AuthorizationFailure("The accepted claim changed the immutable input reference.")
    if not receipt.HasField("input_bundle"):
        raise InvalidInput("The accepted claim is missing its input manifest.")

    manifest_raw = receipt.input_bundle.SerializeToString(deterministic=True)
    reference = command.input_bundle_ref
    if (
        len(manifest_raw) != reference.byte_length
        or not hmac.compare_digest(hashlib.sha256(manifest_raw).digest(), reference.digest.value)
    ):
        raise AuthorizationFailure("The accepted claim input manifest does not match its command.")
    manifest = parse_execution_input_bundle(manifest_raw)
    if (
        manifest.input_bundle_id != reference.input_bundle_id
        or manifest.immutable_version != reference.immutable_version
        or not manifest.entries
        or len(manifest.entries) > MAX_BUNDLE_ENTRIES
    ):
        raise InvalidInput("The accepted claim input manifest is malformed.")
    entries = project_input_manifest_entries(manifest)
    selected = [
        entry
        for entry in entries
        if entry.entry_id == command.configuration_validation.settings_entry_id
    ]
    if len(selected) != 1:
        raise InvalidInput("The selected settings entry is absent or ambiguous.")
    entry = selected[0]
    if (
        entry.semantic_role != "configuration.settings"
        or entry.immutable_version != entry.content.immutable_version
        or entry.content.required_grant_audience != "elitea.runtime.input.read.v1"
        or entry.content.byte_length > MAX_SETTINGS_BYTES
    ):
        raise InvalidInput("The selected settings entry is malformed.")

    return _AcceptedClaim(
        verified=_verified_claim_command(signed, command, receipt),
        content=entry.content,
        claim_id=receipt.claim_id,
        claim_handoff_watermark=int(receipt.claim_handoff_watermark),
    )


def _verified_claim_command(
    signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    command: command_pb2.WorkerCommandV1,
    receipt: control_pb2.ClaimReceiptV1,
) -> VerifiedWorkerCommand:
    envelope = envelope_pb2.WorkerExecutionEnvelopeV1()
    envelope.signed_command.CopyFrom(signed)
    envelope.fence.CopyFrom(receipt.fence)
    return VerifiedWorkerCommand(envelope=envelope, command=command)


def _validate_pending_output(
    frame: output_pb2.ExecutionOutputFrameV1,
    *,
    command: command_pb2.WorkerCommandV1,
    receipt: control_pb2.ClaimReceiptV1,
) -> None:
    expected_stream = f"{command.execution_id}:{command.generation}"
    expected_logical_output = (
        "configuration-validation:"
        f"{command.configuration_validation.configuration_revision_id}"
    )
    proposal = frame.settlement_proposal
    if not frame.HasField("identity") or frame.identity != receipt.identity:
        raise AuthorizationFailure(
            "The durable output spool belongs to a different execution identity."
        )
    if not frame.HasField("fence") or frame.fence != receipt.fence:
        raise AuthorizationFailure(
            "The durable output spool uses a different claim fence; "
            "server-side recovery is required."
        )
    if int(frame.claim_handoff_watermark) != int(receipt.claim_handoff_watermark):
        raise AuthorizationFailure(
            "The durable output spool uses a different claim handoff watermark."
        )
    if (
        frame.stream_id != expected_stream
        or frame.logical_output_id != expected_logical_output
        or frame.event_id != f"{command.command_id}:1"
        or frame.sequence != 1
        or not frame.terminal
        or not frame.HasField("settlement_proposal")
        or proposal.proposal_id != f"{command.command_id}:settlement"
        or proposal.terminal_logical_output_id != frame.logical_output_id
        or proposal.terminal_event_id != frame.event_id
        or proposal.terminal_sequence != frame.sequence
        or proposal.terminal_payload_digest != frame.payload_digest
        or proposal.prepare_idempotency_key
        != f"{command.command_id}:prepare-settlement"
        or int(proposal.requested_outcome) not in _TERMINAL_OUTCOMES
    ):
        raise InvalidInput("The durable terminal output frame is malformed.")


def _require_running_desired_state(state: int) -> None:
    if state == common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING:
        return
    if state == common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED:
        raise ExecutionCancelled()
    if state == common_pb2.DESIRED_EXECUTION_STATE_V1_DRAINING:
        raise DependencyUnavailable("The execution is draining.")
    raise InvalidInput("The execution desired state is malformed.")


def _is_output_cancellation_winner(error: BaseException) -> bool:
    if isinstance(error, OutputCancellationWon):
        return True
    return isinstance(error, RuntimeError) and isinstance(
        error.__cause__, OutputCancellationWon
    )


def _is_output_deadline_winner(error: BaseException) -> bool:
    if isinstance(error, OutputDeadlineWon):
        return True
    return isinstance(error, RuntimeError) and isinstance(
        error.__cause__, OutputDeadlineWon
    )


def _is_cancellation_frame(frame: output_pb2.ExecutionOutputFrameV1) -> bool:
    return (
        frame.HasField("runtime_error")
        and frame.runtime_error.code == errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED
        and frame.HasField("settlement_proposal")
        and frame.settlement_proposal.requested_outcome
        == common_pb2.EXECUTION_OUTCOME_V1_CANCELLED
    )


def _is_deadline_frame(frame: output_pb2.ExecutionOutputFrameV1) -> bool:
    return (
        frame.HasField("runtime_error")
        and frame.runtime_error.code
        == errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED
        and frame.runtime_error.safe_message == "The execution deadline was exceeded."
        and frame.runtime_error.retryable
        and frame.HasField("settlement_proposal")
        and frame.settlement_proposal.requested_outcome
        == common_pb2.EXECUTION_OUTCOME_V1_FAILED
    )


def _validate_receipt_identity(
    receipt: control_pb2.ClaimReceiptV1,
    command: command_pb2.WorkerCommandV1,
) -> None:
    expected = common_pb2.ExecutionIdentityV1(
        tenant_id=command.tenant_id,
        resource_project_id=command.resource_project_id,
        projection_project_id=command.projection_project_id,
        command_id=command.command_id,
        execution_id=command.execution_id,
        generation=command.generation,
    )
    if not receipt.HasField("identity") or receipt.identity != expected:
        raise AuthorizationFailure("The claim receipt identity does not match its command.")


def _validate_obsolete_receipt(receipt: control_pb2.ClaimReceiptV1) -> None:
    _require_no_worker_authority(receipt)
    if receipt.desired_state != common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED:
        raise InvalidInput("The obsolete claim receipt desired state is malformed.")


def _validate_retired_receipt(receipt: control_pb2.ClaimReceiptV1) -> None:
    _require_no_worker_authority(receipt)
    if int(receipt.desired_state) not in _KNOWN_DESIRED_STATES:
        raise InvalidInput("The retired claim receipt desired state is malformed.")
    if not receipt.HasField("retirement"):
        raise InvalidInput("The retired claim receipt is missing its retirement detail.")
    retirement = receipt.retirement
    if (
        retirement.code != errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED
        or retirement.safe_message != _DEADLINE_RETIREMENT_SAFE_MESSAGE
        or not retirement.retryable
    ):
        raise InvalidInput("The retired claim receipt detail is malformed.")


def _require_no_worker_authority(receipt: control_pb2.ClaimReceiptV1) -> None:
    if (
        receipt.HasField("fence")
        or receipt.lease_expires_at_unix_millis != 0
        or receipt.HasField("input_bundle_ref")
        or receipt.HasField("input_bundle")
        or receipt.claim_handoff_watermark != 0
        or receipt.claim_id
        or receipt.HasField("settlement_recovery")
    ):
        raise InvalidInput(
            "The no-authority claim receipt contains worker authority or business material."
        )


def _validate_active_fence(
    receipt: control_pb2.ClaimReceiptV1,
    *,
    workload_session_id: str,
    producer_id: str,
    now_unix_millis: int,
) -> None:
    if (
        not receipt.HasField("fence")
        or receipt.fence.workload_session_id != workload_session_id
        or receipt.fence.producer_id != producer_id
        or receipt.fence.claim_attempt < 1
        or receipt.fence.lease_epoch < 1
        or len(receipt.fence.fence_token) != 32
        or not _bounded_text(receipt.claim_id)
        or receipt.lease_expires_at_unix_millis <= now_unix_millis
    ):
        raise AuthorizationFailure("The claim fence is malformed or expired.")


def _terminal_ack_recovery(
    receipt: control_pb2.ClaimReceiptV1,
) -> control_pb2.SettlementRecoveryV1:
    if not receipt.HasField("settlement_recovery"):
        raise InvalidInput("The terminal ACK recovery receipt is missing.")
    recovery = receipt.settlement_recovery
    if (
        not recovery.HasField("proposal")
        or not recovery.HasField("proposal_digest")
        or not _bounded_text(recovery.idempotency_key)
        or recovery.settlement_receipt_id
        or recovery.outcome != common_pb2.EXECUTION_OUTCOME_V1_UNSPECIFIED
    ):
        raise InvalidInput("The terminal ACK recovery receipt is malformed.")
    proposal = recovery.proposal
    if (
        not _bounded_text(proposal.proposal_id)
        or not _bounded_text(proposal.terminal_logical_output_id)
        or not _bounded_text(proposal.terminal_event_id)
        or not _bounded_text(proposal.prepare_idempotency_key)
        or recovery.idempotency_key != proposal.prepare_idempotency_key
        or proposal.terminal_sequence < 1
        or int(proposal.requested_outcome) not in _TERMINAL_OUTCOMES
        or not _valid_sha256(proposal.terminal_payload_digest)
        or not _valid_sha256(recovery.proposal_digest)
    ):
        raise InvalidInput("The terminal ACK recovery proposal is malformed.")
    proposal_raw = proposal.SerializeToString(deterministic=True)
    if not hmac.compare_digest(
        hashlib.sha256(proposal_raw).digest(),
        recovery.proposal_digest.value,
    ):
        raise AuthorizationFailure("The terminal ACK recovery proposal digest is invalid.")
    return recovery


def _prepared_settlement_recovery(
    receipt: control_pb2.ClaimReceiptV1,
) -> control_pb2.SettlementRecoveryV1:
    if not receipt.HasField("settlement_recovery"):
        raise InvalidInput("The prepared settlement recovery receipt is missing.")
    recovery = receipt.settlement_recovery
    if (
        recovery.HasField("proposal")
        or recovery.HasField("proposal_digest")
        or recovery.idempotency_key
        or not _bounded_text(recovery.settlement_receipt_id)
        or int(recovery.outcome) not in _TERMINAL_OUTCOMES
    ):
        raise InvalidInput("The prepared settlement recovery receipt is malformed.")
    return recovery


def _require_no_recovery(receipt: control_pb2.ClaimReceiptV1) -> None:
    if receipt.HasField("settlement_recovery"):
        raise InvalidInput("The claim disposition has unexpected recovery material.")


def _validate_capability_identity(command: command_pb2.WorkerCommandV1) -> None:
    selected = command.configuration_validation
    if selected.configuration_type != CONFIGURATION_TYPE:
        raise UnsupportedCapability("Configuration type is not supported.")
    if (
        selected.catalog_revision != CONFIGURATION_CATALOG_REVISION
        or selected.catalog_digest.value.hex() != CONFIGURATION_CATALOG_SHA256
        or selected.schema_id != OPENAPI_SCHEMA_ID
        or selected.schema_revision != OPENAPI_SCHEMA_REVISION
        or selected.schema_digest.value.hex() != OPENAPI_SCHEMA_SHA256
    ):
        raise IncompatibleVersion()


def _settlement_receipt(
    response: control_pb2.PrepareSettlementResponseV1,
    *,
    expected_outcome: int,
) -> str:
    if response.HasField("rejection"):
        raise _worker_error_from_runtime(response.rejection)
    if (
        not _bounded_text(response.settlement_receipt_id)
        or int(response.outcome) != expected_outcome
    ):
        raise InvalidInput("The settlement receipt is malformed.")
    return response.settlement_receipt_id


def _worker_error_from_runtime(error: errors_pb2.RuntimeErrorV1) -> WorkerError:
    code = int(error.code)
    if code == errors_pb2.RUNTIME_ERROR_CODE_V1_UNSUPPORTED_CAPABILITY:
        return UnsupportedCapability()
    if code == errors_pb2.RUNTIME_ERROR_CODE_V1_INCOMPATIBLE_VERSION:
        return IncompatibleVersion()
    if code in {
        errors_pb2.RUNTIME_ERROR_CODE_V1_INVALID_INPUT,
        errors_pb2.RUNTIME_ERROR_CODE_V1_PROTOCOL_VIOLATION,
    }:
        return InvalidInput()
    if code == errors_pb2.RUNTIME_ERROR_CODE_V1_RESOURCE_EXHAUSTED:
        return ResourceExhausted()
    if code in {
        errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHENTICATION_FAILED,
        errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHORIZATION_FAILED,
        errors_pb2.RUNTIME_ERROR_CODE_V1_STALE_FENCE,
    }:
        return AuthorizationFailure()
    if code == errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED:
        return ExecutionCancelled()
    if code == errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED:
        return DeadlineExceeded()
    if code in {
        errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
        errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL,
    }:
        return DependencyUnavailable()
    return InvalidInput("The runtime control response is malformed.")


def _bounded_text(value: str) -> bool:
    return bool(value) and len(value.encode("utf-8")) <= MAX_SAFE_STRING_BYTES


def _valid_sha256(value: common_pb2.DigestV1) -> bool:
    return (
        value.algorithm == common_pb2.DIGEST_ALGORITHM_V1_SHA256
        and len(value.value) == 32
    )


def _runtime_now(clock: Callable[[], int]) -> int:
    value = clock()
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise InvalidInput("The runtime clock is malformed.")
    return value


def _raise_if_execution_deadline_exceeded(
    command: command_pb2.WorkerCommandV1,
    clock: Callable[[], int],
) -> None:
    if _runtime_now(clock) >= int(command.deadline_unix_millis):
        raise DeadlineExceeded()


def _reconnectable_output(error: RuntimeError | TimeoutError) -> bool:
    if isinstance(error, TimeoutError):
        return True
    cause = error.__cause__
    return not isinstance(
        cause,
        (AuthorizationFailure, DeadlineExceeded, ExecutionCancelled, InvalidInput),
    )
