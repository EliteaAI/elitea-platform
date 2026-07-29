from __future__ import annotations

import ast

import pytest

from sync_index_types_snapshot import (
    ContractSyncError,
    _assignments,
    _code_mime_types,
    _loader_mime_types,
)


def test_current_producer_projection_uses_complete_named_sources() -> None:
    assignments = _assignments(
        b"""
document_loaders_map = {
    '.txt': {'class': object, 'mime_type': 'text/plain'},
    '.xlsx': {
        'class': object,
        'mime_type': ('application/vnd.openxmlformats-officedocument.'
                      'spreadsheetml.sheet'),
    },
}
image_loaders_map = {'.png': {'mime_type': 'image/png'}}
image_loaders_map_converted = {'.svg': {'mime_type': 'image/svg+xml'}}
code_extensions = ['.py', '.go']
code_loaders_map = {ext: {'mime_type': 'text/plain'} for ext in code_extensions}
"""
    )

    assert _loader_mime_types(assignments, "document_loaders_map") == {
        ".txt": "text/plain",
        ".xlsx": (
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        ),
    }
    assert _loader_mime_types(assignments, "image_loaders_map") == {
        ".png": "image/png"
    }
    assert _code_mime_types(assignments) == {
        ".go": "text/plain",
        ".py": "text/plain",
    }
    # The current indexer_worker producer does not project the converted map.
    assert ".svg" not in _loader_mime_types(assignments, "image_loaders_map")


@pytest.mark.parametrize(
    ("source", "operation", "message"),
    [
        (
            b"document_loaders_map = make_mapping()",
            lambda assignments: _loader_mime_types(
                assignments, "document_loaders_map"
            ),
            "literal mapping",
        ),
        (
            b"document_loaders_map = {'.txt': {'class': object}}",
            lambda assignments: _loader_mime_types(
                assignments, "document_loaders_map"
            ),
            "omits mime_type",
        ),
        (
            b"code_extensions = ['.py', '.py']",
            _code_mime_types,
            "repeats code extension",
        ),
    ],
)
def test_partial_or_dynamic_sdk_sources_fail_closed(
    source: bytes,
    operation,
    message: str,
) -> None:
    assignments = _assignments(source)
    with pytest.raises(ContractSyncError, match=message):
        operation(assignments)


def test_duplicate_top_level_assignment_is_rejected() -> None:
    with pytest.raises(ContractSyncError, match="duplicate SDK assignment"):
        _assignments(b"code_extensions = ['.py']\ncode_extensions = ['.go']\n")


def test_assignment_parser_does_not_execute_sdk_source() -> None:
    assignments = _assignments(
        b"danger = __import__('pathlib').Path('/tmp/should-not-exist').touch()\n"
    )
    assert isinstance(assignments["danger"], ast.Call)
