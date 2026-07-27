from __future__ import annotations

from elitea.runtime.v1 import index_search_pb2


def test_index_search_command_fixture_is_stable_for_go_consumer() -> None:
    command = index_search_pb2.IndexSearchCommandV1(
        operation=index_search_pb2.INDEX_SEARCH_OPERATION_V1_SEARCH_INDEX,
        toolkit_configuration_entry_id="toolkit",
        tool_parameters_entry_id="params",
        llm_model_entry_id="llm-model",
        llm_configuration_entry_id="llm-config",
        mcp_tokens_entry_id="mcp-tokens",
    )

    # The Go contract test consumes this exact Python-produced wire fixture.
    assert command.SerializeToString(deterministic=True).hex() == (
        "08011207746f6f6c6b69741a06706172616d7322096c6c6d2d6d6f64656c"
        "2a0a6c6c6d2d636f6e666967320a6d63702d746f6b656e73"
    )
