from __future__ import annotations

import pytest

from elitea.runtime.v1 import index_search_pb2

from elitea_worker.agents.sdk_adapter import EliteaSdkIndexSearchAdapter
from elitea_worker.execution.errors import InvalidInput
from elitea_worker.handlers.index_search import IndexSearchHandler, IndexSearchRequest
from elitea_worker.protocol.index_search import bind_result_artifact


class _SDK:
    def __init__(self, value: dict) -> None:
        self.value = value
        self.calls: list[dict] = []

    def execute(self, **kwargs):
        self.calls.append(kwargs)
        return self.value


@pytest.mark.parametrize(
    ("operation", "value"),
    [
        ("search_index", {"success": True, "result": [{"score": 0.9}]}),
        ("stepback_search_index", {"success": True, "result": "Found 1 documents matching the query\n[]"}),
        ("list_indexes", {"success": True, "result": ["current"]}),
        ("search_index", {"success": False, "error": "No documents found by query 'x' and filter '{}"}),
    ],
)
def test_handler_preserves_current_sdk_branches(operation: str, value: dict) -> None:
    sdk = _SDK(value)
    request = _request(operation)

    assert IndexSearchHandler(sdk).execute(request) is value
    assert sdk.calls == [
        {
            "operation": operation,
            "toolkit_config": request.toolkit_config,
            "tool_params": request.tool_params,
            "runtime_config": request.runtime_config,
            "llm_model": request.llm_model,
            "llm_config": request.llm_config,
            "mcp_tokens": request.mcp_tokens,
        }
    ]


def test_handler_rejects_non_parity_tool_before_sdk_call() -> None:
    sdk = _SDK({"success": True})
    with pytest.raises(InvalidInput):
        IndexSearchHandler(sdk).execute(_request("remove_index"))
    assert sdk.calls == []


def test_sdk_adapter_matches_current_invocation_copy_boundaries() -> None:
    class _Client:
        def __init__(self) -> None:
            self.kwargs = None

        def test_toolkit_tool(self, **kwargs):
            self.kwargs = kwargs
            return {"success": True, "result": ["current"]}

    client = _Client()
    adapter = object.__new__(EliteaSdkIndexSearchAdapter)
    adapter._client = client
    request = _request("search_index")

    assert adapter.execute(
        operation=request.operation,
        toolkit_config=request.toolkit_config,
        tool_params=request.tool_params,
        runtime_config=request.runtime_config,
        llm_model=request.llm_model,
        llm_config=request.llm_config,
        mcp_tokens=request.mcp_tokens,
    ) == {"success": True, "result": ["current"]}
    assert client.kwargs["tool_name"] == "search_index"
    assert client.kwargs["toolkit_config"] == request.toolkit_config
    assert client.kwargs["toolkit_config"] is not request.toolkit_config
    assert client.kwargs["tool_params"] == request.tool_params
    assert client.kwargs["tool_params"] is not request.tool_params
    assert client.kwargs["llm_config"] == request.llm_config
    assert client.kwargs["llm_config"] is not request.llm_config
    assert client.kwargs["runtime_config"] is request.runtime_config


def test_artifact_result_binds_opaque_current_result_to_exact_inputs() -> None:
    binding = index_search_pb2.IndexSearchInputBindingV1(
        entry_id="toolkit",
        immutable_version="sha256:toolkit",
        content_digest={"algorithm": "DIGEST_ALGORITHM_V1_SHA256", "value": b"t" * 32},
    )
    result = bind_result_artifact(
        operation=index_search_pb2.INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX,
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        toolkit_configuration=binding,
        tool_parameters=binding,
        llm_model=None,
        llm_configuration=None,
        mcp_tokens=None,
        artifact_id="artifact-1",
        immutable_version="sha256:artifact",
        media_type="application/vnd.elitea.index-search-result.v1+json",
        byte_length=1024,
        artifact_digest=b"a" * 32,
        classification="tenant-confidential",
    )

    assert result.operation == index_search_pb2.INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX
    assert result.toolkit_configuration.entry_id == "toolkit"
    assert result.result_artifact.artifact_id == "artifact-1"
    assert bytes(result.result_artifact.digest.value) == b"a" * 32


def _request(operation: str) -> IndexSearchRequest:
    return IndexSearchRequest(
        operation=operation,
        toolkit_config={"type": "github", "settings": {"embedding_model": "current-bound"}},
        tool_params={
            "query": "release notes",
            "filter": {"state": {"$eq": "published"}},
            "full_text_search": {"enabled": True, "fields": ["page_content"]},
            "reranking_config": {"source": {"weight": 2, "rules": {"priority": "docs"}}},
            "extended_search": ["summary"],
            "output_fields": ["metadata.source", "score"],
        },
        runtime_config={"metadata": {"initiator": "user"}},
        llm_model="current-model",
        llm_config={"temperature": 0.1},
        mcp_tokens={"server": "opaque"},
    )
