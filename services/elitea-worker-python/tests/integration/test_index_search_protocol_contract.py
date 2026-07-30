from __future__ import annotations

from elitea.runtime.v1 import index_search_pb2


def test_index_search_command_fixture_is_stable_for_go_consumer() -> None:
    embedding_binding = index_search_pb2.IndexSearchInputBindingV1(
        entry_id="embedding-binding",
        immutable_version="sha256:embedding",
        content_digest={
            "algorithm": "DIGEST_ALGORITHM_V1_SHA256",
            "value": b"e" * 32,
        },
    )
    command = index_search_pb2.IndexSearchCommandV1(
        operation=index_search_pb2.INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX,
        toolkit_configuration_entry_id="toolkit",
        tool_parameters_entry_id="params",
        llm_model_entry_id="llm-model",
        llm_configuration_entry_id="llm-config",
        mcp_tokens_entry_id="mcp-tokens",
        embedding_binding=embedding_binding,
    )

    # The Go contract test consumes this exact Python-produced wire fixture.
    assert command.SerializeToString(deterministic=True).hex() == (
        "08011207746f6f6c6b69741a06706172616d7322096c6c6d2d6d6f64656c2a0a6c6c6d2d"
        "636f6e666967320a6d63702d746f6b656e733a4b0a11656d62656464696e672d62696e64"
        "696e6712107368613235363a656d62656464696e671a2408011220656565656565656565"
        "6565656565656565656565656565656565656565656565"
    )
