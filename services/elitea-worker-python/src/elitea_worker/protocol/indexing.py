"""Pure typed mapping for the reference-only ``index.ingest.v1`` boundary."""

from __future__ import annotations

from typing import Any

from elitea.runtime.v1 import common_pb2, indexing_pb2

from elitea_worker.constants import MAX_SAFE_STRING_BYTES
from elitea_worker.execution.errors import InternalFailure, InvalidInput, ResourceExhausted
from elitea_worker.handlers.indexing import (
    IndexIngestInputBinding,
    IndexIngestRequest,
    IndexIngestResult,
    ResolvedIndexIngestInput,
)

RESULT_MEDIA_TYPE = "application/vnd.elitea.index-ingest-result.v1+json"
RESULT_CLASSIFICATION = "tenant-confidential"
MAX_RESULT_SUMMARY_MESSAGE_BYTES = 48 * 1024
INDEX_INGEST_FAILURE_SAFE_MESSAGE = "Indexing failed before completion."

_SUMMARY_STATUS = {
    "ok": indexing_pb2.INDEX_INGEST_STATUS_V1_OK,
    "partly_indexed": indexing_pb2.INDEX_INGEST_STATUS_V1_PARTLY_INDEXED,
    "error": indexing_pb2.INDEX_INGEST_STATUS_V1_ERROR,
}


def request_from(
    command: indexing_pb2.IndexIngestCommandV1,
    *,
    input_bundle_id: str,
    input_bundle_digest: bytes,
    toolkit_configuration: ResolvedIndexIngestInput,
    tool_parameters: ResolvedIndexIngestInput,
    llm_model: ResolvedIndexIngestInput | None,
    llm_configuration: ResolvedIndexIngestInput | None,
    mcp_tokens: ResolvedIndexIngestInput | None,
    runtime_config: dict[str, Any],
) -> IndexIngestRequest:
    expected = (
        (command.toolkit_configuration_entry_id, toolkit_configuration),
        (command.tool_parameters_entry_id, tool_parameters),
        (command.llm_model_entry_id, llm_model),
        (command.llm_configuration_entry_id, llm_configuration),
        (command.mcp_tokens_entry_id, mcp_tokens),
    )
    if any(not _matches(entry_id, value) for entry_id, value in expected):
        raise InvalidInput(
            "An index-ingest input does not match its command reference."
        )
    return IndexIngestRequest(
        input_bundle_id=input_bundle_id,
        input_bundle_digest=input_bundle_digest,
        toolkit_configuration=toolkit_configuration,
        tool_parameters=tool_parameters,
        llm_model=llm_model,
        llm_configuration=llm_configuration,
        mcp_tokens=mcp_tokens,
        runtime_config=runtime_config,
    )


def bind_result_artifact(
    result: IndexIngestResult,
    *,
    artifact_id: str,
    immutable_version: str,
    byte_length: int,
    digest: bytes,
) -> indexing_pb2.IndexIngestResultV1:
    """Bind a separately persisted, reviewed result projection.

    The raw trusted-memory ``sdk_result`` is intentionally not inspected or
    serialized here.
    """

    text = (artifact_id, immutable_version, result.input_bundle_id)
    if (
        any(not isinstance(value, str) or not value for value in text)
        or len(digest) != 32
    ):
        raise InvalidInput("The index-ingest result artifact identity is malformed.")
    if any(not _valid_text(value) for value in text):
        raise ResourceExhausted("The index-ingest result reference exceeds its limit.")
    if (
        isinstance(byte_length, bool)
        or not isinstance(byte_length, int)
        or byte_length < 1
        or byte_length >= 1 << 64
    ):
        raise InvalidInput("The index-ingest result artifact length is malformed.")
    message = indexing_pb2.IndexIngestResultV1(
        input_bundle_id=result.input_bundle_id,
        input_bundle_digest=_digest(result.input_bundle_digest),
        toolkit_configuration=_binding(result.toolkit_configuration),
        tool_parameters=_binding(result.tool_parameters),
        result_artifact=indexing_pb2.IndexIngestArtifactReferenceV1(
            artifact_id=artifact_id,
            immutable_version=immutable_version,
            media_type=RESULT_MEDIA_TYPE,
            byte_length=byte_length,
            digest=_digest(digest),
            classification=RESULT_CLASSIFICATION,
        ),
    )
    _copy_optional(message.llm_model, result.llm_model)
    _copy_optional(message.llm_configuration, result.llm_configuration)
    _copy_optional(message.mcp_tokens, result.mcp_tokens)
    return message


def bind_result_summary(result: IndexIngestResult) -> indexing_pb2.IndexIngestResultV1:
    """Project only the reviewed terminal fields from trusted SDK memory.

    The current SDK outer object can contain redeemed toolkit configuration,
    model settings and callback state. This function deliberately reads only
    ``success``/``error`` and the nested ``result.status``/``result.message``.
    No other SDK field can enter protobuf serialization.
    """

    sdk_result = result.sdk_result
    if not isinstance(sdk_result, dict):
        raise InternalFailure()
    success = sdk_result.get("success")
    if success is False:
        # The current SDK error can contain endpoint, toolkit, model or
        # credential-adjacent data. Preserve the business-failure outcome while
        # deliberately improving the legacy disclosure behavior: only this
        # fixed safe message crosses the worker boundary.
        error = sdk_result.get("error")
        if not isinstance(error, str) or not error:
            raise InternalFailure()
        status = indexing_pb2.INDEX_INGEST_STATUS_V1_ERROR
        message = INDEX_INGEST_FAILURE_SAFE_MESSAGE
    else:
        if success is not True:
            raise InternalFailure()
        nested = sdk_result.get("result")
        if not isinstance(nested, dict):
            raise InternalFailure()
        status = _SUMMARY_STATUS.get(nested.get("status"))
        message = nested.get("message")
        if (
            status is None
            or not isinstance(message, str)
            or not message
            or "\x00" in message
        ):
            raise InternalFailure()
        try:
            message_bytes = message.encode("utf-8")
        except UnicodeEncodeError as exc:
            raise InternalFailure() from exc
        if len(message_bytes) > MAX_RESULT_SUMMARY_MESSAGE_BYTES:
            raise ResourceExhausted(
                "The index-ingest result exceeds the approved output limit."
            )

    bound = indexing_pb2.IndexIngestResultV1(
        input_bundle_id=result.input_bundle_id,
        input_bundle_digest=_digest(result.input_bundle_digest),
        toolkit_configuration=_binding(result.toolkit_configuration),
        tool_parameters=_binding(result.tool_parameters),
        result_summary=indexing_pb2.IndexIngestSummaryV1(
            status=status,
            message=message,
        ),
    )
    _copy_optional(bound.llm_model, result.llm_model)
    _copy_optional(bound.llm_configuration, result.llm_configuration)
    _copy_optional(bound.mcp_tokens, result.mcp_tokens)
    return bound


def _matches(entry_id: str, value: ResolvedIndexIngestInput | None) -> bool:
    if value is None:
        return not entry_id
    return bool(entry_id) and value.binding.entry_id == entry_id


def _binding(value: IndexIngestInputBinding) -> indexing_pb2.IndexIngestInputBindingV1:
    if not _valid_text(value.entry_id) or not _valid_text(value.immutable_version):
        raise ResourceExhausted("The index-ingest input binding exceeds its limit.")
    return indexing_pb2.IndexIngestInputBindingV1(
        entry_id=value.entry_id,
        immutable_version=value.immutable_version,
        content_digest=_digest(value.content_digest),
    )


def _copy_optional(
    target: indexing_pb2.IndexIngestInputBindingV1,
    value: IndexIngestInputBinding | None,
) -> None:
    if value is not None:
        target.CopyFrom(_binding(value))


def _digest(value: bytes) -> common_pb2.DigestV1:
    if not isinstance(value, bytes) or len(value) != 32:
        raise InvalidInput("An index-ingest digest binding is malformed.")
    return common_pb2.DigestV1(
        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
        value=value,
    )


def _valid_text(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        return len(value.encode("utf-8")) <= MAX_SAFE_STRING_BYTES
    except UnicodeEncodeError:
        return False
