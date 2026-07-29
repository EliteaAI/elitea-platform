"""Pure contract mapping for ``toolkit.available_tools.v1``.

This module does not create an output frame. The production artifact writer
must first durably store the prepared bytes, then supply the immutable ID and
version used by this bounded reference message.
"""

from __future__ import annotations

from elitea.runtime.v1 import common_pb2, toolkit_pb2

from elitea_worker.execution.errors import InvalidInput
from elitea_worker.handlers.toolkit_available_tools import ToolkitAvailableToolsResult


def bind_result_artifact(
    result: ToolkitAvailableToolsResult,
    *,
    artifact_id: str,
    immutable_version: str,
) -> toolkit_pb2.ToolkitAvailableToolsResultV1:
    if not artifact_id or not immutable_version:
        raise InvalidInput("The result artifact identity is malformed.")
    return toolkit_pb2.ToolkitAvailableToolsResultV1(
        toolkit_type=result.toolkit_type,
        input_bundle_id=result.input_bundle_id,
        input_bundle_digest=_digest(result.input_bundle_digest),
        settings_entry_id=result.settings_entry_id,
        settings_entry_version=result.settings_entry_version,
        settings_content_digest=_digest(result.settings_content_digest),
        result_artifact=toolkit_pb2.ToolkitAvailableToolsArtifactReferenceV1(
            artifact_id=artifact_id,
            immutable_version=immutable_version,
            media_type=result.artifact.media_type,
            byte_length=len(result.artifact.content),
            digest=_digest(result.artifact.digest),
            classification=result.artifact.classification,
        ),
    )


def _digest(value: bytes) -> common_pb2.DigestV1:
    if len(value) != 32:
        raise InvalidInput("An artifact digest binding is malformed.")
    return common_pb2.DigestV1(
        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
        value=value,
    )
