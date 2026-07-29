#!/usr/bin/env python3

from __future__ import annotations

import copy
import json
import unittest

from sync_current_available_sdk import (
    ContractSyncError,
    SDK_CHECK_CONNECTION_FUNC,
    SDK_VALIDATION_FUNC,
    canonical_json,
    load_document,
    synchronize_document,
)


class _WithoutCheck:
    @classmethod
    def model_json_schema(cls):
        return {
            "type": "object",
            "title": "GithubConfiguration",
            "metadata": {
                "type": "github",
                "section": "credentials",
                "label": "GitHub",
            },
        }


class _WithCheck:
    @classmethod
    def model_json_schema(cls):
        return {
            "type": "object",
            "title": "AhaConfiguration",
            "metadata": {
                "type": "aha",
                "section": "credentials",
                "label": "Aha!",
            },
        }

    @staticmethod
    def check_connection(settings):
        return None


def _entry(type_name, *, validation_func=None):
    return {
        "type": type_name,
        "section": "credentials",
        "config_schema": {
            "type": "object",
            "title": type_name,
            "properties": {
                "elitea_title": {"type": "string"},
                "data": {
                    "type": "object",
                    "metadata": {"type": type_name, "section": "credentials"},
                },
            },
            "required": ["elitea_title", "data"],
        },
        "has_test_connection": False,
        "check_connection_label": None,
        "validation_func": validation_func,
        "check_connection_func": None,
    }


def _document():
    github = _entry("github", validation_func=SDK_VALIDATION_FUNC)
    return {
        "schema_version": "elitea.current-configuration-available-snapshot.v1",
        "sources": {"elitea_sdk": "0" * 40},
        "dynamic_sources": {},
        "entries": [_entry("platform_type"), github],
    }


class SynchronizeCurrentAvailableSDKTest(unittest.TestCase):
    def test_preserves_prefix_and_outer_schema_and_appends_registry_order(self):
        source = _document()
        preserved = copy.deepcopy(source["entries"][0])

        result = synchronize_document(
            source,
            {"github": _WithoutCheck, "aha": _WithCheck},
            "1" * 40,
        )

        self.assertEqual(result["entries"][0], preserved)
        self.assertEqual(
            [entry["type"] for entry in result["entries"]],
            ["platform_type", "github", "aha"],
        )
        self.assertEqual(result["sources"]["elitea_sdk"], "1" * 40)
        self.assertEqual(source["sources"]["elitea_sdk"], "0" * 40)
        github, aha = result["entries"][1:]
        self.assertEqual(github["validation_func"], SDK_VALIDATION_FUNC)
        self.assertFalse(github["has_test_connection"])
        github_metadata = github["config_schema"]["properties"]["data"]["metadata"]
        self.assertFalse(github_metadata["check_connection_supported"])
        self.assertTrue(aha["has_test_connection"])
        self.assertEqual(aha["check_connection_func"], SDK_CHECK_CONNECTION_FUNC)
        aha_metadata = aha["config_schema"]["properties"]["data"]["metadata"]
        self.assertTrue(aha_metadata["check_connection_supported"])
        self.assertEqual(
            github["config_schema"]["properties"]["elitea_title"],
            aha["config_schema"]["properties"]["elitea_title"],
        )

    def test_rejects_sdk_collision_with_preserved_prefix(self):
        source = _document()
        source["entries"].insert(0, _entry("aha"))

        with self.assertRaisesRegex(ContractSyncError, "collides"):
            synchronize_document(
                source,
                {"github": _WithoutCheck, "aha": _WithCheck},
                "1" * 40,
            )

    def test_rejects_partial_or_reordered_sdk_suffix(self):
        source = _document()
        source["entries"].append(_entry("not_in_sdk", validation_func=SDK_VALIDATION_FUNC))

        with self.assertRaisesRegex(ContractSyncError, "partial, reordered, or ambiguous"):
            synchronize_document(source, {"github": _WithoutCheck}, "1" * 40)

        with self.assertRaisesRegex(ContractSyncError, "partial, reordered, or ambiguous"):
            synchronize_document(
                _document(),
                {"github": _WithoutCheck, "middle": _WithoutCheck, "aha": _WithCheck},
                "1" * 40,
            )

    def test_loader_rejects_duplicate_keys_and_non_finite_numbers(self):
        with self.assertRaisesRegex(ContractSyncError, "duplicate JSON key"):
            load_document(b'{"entries":[],"entries":[]}')
        with self.assertRaisesRegex(ContractSyncError, "non-finite JSON number"):
            load_document(b'{"value":NaN}')

    def test_canonical_json_is_sorted_compact_and_newline_terminated(self):
        self.assertEqual(canonical_json({"z": 1, "a": "x"}), b'{"a":"x","z":1}\n')
        self.assertEqual(json.loads(canonical_json({"z": 1})), {"z": 1})


if __name__ == "__main__":
    unittest.main()
