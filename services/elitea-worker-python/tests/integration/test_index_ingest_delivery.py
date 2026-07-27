from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import pytest
from elitea.runtime.v1 import (
    command_pb2,
    common_pb2,
    control_pb2,
    envelope_pb2,
    errors_pb2,
    indexing_pb2,
    input_pb2,
    output_pb2,
)

from elitea_worker.agents.client_context import EliteaClientContext, IndexExecutionClaim
from elitea_worker.agents.sdk_adapter import EliteaSdkIndexingAdapter
from elitea_worker.constants import (
    CONFORMANCE_HMAC_KEY,
    CONFORMANCE_HMAC_KEY_ID,
    ENVELOPE_SCHEMA_REVISION,
)
from elitea_worker.execution.delivery import (
    DeliveryDisposition,
    IndexIngestDeliveryProcessor,
)
from elitea_worker.execution.errors import (
    InternalFailure,
    InvalidInput,
    OutputCancellationWon,
)
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    VerifiedWorkerCommand,
    build_output_frame,
)
from elitea_worker.protocol.indexing import bind_result_summary
from elitea_worker.protocol.node_event import encode_current_node_event_json
from elitea_worker.handlers.indexing import IndexIngestInputBinding, IndexIngestResult
from elitea_worker.transport.input_content import ClaimBoundInputRequestBuilder
from elitea_worker.transport.redis_commands import RedisCommandDelivery

_NOW = 1_700_000_000_000
_WORKLOAD = "index-worker-1"
_PRODUCER = "index-producer-1"


class InlineSupervisor:
    async def run(self, operation):
        return await operation()

    async def run_sync(self, operation, /, *args, **kwargs):
        return await asyncio.to_thread(operation, *args, **kwargs)


class RecordingSdk:
    def __init__(
        self,
        result: dict[str, Any],
        *,
        custom_events: list[tuple[str, dict[str, Any]]] | None = None,
        catch_callback_errors: bool = False,
        emit_tool_lifecycle: bool = False,
    ) -> None:
        self.result = result
        self.custom_events = custom_events or []
        self.catch_callback_errors = catch_callback_errors
        self.emit_tool_lifecycle = emit_tool_lifecycle
        self.calls: list[dict[str, Any]] = []
        self.callback_errors: list[Exception] = []

    def ingest(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        run_id = UUID("00000000-0000-0000-0000-000000000007")
        parent_run_id = UUID("00000000-0000-0000-0000-000000000099")
        if self.emit_tool_lifecycle:
            for callback in kwargs["runtime_config"]["callbacks"]:
                callback.on_tool_start(
                    {
                        "name": "index_data",
                        "description": "REDEEMED_LIFECYCLE_CANARY",
                    },
                    "REDEEMED_LIFECYCLE_CANARY",
                    run_id=run_id,
                    parent_run_id=parent_run_id,
                    metadata={"credential": "REDEEMED_LIFECYCLE_CANARY"},
                    inputs={"token": "REDEEMED_LIFECYCLE_CANARY"},
                )
        for name, data in self.custom_events:
            for callback in kwargs["runtime_config"]["callbacks"]:
                try:
                    callback.on_custom_event(
                        name,
                        data,
                        run_id=run_id,
                        metadata=kwargs["runtime_config"].get("metadata"),
                    )
                except Exception as exc:
                    if not self.catch_callback_errors:
                        raise
                    self.callback_errors.append(exc)
        if self.emit_tool_lifecycle:
            for callback in kwargs["runtime_config"]["callbacks"]:
                callback.on_tool_end(
                    {"credential": "REDEEMED_LIFECYCLE_CANARY"},
                    run_id=run_id,
                    parent_run_id=parent_run_id,
                )
        return self.result


class InputContextDiagnosticError(RuntimeError):
    pass


class ExecuteDiagnosticError(RuntimeError):
    pass


def _raise_execute_diagnostic(depth: int, message: str) -> None:
    if depth > 0:
        _raise_execute_diagnostic(depth - 1, message)
        return
    raise ExecuteDiagnosticError(message)


class InputClient:
    def __init__(self, values: dict[str, bytes], sequence: list[str]) -> None:
        self.values = values
        self.sequence = sequence
        self.calls = 0

    async def fetch_materialized(self, grant, *, source_immutable_version: str) -> bytes:
        self.calls += 1
        self.sequence.append(f"input:{grant.url.rsplit('/', 3)[-3]}")
        assert source_immutable_version
        return self.values[grant.url.rsplit("/", 3)[-3]]


class Acker:
    def __init__(self) -> None:
        self.calls = 0

    async def ack_after_settlement(self, delivery, stable_delivery_id: str) -> None:
        assert stable_delivery_id == "index-idempotency-1"
        self.calls += 1


class Output:
    def __init__(self, pending: output_pb2.ExecutionOutputFrameV1 | None = None) -> None:
        self.frame = pending
        self.frames: list[output_pb2.ExecutionOutputFrameV1] = []
        self.sent = 0
        self.started = 0

    @property
    def has_pending_replay(self) -> bool:
        return self.frame is not None

    @property
    def pending_replay_frame(self) -> output_pb2.ExecutionOutputFrameV1 | None:
        return self.frame

    def replays(self, frame: output_pb2.ExecutionOutputFrameV1) -> bool:
        return self.frame is not None and self.frame == frame

    async def replace_pending_exact(self, expected, replacement) -> None:
        assert self.frame == expected
        self.frame = replacement

    async def start(self) -> None:
        self.started += 1

    async def send(self, frame: output_pb2.ExecutionOutputFrameV1) -> None:
        assert self.frame is None
        self.frame = frame
        self.frames.append(frame)
        self.sent += 1

    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None:
        assert (
            self.frame is not None
            and sequence == self.frame.sequence
            and timeout_seconds > 0
        )
        self.frame = None

    async def close(self) -> None:
        return None


class GatedOutput(Output):
    def __init__(self) -> None:
        super().__init__()
        self.waiting_for_ack = asyncio.Event()
        self.release_ack = asyncio.Event()

    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None:
        self.waiting_for_ack.set()
        await self.release_ack.wait()
        await super().wait_for_ack(sequence, timeout_seconds)


@dataclass
class SharedPendingOutput:
    frame: output_pb2.ExecutionOutputFrameV1 | None = None


class CancellationWinnerOutput:
    def __init__(
        self,
        shared: SharedPendingOutput,
        *,
        reject_progress: bool,
        frames: list[output_pb2.ExecutionOutputFrameV1],
    ) -> None:
        self.shared = shared
        self.reject_progress = reject_progress
        self.frames = frames

    @property
    def has_pending_replay(self) -> bool:
        return self.shared.frame is not None

    @property
    def pending_replay_frame(self) -> output_pb2.ExecutionOutputFrameV1 | None:
        return self.shared.frame

    def replays(self, frame: output_pb2.ExecutionOutputFrameV1) -> bool:
        return self.shared.frame == frame

    async def replace_pending_exact(self, expected, replacement) -> None:
        assert self.shared.frame == expected
        self.shared.frame = replacement
        self.frames.append(replacement)

    async def start(self) -> None:
        return None

    async def send(self, frame: output_pb2.ExecutionOutputFrameV1) -> None:
        assert self.shared.frame is None
        self.shared.frame = frame
        self.frames.append(frame)

    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None:
        assert self.shared.frame is not None
        assert self.shared.frame.sequence == sequence
        assert timeout_seconds > 0
        if self.reject_progress and self.shared.frame.HasField("node_event"):
            try:
                raise OutputCancellationWon()
            except OutputCancellationWon as exc:
                raise RuntimeError("output stream is unavailable") from exc
        self.shared.frame = None

    async def close(self) -> None:
        return None


class Control:
    def __init__(
        self,
        case: "Case",
        *,
        active: bool = False,
        claim_handoff_watermark: int = 0,
    ) -> None:
        self.case = case
        self.active = active
        self.claim_handoff_watermark = claim_handoff_watermark
        self.settlements = 0

    async def claim_command(self, request):
        disposition = (
            control_pb2.CLAIM_DISPOSITION_V1_ACTIVE_LEASE_NOACK
            if self.active
            else control_pb2.CLAIM_DISPOSITION_V1_ACCEPTED
        )
        receipt = control_pb2.ClaimReceiptV1(
            disposition=disposition,
            claim_id="claim-1",
            identity=_identity(self.case.command),
            fence=self.case.fence,
            lease_expires_at_unix_millis=_NOW + 120_000,
            desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
            claim_handoff_watermark=self.claim_handoff_watermark,
        )
        if not self.active:
            receipt.input_bundle_ref.CopyFrom(self.case.command.input_bundle_ref)
            receipt.input_bundle.CopyFrom(self.case.manifest)
        return control_pb2.ClaimCommandResponseV1(receipt=receipt)

    async def renew_lease(self, request):
        return control_pb2.RenewLeaseResponseV1(
            lease_expires_at_unix_millis=_NOW + 180_000,
            desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
        )

    async def observe_desired_state(self, request):
        return control_pb2.ObserveDesiredStateResponseV1(
            desired_state=common_pb2.DESIRED_EXECUTION_STATE_V1_RUNNING,
        )

    async def prepare_settlement(self, request):
        self.settlements += 1
        return control_pb2.PrepareSettlementResponseV1(
            settlement_receipt_id="settlement-1",
            outcome=request.proposal.requested_outcome,
        )


@dataclass(frozen=True)
class Case:
    command: command_pb2.WorkerCommandV1
    signed: envelope_pb2.SignedWorkerCommandEnvelopeV1
    manifest: input_pb2.ExecutionInputBundleV1
    fence: common_pb2.ExecutionFenceV1
    values: dict[str, bytes]

    @property
    def delivery(self) -> RedisCommandDelivery:
        return RedisCommandDelivery(
            "index-ingest.v1",
            "1-0",
            {"signed_envelope": self.signed.SerializeToString(deterministic=True)},
        )


@pytest.mark.parametrize("sdk_success", [True, False])
def test_index_delivery_invokes_sdk_once_and_emits_only_safe_terminal_fields(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
    sdk_success: bool,
) -> None:
    case = _case()
    canary = "REDEEMED_SECRET_CANARY"

    async def run() -> None:
        sdk_result = (
            {
                "success": True,
                "result": {"status": "ok", "message": "Indexed 3 documents"},
                "toolkit_config": {"settings": {"token": canary}},
            }
            if sdk_success
            else {
                "success": False,
                "error": f"raw failure containing {canary}",
                "toolkit_config": {"settings": {"token": canary}},
            }
        )
        sdk = RecordingSdk(sdk_result, emit_tool_lifecycle=True)
        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: sdk),
        )
        sequence: list[str] = []

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            sequence.append("context")
            assert claim.resource_project_id == "42"
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        output = Output()
        control = Control(case)
        acker = Acker()
        processor = _processor(
            case,
            control=control,
            input_client=InputClient(case.values, sequence),
            output=output,
            acker=acker,
            context_factory=context_factory,
        )

        result = await processor.process(case.delivery)

        assert result.disposition is DeliveryDisposition.EXECUTED_SETTLED_ACKED
        assert result.output_frame is not None
        assert len(sdk.calls) == 1
        assert sequence[-1] == "context"
        assert len(sequence) == 6
        assert control.settlements == 1
        assert acker.calls == 1
        encoded = result.output_frame.SerializeToString(deterministic=True)
        assert canary.encode() not in encoded
        assert b"REDEEMED_LIFECYCLE_CANARY" not in b"".join(
            frame.SerializeToString(deterministic=True) for frame in output.frames
        )
        assert [frame.node_event.type for frame in output.frames[:-1]] == (
            ["agent_tool_start", "agent_tool_end"]
            if sdk_success
            else ["agent_tool_start", "agent_tool_error"]
        )
        assert output.frames[-1] == result.output_frame
        if sdk_success:
            assert result.output_frame.event_type == output_pb2.EXECUTION_OUTPUT_EVENT_TYPE_V1_INDEX_INGEST_RESULT
            assert result.output_frame.index_ingest.result_summary.status == indexing_pb2.INDEX_INGEST_STATUS_V1_OK
            assert result.output_frame.index_ingest.result_summary.message == "Indexed 3 documents"
            assert sdk.calls[0]["toolkit_config"]["settings"]["token"] == "github-secret"
            runtime_config = sdk.calls[0]["runtime_config"]
            assert len(runtime_config["callbacks"]) == 1
            assert runtime_config["metadata"] == {
                "initiator": "user",
                "tool_name": "index_data",
                "display_name": "github",
            }
        else:
            assert result.output_frame.runtime_error.code == errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL
            assert result.output_frame.runtime_error.safe_message == "The runtime operation failed."

    asyncio.run(run())
    captured = capsys.readouterr()
    if not sdk_success:
        diagnostic = _single_index_internal_failure(captured.err)
        assert diagnostic["stage"] == "result_projection"
        assert diagnostic["execution_id"] == case.command.execution_id
        assert diagnostic["exception_module"] == InternalFailure.__module__
        assert diagnostic["exception_name"] == InternalFailure.__name__
        assert diagnostic["sdk_failure_category"] == "unclassified_failure"
        _assert_safe_diagnostic_frames(diagnostic["frames"])
        assert any(
            frame["function"] == "bind_result_summary"
            for frame in diagnostic["frames"]
        )
        assert canary not in captured.err


def test_input_context_internal_failure_emits_credential_safe_diagnostic(
    capsys: pytest.CaptureFixture[str],
) -> None:
    case = _case()
    canary = "INPUT_CONTEXT_SECRET_CANARY"

    async def run() -> None:
        async def context_factory(
            claim: IndexExecutionClaim,
        ) -> EliteaClientContext:
            raise InputContextDiagnosticError(canary)

        result = await _processor(
            case,
            control=Control(case),
            input_client=InputClient(case.values, []),
            output=Output(),
            acker=Acker(),
            context_factory=context_factory,
        ).process(case.delivery)

        assert result.output_frame is not None
        assert (
            result.output_frame.runtime_error.code
            == errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL
        )
        assert (
            result.output_frame.runtime_error.safe_message
            == "The runtime operation failed."
        )
        assert canary.encode() not in result.output_frame.SerializeToString(
            deterministic=True
        )

    asyncio.run(run())

    captured = capsys.readouterr()
    diagnostic = _single_index_internal_failure(captured.err)
    assert diagnostic["stage"] == "input_context"
    assert diagnostic["execution_id"] == case.command.execution_id
    assert diagnostic["exception_module"] == InputContextDiagnosticError.__module__
    assert diagnostic["exception_name"] == InputContextDiagnosticError.__name__
    _assert_safe_diagnostic_frames(diagnostic["frames"])
    assert any(
        frame["function"] == "context_factory" for frame in diagnostic["frames"]
    )
    assert canary not in captured.err


def test_execute_internal_failure_emits_bounded_credential_safe_diagnostic(
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture[str],
) -> None:
    case = _case()
    canary = "EXECUTE_SECRET_CANARY"

    class RaisingSdk:
        def ingest(self, **kwargs: Any) -> dict[str, Any]:
            _raise_execute_diagnostic(16, canary)
            raise AssertionError("unreachable")

    monkeypatch.setattr(
        EliteaSdkIndexingAdapter,
        "from_context",
        classmethod(lambda cls, context: RaisingSdk()),
    )

    async def run() -> None:
        async def context_factory(
            claim: IndexExecutionClaim,
        ) -> EliteaClientContext:
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        result = await _processor(
            case,
            control=Control(case),
            input_client=InputClient(case.values, []),
            output=Output(),
            acker=Acker(),
            context_factory=context_factory,
        ).process(case.delivery)

        assert result.output_frame is not None
        assert (
            result.output_frame.runtime_error.code
            == errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL
        )
        assert (
            result.output_frame.runtime_error.safe_message
            == "The runtime operation failed."
        )
        assert canary.encode() not in result.output_frame.SerializeToString(
            deterministic=True
        )

    asyncio.run(run())

    captured = capsys.readouterr()
    diagnostic = _single_index_internal_failure(captured.err)
    assert diagnostic["stage"] == "execute"
    assert diagnostic["execution_id"] == case.command.execution_id
    assert diagnostic["exception_module"] == ExecuteDiagnosticError.__module__
    assert diagnostic["exception_name"] == ExecuteDiagnosticError.__name__
    _assert_safe_diagnostic_frames(diagnostic["frames"])
    assert len(diagnostic["frames"]) == 8
    assert any(
        frame["function"] == "_execute_resolved"
        for frame in diagnostic["frames"]
    )
    assert any(
        frame["function"] == "_raise_execute_diagnostic"
        for frame in diagnostic["frames"]
    )
    assert canary not in captured.err


def test_current_sdk_index_progress_is_acked_before_contiguous_terminal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        case = _case()
        canary = "REDEEMED_SECRET_CANARY"
        sdk = RecordingSdk(
            {
                "success": True,
                "result": {"status": "ok", "message": "Indexed 3 documents"},
            },
            custom_events=[
                (
                    "thinking_step",
                    {
                        "message": "20 files processed",
                        "tool_name": "loader",
                        "toolkit": "EliteaGitHubAPIWrapper",
                        "toolkit_config": {
                            "settings": {"private_token": canary}
                        },
                    },
                ),
                (
                    "index_data_status",
                    {
                        "id": "index-meta-1",
                        "index_name": "docs",
                        "state": "completed",
                        "error": None,
                        "reindex": False,
                        "indexed": 3,
                        "updated": 0,
                        "created_at": 1_700_000_000.0,
                        "updated_on": 1_700_000_010.0,
                        "toolkit_id": 9,
                        "credential": canary,
                    },
                )
            ],
            emit_tool_lifecycle=True,
        )
        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: sdk),
        )

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        output = GatedOutput()
        processing = asyncio.create_task(_processor(
            case,
            control=Control(case),
            input_client=InputClient(case.values, []),
            output=output,
            acker=Acker(),
            context_factory=context_factory,
        ).process(case.delivery))
        await asyncio.wait_for(output.waiting_for_ack.wait(), timeout=1)
        assert not processing.done()
        assert [frame.sequence for frame in output.frames] == [1]
        output.release_ack.set()
        result = await processing

        assert result.output_frame is not None
        assert result.output_frame.sequence == 5
        assert result.output_frame.settlement_proposal.terminal_sequence == 5
        assert [frame.sequence for frame in output.frames] == [1, 2, 3, 4, 5]
        start, thinking, status, end, terminal = output.frames
        for progress in (start, thinking, status, end):
            assert not progress.terminal
            assert not progress.HasField("settlement_proposal")
            assert (
                progress.event_type
                == output_pb2.EXECUTION_OUTPUT_EVENT_TYPE_V1_NODE_EVENT
            )
        assert terminal == result.output_frame
        assert start.node_event.type == "agent_tool_start"
        assert end.node_event.type == "agent_tool_end"

        browser_event = json.loads(
            encode_current_node_event_json(thinking.node_event)
        )
        assert browser_event["type"] == "agent_thinking_step"
        assert browser_event["stream_id"] == case.command.index_ingest.client_stream_id
        assert browser_event["message_id"] == case.command.index_ingest.client_message_id
        assert browser_event["sio_event"] == case.command.index_ingest.sio_event
        assert browser_event["response_metadata"]["message"] == "20 files processed"
        assert browser_event["response_metadata"]["tool_name"] == "loader"
        assert (
            browser_event["response_metadata"]["toolkit"]
            == "EliteaGitHubAPIWrapper"
        )
        assert browser_event["response_metadata"]["metadata"] == {
            "initiator": "user",
            "tool_name": "index_data",
            "display_name": "github",
        }
        assert canary not in json.dumps(browser_event)

        browser_event = json.loads(
            encode_current_node_event_json(status.node_event)
        )
        assert browser_event["type"] == "agent_index_data_status"
        assert browser_event["stream_id"] == case.command.index_ingest.client_stream_id
        metadata = browser_event["response_metadata"]
        assert metadata["task_id"] == case.command.execution_id
        assert metadata["initiator"] == "user"
        assert metadata["project_id"] == 42
        assert metadata["user_id"] == 7
        assert metadata["toolkit_id"] == 9
        assert metadata["index_name"] == "docs"
        assert canary not in json.dumps(browser_event)

    asyncio.run(run())


def test_claim_handoff_watermark_seeds_the_next_terminal_sequence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        case = _case()
        sdk = RecordingSdk(
            {
                "success": True,
                "result": {"status": "ok", "message": "Already resumed"},
            }
        )
        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: sdk),
        )

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        result = await _processor(
            case,
            control=Control(case, claim_handoff_watermark=3),
            input_client=InputClient(case.values, []),
            output=Output(),
            acker=Acker(),
            context_factory=context_factory,
        ).process(case.delivery)

        assert result.output_frame is not None
        assert result.output_frame.sequence == 4
        assert result.output_frame.claim_handoff_watermark == 3
        assert result.output_frame.event_id == f"{case.command.command_id}:4"
        assert result.output_frame.settlement_proposal.terminal_sequence == 4

    asyncio.run(run())


def test_progress_cancellation_winner_replaces_exact_sequence_and_settles(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        case = _case()
        sdk = RecordingSdk(
            {
                "success": True,
                "result": {"status": "ok", "message": "late success"},
            },
            custom_events=[
                (
                    "index_data_status",
                    {
                        "index_name": "docs",
                        "state": "in_progress",
                        "toolkit_id": 9,
                    },
                )
            ],
            # The current BaseIndexerToolkit catches callback failures and the
            # phase-one synchronous call remains non-preemptible.
            catch_callback_errors=True,
        )
        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: sdk),
        )

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        shared = SharedPendingOutput()
        frames: list[output_pb2.ExecutionOutputFrameV1] = []
        sessions = 0

        def output_factory() -> CancellationWinnerOutput:
            nonlocal sessions
            sessions += 1
            return CancellationWinnerOutput(
                shared,
                reject_progress=sessions == 1,
                frames=frames,
            )

        control = Control(case)
        acker = Acker()
        result = await _processor(
            case,
            control=control,
            input_client=InputClient(case.values, []),
            output=None,
            output_factory=output_factory,
            acker=acker,
            context_factory=context_factory,
        ).process(case.delivery)

        assert len(sdk.callback_errors) == 1
        assert result.output_frame is not None
        assert result.output_frame.sequence == 1
        assert result.output_frame.runtime_error.code == errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED
        assert result.output_frame.settlement_proposal.terminal_sequence == 1
        assert frames[0].HasField("node_event")
        assert not frames[0].terminal
        assert frames[1] == result.output_frame
        assert shared.frame is None
        assert control.settlements == 1
        assert acker.calls == 1

    asyncio.run(run())


def test_pending_index_output_recovers_without_input_context_or_sdk(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        case = _case()
        safe_result = bind_result_summary(_terminal_result())
        envelope = envelope_pb2.WorkerExecutionEnvelopeV1(
            signed_command=case.signed,
            fence=case.fence,
        )
        pending = build_output_frame(
            VerifiedWorkerCommand(envelope=envelope, command=case.command),
            safe_result,
            occurred_at_unix_millis=_NOW,
            claim_handoff_watermark=0,
        )
        output = Output(pending)
        control = Control(case, active=True)
        acker = Acker()

        class ForbiddenInput:
            async def fetch_materialized(self, *args, **kwargs):
                raise AssertionError("recovery must not fetch input")

        async def forbidden_context(claim):
            raise AssertionError("recovery must not fetch SDK authority")

        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: (_ for _ in ()).throw(AssertionError())),
        )
        result = await _processor(
            case,
            control=control,
            input_client=ForbiddenInput(),
            output=output,
            acker=acker,
            context_factory=forbidden_context,
        ).process(case.delivery)

        assert result.disposition is DeliveryDisposition.RECOVERED_LOCAL_OUTPUT_SETTLED_ACKED
        assert result.output_frame == pending
        assert output.sent == 0
        assert output.started == 1
        assert control.settlements == 1
        assert acker.calls == 1

    asyncio.run(run())


def test_deadline_during_context_acquisition_prevents_sdk_execution(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def run() -> None:
        case = _case()
        clock = [_NOW]
        sequence: list[str] = []

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            sequence.append("context")
            clock[0] = int(case.command.deadline_unix_millis)
            return EliteaClientContext(42, "https://elitea.internal", "actor-pat")

        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(
                lambda cls, context: (_ for _ in ()).throw(
                    AssertionError("deadline-expired work must not enter the SDK")
                )
            ),
        )
        output = Output()
        control = Control(case)
        acker = Acker()

        result = await _processor(
            case,
            control=control,
            input_client=InputClient(case.values, sequence),
            output=output,
            acker=acker,
            context_factory=context_factory,
            clock=lambda: clock[0],
        ).process(case.delivery)

        assert sequence[-1] == "context"
        assert len(sequence) == 6
        assert result.disposition is DeliveryDisposition.EXECUTED_SETTLED_ACKED
        assert result.output_frame is not None
        assert (
            result.output_frame.runtime_error.code
            == errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED
        )
        assert control.settlements == 1
        assert acker.calls == 1

    asyncio.run(run())


def test_index_delivery_rejects_wrong_manifest_role_before_data_or_authority() -> None:
    async def run() -> None:
        original = _case()
        manifest = input_pb2.ExecutionInputBundleV1.FromString(
            original.manifest.SerializeToString(deterministic=True)
        )
        manifest.entries[0].semantic_role = "index.llm_model"
        case = _with_manifest(original, manifest)

        class ForbiddenInput:
            async def fetch_materialized(self, *args, **kwargs):
                raise AssertionError("rejected manifest must not fetch input")

        async def forbidden_context(claim):
            raise AssertionError("rejected manifest must not fetch SDK authority")

        control = Control(case)
        acker = Acker()
        with pytest.raises(InvalidInput):
            await _processor(
                case,
                control=control,
                input_client=ForbiddenInput(),
                output=Output(),
                acker=acker,
                context_factory=forbidden_context,
            ).process(case.delivery)

        assert control.settlements == 0
        assert acker.calls == 0

    asyncio.run(run())


def _processor(
    case,
    *,
    control,
    input_client,
    output,
    acker,
    context_factory,
    clock=None,
    output_factory=None,
):
    clock = clock or (lambda: _NOW)
    return IndexIngestDeliveryProcessor(
        supervisor=InlineSupervisor(),
        client_context_factory=context_factory,
        control=control,
        command_acker=acker,
        input_client=input_client,
        input_request_builder=ClaimBoundInputRequestBuilder(
            origin="https://content.internal"
        ),
        output_session_factory=output_factory or (lambda: output),
        signed_command_authenticator=TestOnlyConformanceHmacAuthenticator(),
        workload_session_id=_WORKLOAD,
        producer_id=_PRODUCER,
        clock_unix_millis=clock,
        lease_poll_interval_seconds=10,
    )


def _single_index_internal_failure(stderr: str) -> dict[str, Any]:
    lines = [line for line in stderr.splitlines() if line]
    assert len(lines) == 1
    diagnostic = json.loads(lines[0])
    assert set(diagnostic) in ({
        "event",
        "stage",
        "execution_id",
        "exception_module",
        "exception_name",
        "frames",
    }, {
        "event",
        "stage",
        "execution_id",
        "exception_module",
        "exception_name",
        "frames",
        "sdk_failure_category",
    })
    assert diagnostic["event"] == "index_ingest_internal_failure"
    return diagnostic


def _assert_safe_diagnostic_frames(frames: object) -> None:
    assert isinstance(frames, list)
    assert 0 < len(frames) <= 8
    for frame in frames:
        assert isinstance(frame, dict)
        assert set(frame) == {"file", "function", "line"}
        assert "/" not in frame["file"]
        assert "\\" not in frame["file"]
        assert isinstance(frame["function"], str)
        assert isinstance(frame["line"], int)


def _case() -> Case:
    sources = (
        ("toolkit-config", "index.toolkit_configuration", {"type": "github", "settings": {"token": "{{secret.GITHUB_TOKEN}}"}}, {"type": "github", "settings": {"token": "github-secret"}}),
        ("tool-params", "index.tool_parameters", {"index_name": "docs"}, {"index_name": "docs"}),
        ("llm-model", "index.llm_model", "gpt-test", "gpt-test"),
        ("llm-config", "index.llm_configuration", {"model_name": "gpt-test"}, {"model_name": "gpt-test"}),
        ("mcp-tokens", "index.mcp_tokens", {}, {}),
    )
    entries = []
    values: dict[str, bytes] = {}
    for ordinal, (entry_id, role, source, materialized) in enumerate(sources, start=1):
        raw = json.dumps(source, sort_keys=True, separators=(",", ":")).encode()
        version = f"sha256:{hashlib.sha256(raw).hexdigest()}"
        content_id = f"content-{ordinal}"
        entries.append(
            input_pb2.ExecutionInputEntryV1(
                entry_id=entry_id,
                immutable_version=version,
                semantic_role=role,
                content=input_pb2.ScopedContentReferenceV1(
                    content_id=content_id,
                    immutable_version=version,
                    media_type="application/json",
                    byte_length=len(raw),
                    digest=_digest(hashlib.sha256(raw).digest()),
                    classification="tenant-confidential",
                    required_grant_audience="elitea.runtime.input.read.v1",
                ),
            )
        )
        values[content_id] = json.dumps(
            materialized,
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    manifest = input_pb2.ExecutionInputBundleV1(
        input_bundle_id="index-bundle-1",
        immutable_version="admission:index-bundle-1",
        entries=entries,
    )
    manifest_raw = manifest.SerializeToString(deterministic=True)
    command = command_pb2.WorkerCommandV1(
        protocol_revision="elitea.runtime.v1",
        command_id="index-command-1",
        idempotency_key="index-idempotency-1",
        command_type=command_pb2.WORKER_COMMAND_TYPE_V1_INDEX_INGEST,
        execution_id="index-execution-1",
        generation=1,
        dispatch_ordinal=1,
        root_execution_id="index-execution-1",
        tenant_id="tenant-1",
        resource_project_id="42",
        projection_project_id="42",
        principal_ref="user:7",
        input_bundle_ref=input_pb2.ExecutionInputBundleReferenceV1(
            input_bundle_id=manifest.input_bundle_id,
            immutable_version=manifest.immutable_version,
            digest=_digest(hashlib.sha256(manifest_raw).digest()),
            byte_length=len(manifest_raw),
            media_type="application/x-protobuf",
        ),
        capability_id="index.ingest.v1",
        capability_version="1",
        resource_class="indexing",
        isolation_class="shared",
        priority=1,
        deadline_unix_millis=_NOW + 60_000,
        limits_revision="elitea.runtime.limits.conformance.v1",
        index_ingest=indexing_pb2.IndexIngestCommandV1(
            toolkit_configuration_entry_id="toolkit-config",
            tool_parameters_entry_id="tool-params",
            llm_model_entry_id="llm-model",
            llm_configuration_entry_id="llm-config",
            mcp_tokens_entry_id="mcp-tokens",
            client_stream_id="conversation-1",
            client_message_id="message-1",
            sio_event="chat_predict",
        ),
    )
    command_raw = command.SerializeToString(deterministic=True)
    signed = envelope_pb2.SignedWorkerCommandEnvelopeV1(
        envelope_schema_revision=ENVELOPE_SCHEMA_REVISION,
        signature_profile=envelope_pb2.SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256,
        key_id=CONFORMANCE_HMAC_KEY_ID,
        worker_command_bytes=command_raw,
        worker_command_digest=_digest(hashlib.sha256(command_raw).digest()),
        signature=hmac.new(CONFORMANCE_HMAC_KEY, command_raw, hashlib.sha256).digest(),
    )
    return Case(
        command=command,
        signed=signed,
        manifest=manifest,
        fence=common_pb2.ExecutionFenceV1(
            workload_session_id=_WORKLOAD,
            claim_attempt=1,
            lease_epoch=1,
            producer_id=_PRODUCER,
            fence_token=b"f" * 32,
        ),
        values=values,
    )


def _terminal_result() -> IndexIngestResult:
    case = _case()
    return IndexIngestResult(
        input_bundle_id="index-bundle-1",
        input_bundle_digest=hashlib.sha256(
            case.manifest.SerializeToString(deterministic=True)
        ).digest(),
        toolkit_configuration=IndexIngestInputBinding(
            "toolkit-config",
            case.manifest.entries[0].immutable_version,
            bytes(case.manifest.entries[0].content.digest.value),
        ),
        tool_parameters=IndexIngestInputBinding(
            "tool-params",
            case.manifest.entries[1].immutable_version,
            bytes(case.manifest.entries[1].content.digest.value),
        ),
        llm_model=IndexIngestInputBinding(
            "llm-model",
            case.manifest.entries[2].immutable_version,
            bytes(case.manifest.entries[2].content.digest.value),
        ),
        llm_configuration=IndexIngestInputBinding(
            "llm-config",
            case.manifest.entries[3].immutable_version,
            bytes(case.manifest.entries[3].content.digest.value),
        ),
        mcp_tokens=IndexIngestInputBinding(
            "mcp-tokens",
            case.manifest.entries[4].immutable_version,
            bytes(case.manifest.entries[4].content.digest.value),
        ),
        sdk_result={"success": True, "result": {"status": "ok", "message": "done"}},
    )


def _with_manifest(
    case: Case,
    manifest: input_pb2.ExecutionInputBundleV1,
) -> Case:
    command = command_pb2.WorkerCommandV1.FromString(
        case.command.SerializeToString(deterministic=True)
    )
    manifest_raw = manifest.SerializeToString(deterministic=True)
    command.input_bundle_ref.byte_length = len(manifest_raw)
    command.input_bundle_ref.digest.CopyFrom(
        _digest(hashlib.sha256(manifest_raw).digest())
    )
    command_raw = command.SerializeToString(deterministic=True)
    signed = envelope_pb2.SignedWorkerCommandEnvelopeV1(
        envelope_schema_revision=ENVELOPE_SCHEMA_REVISION,
        signature_profile=envelope_pb2.SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256,
        key_id=CONFORMANCE_HMAC_KEY_ID,
        worker_command_bytes=command_raw,
        worker_command_digest=_digest(hashlib.sha256(command_raw).digest()),
        signature=hmac.new(
            CONFORMANCE_HMAC_KEY,
            command_raw,
            hashlib.sha256,
        ).digest(),
    )
    return Case(
        command=command,
        signed=signed,
        manifest=manifest,
        fence=case.fence,
        values=case.values,
    )


def _digest(value: bytes) -> common_pb2.DigestV1:
    return common_pb2.DigestV1(
        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
        value=value,
    )


def _identity(command: command_pb2.WorkerCommandV1) -> common_pb2.ExecutionIdentityV1:
    return common_pb2.ExecutionIdentityV1(
        tenant_id=command.tenant_id,
        resource_project_id=command.resource_project_id,
        projection_project_id=command.projection_project_id,
        command_id=command.command_id,
        execution_id=command.execution_id,
        generation=command.generation,
    )
