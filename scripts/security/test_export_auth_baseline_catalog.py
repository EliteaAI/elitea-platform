#!/usr/bin/env python3
"""Focused tests for the dependency-free pylon_auth catalog exporter."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from copy import deepcopy
from pathlib import Path
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).resolve().parent))

import export_auth_baseline_catalog as catalog_export  # noqa: E402
from check_auth_baseline_catalog import check_catalog  # noqa: E402


build_catalog = catalog_export.build_catalog


class AuthBaselineCatalogTest(unittest.TestCase):
    def test_collects_interfaces_registrations_events_and_migrations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            auth_root = Path(directory) / "pylon_auth"
            root = auth_root / "plugins"
            plugin = root / "auth_example"
            (plugin / "routes").mkdir(parents=True)
            (plugin / "db" / "migrations").mkdir(parents=True)
            (plugin / "migrations").mkdir(parents=True)
            (plugin / "metadata.json").write_text(
                json.dumps({"name": "Example", "version": "1.2", "ignored": "value"}),
                encoding="utf-8",
            )
            (plugin / "config.yml").write_text("enabled: true\n", encoding="utf-8")
            (plugin / "routes" / "auth.py").write_text(
                """
class Route:
    @web.route('/auth')
    def auth(self, user_id: int, enabled=True, marker=...):
        pass

    @web.rpc('auth_get_user', 'get_user')
    def get_user(self, user_id):
        pass

    @web.method()
    def helper(self):
        pass

    @web.event(EVENT_NAME)
    def changed(self, payload):
        pass
""",
                encoding="utf-8",
            )
            (plugin / "module.py").write_text(
                """
def init(auth_core, context):
    auth_core.register_auth_provider('example', login_path='/login')
    context.event_manager.fire_event('auth_ready', {'ok': True})
""",
                encoding="utf-8",
            )
            (plugin / "db" / "migrations" / "001.py").write_text(
                "revision = '001'\ndown_revision = None\n",
                encoding="utf-8",
            )
            (plugin / "migrations" / "002_audit.sql").write_text(
                "ALTER TABLE audit ADD COLUMN entity TEXT;\n",
                encoding="utf-8",
            )

            first = build_catalog(root, auth_root)
            second = build_catalog(root, auth_root)

        self.assertEqual(first, second)
        self.assertEqual(first["summary"]["plugins"], 1)
        self.assertEqual(
            first["summary"]["declarations_by_kind"],
            {"event": 1, "http_route": 1, "method": 1, "rpc": 1},
        )
        self.assertEqual(first["summary"]["dynamic_declarations"], 1)
        self.assertEqual(first["summary"]["runtime_registrations"], 1)
        self.assertEqual(first["summary"]["emitted_events"], 1)
        self.assertEqual(first["summary"]["migrations"], 2)
        self.assertEqual(
            first["summary"]["migrations_by_format"],
            {"python_alembic": 1, "sql": 1},
        )
        self.assertEqual(first["plugin_metadata"]["auth_example"], {
            "name": "Example",
            "version": "1.2",
        })

        route = next(item for item in first["declarations"] if item["kind"] == "http_route")
        self.assertEqual(route["paths"], ["/auth"])
        self.assertEqual(route["http_methods"], ["GET"])
        rpc = next(item for item in first["declarations"] if item["kind"] == "rpc")
        self.assertEqual(rpc["exported_names"], ["auth_get_user", "get_user"])
        method = next(item for item in first["declarations"] if item["kind"] == "method")
        self.assertEqual(method["exported_names"], ["helper"])

    def test_collects_convention_api_permissions_and_safe_configuration_reads(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            auth_root = Path(directory) / "pylon_auth"
            plugin = auth_root / "plugins" / "tracing"
            (plugin / "api" / "v2").mkdir(parents=True)
            (plugin / "metadata.json").write_text(
                json.dumps({"name": "Tracing", "version": "1.0"}),
                encoding="utf-8",
            )
            (plugin / "api" / "v2" / "status.py").write_text(
                """
class AdminAPI(api_tools.APIModeHandler):
    @auth.decorators.check_api({
        "permissions": ["tracing.view"],
        "recommended_roles": {c.ADMINISTRATION_MODE: {"admin": True}},
    })
    def get(self, **kwargs):
        pass

class API(api_tools.APIBase):
    url_params = api_tools.with_modes(['', '<int:project_id>'])
    mode_handlers = {'administration': AdminAPI}
""",
                encoding="utf-8",
            )
            (plugin / "module.py").write_text(
                """
import os

def init(self, auth):
    auth.register_permissions({"permissions": ["audit.view"]})
    timeout = self.descriptor.config.get("timeout", 15 * 60)
    section = self.descriptor.config.get("section", {})
    enabled = section.get("enabled", True)
    required = self.descriptor.config["required"]
    if "feature" in self.descriptor.config:
        pass
    secret = self.descriptor.config.get("client_secret", "TEST_ONLY_SECRET_CANARY")
    env_enabled = os.environ.get("TRACING_ENABLED", "")
""",
                encoding="utf-8",
            )

            catalog = build_catalog(auth_root / "plugins", auth_root)

        self.assertEqual(catalog["summary"]["http_handler_methods"], 1)
        self.assertEqual(catalog["summary"]["permission_guards"], 1)
        self.assertEqual(catalog["summary"]["permission_registrations"], 1)
        self.assertEqual(catalog["literal_permissions"], ["audit.view", "tracing.view"])

        handler = catalog["http_handlers"][0]
        self.assertEqual(handler["method"], "GET")
        self.assertEqual(handler["api_version"], "v2")
        self.assertEqual(handler["resource"], "status")
        self.assertEqual(handler["mode_keys"], ["administration"])
        self.assertFalse(handler["path_literal"])
        self.assertIn("full runtime path", catalog["inference_limits"]["convention_http_paths"])

        reads = catalog["configuration_reads"]
        key_paths = [
            [part.get("value") for part in read["key_path"]]
            for read in reads
        ]
        self.assertIn(["timeout"], key_paths)
        self.assertIn(["section", "enabled"], key_paths)
        self.assertIn(["required"], key_paths)
        self.assertIn(["feature"], key_paths)
        self.assertIn(["TRACING_ENABLED"], key_paths)

        timeout = next(
            read for read in reads
            if [part.get("value") for part in read["key_path"]] == ["timeout"]
        )
        self.assertEqual(timeout["default"]["expression"], "15 * 60")
        nested = next(
            read for read in reads
            if [part.get("value") for part in read["key_path"]] == ["section", "enabled"]
        )
        self.assertTrue(nested["inferred_alias"])
        sensitive = next(
            read for read in reads
            if [part.get("value") for part in read["key_path"]] == ["client_secret"]
        )
        self.assertTrue(sensitive["default"]["redacted"])
        self.assertNotIn("TEST_ONLY_SECRET_CANARY", json.dumps(catalog, sort_keys=True))

    def test_hashes_tracked_plugin_and_bounded_runtime_evidence_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            auth_root = Path(directory) / "pylon_auth"
            plugin = auth_root / "plugins" / "auth_example"
            (plugin / "templates").mkdir(parents=True)
            (plugin / "static").mkdir()
            (auth_root / "configs").mkdir(parents=True)
            (auth_root / "requirements" / "installed_package").mkdir(parents=True)

            tracked_files = {
                "metadata.json": json.dumps({"name": "Example", "version": "1"}),
                "admin_schema.json": "{}",
                "README.md": "tracked docs",
                "requirements.txt": "package==1\n",
                "templates/login.html": "<form></form>",
                "static/login.js": "console.log('tracked')",
            }
            for relative, content in tracked_files.items():
                path = plugin / relative
                path.write_text(content, encoding="utf-8")
            (plugin / "untracked.txt").write_text("must not be catalogued", encoding="utf-8")

            (auth_root / "pylon.yml").write_text(
                "secret: TEST_ONLY_RUNTIME_CANARY\n",
                encoding="utf-8",
            )
            (auth_root / "configs" / "auth.yml").write_text("enabled: true\n", encoding="utf-8")
            (auth_root / "requirements" / "auth_example.json").write_text(
                '{"cache_hash":"public-hash"}', encoding="utf-8"
            )
            (auth_root / "requirements" / "installed_package" / "module.py").write_text(
                "generated = True\n", encoding="utf-8"
            )
            (auth_root / "pylon.db").write_bytes(b"sqlite")

            def tracked(root: Path) -> list[str] | None:
                if root == plugin.resolve():
                    return sorted(tracked_files)
                if root == auth_root.resolve():
                    return ["configs/auth.yml", "pylon.yml"]
                return None

            with patch.object(catalog_export, "_git_tracked_files", side_effect=tracked):
                catalog = build_catalog(auth_root / "plugins", auth_root)

        self.assertEqual(
            set(catalog["plugin_evidence_files_sha256"]),
            {f"auth_example/{path}" for path in tracked_files},
        )
        runtime_paths = {
            item["path"]: item for item in catalog["runtime_evidence_files"]
        }
        self.assertEqual(
            set(runtime_paths),
            {"configs/auth.yml", "pylon.yml"},
        )
        self.assertTrue(runtime_paths["pylon.yml"]["tracked"])
        encoded = json.dumps(catalog, sort_keys=True)
        self.assertNotIn("pylon.db", encoded)
        self.assertNotIn("installed_package", encoded)
        self.assertNotIn("requirements/auth_example.json", encoded)
        self.assertNotIn("TEST_ONLY_RUNTIME_CANARY", encoded)


class AuthBaselineCatalogCheckerTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        catalog_path = (
            Path(__file__).resolve().parents[2]
            / "testdata"
            / "baseline"
            / "auth-static-catalog.json"
        )
        cls.catalog = json.loads(catalog_path.read_text(encoding="utf-8"))

    def test_accepts_reviewed_catalog(self) -> None:
        self.assertEqual(check_catalog(self.catalog), {})

    def test_rejects_deleted_evidence_collection(self) -> None:
        catalog = deepcopy(self.catalog)
        del catalog["configuration_reads"]

        failures = check_catalog(catalog)

        self.assertIn("configuration_reads_shape", failures)
        self.assertIn("summary_reconciliation", failures)

    def test_rejects_tampered_evidence_hash(self) -> None:
        catalog = deepcopy(self.catalog)
        source = next(iter(catalog["plugin_evidence_files_sha256"]))
        catalog["plugin_evidence_files_sha256"][source] = "not-a-sha256"

        failures = check_catalog(catalog)

        self.assertIn("plugin_evidence_hashes", failures)

    def test_rejects_tampered_git_provenance(self) -> None:
        catalog = deepcopy(self.catalog)
        catalog["plugin_git_provenance"]["auth_core"]["head"] = "unknown"
        catalog["runtime_git_provenance"]["tracked_dirty_paths"] = ["../pylon.yml"]

        failures = check_catalog(catalog)

        self.assertIn("plugin_git_provenance.auth_core", failures)
        self.assertIn("runtime_git_provenance", failures)


if __name__ == "__main__":
    unittest.main()
