"""Pure protobuf bindings for the source-only index-search compatibility seam."""

from __future__ import annotations

from elitea.runtime.v1 import common_pb2, index_search_pb2

from elitea_worker.execution.errors import InvalidInput


def bind_result_artifact(
    *,
    operation: int,
    input_bundle_id: str,
    input_bundle_digest: bytes,
    toolkit_configuration: index_search_pb2.IndexSearchInputBindingV1,
    tool_parameters: index_search_pb2.IndexSearchInputBindingV1,
    llm_model: index_search_pb2.IndexSearchInputBindingV1 | None,
    llm_configuration: index_search_pb2.IndexSearchInputBindingV1 | None,
    mcp_tokens: index_search_pb2.IndexSearchInputBindingV1 | None,
    embedding_binding: index_search_pb2.IndexSearchInputBindingV1,
    artifact_id: str,
    immutable_version: str,
    media_type: str,
    byte_length: int,
    artifact_digest: bytes,
    classification: str,
) -> index_search_pb2.IndexSearchResultV1:
    if (
        operation
        not in {
            index_search_pb2.INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX,
            index_search_pb2.INDEX_SEARCH_OPERATION_V1_STEPBACK_SEARCH_INDEX,
            index_search_pb2.INDEX_SEARCH_OPERATION_V1_LIST_INDEXES,
        }
        or not input_bundle_id
        or not artifact_id
        or not immutable_version
        or not media_type
        or not classification
        or not embedding_binding.entry_id
        or byte_length < 0
    ):
        raise InvalidInput("The index-search artifact binding is malformed.")

    result = index_search_pb2.IndexSearchResultV1(
        operation=operation,
        input_bundle_id=input_bundle_id,
        input_bundle_digest=_digest(input_bundle_digest),
        toolkit_configuration=toolkit_configuration,
        tool_parameters=tool_parameters,
        embedding_binding=embedding_binding,
        result_artifact=index_search_pb2.IndexSearchArtifactReferenceV1(
            artifact_id=artifact_id,
            immutable_version=immutable_version,
            media_type=media_type,
            byte_length=byte_length,
            digest=_digest(artifact_digest),
            classification=classification,
        ),
    )
    if llm_model is not None:
        result.llm_model.CopyFrom(llm_model)
    if llm_configuration is not None:
        result.llm_configuration.CopyFrom(llm_configuration)
    if mcp_tokens is not None:
        result.mcp_tokens.CopyFrom(mcp_tokens)
    return result


def _digest(value: bytes) -> common_pb2.DigestV1:
    if not isinstance(value, bytes) or len(value) != 32:
        raise InvalidInput("An index-search digest binding is malformed.")
    return common_pb2.DigestV1(
        algorithm=common_pb2.DIGEST_ALGORITHM_V1_SHA256,
        value=value,
    )
