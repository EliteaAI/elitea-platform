#!/usr/bin/env python3
"""Focused dependency-free tests for pylon_main Auth HTTP evidence."""

from __future__ import annotations

import ast
import json
import subprocess
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

import export_main_auth_http_baseline as exporter  # noqa: E402
from check_main_auth_http_baseline import check_catalog  # noqa: E402


CATALOG = Path(__file__).resolve().parents[2] / "testdata/baseline/main-auth-http-contracts.json"


class MainAuthHTTPBaselineTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = json.loads(CATALOG.read_text(encoding="utf-8"))

    def test_checked_fixture_is_internally_valid(self) -> None:
        self.assertEqual(check_catalog(self.catalog), [])

    def test_checker_rejects_security_and_scope_overclaims(self) -> None:
        changed = deepcopy(self.catalog)
        changed["scope"]["full_auth_parity_claim"] = True
        item_get = next(
            item for item in changed["behavior_contracts"] if item["id"] == "pat.item.get"
        )
        item_get["auth"]["owner_check"] = True
        collection_post = next(
            item for item in changed["behavior_contracts"] if item["id"] == "pat.collection.post"
        )
        collection_post["request"]["name_presence_semantics"]["null"] = (
            "missing and null are equivalent"
        )
        failures = check_catalog(changed)
        self.assertIn("fixture must not claim full Auth parity", failures)
        self.assertIn("PAT item GET behavior changed", failures)
        self.assertIn("pat.collection.post null-name behavior changed", failures)

    def test_checker_rejects_reported_status_timeout_and_deletion_mutations(self) -> None:
        changed = deepcopy(self.catalog)
        collection_delete = next(
            item for item in changed["behavior_contracts"]
            if item["id"] == "pat.collection.delete"
        )
        collection_delete["outcomes"][0]["status"] = 418
        collection_delete["outcomes"][0]["body"] = "mutated"
        failures = check_catalog(changed)
        self.assertIn("PAT collection DELETE status/error changed", failures)
        self.assertIn("behavior_contracts reviewed snapshot changed", failures)

        changed = deepcopy(self.catalog)
        changed["global_auth_rpc_gate"]["authorization_request"]["timeout_seconds"] = 14
        failures = check_catalog(changed)
        self.assertIn("Auth RPC timeout changed", failures)
        self.assertIn("global_auth_rpc_gate reviewed snapshot changed", failures)

        changed = deepcopy(self.catalog)
        item_delete = next(
            item for item in changed["behavior_contracts"] if item["id"] == "pat.item.delete"
        )
        item_delete["outcomes"][-1]["status"] = 200
        item_delete["side_effects"] = []
        failures = check_catalog(changed)
        self.assertIn("PAT item DELETE outcomes changed", failures)
        self.assertIn("PAT item DELETE side effects changed", failures)

        changed = deepcopy(self.catalog)
        del changed["method_route_matrix"]["/api/v2/auth/token/"]["DELETE"]
        self.assertIn("method-route matrix changed", check_catalog(changed))

    def test_checker_pins_matrix_fingerprints_sources_provenance_and_limits(self) -> None:
        mutations = []

        changed = deepcopy(self.catalog)
        changed["method_route_matrix"]["/api/v2/auth/token/<string:uid>"]["POST"] = (
            "pat.collection.post"
        )
        mutations.append((changed, "method-route matrix changed"))

        changed = deepcopy(self.catalog)
        key = "shared/tools/api_tools.py#APIBase.proxy_method"
        changed["behavior_fingerprints"][key]["ast_sha256"] = "0" * 64
        mutations.append((changed, "behavior_fingerprints reviewed snapshot changed"))

        changed = deepcopy(self.catalog)
        changed["source_files_sha256"]["auth/api/v2/token.py"] = "0" * 64
        mutations.append((changed, "reviewed source hashes changed"))

        changed = deepcopy(self.catalog)
        changed["provenance"]["auth_repo"]["pinned_head"] = "0" * 40
        mutations.append((changed, "auth_repo pinned provenance changed"))

        changed = deepcopy(self.catalog)
        changed["inference_limits"].pop()
        mutations.append((changed, "bounded inference limits changed"))

        for catalog, expected_failure in mutations:
            with self.subTest(expected_failure=expected_failure):
                self.assertIn(expected_failure, check_catalog(catalog))

    def test_checker_rejects_public_rule_ownership_order_and_rule_mutations(self) -> None:
        mutations = []

        changed = deepcopy(self.catalog)
        configured = changed["public_rule_inventory"]["main_local_plane"][
            "configured_rules_ordered"
        ]
        configured[0], configured[1] = configured[1], configured[0]
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        changed = deepcopy(self.catalog)
        sites = changed["public_rule_inventory"]["main_local_plane"][
            "dynamic_registration_sites"
        ]
        sites["runtime_interface_litellm.Method.init"]["rules_in_source_order"][0][
            "uri"
        ] = "/llm/v1/.*"
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        changed = deepcopy(self.catalog)
        changed["public_rule_inventory"]["messages_rule_configuration"][
            "base_plugin_value"
        ] = False
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        changed = deepcopy(self.catalog)
        changed["public_rule_inventory"]["auth_core_direct_plane"][
            "initial_rules"
        ] = [{"uri": "/unexpected"}]
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        changed = deepcopy(self.catalog)
        changed["public_rule_inventory"]["main_local_plane"]["ordering"][
            "cross_plugin"
        ] = "globally ordered by the fixture"
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        changed = deepcopy(self.catalog)
        changed["public_rule_inventory"]["main_local_plane"][
            "deployment_selection"
        ]["required_dynamic_plugins_enabled"].remove("artifacts")
        mutations.append((changed, "Main/Auth Core public-rule inventory changed"))

        for catalog, expected_failure in mutations:
            with self.subTest(expected_failure=expected_failure):
                failures = check_catalog(catalog)
                self.assertIn(expected_failure, failures)
                self.assertIn("public_rule_inventory reviewed snapshot changed", failures)

    def test_checker_pins_each_dynamic_public_rule_source_and_repository(self) -> None:
        mutations = []
        for source in (
            "admin_ui/module.py",
            "artifacts/methods/s3.py",
            "elitea_core/module.py",
            "runtime_interface_litellm/methods/init.py",
        ):
            changed = deepcopy(self.catalog)
            changed["source_files_sha256"][source] = "0" * 64
            mutations.append((changed, "reviewed source hashes changed"))

        for fingerprint in (
            "admin_ui/module.py#Module.init",
            "artifacts/methods/s3.py#Method.s3_api_init",
            "elitea_core/module.py#Module.elitea_ui_init",
            "runtime_interface_litellm/methods/init.py#Method.init",
            "auth_core/methods/public_rules.py#Method.public_rules_init",
        ):
            changed = deepcopy(self.catalog)
            changed["behavior_fingerprints"][fingerprint]["ast_sha256"] = "0" * 64
            mutations.append(
                (changed, "behavior_fingerprints reviewed snapshot changed")
            )

        for repository in (
            "admin_ui_repo",
            "artifacts_repo",
            "elitea_core_repo",
            "runtime_interface_litellm_repo",
        ):
            changed = deepcopy(self.catalog)
            changed["provenance"][repository]["pinned_head"] = "0" * 40
            mutations.append((changed, f"{repository} pinned provenance changed"))

        for catalog, expected_failure in mutations:
            with self.subTest(expected_failure=expected_failure):
                self.assertIn(expected_failure, check_catalog(catalog))

    def test_public_rule_parser_preserves_config_order_and_roots_are_siblings(self) -> None:
        rules = exporter._literal_public_rules(
            """auth_mode: rpc
public_rules:
  - uri: '/first/.*'
  - uri: '/second/.*'
"""
        )
        self.assertEqual(rules, [
            {"uri": "/first/.*"},
            {"uri": "/second/.*"},
        ])
        self.assertEqual(
            exporter._literal_yaml_sequence(
                """preordered_plugins:
- auth
- artifacts
""",
                "preordered_plugins",
            ),
            ["auth", "artifacts"],
        )

        auth_root = Path("/workspace/plugins/auth")
        roots = exporter._public_rule_plugin_roots(auth_root)
        self.assertEqual(
            roots,
            {
                "admin_ui": Path("/workspace/plugins/admin_ui"),
                "artifacts": Path("/workspace/plugins/artifacts"),
                "elitea_core": Path("/workspace/plugins/elitea_core"),
                "runtime_interface_litellm": Path(
                    "/workspace/plugins/runtime_interface_litellm"
                ),
            },
        )

    def test_route_variants_preserve_pylon_trailing_slash_registration(self) -> None:
        registered = exporter._route_variants("token", ["", "<string:uid>"])
        self.assertEqual(registered, [
            "/api/v2/auth/token/",
            "/api/v2/auth/token//",
            "/api/v2/auth/token/<string:uid>",
            "/api/v2/auth/token/<string:uid>/",
        ])
        self.assertEqual(exporter._direct_dispatch_routes(registered), [
            "/api/v2/auth/token/",
            "/api/v2/auth/token/<string:uid>",
            "/api/v2/auth/token/<string:uid>/",
        ])

    def test_method_route_matrix_includes_inherited_and_framework_methods(self) -> None:
        matrix = self.catalog["method_route_matrix"]
        collection = matrix["/api/v2/auth/token/"]
        item = matrix["/api/v2/auth/token/<string:uid>"]
        self.assertEqual(collection["DELETE"], "pat.collection.delete")
        self.assertEqual(collection["PATCH"], "inherited.empty_mode_handlers.404")
        self.assertEqual(item["POST"], "pat.item.post")
        self.assertEqual(item["HEAD"], "framework.head_via_get")
        self.assertEqual(item["OPTIONS"], "framework.options.cors")
        self.assertEqual(
            self.catalog["resources"]["token"]["exposed_http_methods"],
            ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"],
        )

    def test_ast_fingerprint_ignores_comments_but_detects_logic_changes(self) -> None:
        original = ast.parse("class API:\n    def get(self):\n        # comment\n        return 1\n")
        reformatted = ast.parse("class API:\n    def get(self):\n        return 1  # another comment\n")
        changed = ast.parse("class API:\n    def get(self):\n        return 2\n")
        first = exporter._method_fingerprint(exporter._method(original, "API", "get"))["ast_sha256"]
        second = exporter._method_fingerprint(exporter._method(reformatted, "API", "get"))["ast_sha256"]
        third = exporter._method_fingerprint(exporter._method(changed, "API", "get"))["ast_sha256"]
        self.assertEqual(first, second)
        self.assertNotEqual(first, third)

    def test_fixture_records_current_security_relevant_branches(self) -> None:
        contracts = {item["id"]: item for item in self.catalog["behavior_contracts"]}
        self.assertFalse(contracts["pat.item.get"]["auth"]["owner_check"])
        self.assertEqual(
            contracts["pat.item.delete"]["auth"]["owner_check"],
            "token.user_id must equal current_user.id",
        )
        self.assertIn(
            "request processing continues",
            self.catalog["global_auth_rpc_gate"]["dependency_exception"]["effect"],
        )
        self.assertIn(
            "every token",
            contracts["pat.collection.get"]["auth"]["dependency_exception_consequence"],
        )
        self.assertIn(
            "ownerless token",
            contracts["pat.item.post"]["auth"]["dependency_exception_consequence"],
        )
        self.assertFalse(self.catalog["scope"]["full_auth_parity_claim"])

    def test_pat_post_preserves_missing_null_and_type_mismatch_distinctions(self) -> None:
        contracts = {item["id"]: item for item in self.catalog["behavior_contracts"]}
        semantics = contracts["pat.collection.post"]["request"]["name_presence_semantics"]
        self.assertIn("400 Name is required", semantics["missing"])
        self.assertIn("200 with name=null", semantics["null"])
        self.assertIn("no type validation", semantics["type_mismatch"])
        self.assertIn("generic server-error handling", semantics["type_mismatch"])
        item = contracts["pat.item.post"]
        self.assertIn("ignored", item["request"]["path_parameters"]["uid"])
        self.assertIn(
            "falsy value bypasses parsing",
            item["request"]["json"]["expires"],
        )
        self.assertEqual(
            [outcome["status"] for outcome in item["outcomes"]],
            [415, 400, 500, 400, 400, 400, 400, 400, 500, 500, 500, 200, 200],
        )
        self.assertIn("AUTOCOMMIT can leave the new token durable", str(item))

    def test_current_user_and_options_failure_semantics_are_explicit(self) -> None:
        contracts = {item["id"]: item for item in self.catalog["behavior_contracts"]}
        self.assertEqual(
            [outcome["status"] for outcome in contracts["current_user.get"]["outcomes"]],
            [200, 200, 500],
        )
        options = contracts["framework.options.cors"]
        self.assertEqual(options["outcomes"][0]["status"], 200)
        self.assertEqual(options["outcomes"][0]["body"], "empty")
        self.assertIn("denial", options["auth"]["denial_masking"])
        self.assertEqual(
            self.catalog["composition_evidence"]["auth_init_after"],
            ["shared", "auth_core"],
        )

    def test_project_zero_fallback_is_pinned_and_mutation_is_rejected(self) -> None:
        permissions = next(
            item
            for item in self.catalog["behavior_contracts"]
            if item["id"] == "rbac.permissions.get"
        )
        project_id = permissions["request"]["path_parameters"]["project_id"]
        self.assertIn("accepts 0", project_id)
        self.assertIn("treats 0 as absent", project_id)
        self.assertIn("project_id=0 invokes project_get_id()", str(permissions["side_effects"]))

        changed = deepcopy(self.catalog)
        changed_permissions = next(
            item
            for item in changed["behavior_contracts"]
            if item["id"] == "rbac.permissions.get"
        )
        changed_permissions["request"]["path_parameters"]["project_id"] = (
            "all Flask integer values are passed unchanged and remain effective unchanged"
        )
        self.assertIn("RBAC project_id=0 fallback changed", check_catalog(changed))

    def test_double_slash_redirects_are_not_reported_as_handler_dispatch(self) -> None:
        matrix = self.catalog["method_route_matrix"]
        self.assertNotIn("/api/v2/auth/token//", matrix)
        self.assertNotIn("/api/v2/auth/user//", matrix)
        self.assertIn(
            "/api/v2/auth/token//",
            self.catalog["resources"]["token"]["registered_routes"],
        )
        canonical = self.catalog["canonicalization_matrix"]["/api/v2/auth/token//"]
        self.assertEqual(canonical["canonical_location_path"], "/api/v2/auth/token/")
        self.assertEqual(canonical["methods"]["POST"]["status"], 308)
        self.assertEqual(canonical["methods"]["OPTIONS"]["status"], 200)
        self.assertTrue(
            canonical["methods"]["OPTIONS"][
                "redirect_response_replaced_by_auth_after_request"
            ]
        )

        changed = deepcopy(self.catalog)
        changed["canonicalization_matrix"]["/api/v2/auth/token//"]["methods"][
            "POST"
        ]["status"] = 307
        self.assertIn(
            "double-slash canonicalization matrix changed",
            check_catalog(changed),
        )

    def test_provenance_ignores_unrelated_dirty_paths_but_gates_contract_sources(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(
                ["git", "-C", str(repo), "config", "user.email", "test@example.invalid"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(repo), "config", "user.name", "Contract Test"],
                check=True,
            )
            contract = repo / "contract.py"
            unrelated = repo / "notes.txt"
            contract.write_text("VALUE = 1\n", encoding="utf-8")
            unrelated.write_text("clean\n", encoding="utf-8")
            subprocess.run(
                ["git", "-C", str(repo), "add", "contract.py", "notes.txt"],
                check=True,
            )
            subprocess.run(
                ["git", "-C", str(repo), "commit", "-q", "-m", "fixture"],
                check=True,
            )

            clean = exporter.git_provenance(repo, {"contract.py"})
            unrelated.write_text("dirty but out of scope\n", encoding="utf-8")
            self.assertEqual(exporter.git_provenance(repo, {"contract.py"}), clean)
            self.assertNotIn("observed_repository_dirty_paths", clean)

            contract.write_text("VALUE = 2\n", encoding="utf-8")
            dirty_contract = exporter.git_provenance(repo, {"contract.py"})
            self.assertFalse(
                dirty_contract["contract_sources_reconstructable_from_pinned_head"]
            )
            self.assertEqual(dirty_contract["contract_source_dirty_paths"], ["contract.py"])

    def test_persistence_exception_and_user_mapping_evidence_is_pinned(self) -> None:
        persistence = self.catalog["auth_core_persistence"]
        self.assertEqual(persistence["effective_tracked_isolation_level"], "AUTOCOMMIT")
        self.assertIsNone(persistence["tracked_runtime_override_isolation_level"])
        self.assertIn("pool_pre_ping", persistence["tracked_runtime_override_db_option_keys"])
        self.assertIn("runtime config-provider payload can override", persistence["verification_limit"])
        self.assertEqual(
            self.catalog["token_encoding"]["dependency_from_auth_core_requirements"],
            "PyJWT==2.7.0",
        )
        self.assertFalse(self.catalog["token_encoding"]["byte_level_output_pinned"])
        self.assertIn(
            "wrapped as RuntimeError",
            self.catalog["rpc_exception_translation"]["behavior"]["other_base_exception"],
        )
        self.assertIn(
            "converts every mapping key to str",
            self.catalog["authoritative_user_resolution"]["mapping"],
        )


if __name__ == "__main__":
    unittest.main()
