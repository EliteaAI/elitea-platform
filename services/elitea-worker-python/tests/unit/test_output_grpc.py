from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
from elitea.runtime.v1 import common_pb2, errors_pb2, output_pb2

from elitea_worker.execution.errors import (
    AuthorizationFailure,
    DependencyUnavailable,
    InvalidInput,
    OutputCancellationWon,
    OutputDeadlineWon,
)
from elitea_worker.transport.output_grpc import OutputGrpcSession
from elitea_worker.transport.output_spool import EncryptedOutputSpool


class FakeCall:
    def __init__(self) -> None:
        self.controls: asyncio.Queue[output_pb2.ExecutionOutputAckV1 | None] = (
            asyncio.Queue()
        )
        self.writes: list[output_pb2.ExecutionOutputFrameV1] = []
        self.write_gate = asyncio.Event()
        self.cancelled = False
        self.done = False

    def __aiter__(self):
        return self

    async def __anext__(self) -> output_pb2.ExecutionOutputAckV1:
        value = await self.controls.get()
        if value is None:
            raise StopAsyncIteration
        return value

    async def write(self, frame: output_pb2.ExecutionOutputFrameV1) -> None:
        await self.write_gate.wait()
        self.writes.append(frame)

    async def done_writing(self) -> None:
        self.done = True
        await self.controls.put(None)

    def cancel(self) -> bool:
        self.cancelled = True
        return True


class Stub:
    def __init__(self, call: FakeCall) -> None:
        self.call = call
        self.kwargs: dict[str, object] | None = None

    def Publish(self, **kwargs: object) -> FakeCall:
        self.kwargs = kwargs
        return self.call


def _spool(tmp_path: Path) -> EncryptedOutputSpool:
    return EncryptedOutputSpool(
        tmp_path / "spool",
        key=b"k" * 32,
        stream_aad=b"stream-1",
        max_frames=4,
        max_bytes=4096,
        max_frame_bytes=1024,
    )


def _frame(sequence: int) -> output_pb2.ExecutionOutputFrameV1:
    frame = output_pb2.ExecutionOutputFrameV1(
        output_schema_revision="elitea.runtime.execution-output.v1",
        stream_id="stream-1",
        logical_output_id=f"logical-{sequence}",
        event_id=f"event-{sequence}",
        sequence=sequence,
        occurred_at_unix_millis=1_700_000_000_000,
    )
    frame.identity.tenant_id = "tenant-1"
    frame.identity.resource_project_id = "resource-1"
    frame.identity.projection_project_id = "projection-1"
    frame.identity.command_id = "command-1"
    frame.identity.execution_id = "execution-1"
    frame.identity.generation = 1
    frame.fence.workload_session_id = "session-1"
    frame.fence.claim_attempt = 1
    frame.fence.lease_epoch = 1
    frame.fence.producer_id = "worker-1"
    frame.fence.fence_token = b"f" * 32
    return frame


def _ack(
    sequence: int,
    *,
    credit_frames: int = 1,
    credit_bytes: int = 1024,
    bind_identity: bool = False,
    frame: output_pb2.ExecutionOutputFrameV1 | None = None,
) -> output_pb2.ExecutionOutputAckV1:
    ack = output_pb2.ExecutionOutputAckV1(
        committed_contiguous_sequence=sequence,
        credit_frames=credit_frames,
        credit_bytes=credit_bytes,
        desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
    )
    if bind_identity:
        binding = frame or _frame(1)
        ack.stream_id = binding.stream_id
        ack.identity.CopyFrom(binding.identity)
        ack.fence.CopyFrom(binding.fence)
        ack.claim_handoff_watermark = binding.claim_handoff_watermark
    return ack


def _cancellation_winner(
    frame: output_pb2.ExecutionOutputFrameV1,
) -> output_pb2.ExecutionOutputAckV1:
    ack = output_pb2.ExecutionOutputAckV1(
        stream_id=frame.stream_id,
        claim_handoff_watermark=frame.claim_handoff_watermark,
        desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED,
    )
    ack.identity.CopyFrom(frame.identity)
    ack.fence.CopyFrom(frame.fence)
    ack.rejection.code = errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED
    ack.rejection.safe_message = (
        "Execution cancellation won before this output became durable."
    )
    return ack


def _deadline_winner(
    frame: output_pb2.ExecutionOutputFrameV1,
) -> output_pb2.ExecutionOutputAckV1:
    ack = output_pb2.ExecutionOutputAckV1(
        stream_id=frame.stream_id,
        claim_handoff_watermark=frame.claim_handoff_watermark,
        desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
    )
    ack.identity.CopyFrom(frame.identity)
    ack.fence.CopyFrom(frame.fence)
    ack.rejection.code = errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED
    ack.rejection.safe_message = "The execution deadline was exceeded."
    ack.rejection.retryable = True
    return ack


def _retryable_rejection(
    frame: output_pb2.ExecutionOutputFrameV1,
    code: int,
) -> output_pb2.ExecutionOutputAckV1:
    ack = output_pb2.ExecutionOutputAckV1(
        stream_id=frame.stream_id,
        claim_handoff_watermark=frame.claim_handoff_watermark,
    )
    ack.identity.CopyFrom(frame.identity)
    ack.fence.CopyFrom(frame.fence)
    ack.rejection.code = code
    ack.rejection.safe_message = "A required runtime dependency is unavailable."
    ack.rejection.retryable = True
    return ack


def _session(
    tmp_path: Path,
    call: FakeCall,
    *,
    max_queued_frames: int = 2,
) -> tuple[OutputGrpcSession, EncryptedOutputSpool, Stub]:
    spool = _spool(tmp_path)
    stub = Stub(call)
    session = OutputGrpcSession(
        stub,
        spool=spool,
        metadata=lambda: (("x-elitea-workload-session", "session-1"),),
        max_queued_frames=max_queued_frames,
        max_queued_bytes=2048,
        max_frame_bytes=1024,
    )
    return session, spool, stub


def test_ack_receive_remains_independent_while_write_is_blocked(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, spool, stub = _session(tmp_path, call)
        await session.start()
        assert stub.kwargs == {
            "timeout": 300.0,
            "metadata": (("x-elitea-workload-session", "session-1"),),
        }

        await call.controls.put(_ack(0))
        frame = _frame(1)
        await session.send(frame)

        # The send task is blocked inside transport write. The independent
        # receive task can still observe new credit/control information.
        await call.controls.put(_ack(0, bind_identity=True))
        await asyncio.sleep(0)
        call.write_gate.set()
        while not call.writes:
            await asyncio.sleep(0)
        await call.controls.put(_ack(1, bind_identity=True))
        await session.wait_for_ack(1, 1)
        assert spool.pending() == ()
        assert call.writes == [frame]
        await session.close()
        assert call.done
        assert call.cancelled

    asyncio.run(run())


def test_duplicate_or_noncontiguous_sequence_is_rejected(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await call.controls.put(_ack(0))
        await session.send(_frame(1))
        with pytest.raises(InvalidInput, match="contiguous"):
            await session.send(_frame(1))
        with pytest.raises(InvalidInput, match="contiguous"):
            await session.send(_frame(3))
        await session.close()

    asyncio.run(run())


def test_fresh_session_resumes_after_claim_handoff_watermark(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await call.controls.put(_ack(0))
        frame = _frame(4)
        frame.claim_handoff_watermark = 3
        await session.send(frame)
        skipped = _frame(6)
        skipped.claim_handoff_watermark = 3
        with pytest.raises(InvalidInput, match="contiguous"):
            await session.send(skipped)
        while not call.writes:
            await asyncio.sleep(0)
        await call.controls.put(_ack(4, bind_identity=True, frame=frame))
        await session.wait_for_ack(4, 1)
        await session.close()

    asyncio.run(run())


def test_ack_beyond_highest_transmitted_fails_the_session(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await session.send(_frame(1))
        await call.controls.put(_ack(1, bind_identity=True))
        with pytest.raises(RuntimeError, match="unavailable"):
            await session.wait_for_ack(1, 1)
        assert isinstance(session._failure, InvalidInput)
        await session.close()

    asyncio.run(run())


def test_server_credit_above_negotiated_bound_fails_the_session(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await call.controls.put(_ack(0, credit_frames=3))
        for _ in range(10):
            if session._failure is not None:
                break
            await asyncio.sleep(0)
        assert isinstance(session._failure, InvalidInput)
        await session.close()

    asyncio.run(run())


def test_second_identity_free_bootstrap_credit_is_rejected(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await call.controls.put(_ack(0))
        await call.controls.put(_ack(0))
        for _ in range(10):
            if session._failure is not None:
                break
            await asyncio.sleep(0)
        assert isinstance(session._failure, AuthorizationFailure)
        await session.close()

    asyncio.run(run())


def test_remote_eof_before_local_close_fails_the_session(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, _, _ = _session(tmp_path, call)
        await session.start()
        await call.controls.put(None)
        with pytest.raises(RuntimeError, match="unavailable"):
            await session.wait_for_ack(1, 1)
        await session.close()

    asyncio.run(run())


def test_only_exact_bound_cancellation_rejection_exposes_winner_signal(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, spool, _ = _session(tmp_path, call)
        frame = _frame(1)
        await session.start()
        await call.controls.put(_ack(0))
        await session.send(frame)
        while not call.writes:
            await asyncio.sleep(0)
        await call.controls.put(_cancellation_winner(frame))

        with pytest.raises(RuntimeError, match="unavailable") as caught:
            await session.wait_for_ack(1, 1)
        assert isinstance(caught.value.__cause__, OutputCancellationWon)
        assert spool.pending() != ()
        await session.close()

        malformed_root = tmp_path / "malformed"
        malformed_root.mkdir()
        malformed_call = FakeCall()
        malformed_call.write_gate.set()
        malformed, malformed_spool, _ = _session(malformed_root, malformed_call)
        await malformed.start()
        await malformed_call.controls.put(_ack(0))
        await malformed.send(frame)
        while not malformed_call.writes:
            await asyncio.sleep(0)
        bad = _cancellation_winner(frame)
        bad.fence.fence_token = b"x" * 32
        await malformed_call.controls.put(bad)
        with pytest.raises(RuntimeError, match="unavailable") as rejected:
            await malformed.wait_for_ack(1, 1)
        assert isinstance(rejected.value.__cause__, AuthorizationFailure)
        assert not isinstance(rejected.value.__cause__, OutputCancellationWon)
        assert malformed_spool.pending() != ()
        await malformed.close()

    asyncio.run(run())


def test_only_exact_bound_deadline_rejection_exposes_winner_signal(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, spool, _ = _session(tmp_path, call)
        frame = _frame(1)
        await session.start()
        await call.controls.put(_ack(0))
        await session.send(frame)
        while not call.writes:
            await asyncio.sleep(0)
        await call.controls.put(_deadline_winner(frame))

        with pytest.raises(RuntimeError, match="unavailable") as caught:
            await session.wait_for_ack(1, 1)
        assert isinstance(caught.value.__cause__, OutputDeadlineWon)
        assert spool.pending() != ()
        await session.close()

        for malformed in (
            "binding",
            "desired_state",
            "committed",
            "credit",
            "safe_message",
            "retryable",
        ):
            malformed_root = tmp_path / malformed
            malformed_root.mkdir()
            malformed_call = FakeCall()
            malformed_call.write_gate.set()
            malformed_session, malformed_spool, _ = _session(
                malformed_root,
                malformed_call,
            )
            await malformed_session.start()
            await malformed_call.controls.put(_ack(0))
            await malformed_session.send(frame)
            while not malformed_call.writes:
                await asyncio.sleep(0)
            bad = _deadline_winner(frame)
            if malformed == "binding":
                bad.fence.fence_token = b"x" * 32
            elif malformed == "desired_state":
                bad.desired_state = common_pb2.DESIRED_EXECUTION_STATE_V1_CANCELLED
            elif malformed == "committed":
                bad.committed_contiguous_sequence = 1
            elif malformed == "credit":
                bad.credit_frames = 1
            elif malformed == "safe_message":
                bad.rejection.safe_message = "late"
            else:
                bad.rejection.retryable = False
            await malformed_call.controls.put(bad)
            with pytest.raises(RuntimeError, match="unavailable") as rejected:
                await malformed_session.wait_for_ack(1, 1)
            assert isinstance(rejected.value.__cause__, AuthorizationFailure)
            assert not isinstance(rejected.value.__cause__, OutputDeadlineWon)
            assert malformed_spool.pending() != ()
            await malformed_session.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    "code",
    [
        errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
        errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL,
    ],
)
def test_exact_bound_retryable_rejection_is_dependency_unavailable(
    tmp_path: Path,
    code: int,
) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, spool, _ = _session(tmp_path, call)
        frame = _frame(1)
        await session.start()
        await call.controls.put(_ack(0))
        await session.send(frame)
        while not call.writes:
            await asyncio.sleep(0)
        await call.controls.put(_retryable_rejection(frame, code))

        with pytest.raises(RuntimeError, match="unavailable") as caught:
            await session.wait_for_ack(1, 1)
        assert isinstance(caught.value.__cause__, DependencyUnavailable)
        assert spool.pending() != ()
        await session.close()

    asyncio.run(run())


@pytest.mark.parametrize(
    ("code", "retryable", "change_binding", "expected"),
    [
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
            False,
            False,
            InvalidInput,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
            True,
            True,
            AuthorizationFailure,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHENTICATION_FAILED,
            True,
            False,
            AuthorizationFailure,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHORIZATION_FAILED,
            True,
            False,
            AuthorizationFailure,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_STALE_FENCE,
            True,
            False,
            AuthorizationFailure,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_INVALID_INPUT,
            True,
            False,
            InvalidInput,
        ),
        (
            errors_pb2.RUNTIME_ERROR_CODE_V1_PROTOCOL_VIOLATION,
            True,
            False,
            InvalidInput,
        ),
    ],
    ids=[
        "non-retryable-dependency",
        "unbound-retryable-dependency",
        "authentication",
        "authorization",
        "stale-fence",
        "invalid-input",
        "protocol-violation",
    ],
)
def test_retryable_rejection_contract_fails_closed(
    tmp_path: Path,
    code: int,
    retryable: bool,
    change_binding: bool,
    expected: type[InvalidInput] | type[AuthorizationFailure],
) -> None:
    async def run() -> None:
        call = FakeCall()
        call.write_gate.set()
        session, spool, _ = _session(tmp_path, call)
        frame = _frame(1)
        await session.start()
        await call.controls.put(_ack(0))
        await session.send(frame)
        while not call.writes:
            await asyncio.sleep(0)
        rejection = _retryable_rejection(frame, code)
        rejection.rejection.retryable = retryable
        if change_binding:
            rejection.fence.fence_token = b"x" * 32
        await call.controls.put(rejection)

        with pytest.raises(RuntimeError, match="unavailable") as caught:
            await session.wait_for_ack(1, 1)
        assert isinstance(caught.value.__cause__, expected)
        assert not isinstance(caught.value.__cause__, DependencyUnavailable)
        assert spool.pending() != ()
        await session.close()

    asyncio.run(run())


def test_close_does_not_deadlock_with_full_credit_starved_queue(tmp_path: Path) -> None:
    async def run() -> None:
        call = FakeCall()
        session, _, _ = _session(tmp_path, call, max_queued_frames=1)
        await session.start()
        await session.send(_frame(1))
        await asyncio.wait_for(session.close(), timeout=1)
        assert call.cancelled

    asyncio.run(run())


def test_existing_spool_replays_exact_frame_and_clears_only_after_bound_ack(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        frame = _frame(1)
        encoded = frame.SerializeToString(deterministic=True)
        spool = _spool(tmp_path)
        spool.put(1, encoded)
        call = FakeCall()
        call.write_gate.set()
        session = OutputGrpcSession(
            Stub(call),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )
        assert session.replays(frame)
        pending = session.pending_replay_frame
        assert pending is not None
        assert pending.SerializeToString(deterministic=True) == encoded
        pending.event_id = "caller-must-not-mutate-durable-state"
        assert session.pending_replay_frame is not None
        assert (
            session.pending_replay_frame.SerializeToString(deterministic=True)
            == encoded
        )
        await session.start()
        await call.controls.put(_ack(0))
        while not call.writes:
            await asyncio.sleep(0)
        assert call.writes[0].SerializeToString(deterministic=True) == encoded
        assert spool.pending()[0].payload == encoded

        await call.controls.put(_ack(1, bind_identity=True))
        await session.wait_for_ack(1, 1)
        assert spool.pending() == ()
        assert not session.has_pending_replay
        await session.send(_frame(2))
        while len(call.writes) < 2:
            await asyncio.sleep(0)
        await call.controls.put(_ack(2, bind_identity=True))
        await session.wait_for_ack(2, 1)
        await session.close()

    asyncio.run(run())


def test_existing_spool_replay_waits_for_each_bound_ack(tmp_path: Path) -> None:
    async def run() -> None:
        first = _frame(1)
        second = _frame(2)
        spool = _spool(tmp_path)
        spool.put(1, first.SerializeToString(deterministic=True))
        spool.put(2, second.SerializeToString(deterministic=True))
        call = FakeCall()
        call.write_gate.set()
        session = OutputGrpcSession(
            Stub(call),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=2,
            max_queued_bytes=2048,
            max_frame_bytes=1024,
        )

        await session.start()
        await call.controls.put(_ack(0, credit_frames=2, credit_bytes=2048))
        while not call.writes:
            await asyncio.sleep(0)
        await asyncio.sleep(0)
        assert call.writes == [first]
        assert [item.sequence for item in spool.pending()] == [1, 2]

        await call.controls.put(
            _ack(
                1,
                credit_frames=1,
                credit_bytes=1024,
                bind_identity=True,
                frame=first,
            )
        )
        while len(call.writes) < 2:
            await asyncio.sleep(0)
        assert call.writes == [first, second]
        assert [item.sequence for item in spool.pending()] == [2]

        await call.controls.put(
            _ack(
                2,
                credit_frames=1,
                credit_bytes=1024,
                bind_identity=True,
                frame=second,
            )
        )
        await session.wait_for_ack(2, 1)
        assert spool.pending() == ()
        await session.close()

    asyncio.run(run())


def test_ack_loss_preserves_exact_spool_for_restart_replay(tmp_path: Path) -> None:
    async def run() -> None:
        frame = _frame(1)
        encoded = frame.SerializeToString(deterministic=True)
        spool = _spool(tmp_path)
        spool.put(1, encoded)

        lost_ack_call = FakeCall()
        lost_ack_call.write_gate.set()
        lost_ack = OutputGrpcSession(
            Stub(lost_ack_call),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )
        await lost_ack.start()
        await lost_ack_call.controls.put(_ack(0))
        while not lost_ack_call.writes:
            await asyncio.sleep(0)
        await lost_ack.close()
        assert spool.pending()[0].payload == encoded

        restart_call = FakeCall()
        restart_call.write_gate.set()
        restarted = OutputGrpcSession(
            Stub(restart_call),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )
        await restarted.start()
        await restart_call.controls.put(_ack(0))
        while not restart_call.writes:
            await asyncio.sleep(0)
        assert restart_call.writes[0].SerializeToString(deterministic=True) == encoded
        await restart_call.controls.put(_ack(1, bind_identity=True, frame=frame))
        await restarted.wait_for_ack(1, 1)
        assert spool.pending() == ()
        await restarted.close()

    asyncio.run(run())


def test_fresh_session_reconciliation_preserves_spool_until_watermark_covers_all(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        spool = _spool(tmp_path)
        spool.put(1, _frame(1).SerializeToString(deterministic=True))
        spool.put(2, _frame(2).SerializeToString(deterministic=True))
        session = OutputGrpcSession(
            Stub(FakeCall()),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=2,
            max_queued_bytes=2048,
            max_frame_bytes=1024,
        )

        with pytest.raises(InvalidInput, match="watermark"):
            await session.reconcile_pending_through(0)
        assert [item.sequence for item in spool.pending()] == [1, 2]

        with pytest.raises(AuthorizationFailure, match="does not cover"):
            await session.reconcile_pending_through(1)
        assert [item.sequence for item in spool.pending()] == [1, 2]
        assert session.has_pending_replay

        await session.reconcile_pending_through(2)
        assert spool.pending() == ()
        assert not session.has_pending_replay

    asyncio.run(run())


def test_fresh_session_cas_replaces_and_replays_exact_pending_frame(
    tmp_path: Path,
) -> None:
    async def run() -> None:
        original = _frame(1)
        replacement = _frame(1)
        replacement.event_id = "cancelled-event-1"
        spool = _spool(tmp_path)
        spool.put(1, original.SerializeToString(deterministic=True))
        call = FakeCall()
        call.write_gate.set()
        session = OutputGrpcSession(
            Stub(call),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )

        await session.replace_pending_exact(original, replacement)
        assert session.replays(replacement)
        assert not session.replays(original)
        assert spool.pending()[0].payload == replacement.SerializeToString(
            deterministic=True
        )

        await session.start()
        await call.controls.put(_ack(0))
        while not call.writes:
            await asyncio.sleep(0)
        assert call.writes == [replacement]
        await call.controls.put(_ack(1, bind_identity=True))
        await session.wait_for_ack(1, 1)
        assert spool.pending() == ()
        await session.close()

    asyncio.run(run())


def test_spool_resume_rejects_corrupt_noncanonical_frame(tmp_path: Path) -> None:
    spool = _spool(tmp_path)
    spool.put(1, b"not-a-protobuf-frame")
    with pytest.raises(InvalidInput):
        OutputGrpcSession(
            Stub(FakeCall()),
            spool=spool,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )


def test_spool_resume_rejects_gap_or_changed_fence(tmp_path: Path) -> None:
    gap_root = tmp_path / "gap"
    gap_root.mkdir()
    gap = _spool(gap_root)
    gap.put(1, _frame(1).SerializeToString(deterministic=True))
    gap.put(3, _frame(3).SerializeToString(deterministic=True))
    with pytest.raises(InvalidInput, match="contiguous"):
        OutputGrpcSession(
            Stub(FakeCall()),
            spool=gap,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )

    fence_root = tmp_path / "fence"
    fence_root.mkdir()
    changed = _spool(fence_root)
    changed.put(1, _frame(1).SerializeToString(deterministic=True))
    second = _frame(2)
    second.fence.fence_token = b"x" * 32
    changed.put(2, second.SerializeToString(deterministic=True))
    with pytest.raises(AuthorizationFailure, match="identity changed"):
        OutputGrpcSession(
            Stub(FakeCall()),
            spool=changed,
            metadata=lambda: (("x-elitea-workload-session", "session-1"),),
            max_queued_frames=1,
            max_queued_bytes=1024,
            max_frame_bytes=1024,
        )
