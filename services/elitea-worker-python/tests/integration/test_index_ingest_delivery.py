from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from dataclasses import dataclass
from typing import Any

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
from elitea_worker.execution.errors import InvalidInput
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    VerifiedWorkerCommand,
    build_output_frame,
)
from elitea_worker.protocol.indexing import bind_result_summary
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
        return operation(*args, **kwargs)


class RecordingSdk:
    def __init__(self, result: dict[str, Any]) -> None:
        self.result = result
        self.calls: list[dict[str, Any]] = []

    def ingest(self, **kwargs: Any) -> dict[str, Any]:
        self.calls.append(kwargs)
        return self.result


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
        self.sent += 1

    async def wait_for_ack(self, sequence: int, timeout_seconds: float) -> None:
        assert self.frame is not None and sequence == 1 and timeout_seconds > 0

    async def close(self) -> None:
        return None


class Control:
    def __init__(self, case: "Case", *, active: bool = False) -> None:
        self.case = case
        self.active = active
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
            claim_handoff_watermark=1,
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
    sdk_success: bool,
) -> None:
    async def run() -> None:
        case = _case()
        canary = "REDEEMED_SECRET_CANARY"
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
        sdk = RecordingSdk(sdk_result)
        monkeypatch.setattr(
            EliteaSdkIndexingAdapter,
            "from_context",
            classmethod(lambda cls, context: sdk),
        )
        sequence: list[str] = []

        async def context_factory(claim: IndexExecutionClaim) -> EliteaClientContext:
            sequence.append("context")
            assert claim.resource_project_id == "42"
            return EliteaClientContext(42, "https://elitea.internal", "system-pat")

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
        if sdk_success:
            assert result.output_frame.event_type == output_pb2.EXECUTION_OUTPUT_EVENT_TYPE_V1_INDEX_INGEST_RESULT
            assert result.output_frame.index_ingest.result_summary.status == indexing_pb2.INDEX_INGEST_STATUS_V1_OK
            assert result.output_frame.index_ingest.result_summary.message == "Indexed 3 documents"
            assert sdk.calls[0]["toolkit_config"]["settings"]["token"] == "github-secret"
            assert sdk.calls[0]["runtime_config"] == {}
        else:
            assert result.output_frame.runtime_error.code == errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL
            assert result.output_frame.runtime_error.safe_message == "The runtime operation failed."

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
            claim_handoff_watermark=1,
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
            return EliteaClientContext(42, "https://elitea.internal", "system-pat")

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
        output_session_factory=lambda: output,
        signed_command_authenticator=TestOnlyConformanceHmacAuthenticator(),
        workload_session_id=_WORKLOAD,
        producer_id=_PRODUCER,
        clock_unix_millis=clock,
        lease_poll_interval_seconds=10,
    )


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
