"""Strict protobuf framing, production/test signatures and safe output mapping."""

from __future__ import annotations

import hashlib
import hmac
import os
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from google.protobuf.descriptor import Descriptor, FieldDescriptor
from google.protobuf.message import DecodeError, Message

from elitea.runtime.v1 import (
    command_pb2,
    common_pb2,
    envelope_pb2,
    errors_pb2,
    input_pb2,
    output_pb2,
    validation_pb2,
)

from elitea_worker.constants import (
    CAPABILITY_ID,
    CAPABILITY_VERSION,
    CONFORMANCE_HMAC_KEY,
    CONFORMANCE_HMAC_KEY_ID,
    ENVELOPE_SCHEMA_REVISION,
    LIMITS_REVISION,
    MAX_ENVELOPE_BYTES,
    MAX_MANIFEST_BYTES,
    MAX_SIGNED_ENVELOPE_BYTES,
    MAX_SAFE_STRING_BYTES,
    MAX_WORKER_COMMAND_BYTES,
    OUTPUT_SCHEMA_REVISION,
    PROTOCOL_REVISION,
)
from elitea_worker.execution.errors import (
    AuthorizationFailure,
    IncompatibleVersion,
    InvalidInput,
    ResourceExhausted,
    UnsupportedCapability,
    WorkerError,
)
from elitea_worker.handlers.validation import ConfigurationValidationResult


@dataclass(frozen=True, slots=True)
class VerifiedWorkerCommand:
    envelope: envelope_pb2.WorkerExecutionEnvelopeV1
    command: command_pb2.WorkerCommandV1


class SignedCommandAuthenticator(Protocol):
    """Authenticates an already digest-bound signed command envelope."""

    def authenticate(
        self,
        signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    ) -> None: ...


class TestOnlyConformanceHmacAuthenticator:
    """Public conformance key profile; never a production workload identity."""

    def authenticate(
        self,
        signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    ) -> None:
        if (
            signed.signature_profile
            != envelope_pb2.SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256
            or signed.key_id != CONFORMANCE_HMAC_KEY_ID
        ):
            raise AuthorizationFailure("The offline command signature profile is not accepted.")
        expected_signature = hmac.new(
            CONFORMANCE_HMAC_KEY,
            signed.worker_command_bytes,
            hashlib.sha256,
        ).digest()
        if len(signed.signature) != 32 or not hmac.compare_digest(
            expected_signature,
            signed.signature,
        ):
            raise AuthorizationFailure("The worker command signature is invalid.")


class Ed25519PublicKeyResolver(Protocol):
    """Resolves one exact production key ID without default-key fallback."""

    def resolve_ed25519_public_key(self, key_id: str) -> Ed25519PublicKey: ...


class Ed25519CommandAuthenticator:
    """Production verifier for domain-separated pure Ed25519 signatures.

    A rotated verification key must remain resolvable by its exact key ID until
    every immutable prepared command using it has settled or expired.
    """

    def __init__(self, resolver: Ed25519PublicKeyResolver) -> None:
        if resolver is None:
            raise ValueError("an Ed25519 public-key resolver is required")
        self._resolver = resolver

    def authenticate(
        self,
        signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    ) -> None:
        key_id = signed.key_id
        if (
            signed.signature_profile != envelope_pb2.SIGNATURE_PROFILE_V1_ED25519
            or not key_id
            or len(key_id.encode("utf-8")) > MAX_SAFE_STRING_BYTES
            or any(character in key_id for character in ("\r", "\n", "\x00"))
            or len(signed.signature) != 64
        ):
            raise AuthorizationFailure(
                "The production command signature profile is not accepted."
            )
        try:
            public_key = self._resolver.resolve_ed25519_public_key(key_id)
            if not isinstance(public_key, Ed25519PublicKey):
                raise TypeError("resolver returned the wrong key type")
            public_key.verify(
                signed.signature,
                _ed25519_worker_command_signing_input(signed.worker_command_bytes),
            )
        except (InvalidSignature, TypeError, ValueError, KeyError) as exc:
            raise AuthorizationFailure(
                "The worker command signature is invalid."
            ) from exc


def _ed25519_worker_command_signing_input(exact_command_bytes: bytes) -> bytes:
    if not exact_command_bytes:
        raise ValueError("worker command bytes are required")
    domain = b"elitea.runtime.worker-command.ed25519.v1\x00"
    return domain + len(exact_command_bytes).to_bytes(8, "big") + exact_command_bytes


def read_and_verify_envelope(
    path: Path,
    *,
    authenticator: SignedCommandAuthenticator | None = None,
) -> VerifiedWorkerCommand:
    raw = _read_regular(path, MAX_ENVELOPE_BYTES)
    _scan_envelope(raw)
    envelope = envelope_pb2.WorkerExecutionEnvelopeV1()
    _parse(envelope, raw, "worker execution envelope")
    command = _verify_signed_command(envelope.signed_command, authenticator)
    _validate_fence(envelope.fence)
    return VerifiedWorkerCommand(envelope, command)


def parse_and_verify_signed_command(
    raw: bytes,
    *,
    authenticator: SignedCommandAuthenticator | None = None,
) -> tuple[envelope_pb2.SignedWorkerCommandEnvelopeV1, command_pb2.WorkerCommandV1]:
    if not raw or len(raw) > MAX_SIGNED_ENVELOPE_BYTES:
        raise ResourceExhausted("The signed command envelope exceeds the conformance limit.")
    _scan_message(raw, envelope_pb2.SignedWorkerCommandEnvelopeV1.DESCRIPTOR)
    signed = envelope_pb2.SignedWorkerCommandEnvelopeV1()
    _parse(signed, raw, "signed worker command envelope")
    return signed, _verify_signed_command(signed, authenticator)


def parse_execution_input_bundle(raw: bytes) -> input_pb2.ExecutionInputBundleV1:
    if not raw or len(raw) > MAX_MANIFEST_BYTES:
        raise ResourceExhausted("The input bundle manifest exceeds the approved limit.")
    _scan_message(raw, input_pb2.ExecutionInputBundleV1.DESCRIPTOR)
    manifest = input_pb2.ExecutionInputBundleV1()
    _parse(manifest, raw, "execution input bundle")
    return manifest


def parse_execution_output_frame(
    raw: bytes,
    *,
    max_frame_bytes: int,
) -> output_pb2.ExecutionOutputFrameV1:
    """Decode one canonical bounded worker-owned spool frame."""

    if max_frame_bytes < 1:
        raise ValueError("max_frame_bytes must be positive")
    if not raw or len(raw) > max_frame_bytes:
        raise ResourceExhausted("The output frame exceeds the transport limit.")
    _scan_message(raw, output_pb2.ExecutionOutputFrameV1.DESCRIPTOR)
    frame = output_pb2.ExecutionOutputFrameV1()
    _parse(frame, raw, "spooled output frame")
    if frame.SerializeToString(deterministic=True) != raw:
        raise InvalidInput("The spooled output frame is not canonical protobuf.")
    return frame


def _verify_signed_command(
    signed: envelope_pb2.SignedWorkerCommandEnvelopeV1,
    authenticator: SignedCommandAuthenticator | None,
) -> command_pb2.WorkerCommandV1:
    if signed.envelope_schema_revision != ENVELOPE_SCHEMA_REVISION:
        raise IncompatibleVersion("The signed command envelope revision is not compatible.")
    _require_sha256(signed.worker_command_digest, "worker command digest")
    if not signed.worker_command_bytes or len(signed.worker_command_bytes) > MAX_WORKER_COMMAND_BYTES:
        raise ResourceExhausted("The worker command exceeds the conformance limit.")
    calculated_digest = hashlib.sha256(signed.worker_command_bytes).digest()
    if not hmac.compare_digest(calculated_digest, signed.worker_command_digest.value):
        raise AuthorizationFailure("The worker command digest is invalid.")
    if authenticator is None:
        raise AuthorizationFailure(
            "No production signed-command authenticator is configured."
        )
    authenticator.authenticate(signed)

    _scan_worker_command(signed.worker_command_bytes)
    command = command_pb2.WorkerCommandV1()
    _parse(command, signed.worker_command_bytes, "worker command")
    _validate_command(command)
    return command


def validation_request_from(
    verified: VerifiedWorkerCommand,
    *,
    input_bundle_id: str,
    input_bundle_digest: bytes,
    settings_entry_version: str,
    settings_content_digest: bytes,
    settings: dict[str, Any],
) -> Any:
    # Imported lazily to keep generated-message mapping separate from the
    # existing SDK seam.
    from elitea_worker.handlers.validation import ConfigurationValidationRequest

    command = verified.command.configuration_validation
    return ConfigurationValidationRequest(
        configuration_revision_id=command.configuration_revision_id,
        configuration_type=command.configuration_type,
        catalog_revision=command.catalog_revision,
        catalog_digest=bytes(command.catalog_digest.value),
        schema_id=command.schema_id,
        schema_revision=command.schema_revision,
        schema_digest=bytes(command.schema_digest.value),
        input_bundle_id=input_bundle_id,
        input_bundle_digest=input_bundle_digest,
        settings_entry_id=command.settings_entry_id,
        settings_entry_version=settings_entry_version,
        settings_content_digest=settings_content_digest,
        settings=settings,
    )


def build_output_frame(
    verified: VerifiedWorkerCommand,
    outcome: ConfigurationValidationResult | WorkerError,
    *,
    occurred_at_unix_millis: int,
    claim_handoff_watermark: int = 0,
) -> output_pb2.ExecutionOutputFrameV1:
    if occurred_at_unix_millis <= 0 or claim_handoff_watermark < 0:
        raise InvalidInput("The output occurrence time is malformed.")
    command = verified.command
    frame = output_pb2.ExecutionOutputFrameV1(
        output_schema_revision=OUTPUT_SCHEMA_REVISION,
        stream_id=f"{command.execution_id}:{command.generation}",
        identity=common_pb2.ExecutionIdentityV1(
            tenant_id=command.tenant_id,
            resource_project_id=command.resource_project_id,
            projection_project_id=command.projection_project_id,
            command_id=command.command_id,
            execution_id=command.execution_id,
            generation=command.generation,
        ),
        fence=verified.envelope.fence,
        logical_output_id=(
            "configuration-validation:"
            f"{command.configuration_validation.configuration_revision_id}"
        ),
        event_id=f"{command.command_id}:1",
        sequence=1,
        claim_handoff_watermark=claim_handoff_watermark,
        occurred_at_unix_millis=occurred_at_unix_millis,
        terminal=True,
    )
    if isinstance(outcome, ConfigurationValidationResult):
        payload = _validation_result_message(outcome)
        frame.event_type = (
            output_pb2.EXECUTION_OUTPUT_EVENT_TYPE_V1_CONFIGURATION_VALIDATION_RESULT
        )
        frame.configuration_validation.CopyFrom(payload)
        requested_outcome = common_pb2.EXECUTION_OUTCOME_V1_SUCCEEDED
    else:
        payload = _runtime_error_message(outcome)
        frame.event_type = output_pb2.EXECUTION_OUTPUT_EVENT_TYPE_V1_RUNTIME_ERROR
        frame.runtime_error.CopyFrom(payload)
        requested_outcome = (
            common_pb2.EXECUTION_OUTCOME_V1_CANCELLED
            if outcome.code == "CANCELLED"
            else common_pb2.EXECUTION_OUTCOME_V1_FAILED
        )
    payload_bytes = payload.SerializeToString(deterministic=True)
    payload_digest = _digest(hashlib.sha256(payload_bytes).digest())
    frame.payload_digest.CopyFrom(payload_digest)
    frame.settlement_proposal.CopyFrom(
        output_pb2.SettlementProposalV1(
            proposal_id=f"{command.command_id}:settlement",
            requested_outcome=requested_outcome,
            terminal_logical_output_id=frame.logical_output_id,
            terminal_event_id=frame.event_id,
            terminal_sequence=frame.sequence,
            terminal_payload_digest=payload_digest,
            prepare_idempotency_key=f"{command.command_id}:prepare-settlement",
        )
    )
    return frame


def write_output_frame(path: Path, frame: output_pb2.ExecutionOutputFrameV1) -> None:
    raw = frame.SerializeToString(deterministic=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags, 0o600)
    except OSError as exc:
        raise InvalidInput("The output path is unavailable or unsafe.") from exc
    try:
        view = memoryview(raw)
        while view:
            written = os.write(descriptor, view)
            view = view[written:]
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _validation_result_message(
    result: ConfigurationValidationResult,
) -> validation_pb2.ConfigurationValidationResultV1:
    message = validation_pb2.ConfigurationValidationResultV1(
        configuration_revision_id=result.configuration_revision_id,
        configuration_type=result.configuration_type,
        catalog_revision=result.catalog_revision,
        catalog_digest=_digest(result.catalog_digest),
        schema_id=result.schema_id,
        schema_revision=result.schema_revision,
        schema_digest=_digest(result.schema_digest),
        input_bundle_id=result.input_bundle_id,
        input_bundle_digest=_digest(result.input_bundle_digest),
        settings_entry_id=result.settings_entry_id,
        settings_entry_version=result.settings_entry_version,
        settings_content_digest=_digest(result.settings_content_digest),
        valid=result.valid,
    )
    for issue in result.issues:
        message.issues.add(
            code=issue.code,
            json_pointer=issue.json_pointer,
            safe_message=issue.safe_message,
        )
    return message


_ERROR_CODES = {
    "UNSUPPORTED_CAPABILITY": errors_pb2.RUNTIME_ERROR_CODE_V1_UNSUPPORTED_CAPABILITY,
    "INCOMPATIBLE_VERSION": errors_pb2.RUNTIME_ERROR_CODE_V1_INCOMPATIBLE_VERSION,
    "INVALID_INPUT": errors_pb2.RUNTIME_ERROR_CODE_V1_INVALID_INPUT,
    "RESOURCE_EXHAUSTED": errors_pb2.RUNTIME_ERROR_CODE_V1_RESOURCE_EXHAUSTED,
    "DEPENDENCY_UNAVAILABLE": errors_pb2.RUNTIME_ERROR_CODE_V1_DEPENDENCY_UNAVAILABLE,
    "DEADLINE_EXCEEDED": errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED,
    "AUTHORIZATION_FAILED": errors_pb2.RUNTIME_ERROR_CODE_V1_AUTHORIZATION_FAILED,
    "CANCELLED": errors_pb2.RUNTIME_ERROR_CODE_V1_CANCELLED,
    "INTERNAL": errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL,
}

_SAFE_RUNTIME_ERRORS: dict[str, tuple[str, bool]] = {
    "UNSUPPORTED_CAPABILITY": ("Configuration type is not supported.", False),
    "INCOMPATIBLE_VERSION": ("The requested contract version is not compatible.", False),
    "INVALID_INPUT": ("The execution input is invalid.", False),
    "RESOURCE_EXHAUSTED": ("The execution input exceeds an approved limit.", False),
    "DEPENDENCY_UNAVAILABLE": ("A required runtime dependency is unavailable.", True),
    "DEADLINE_EXCEEDED": ("The execution deadline was exceeded.", True),
    "AUTHORIZATION_FAILED": ("Execution authorization failed.", False),
    "CANCELLED": ("Execution was cancelled.", False),
    "INTERNAL": ("The runtime operation failed.", False),
}


def _runtime_error_message(error: WorkerError) -> errors_pb2.RuntimeErrorV1:
    safe_message, retryable = _SAFE_RUNTIME_ERRORS.get(
        error.code,
        ("The runtime operation failed.", False),
    )
    return errors_pb2.RuntimeErrorV1(
        code=_ERROR_CODES.get(error.code, errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL),
        safe_message=safe_message,
        retryable=retryable,
    )


def _validate_command(command: command_pb2.WorkerCommandV1) -> None:
    if command.protocol_revision != PROTOCOL_REVISION or command.limits_revision != LIMITS_REVISION:
        raise IncompatibleVersion()
    if command.capability_id != CAPABILITY_ID or command.capability_version != CAPABILITY_VERSION:
        raise UnsupportedCapability()
    if (
        command.command_type != command_pb2.WORKER_COMMAND_TYPE_V1_CONFIGURATION_VALIDATE
        or command.WhichOneof("capability_command") != "configuration_validation"
    ):
        raise UnsupportedCapability()
    required = (
        command.command_id,
        command.idempotency_key,
        command.execution_id,
        command.root_execution_id,
        command.tenant_id,
        command.resource_project_id,
        command.projection_project_id,
        command.principal_ref,
        command.input_bundle_ref.input_bundle_id,
        command.input_bundle_ref.immutable_version,
        command.input_bundle_ref.media_type,
        command.resource_class,
        command.isolation_class,
        command.configuration_validation.configuration_revision_id,
        command.configuration_validation.configuration_type,
        command.configuration_validation.catalog_revision,
        command.configuration_validation.schema_id,
        command.configuration_validation.schema_revision,
        command.configuration_validation.settings_entry_id,
    )
    if any(not value for value in required):
        raise InvalidInput("The worker command is missing a required reference or identity.")
    bounded = required + (
        command.capability_id,
        command.capability_version,
        command.protocol_revision,
        command.limits_revision,
        command.parent_execution_id,
        command.parent_call_id,
        command.traceparent,
    )
    if any(len(value.encode("utf-8")) > MAX_SAFE_STRING_BYTES for value in bounded):
        raise ResourceExhausted("A worker command reference exceeds the string limit.")
    if len(command.tracestate.encode("utf-8")) > 512:
        raise ResourceExhausted("The worker command trace state exceeds the string limit.")
    if bool(command.parent_execution_id) != bool(command.parent_call_id):
        raise InvalidInput("The worker command parent identity is incomplete.")
    if (
        command.generation < 1
        or command.dispatch_ordinal < 1
        or command.priority < 1
        or command.deadline_unix_millis < 1
    ):
        raise InvalidInput("The worker command scheduling identity is malformed.")
    if command.input_bundle_ref.media_type != "application/x-protobuf":
        raise InvalidInput("The input bundle reference has the wrong media type.")
    _require_sha256(command.input_bundle_ref.digest, "input bundle digest")
    _require_sha256(command.configuration_validation.catalog_digest, "catalog digest")
    _require_sha256(command.configuration_validation.schema_digest, "schema digest")
    if (
        command.input_bundle_ref.byte_length < 1
        or command.input_bundle_ref.byte_length > MAX_MANIFEST_BYTES
    ):
        raise ResourceExhausted("The input bundle manifest exceeds the approved limit.")


def _validate_fence(fence: common_pb2.ExecutionFenceV1) -> None:
    if (
        not fence.workload_session_id
        or not fence.producer_id
        or len(fence.fence_token) != 32
        or fence.claim_attempt < 1
        or fence.lease_epoch < 1
    ):
        raise InvalidInput("The worker command fence is malformed.")
    if (
        len(fence.workload_session_id.encode("utf-8")) > MAX_SAFE_STRING_BYTES
        or len(fence.producer_id.encode("utf-8")) > MAX_SAFE_STRING_BYTES
    ):
        raise ResourceExhausted("The worker command fence exceeds the string limit.")


def _require_sha256(value: common_pb2.DigestV1, description: str) -> None:
    if value.algorithm != common_pb2.DIGEST_ALGORITHM_V1_SHA256 or len(value.value) != 32:
        raise InvalidInput(f"The {description} is malformed.")


def _digest(value: bytes) -> common_pb2.DigestV1:
    if len(value) != 32:
        raise InvalidInput("An output digest binding is malformed.")
    return common_pb2.DigestV1(
        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
        value=value,
    )


def _parse(message: Message, raw: bytes, description: str) -> None:
    try:
        message.ParseFromString(raw)
    except DecodeError as exc:
        raise InvalidInput(f"The {description} is malformed.") from exc


def _scan_envelope(raw: bytes) -> None:
    fields = _scan_message(raw, envelope_pb2.WorkerExecutionEnvelopeV1.DESCRIPTOR)
    signed = _length_field(fields, 1, "signed command")
    if len(signed) > MAX_SIGNED_ENVELOPE_BYTES:
        raise ResourceExhausted("The signed command envelope exceeds the conformance limit.")
    fence = _length_field(fields, 2, "execution fence")
    signed_fields = _scan_message(
        signed,
        envelope_pb2.SignedWorkerCommandEnvelopeV1.DESCRIPTOR,
    )
    _scan_message(fence, common_pb2.ExecutionFenceV1.DESCRIPTOR)
    digest = _length_field(signed_fields, 5, "worker command digest")
    _scan_message(digest, common_pb2.DigestV1.DESCRIPTOR)


def _scan_worker_command(raw: bytes) -> None:
    fields = _scan_message(raw, command_pb2.WorkerCommandV1.DESCRIPTOR)
    input_ref = _length_field(fields, 16, "input bundle reference")
    input_fields = _scan_message(
        input_ref,
        input_pb2.ExecutionInputBundleReferenceV1.DESCRIPTOR,
    )
    _scan_message(
        _length_field(input_fields, 3, "input bundle digest"),
        common_pb2.DigestV1.DESCRIPTOR,
    )
    validation = _length_field(fields, 32, "configuration validation command")
    validation_fields = _scan_message(
        validation,
        validation_pb2.ConfigurationValidationCommandV1.DESCRIPTOR,
    )
    _scan_message(
        _length_field(validation_fields, 4, "catalog digest"),
        common_pb2.DigestV1.DESCRIPTOR,
    )
    _scan_message(
        _length_field(validation_fields, 7, "schema digest"),
        common_pb2.DigestV1.DESCRIPTOR,
    )


def _scan_message(
    raw: bytes,
    descriptor: Descriptor,
    depth: int = 0,
) -> dict[int, tuple[int, bytes]]:
    if depth > 16:
        raise ResourceExhausted("The protobuf message exceeds the nesting limit.")
    known_fields = descriptor.fields_by_number
    position = 0
    result: dict[int, tuple[int, bytes]] = {}
    seen_oneofs: set[str] = set()
    while position < len(raw):
        tag, position = _read_varint(raw, position)
        field_number, wire_type = tag >> 3, tag & 7
        if field_number == 0 or wire_type in (3, 4) or wire_type > 5:
            raise InvalidInput("The protobuf wire message is malformed.")
        if wire_type == 0:
            start = position
            _, position = _read_varint(raw, position)
            payload = raw[start:position]
        elif wire_type == 1:
            end = position + 8
            if end > len(raw):
                raise InvalidInput("The protobuf wire message is truncated.")
            payload, position = raw[position:end], end
        elif wire_type == 2:
            length, position = _read_varint(raw, position)
            end = position + length
            if end > len(raw):
                raise InvalidInput("The protobuf wire message is truncated.")
            payload, position = raw[position:end], end
        else:  # wire type 5
            end = position + 4
            if end > len(raw):
                raise InvalidInput("The protobuf wire message is truncated.")
            payload, position = raw[position:end], end
        field = known_fields.get(field_number)
        if field is not None:
            if wire_type != _expected_wire_type(field):
                raise InvalidInput("A protobuf field has the wrong wire type.")
            if field_number in result and not field.is_repeated:
                raise InvalidInput("A singular protobuf field is duplicated.")
            if field.containing_oneof is not None:
                oneof_name = field.containing_oneof.full_name
                if oneof_name in seen_oneofs:
                    raise InvalidInput("A protobuf oneof field is duplicated.")
                seen_oneofs.add(oneof_name)
            if field.type == FieldDescriptor.TYPE_MESSAGE:
                _scan_message(payload, field.message_type, depth + 1)
            result[field_number] = (wire_type, payload)
        else:
            # Runtime-v1 command/security messages are a closed bounded
            # contract. A newer producer must negotiate a compatible revision
            # instead of smuggling an extension through protobuf unknown-field
            # retention.
            raise IncompatibleVersion("The protobuf message contains an unknown v1 field.")
    return result


def _expected_wire_type(field: FieldDescriptor) -> int:
    if field.type in {
        FieldDescriptor.TYPE_INT32,
        FieldDescriptor.TYPE_INT64,
        FieldDescriptor.TYPE_UINT32,
        FieldDescriptor.TYPE_UINT64,
        FieldDescriptor.TYPE_SINT32,
        FieldDescriptor.TYPE_SINT64,
        FieldDescriptor.TYPE_BOOL,
        FieldDescriptor.TYPE_ENUM,
    }:
        return 0
    if field.type in {
        FieldDescriptor.TYPE_FIXED64,
        FieldDescriptor.TYPE_SFIXED64,
        FieldDescriptor.TYPE_DOUBLE,
    }:
        return 1
    if field.type in {
        FieldDescriptor.TYPE_STRING,
        FieldDescriptor.TYPE_BYTES,
        FieldDescriptor.TYPE_MESSAGE,
    }:
        return 2
    if field.type in {
        FieldDescriptor.TYPE_FIXED32,
        FieldDescriptor.TYPE_SFIXED32,
        FieldDescriptor.TYPE_FLOAT,
    }:
        return 5
    raise InvalidInput("The protobuf field type is not supported by runtime v1.")


def _length_field(
    fields: dict[int, tuple[int, bytes]],
    field_number: int,
    description: str,
) -> bytes:
    try:
        wire_type, payload = fields[field_number]
    except KeyError as exc:
        raise InvalidInput(f"The {description} is missing.") from exc
    if wire_type != 2:
        raise InvalidInput(f"The {description} has the wrong wire type.")
    return payload


def _read_varint(raw: bytes, position: int) -> tuple[int, int]:
    value = 0
    for index in range(10):
        if position >= len(raw):
            raise InvalidInput("The protobuf varint is truncated.")
        octet = raw[position]
        position += 1
        value |= (octet & 0x7F) << (index * 7)
        if not octet & 0x80:
            return value, position
    raise InvalidInput("The protobuf varint exceeds its encoded limit.")


def _read_regular(path: Path, limit: int) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except OSError as exc:
        raise InvalidInput("The envelope path is unavailable or unsafe.") from exc
    try:
        info = os.fstat(descriptor)
        if not stat.S_ISREG(info.st_mode):
            raise InvalidInput("The envelope must be a regular file.")
        if info.st_size > limit:
            raise ResourceExhausted("The envelope exceeds the approved limit.")
        result = bytearray()
        while len(result) <= limit:
            chunk = os.read(descriptor, min(64 * 1024, limit + 1 - len(result)))
            if not chunk:
                break
            result.extend(chunk)
        if len(result) > limit:
            raise ResourceExhausted("The envelope exceeds the approved limit.")
        return bytes(result)
    finally:
        os.close(descriptor)
