"""Typed output stream with independent receive, bounded credit and ACK safety.

A new session validates and replays a bounded encrypted local spool before it
admits new frames. Cross-node key distribution and live transport composition
remain explicit production gates; this module does not invent either policy.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from typing import Protocol

import grpc
from elitea.runtime.v1 import common_pb2, errors_pb2, output_pb2

from elitea_worker.constants import MAX_GRPC_REQUEST_BYTES, MAX_GRPC_RESPONSE_BYTES

from elitea_worker.execution.errors import (
    AuthorizationFailure,
    DependencyUnavailable,
    ExecutionCancelled,
    InvalidInput,
    OutputCancellationWon,
    OutputDeadlineWon,
    ResourceExhausted,
)
from elitea_worker.protocol.codec import parse_execution_output_frame
from elitea_worker.transport.output_spool import EncryptedOutputSpool, SpooledFrame


class OutputStreamCall(Protocol):
    def __aiter__(self) -> AsyncIterator[output_pb2.ExecutionOutputAckV1]: ...
    async def write(self, frame: output_pb2.ExecutionOutputFrameV1) -> None: ...
    async def done_writing(self) -> None: ...
    def cancel(self) -> bool: ...


class GeneratedOutputStub(Protocol):
    def Publish(
        self,
        *,
        timeout: float,
        metadata: tuple[tuple[str, str], ...],
    ) -> OutputStreamCall: ...


@dataclass(frozen=True, slots=True)
class _QueuedFrame:
    message: output_pb2.ExecutionOutputFrameV1
    sequence: int
    encoded_bytes: int


_STOP = object()
_MAX_SEQUENCE = (1 << 64) - 1
_DEADLINE_EXCEEDED_SAFE_MESSAGE = "The execution deadline was exceeded."


def secure_output_channel(
    target: str,
    *,
    root_certificates: bytes,
    certificate_chain: bytes,
    private_key: bytes,
) -> grpc.aio.Channel:
    if not target or not all((root_certificates, certificate_chain, private_key)):
        raise ValueError("verified target and workload certificates are required")
    credentials = grpc.ssl_channel_credentials(
        root_certificates=root_certificates,
        private_key=private_key,
        certificate_chain=certificate_chain,
    )
    return grpc.aio.secure_channel(
        target,
        credentials,
        options=(
            ("grpc.max_send_message_length", MAX_GRPC_REQUEST_BYTES),
            ("grpc.max_receive_message_length", MAX_GRPC_RESPONSE_BYTES),
        ),
    )


class OutputGrpcSession:
    def __init__(
        self,
        stub: GeneratedOutputStub,
        *,
        spool: EncryptedOutputSpool,
        metadata: Callable[[], tuple[tuple[str, str], ...]],
        max_queued_frames: int,
        max_queued_bytes: int,
        max_frame_bytes: int,
        max_server_credit_frames: int | None = None,
        max_server_credit_bytes: int | None = None,
        stream_deadline_seconds: float = 300.0,
    ) -> None:
        if min(max_queued_frames, max_queued_bytes, max_frame_bytes) < 1:
            raise ValueError("output queue limits must be positive")
        if max_frame_bytes > max_queued_bytes:
            raise ValueError("one output frame must fit inside the bounded queue")
        if stream_deadline_seconds <= 0:
            raise ValueError("stream_deadline_seconds must be positive")
        self._stub = stub
        self._spool = spool
        self._metadata = metadata
        self._max_queued_frames = max_queued_frames
        self._max_queued_bytes = max_queued_bytes
        self._max_frame_bytes = max_frame_bytes
        self._max_server_credit_frames = max_server_credit_frames or max_queued_frames
        self._max_server_credit_bytes = max_server_credit_bytes or max_queued_bytes
        self._stream_deadline = stream_deadline_seconds
        self._queue: asyncio.Queue[_QueuedFrame | object] = asyncio.Queue(max_queued_frames)
        self._condition = asyncio.Condition()
        self._send_admission = asyncio.Lock()
        self._queued_frames = 0
        self._queued_bytes = 0
        self._credit_frames = 0
        self._credit_bytes = 0
        self._acked_sequence = 0
        self._highest_admitted_sequence = 0
        self._highest_transmitted_sequence = 0
        self._failure: BaseException | None = None
        self._draining = False
        self._closing = False
        self._stream_id: str | None = None
        self._identity_bytes: bytes | None = None
        self._fence_bytes: bytes | None = None
        self._claim_handoff_watermark: int | None = None
        self._bootstrap_credit_received = False
        self._call: OutputStreamCall | None = None
        self._send_task: asyncio.Task[None] | None = None
        self._receive_task: asyncio.Task[None] | None = None
        self._replay_task: asyncio.Task[None] | None = None
        self._replay_done = asyncio.Event()
        self._pending_replay = self._restore_pending(spool.pending())
        if not self._pending_replay:
            self._replay_done.set()

    @property
    def acknowledged_sequence(self) -> int:
        return self._acked_sequence

    @property
    def has_pending_replay(self) -> bool:
        return bool(self._pending_replay)

    @property
    def pending_replay_frame(self) -> output_pb2.ExecutionOutputFrameV1 | None:
        """Return a defensive copy of the last durable frame, if one exists."""

        if not self._pending_replay:
            return None
        encoded = self._pending_replay[-1].message.SerializeToString(deterministic=True)
        return output_pb2.ExecutionOutputFrameV1.FromString(encoded)

    def replays(self, frame: output_pb2.ExecutionOutputFrameV1) -> bool:
        encoded = frame.SerializeToString(deterministic=True)
        return any(
            queued.sequence == int(frame.sequence)
            and queued.message.SerializeToString(deterministic=True) == encoded
            for queued in self._pending_replay
        )

    async def reconcile_pending_through(self, sequence: int) -> None:
        """Clear frames covered by an authenticated durable server watermark.

        The caller owns validation of the control-plane receipt that supplied
        the watermark. This fresh-session operation is the only non-output-ACK
        path that may retire stale-fence spool entries.
        """

        if self._call is not None or self._closing:
            raise RuntimeError("output reconciliation requires a fresh session")
        if sequence < 1 or sequence > _MAX_SEQUENCE:
            raise InvalidInput("The output reconciliation watermark is malformed.")
        if not self._pending_replay:
            return
        if sequence < self._pending_replay[-1].sequence:
            raise AuthorizationFailure(
                "The output reconciliation watermark does not cover the durable spool."
            )
        await asyncio.to_thread(self._spool.acknowledge_through, sequence)
        self._pending_replay = ()
        self._acked_sequence = sequence
        self._replay_done.set()

    async def replace_pending_exact(
        self,
        expected: output_pb2.ExecutionOutputFrameV1,
        replacement: output_pb2.ExecutionOutputFrameV1,
    ) -> None:
        """CAS one restored frame after a bound server terminal winner."""

        if self._call is not None or self._closing:
            raise RuntimeError("output replacement requires a fresh, unstarted session")
        if len(self._pending_replay) != 1 or not self.replays(expected):
            raise AuthorizationFailure(
                "The durable output spool changed before terminal replacement."
            )
        expected_sequence = int(expected.sequence)
        if int(replacement.sequence) != expected_sequence:
            raise InvalidInput("Terminal replacement changed the output sequence.")
        encoded_expected = expected.SerializeToString(deterministic=True)
        encoded_replacement = replacement.SerializeToString(deterministic=True)
        if len(encoded_replacement) > self._max_frame_bytes:
            raise ResourceExhausted("The replacement output frame exceeds the transport limit.")
        self._bind_frame_identity(replacement)
        await asyncio.to_thread(
            self._spool.replace_exact,
            expected_sequence,
            encoded_expected,
            encoded_replacement,
        )
        self._pending_replay = (
            _QueuedFrame(replacement, expected_sequence, len(encoded_replacement)),
        )

    async def replace_pending_cancelled_recovery(
        self,
        expected: output_pb2.ExecutionOutputFrameV1,
        replacement: output_pb2.ExecutionOutputFrameV1,
    ) -> None:
        """CAS an authenticated cancelled recovery across a replacement fence.

        This is deliberately narrower than :meth:`replace_pending_exact`: it
        preserves the execution stream, identity, and exact sequence while
        allowing only the new recovery fence to advance the handoff watermark
        to the contiguous predecessor of that sequence. This permits an
        authenticated replacement claim to discard uncommitted old-fence
        progress without creating a sequence gap.
        """

        if self._call is not None or self._closing:
            raise RuntimeError("output replacement requires a fresh, unstarted session")
        if len(self._pending_replay) != 1 or not self.replays(expected):
            raise AuthorizationFailure(
                "The durable output spool changed before cancellation recovery."
            )
        if int(replacement.sequence) != int(expected.sequence):
            raise InvalidInput("Cancellation recovery changed the output sequence.")
        self._validate_cancelled_recovery_rebind(expected, replacement)
        encoded_expected = expected.SerializeToString(deterministic=True)
        encoded_replacement = replacement.SerializeToString(deterministic=True)
        if len(encoded_replacement) > self._max_frame_bytes:
            raise ResourceExhausted("The replacement output frame exceeds the transport limit.")
        await asyncio.to_thread(
            self._spool.replace_exact,
            int(expected.sequence),
            encoded_expected,
            encoded_replacement,
        )
        self._stream_id = replacement.stream_id
        self._identity_bytes = replacement.identity.SerializeToString(deterministic=True)
        self._fence_bytes = replacement.fence.SerializeToString(deterministic=True)
        self._claim_handoff_watermark = int(replacement.claim_handoff_watermark)
        self._pending_replay = (
            _QueuedFrame(replacement, int(replacement.sequence), len(encoded_replacement)),
        )

    async def start(self) -> None:
        if self._call is not None or self._closing:
            raise RuntimeError("output session is already started or closed")
        self._call = self._stub.Publish(
            timeout=self._stream_deadline,
            metadata=_validated_metadata(self._metadata()),
        )
        self._send_task = asyncio.create_task(self._send_loop(), name="elitea-output-send")
        self._receive_task = asyncio.create_task(self._receive_loop(), name="elitea-output-receive")
        if self._pending_replay:
            self._replay_task = asyncio.create_task(
                self._replay_pending(),
                name="elitea-output-replay",
            )

    async def send(self, frame: output_pb2.ExecutionOutputFrameV1) -> None:
        await self._replay_done.wait()
        async with self._send_admission:
            self._raise_if_unavailable()
            if self._call is None:
                raise RuntimeError("output session is not started")
            sequence = int(frame.sequence)
            if sequence < 1 or sequence > _MAX_SEQUENCE:
                raise InvalidInput("Output sequence is outside the uint64 contract.")
            encoded = frame.SerializeToString(deterministic=True)
            if len(encoded) > self._max_frame_bytes:
                raise ResourceExhausted("The output frame exceeds the transport limit.")
            self._bind_frame_identity(frame)
            if self._highest_admitted_sequence:
                if sequence != self._highest_admitted_sequence + 1:
                    raise InvalidInput(
                        "Output sequences must be contiguous and allocated exactly once."
                    )
            elif sequence <= int(self._claim_handoff_watermark or 0):
                raise InvalidInput(
                    "Output sequences must advance beyond the claim handoff watermark."
                )
            async with self._condition:
                await self._condition.wait_for(
                    lambda: self._failure is not None
                    or self._draining
                    or self._closing
                    or (
                        self._queued_frames < self._max_queued_frames
                        and self._queued_bytes + len(encoded) <= self._max_queued_bytes
                    )
                )
                self._raise_if_unavailable()
            await asyncio.to_thread(self._spool.put, sequence, encoded)
            async with self._condition:
                self._raise_if_unavailable()
                self._highest_admitted_sequence = sequence
                self._queued_frames += 1
                self._queued_bytes += len(encoded)
                self._queue.put_nowait(_QueuedFrame(frame, sequence, len(encoded)))

    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None:
        if sequence < 1 or timeout_seconds <= 0:
            raise ValueError("ACK sequence and timeout must be positive")
        async with asyncio.timeout(timeout_seconds):
            async with self._condition:
                await self._condition.wait_for(
                    lambda: self._acked_sequence >= sequence or self._failure is not None
                )
                if self._acked_sequence < sequence:
                    self._raise_if_unavailable()

    async def close(self) -> None:
        if self._call is None:
            return
        self._closing = True
        async with self._condition:
            self._condition.notify_all()
        if self._replay_task is not None and not self._replay_task.done():
            self._replay_task.cancel()
            await asyncio.gather(self._replay_task, return_exceptions=True)
        try:
            self._queue.put_nowait(_STOP)
        except asyncio.QueueFull:
            if self._send_task is not None:
                self._send_task.cancel()
        if self._send_task is not None:
            await asyncio.gather(self._send_task, return_exceptions=True)
        self._call.cancel()
        if self._receive_task is not None:
            self._receive_task.cancel()
            await asyncio.gather(self._receive_task, return_exceptions=True)
        self._call = None

    async def _replay_pending(self) -> None:
        try:
            for item in self._pending_replay:
                async with self._condition:
                    await self._condition.wait_for(
                        lambda: self._failure is not None
                        or self._draining
                        or self._closing
                        or (
                            self._queued_frames < self._max_queued_frames
                            and self._queued_bytes + item.encoded_bytes
                            <= self._max_queued_bytes
                        )
                    )
                    self._raise_if_unavailable()
                    self._queued_frames += 1
                    self._queued_bytes += item.encoded_bytes
                    self._queue.put_nowait(item)
                    await self._condition.wait_for(
                        lambda: self._failure is not None
                        or self._draining
                        or self._closing
                        or self._acked_sequence >= item.sequence
                    )
                    if self._acked_sequence < item.sequence:
                        self._raise_if_unavailable()
        except asyncio.CancelledError:
            if not self._closing:
                await self._record_failure(RuntimeError("output replay task was cancelled"))
            raise
        except BaseException as exc:
            await self._record_failure(exc)
        finally:
            self._replay_done.set()

    async def _send_loop(self) -> None:
        assert self._call is not None
        try:
            while True:
                item = await self._queue.get()
                if item is _STOP:
                    await self._call.done_writing()
                    return
                assert isinstance(item, _QueuedFrame)
                async with self._condition:
                    await self._condition.wait_for(
                        lambda: self._failure is not None
                        or self._draining
                        or self._closing
                        or (
                            self._credit_frames >= 1
                            and self._credit_bytes >= item.encoded_bytes
                        )
                    )
                    self._raise_if_unavailable()
                    self._credit_frames -= 1
                    self._credit_bytes -= item.encoded_bytes
                    self._highest_transmitted_sequence = item.sequence
                await self._call.write(item.message)
                async with self._condition:
                    self._queued_frames -= 1
                    self._queued_bytes -= item.encoded_bytes
                    self._condition.notify_all()
        except asyncio.CancelledError:
            if not self._closing:
                await self._record_failure(RuntimeError("output send task was cancelled"))
            raise
        except BaseException as exc:
            await self._record_failure(exc)

    async def _receive_loop(self) -> None:
        assert self._call is not None
        try:
            async for ack in self._call:
                await self._accept_ack(ack)
            if not self._closing:
                raise RuntimeError("output stream closed before local shutdown")
        except asyncio.CancelledError:
            if not self._closing:
                await self._record_failure(RuntimeError("output receive task was cancelled"))
            raise
        except BaseException as exc:
            await self._record_failure(exc)

    async def _accept_ack(self, ack: output_pb2.ExecutionOutputAckV1) -> None:
        rejection = int(ack.rejection.code)
        if rejection != errors_pb2.RUNTIME_ERROR_CODE_V1_UNSPECIFIED:
            if rejection == errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED:
                self._validate_cancellation_winner(ack)
                raise OutputCancellationWon()
            if rejection == errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED:
                self._validate_deadline_winner(ack)
                raise OutputDeadlineWon()
            if rejection in {
                errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHENTICATION_FAILED,
                errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHORIZATION_FAILED,
                errors_pb2.RUNTIME_ERROR_CODE_V1_STALE_FENCE,
            }:
                raise AuthorizationFailure("The output stream was rejected.")
            if (
                rejection
                in {
                    errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
                    errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL,
                }
                and ack.rejection.retryable
            ):
                self._validate_retryable_rejection(ack)
                raise DependencyUnavailable()
            raise InvalidInput("The output service rejected a frame or stream.")
        if ack.desired_state == common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED:
            raise ExecutionCancelled("Execution cancellation was observed on output control.")
        if ack.desired_state not in {
            common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
            common_pb2.DESIRED_EXECUTION_STATE_V1_DRAINING,
        }:
            raise InvalidInput("The output desired state is malformed.")
        credit_frames = int(ack.credit_frames)
        credit_bytes = int(ack.credit_bytes)
        if (
            credit_frames > self._max_server_credit_frames
            or credit_bytes > self._max_server_credit_bytes
        ):
            raise InvalidInput("Output control credit exceeds the negotiated limit.")
        has_ack_binding = bool(ack.stream_id) or ack.HasField("identity") or ack.HasField("fence")
        acknowledged = int(ack.committed_contiguous_sequence)
        if not has_ack_binding:
            if (
                acknowledged != 0
                or int(ack.claim_handoff_watermark) != 0
                or self._bootstrap_credit_received
                or ack.desired_state
                != common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING
            ):
                # An identity-free ACK is permitted exactly once as the
                # server's bounded bootstrap credit, never as a durable ACK.
                raise AuthorizationFailure("The output ACK identity does not match its stream.")
            self._bootstrap_credit_received = True
            async with self._condition:
                self._credit_frames = credit_frames
                self._credit_bytes = credit_bytes
                self._condition.notify_all()
            return
        else:
            if (
                self._stream_id is None
                or not ack.stream_id
                or not ack.HasField("identity")
                or not ack.HasField("fence")
                or ack.stream_id != self._stream_id
                or ack.identity.SerializeToString(deterministic=True) != self._identity_bytes
                or ack.fence.SerializeToString(deterministic=True) != self._fence_bytes
                or int(ack.claim_handoff_watermark) != self._claim_handoff_watermark
            ):
                raise AuthorizationFailure("The output ACK identity does not match its stream.")
            if acknowledged < self._acked_sequence:
                raise InvalidInput("The output ACK watermark moved backwards.")
            if acknowledged > self._highest_transmitted_sequence:
                raise InvalidInput("The output ACK exceeds the highest transmitted sequence.")
        if acknowledged > self._acked_sequence:
            await asyncio.to_thread(self._spool.acknowledge_through, acknowledged)
            self._pending_replay = tuple(
                queued
                for queued in self._pending_replay
                if queued.sequence > acknowledged
            )
        async with self._condition:
            self._acked_sequence = acknowledged
            self._credit_frames = credit_frames
            self._credit_bytes = credit_bytes
            self._draining = (
                ack.desired_state == common_pb2.DESIRED_EXECUTION_STATE_V1_DRAINING
            )
            self._condition.notify_all()

    def _validate_cancellation_winner(
        self, ack: output_pb2.ExecutionOutputAckV1
    ) -> None:
        if (
            self._stream_id is None
            or ack.desired_state
            != common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED
            or ack.committed_contiguous_sequence != 0
            or ack.credit_frames != 0
            or ack.credit_bytes != 0
            or not ack.stream_id
            or not ack.HasField("identity")
            or not ack.HasField("fence")
            or ack.stream_id != self._stream_id
            or ack.identity.SerializeToString(deterministic=True)
            != self._identity_bytes
            or ack.fence.SerializeToString(deterministic=True) != self._fence_bytes
            or int(ack.claim_handoff_watermark) != self._claim_handoff_watermark
            or ack.rejection.retryable
        ):
            raise AuthorizationFailure(
                "The output cancellation winner is not bound to its exact frame."
            )

    def _validate_deadline_winner(
        self, ack: output_pb2.ExecutionOutputAckV1
    ) -> None:
        if (
            self._stream_id is None
            or ack.desired_state
            != common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING
            or ack.committed_contiguous_sequence != 0
            or ack.credit_frames != 0
            or ack.credit_bytes != 0
            or not ack.stream_id
            or not ack.HasField("identity")
            or not ack.HasField("fence")
            or ack.stream_id != self._stream_id
            or ack.identity.SerializeToString(deterministic=True)
            != self._identity_bytes
            or ack.fence.SerializeToString(deterministic=True) != self._fence_bytes
            or int(ack.claim_handoff_watermark) != self._claim_handoff_watermark
            or ack.rejection.safe_message != _DEADLINE_EXCEEDED_SAFE_MESSAGE
            or not ack.rejection.retryable
        ):
            raise AuthorizationFailure(
                "The output deadline winner is not bound to its exact frame."
            )

    def _validate_retryable_rejection(
        self, ack: output_pb2.ExecutionOutputAckV1
    ) -> None:
        if (
            self._stream_id is None
            or ack.desired_state
            != common_pb2.DESIRED_EXECUTION_STATE_V1_UNSPECIFIED
            or ack.committed_contiguous_sequence != 0
            or ack.credit_frames != 0
            or ack.credit_bytes != 0
            or not ack.stream_id
            or not ack.HasField("identity")
            or not ack.HasField("fence")
            or ack.stream_id != self._stream_id
            or ack.identity.SerializeToString(deterministic=True)
            != self._identity_bytes
            or ack.fence.SerializeToString(deterministic=True) != self._fence_bytes
            or int(ack.claim_handoff_watermark) != self._claim_handoff_watermark
        ):
            raise AuthorizationFailure(
                "The retryable output rejection is not bound to its exact frame."
            )

    def _bind_frame_identity(self, frame: output_pb2.ExecutionOutputFrameV1) -> None:
        if not frame.stream_id or not frame.HasField("identity") or not frame.HasField("fence"):
            raise InvalidInput("The output frame identity is incomplete.")
        identity = frame.identity.SerializeToString(deterministic=True)
        fence = frame.fence.SerializeToString(deterministic=True)
        if self._stream_id is None:
            self._stream_id = frame.stream_id
            self._identity_bytes = identity
            self._fence_bytes = fence
            self._claim_handoff_watermark = int(frame.claim_handoff_watermark)
        elif (
            frame.stream_id != self._stream_id
            or identity != self._identity_bytes
            or fence != self._fence_bytes
            or int(frame.claim_handoff_watermark) != self._claim_handoff_watermark
        ):
            raise AuthorizationFailure("Output frame identity changed within one stream.")

    def _validate_cancelled_recovery_rebind(
        self,
        expected: output_pb2.ExecutionOutputFrameV1,
        replacement: output_pb2.ExecutionOutputFrameV1,
    ) -> None:
        if (
            not expected.HasField("identity")
            or not expected.HasField("fence")
            or not replacement.HasField("identity")
            or not replacement.HasField("fence")
            or expected.terminal
            or not replacement.terminal
            or expected.stream_id != replacement.stream_id
            or expected.identity.SerializeToString(deterministic=True)
            != replacement.identity.SerializeToString(deterministic=True)
            or int(replacement.claim_handoff_watermark)
            < int(expected.claim_handoff_watermark)
            or int(replacement.claim_handoff_watermark)
            != int(replacement.sequence) - 1
            or int(replacement.runtime_error.code)
            != errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED
            or not replacement.HasField("settlement_proposal")
            or replacement.settlement_proposal.requested_outcome
            != common_pb2.EXECUTION_OUTCOME_V1_CANCELLED
        ):
            raise AuthorizationFailure(
                "The cancellation recovery replacement is not exactly bound."
            )
        if (
            self._stream_id != expected.stream_id
            or self._identity_bytes
            != expected.identity.SerializeToString(deterministic=True)
            or self._fence_bytes != expected.fence.SerializeToString(deterministic=True)
            or self._claim_handoff_watermark
            != int(expected.claim_handoff_watermark)
        ):
            raise AuthorizationFailure(
                "The durable output spool identity changed before cancellation recovery."
            )

    def _restore_pending(
        self,
        pending: tuple[SpooledFrame, ...],
    ) -> tuple[_QueuedFrame, ...]:
        if not pending:
            return ()
        restored: list[_QueuedFrame] = []
        previous: int | None = None
        for spooled in pending:
            sequence = int(spooled.sequence)
            if sequence < 1 or sequence > _MAX_SEQUENCE:
                raise InvalidInput("A spooled output sequence is malformed.")
            if previous is not None and sequence != previous + 1:
                raise InvalidInput("Spooled output sequences must be contiguous.")
            frame = parse_execution_output_frame(
                spooled.payload,
                max_frame_bytes=self._max_frame_bytes,
            )
            if int(frame.sequence) != sequence:
                raise InvalidInput("A spooled output sequence does not match its frame.")
            self._bind_frame_identity(frame)
            restored.append(_QueuedFrame(frame, sequence, len(spooled.payload)))
            previous = sequence
        assert previous is not None
        self._acked_sequence = restored[0].sequence - 1
        self._highest_admitted_sequence = previous
        return tuple(restored)

    async def _record_failure(self, exc: BaseException) -> None:
        async with self._condition:
            if self._failure is None:
                self._failure = exc
            self._condition.notify_all()

    def _raise_if_unavailable(self) -> None:
        if self._failure is not None:
            raise RuntimeError("output stream is unavailable") from self._failure
        if self._closing:
            raise RuntimeError("output stream is closed")
        if self._draining:
            raise RuntimeError("output stream is draining")


def _validated_metadata(
    metadata: tuple[tuple[str, str], ...],
) -> tuple[tuple[str, str], ...]:
    allowed = {"x-elitea-workload-session", "x-elitea-producer-id"}
    result: list[tuple[str, str]] = []
    seen: set[str] = set()
    for name, value in metadata:
        normalized = name.lower()
        if (
            normalized not in allowed
            or normalized in seen
            or not value
            or len(value.encode("utf-8")) > 256
            or "\r" in value
            or "\n" in value
        ):
            raise ValueError("output gRPC metadata is not allowlisted")
        seen.add(normalized)
        result.append((normalized, value))
    if "x-elitea-workload-session" not in seen:
        raise ValueError("output gRPC metadata is not allowlisted")
    return tuple(result)
