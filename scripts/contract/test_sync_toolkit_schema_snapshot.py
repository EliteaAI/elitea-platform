from __future__ import annotations

from pathlib import Path

import pytest

import sync_toolkit_schema_snapshot as sync
from sync_toolkit_schema_snapshot import (
    ContractSyncError,
    _annotation_projection,
    _argument_schema_projection,
    _canonical,
    _require_locked_patch_paths,
    project_toolkit_schemas,
)


# A realistic tool-selection payload: the SDK publishes the tool's own Pydantic
# JSON Schema, ``$defs`` and all, keyed by tool name.
INDEX_DATA_ARGS_SCHEMA = {
    "title": "IndexData",
    "type": "object",
    "properties": {
        "collection_suffix": {
            "title": "Collection Suffix",
            "type": "string",
            "description": "Suffix for the collection name",
        },
        "chunking_config": {"$ref": "#/$defs/ChunkingConfig"},
    },
    "required": ["collection_suffix"],
    "$defs": {
        "ChunkingConfig": {
            "title": "ChunkingConfig",
            "type": "object",
            "properties": {"max_tokens": {"type": "integer", "default": 512}},
        }
    },
}


class _ToolkitModel:
    @classmethod
    def model_json_schema(cls) -> dict:
        return {
            "title": "example",
            "properties": {
                "credential": {
                    "configuration_types": ["github"],
                    "description": "not consumed by Main",
                },
                "embedding": {
                    "configuration_model": "embedding",
                    "default": None,
                },
                "url": {
                    "toolkit_name": True,
                    "max_toolkit_length": "80",
                    "type": "string",
                },
                "token": {"secret": True, "type": "string"},
                "ordinary": {"type": "integer"},
            },
        }


def test_sdk_identity_admits_only_the_exact_locked_patch_paths(
    monkeypatch,
) -> None:
    patch_revision = "b" * 40
    actual_paths = "elitea_sdk/runtime/toolkits/mcp.py"

    def fake_git(_root, *arguments, binary=False):
        assert binary is False
        if arguments[:4] == (
            "diff-tree",
            "--no-commit-id",
            "--name-only",
            "-r",
        ):
            assert arguments[4] == patch_revision
            return "elitea_sdk/runtime/toolkits/mcp.py"
        if arguments[:3] == ("diff", "--name-only", "HEAD"):
            return actual_paths
        raise AssertionError(arguments)

    monkeypatch.setattr(sync, "_git", fake_git)
    _require_locked_patch_paths(Path("/sdk"), [patch_revision])

    actual_paths = "elitea_sdk/runtime/toolkits/tools.py"
    with pytest.raises(ContractSyncError, match="patch lock"):
        _require_locked_patch_paths(Path("/sdk"), [patch_revision])


def test_projection_contains_only_annotations_consumed_by_main() -> None:
    assert project_toolkit_schemas([_ToolkitModel], "a" * 40) == {
        "schema_version": "elitea.current-toolkit-schema-snapshot.v1",
        "sdk_revision": "a" * 40,
        "entries": [
            {
                "type": "example",
                "properties": {
                    "credential": {"configuration_types": ["github"]},
                    "embedding": {"configuration_model": "embedding"},
                    "url": {"toolkit_name": True},
                    "token": {"secret": True},
                },
                "args_schemas": {},
                "naming": {"field": "url", "max_length": 80},
            }
        ],
    }


class _IndexingToolkitModel:
    """A toolkit that publishes per-tool argument schemas, as the SDK does."""

    @classmethod
    def model_json_schema(cls) -> dict:
        return {
            "title": "artifact-like",
            "properties": {
                "bucket": {"type": "string"},
                "selected_tools": {
                    "type": "array",
                    "args_schemas": {
                        "search_index": {
                            "title": "SearchIndex",
                            "type": "object",
                            "properties": {"query": {"type": "string"}},
                            "required": ["query"],
                        },
                        "index_data": INDEX_DATA_ARGS_SCHEMA,
                    },
                },
            },
        }


def test_projection_carries_each_tool_argument_schema_verbatim() -> None:
    entry = project_toolkit_schemas([_IndexingToolkitModel], "c" * 40)["entries"][0]

    # The whole schema has to survive: a form cannot be rendered from a bare
    # {"type": "object"} placeholder, and a stripped ``$defs`` leaves the
    # ``$ref`` in ``chunking_config`` dangling.
    assert entry["args_schemas"]["index_data"] == INDEX_DATA_ARGS_SCHEMA
    assert entry["args_schemas"]["index_data"]["properties"]["collection_suffix"] == {
        "title": "Collection Suffix",
        "type": "string",
        "description": "Suffix for the collection name",
    }
    assert entry["args_schemas"]["index_data"]["$defs"]["ChunkingConfig"]["properties"] == {
        "max_tokens": {"type": "integer", "default": 512}
    }
    # Tool selection is a schema carrier, not a Main-consumed annotation, so it
    # must not leak into the annotation projection.
    assert "selected_tools" not in entry["properties"]


def test_argument_schemas_are_canonically_ordered_and_stable() -> None:
    entry = project_toolkit_schemas([_IndexingToolkitModel], "c" * 40)["entries"][0]

    # Declaration order in the SDK is search_index, then index_data.
    assert list(entry["args_schemas"]) == ["index_data", "search_index"]
    # Two runs over the same registry must encode to identical bytes.
    assert _canonical(project_toolkit_schemas([_IndexingToolkitModel], "c" * 40)) == (
        _canonical(project_toolkit_schemas([_IndexingToolkitModel], "c" * 40))
    )


def _clock_toolkit_model(today: str) -> type:
    """Build a toolkit that reads the clock, as the SDK carrier toolkit does.

    elitea_sdk/tools/carrier/ui_reports_tool.py gives ``current_date`` the
    value of ``datetime.now()`` at import time. The projected default is then
    the date of the projection run.
    """

    class _ClockToolkitModel:
        @classmethod
        def model_json_schema(cls) -> dict:
            return {
                "title": "carrier-like",
                "properties": {
                    "selected_tools": {
                        "type": "array",
                        "args_schemas": {
                            "get_ui_reports": {
                                "title": "GetUIReportsInput",
                                "type": "object",
                                "properties": {
                                    "current_date": {
                                        "type": "string",
                                        "default": today,
                                        "description": "auto-filled",
                                    },
                                    "report_id": {"type": "string"},
                                    "page_size": {"type": "integer", "default": 25},
                                    "since": {"type": "string", "default": "2020-01-01"},
                                    "window": {"$ref": "#/$defs/Window"},
                                },
                                "required": ["report_id"],
                                "$defs": {
                                    "Window": {
                                        "type": "object",
                                        "properties": {
                                            "day": {"type": "string", "default": today}
                                        },
                                    }
                                },
                            }
                        },
                    }
                },
            }

    return _ClockToolkitModel


def test_clock_derived_defaults_leave_the_projection() -> None:
    document = project_toolkit_schemas(
        [_clock_toolkit_model("2026-08-13")],
        "d" * 40,
        frozenset({"2026-08-13"}),
    )
    schema = document["entries"][0]["args_schemas"]["get_ui_reports"]

    # The clock default goes. Every other part of the schema stays.
    assert schema["properties"]["current_date"] == {
        "type": "string",
        "description": "auto-filled",
    }
    assert "default" not in schema["$defs"]["Window"]["properties"]["day"]
    assert schema["properties"]["page_size"]["default"] == 25
    assert schema["properties"]["since"]["default"] == "2020-01-01"
    assert schema["properties"]["window"] == {"$ref": "#/$defs/Window"}
    assert schema["required"] == ["report_id"]


def test_two_different_days_project_identical_documents() -> None:
    # The snapshot needs this property. Without it the committed file becomes
    # stale at the next midnight. The --check gate then fails for every later
    # change to this repository.
    first = _canonical(
        project_toolkit_schemas(
            [_clock_toolkit_model("2026-08-13")],
            "d" * 40,
            frozenset({"2026-08-13"}),
        )
    )
    second = _canonical(
        project_toolkit_schemas(
            [_clock_toolkit_model("2026-08-16")],
            "d" * 40,
            frozenset({"2026-08-16"}),
        )
    )

    assert first == second


def test_a_projection_across_midnight_removes_both_observed_dates() -> None:
    # The generator reads the date before the SDK import and again after the
    # registry call. A run across midnight observes two dates.
    document = project_toolkit_schemas(
        [_clock_toolkit_model("2026-08-17")],
        "d" * 40,
        frozenset({"2026-08-16", "2026-08-17"}),
    )
    schema = document["entries"][0]["args_schemas"]["get_ui_reports"]

    assert "default" not in schema["properties"]["current_date"]


def test_toolkits_without_tool_selection_project_no_argument_schemas() -> None:
    assert _argument_schema_projection({"bucket": {"type": "string"}}) == {}
    assert _argument_schema_projection({"selected_tools": {"type": "array"}}) == {}


@pytest.mark.parametrize(
    ("properties", "message"),
    [
        ({"selected_tools": ["not", "a", "schema"]}, "tool selection property"),
        ({"selected_tools": {"args_schemas": ["index_data"]}}, "tool mapping"),
        ({"selected_tools": {"args_schemas": {"": {}}}}, "invalid tool name"),
        (
            {"selected_tools": {"args_schemas": {"index_data": "object"}}},
            "is not an object",
        ),
        (
            {"selected_tools": {"args_schemas": {"index_data": {"x": float("nan")}}}},
            "canonical JSON",
        ),
    ],
)
def test_malformed_argument_schemas_fail_closed(
    properties: dict, message: str
) -> None:
    # Fail closed: a toolkit whose tool schemas cannot be projected must stop
    # the sync, never silently emit an entry with no argument schemas.
    with pytest.raises(ContractSyncError, match=message):
        _argument_schema_projection(properties)


def test_projection_is_sorted_and_rejects_duplicate_types() -> None:
    class _Second:
        @classmethod
        def model_json_schema(cls) -> dict:
            return {"title": "aaa", "properties": {}}

    document = project_toolkit_schemas([_ToolkitModel, _Second], "b" * 40)
    assert [entry["type"] for entry in document["entries"]] == ["aaa", "example"]

    with pytest.raises(ContractSyncError, match="duplicate"):
        project_toolkit_schemas([_ToolkitModel, _ToolkitModel], "b" * 40)


@pytest.mark.parametrize("value", ["not-an-int", -1, 4097])
def test_invalid_toolkit_name_limits_fail_closed(value: object) -> None:
    with pytest.raises(ContractSyncError, match="toolkit name limit"):
        _annotation_projection(
            {"url": {"toolkit_name": True, "max_toolkit_length": value}}
        )
