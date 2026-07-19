#!/usr/bin/env python3
"""Focused tests for the dependency-free pylon_auth catalog exporter."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parent))

from export_auth_baseline_catalog import build_catalog  # noqa: E402


class AuthBaselineCatalogTest(unittest.TestCase):
    def test_collects_interfaces_registrations_events_and_migrations(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            plugin = root / "auth_example"
            (plugin / "routes").mkdir(parents=True)
            (plugin / "db" / "migrations").mkdir(parents=True)
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

            first = build_catalog(root)
            second = build_catalog(root)

        self.assertEqual(first, second)
        self.assertEqual(first["summary"]["plugins"], 1)
        self.assertEqual(
            first["summary"]["declarations_by_kind"],
            {"event": 1, "http_route": 1, "method": 1, "rpc": 1},
        )
        self.assertEqual(first["summary"]["dynamic_declarations"], 1)
        self.assertEqual(first["summary"]["runtime_registrations"], 1)
        self.assertEqual(first["summary"]["emitted_events"], 1)
        self.assertEqual(first["summary"]["migrations"], 1)
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


if __name__ == "__main__":
    unittest.main()
