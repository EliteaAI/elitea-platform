from __future__ import annotations

import pytest

from sync_toolkit_schema_snapshot import (
    ContractSyncError,
    _annotation_projection,
    project_toolkit_schemas,
)


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
                "naming": {"field": "url", "max_length": 80},
            }
        ],
    }


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
