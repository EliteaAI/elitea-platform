from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

import pytest

from elitea.runtime.v1 import command_pb2, envelope_pb2, output_pb2

from elitea_worker.app import OfflineValidationWorker
from elitea_worker.constants import CONFORMANCE_HMAC_KEY, MAX_ENVELOPE_BYTES
from elitea_worker.execution.errors import (
    AuthorizationFailure,
    IncompatibleVersion,
    InvalidInput,
    ResourceExhausted,
    UnsupportedCapability,
)
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    read_and_verify_envelope,
)


_SERVICE_ROOT = Path(__file__).parents[2]
_FIXTURES = (
    _SERVICE_ROOT.parents[1]
    / "testdata"
    / "proto"
    / "runtime"
    / "v1"
    / "configuration-validation"
)
_AUTHENTICATOR = TestOnlyConformanceHmacAuthenticator()


@pytest.mark.parametrize("name", ["valid", "invalid", "unsupported"])
def test_offline_execution_matches_cross_language_golden_bytes(name: str, tmp_path: Path) -> None:
    fixture = _FIXTURES / name
    output = tmp_path / "output.pb"

    OfflineValidationWorker().execute(
        envelope_path=fixture / "envelope.pb",
        fixture_bundle_path=fixture / "fixture-bundle.json",
        output_path=output,
    )

    assert output.read_bytes() == (fixture / "expected-output.pb").read_bytes()


def test_invalid_fixture_exposes_only_safe_registered_issue(tmp_path: Path) -> None:
    fixture = _FIXTURES / "invalid"
    output = tmp_path / "output.pb"
    OfflineValidationWorker().execute(
        envelope_path=fixture / "envelope.pb",
        fixture_bundle_path=fixture / "fixture-bundle.json",
        output_path=output,
    )
    frame = output_pb2.ExecutionOutputFrameV1.FromString(output.read_bytes())

    assert frame.WhichOneof("payload") == "configuration_validation"
    assert frame.configuration_validation.valid is False
    assert [
        (issue.code, issue.json_pointer, issue.safe_message)
        for issue in frame.configuration_validation.issues
    ] == [("VALUE_NOT_ALLOWED", "/auth_type", "Value is not one of the allowed choices.")]
    assert "Digest" not in str(frame)
    assert "Input should be" not in str(frame)


def test_unsupported_fixture_is_runtime_failure_not_fake_schema_issue(tmp_path: Path) -> None:
    fixture = _FIXTURES / "unsupported"
    output = tmp_path / "output.pb"
    worker = OfflineValidationWorker()
    worker.execute(
        envelope_path=fixture / "envelope.pb",
        fixture_bundle_path=fixture / "fixture-bundle.json",
        output_path=output,
    )
    frame = output_pb2.ExecutionOutputFrameV1.FromString(output.read_bytes())

    assert frame.WhichOneof("payload") == "runtime_error"
    assert frame.runtime_error.safe_message == "Configuration type is not supported."
    with pytest.raises(UnsupportedCapability):
        worker.validate_envelope(fixture / "envelope.pb")


def test_tampered_exact_command_bytes_fail_before_command_decode(tmp_path: Path) -> None:
    envelope = _load_envelope("valid")
    command = bytearray(envelope.signed_command.worker_command_bytes)
    command[-1] ^= 1
    envelope.signed_command.worker_command_bytes = bytes(command)
    path = _write_envelope(tmp_path, envelope)

    with pytest.raises(AuthorizationFailure, match="digest"):
        read_and_verify_envelope(path, authenticator=_AUTHENTICATOR)


@pytest.mark.parametrize(
    ("suffix", "error"),
    [
        (b"\x0a\x01x", InvalidInput),  # duplicate known field 1
        (b"\x08\x01", InvalidInput),  # known field 1 with wrong wire type
        (b"\x80", InvalidInput),  # truncated tag varint
        (b"\xf8\x03\x00", IncompatibleVersion),  # unknown field 63
    ],
)
def test_authentic_duplicate_or_unknown_command_field_is_rejected(
    tmp_path: Path,
    suffix: bytes,
    error: type[Exception],
) -> None:
    envelope = _load_envelope("valid")
    command = envelope.signed_command.worker_command_bytes + suffix
    envelope.signed_command.worker_command_bytes = command
    envelope.signed_command.worker_command_digest.value = hashlib.sha256(command).digest()
    envelope.signed_command.signature = hmac.new(
        CONFORMANCE_HMAC_KEY,
        command,
        hashlib.sha256,
    ).digest()
    path = _write_envelope(tmp_path, envelope)

    with pytest.raises(error):
        read_and_verify_envelope(path, authenticator=_AUTHENTICATOR)


def test_authentic_duplicate_capability_oneof_is_rejected(tmp_path: Path) -> None:
    envelope = _load_envelope("valid")
    parsed = envelope_pb2.WorkerExecutionEnvelopeV1.FromString(
        envelope.SerializeToString(deterministic=True)
    )
    command_message = command_pb2.WorkerCommandV1.FromString(
        parsed.signed_command.worker_command_bytes
    )
    payload = command_message.configuration_validation.SerializeToString(
        deterministic=True
    )
    # Field 32, wire type 2, followed by another complete oneof value.
    command = (
        parsed.signed_command.worker_command_bytes
        + b"\x82\x02"
        + _varint(len(payload))
        + payload
    )
    parsed.signed_command.worker_command_bytes = command
    parsed.signed_command.worker_command_digest.value = hashlib.sha256(command).digest()
    parsed.signed_command.signature = hmac.new(
        CONFORMANCE_HMAC_KEY,
        command,
        hashlib.sha256,
    ).digest()

    with pytest.raises(InvalidInput, match="duplicated"):
        read_and_verify_envelope(
            _write_envelope(tmp_path, parsed),
            authenticator=_AUTHENTICATOR,
        )


def test_oversize_envelope_is_rejected_before_decode(tmp_path: Path) -> None:
    path = tmp_path / "oversize.pb"
    path.write_bytes(b"x" * (MAX_ENVELOPE_BYTES + 1))

    with pytest.raises(ResourceExhausted):
        read_and_verify_envelope(path, authenticator=_AUTHENTICATOR)


def test_public_conformance_hmac_is_rejected_without_explicit_test_authenticator() -> None:
    with pytest.raises(AuthorizationFailure, match="No production"):
        read_and_verify_envelope(_FIXTURES / "valid" / "envelope.pb")


def _load_envelope(name: str) -> envelope_pb2.WorkerExecutionEnvelopeV1:
    return envelope_pb2.WorkerExecutionEnvelopeV1.FromString(
        (_FIXTURES / name / "envelope.pb").read_bytes()
    )


def _write_envelope(
    root: Path,
    envelope: envelope_pb2.WorkerExecutionEnvelopeV1,
) -> Path:
    path = root / "envelope.pb"
    path.write_bytes(envelope.SerializeToString(deterministic=True))
    return path


def _varint(value: int) -> bytes:
    result = bytearray()
    while value >= 0x80:
        result.append((value & 0x7F) | 0x80)
        value >>= 7
    result.append(value)
    return bytes(result)
