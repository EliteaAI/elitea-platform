from __future__ import annotations

from pathlib import Path

from elitea_worker.agents.sdk_adapter import SdkValidationError
from elitea_worker.constants import CONFORMANCE_OCCURRED_AT_UNIX_MILLIS
from elitea_worker.execution.errors import DeadlineExceeded, InternalFailure, WorkerError
from elitea.runtime.v1 import errors_pb2
from elitea_worker.handlers.validation import _map_errors
from elitea_worker.protocol.codec import (
    TestOnlyConformanceHmacAuthenticator,
    build_output_frame,
    read_and_verify_envelope,
)


_FIXTURE = (
    Path(__file__).parents[4]
    / "testdata/proto/runtime/v1/configuration-validation/valid/envelope.pb"
)


def test_json_pointer_escapes_tokens_and_unknown_validator_text_is_not_forwarded() -> None:
    issues = _map_errors(
        (
            SdkValidationError("future_custom_error", ("a/b", "c~d"), 0),
        )
    )

    assert [(issue.code, issue.json_pointer, issue.safe_message) for issue in issues] == [
        ("INVALID_VALUE", "/a~1b/c~0d", "Value does not satisfy the configuration schema.")
    ]


def test_issue_order_is_pointer_code_then_stable_ordinal_and_duplicates_are_removed() -> None:
    issues = _map_errors(
        (
            SdkValidationError("literal_error", ("z",), 0),
            SdkValidationError("missing", ("a",), 1),
            SdkValidationError("missing", ("a",), 2),
        )
    )

    assert [(issue.code, issue.json_pointer) for issue in issues] == [
        ("REQUIRED_FIELD", "/a"),
        ("VALUE_NOT_ALLOWED", "/z"),
    ]


def test_arbitrary_worker_error_text_never_reaches_output_contract() -> None:
    verified = read_and_verify_envelope(
        _FIXTURE,
        authenticator=TestOnlyConformanceHmacAuthenticator(),
    )
    secret_canary = "raw dependency exception with password=do-not-emit"
    frame = build_output_frame(
        verified,
        WorkerError(
            code="DEPENDENCY_UNAVAILABLE",
            safe_message=secret_canary,
            retryable=False,
        ),
        occurred_at_unix_millis=CONFORMANCE_OCCURRED_AT_UNIX_MILLIS,
    )

    assert frame.runtime_error.safe_message == "A required runtime dependency is unavailable."
    assert frame.runtime_error.retryable is True
    assert secret_canary.encode() not in frame.SerializeToString(deterministic=True)


def test_internal_failure_has_canonical_non_retryable_wire_contract() -> None:
    verified = read_and_verify_envelope(
        _FIXTURE,
        authenticator=TestOnlyConformanceHmacAuthenticator(),
    )
    frame = build_output_frame(
        verified,
        InternalFailure(),
        occurred_at_unix_millis=CONFORMANCE_OCCURRED_AT_UNIX_MILLIS,
    )

    assert frame.runtime_error.code == errors_pb2.RUNTIME_ERROR_CODE_V1_INTERNAL
    assert frame.runtime_error.safe_message == "The runtime operation failed."
    assert frame.runtime_error.retryable is False


def test_deadline_failure_has_canonical_retryable_wire_contract() -> None:
    verified = read_and_verify_envelope(
        _FIXTURE,
        authenticator=TestOnlyConformanceHmacAuthenticator(),
    )
    frame = build_output_frame(
        verified,
        DeadlineExceeded("secret raw deadline detail"),
        occurred_at_unix_millis=CONFORMANCE_OCCURRED_AT_UNIX_MILLIS,
    )

    assert (
        frame.runtime_error.code
        == errors_pb2.RUNTIME_ERROR_CODE_V1_DEADLINE_EXCEEDED
    )
    assert frame.runtime_error.safe_message == "The execution deadline was exceeded."
    assert frame.runtime_error.retryable is True
    assert b"secret raw deadline detail" not in frame.SerializeToString(
        deterministic=True
    )
