#!/usr/bin/env python3
"""Fail closed when the reviewed pylon_auth static baseline changes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


EXPECTED_PLUGINS = frozenset(
    {
        "auth_core",
        "auth_form",
        "auth_idp_rpc",
        "auth_init",
        "auth_mappers",
        "auth_oidc",
        "auth_saml",
        "bootstrap",
        "tracing",
    }
)
EXPECTED_DECLARATIONS = {
    "event": 1,
    "http_route": 15,
    "method": 40,
    "rpc": 101,
}
EXPECTED_AUTH_CORE_RPCS = 95


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--catalog",
        type=Path,
        default=Path("testdata/baseline/auth-static-catalog.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    catalog = json.loads(args.catalog.read_text(encoding="utf-8"))
    failures: dict[str, object] = {}

    plugins = frozenset(catalog.get("plugin_metadata", {}))
    if plugins != EXPECTED_PLUGINS:
        failures["plugins"] = {
            "actual": sorted(plugins),
            "expected": sorted(EXPECTED_PLUGINS),
        }

    summary = catalog.get("summary", {})
    declarations = summary.get("declarations_by_kind", {})
    if declarations != EXPECTED_DECLARATIONS:
        failures["declarations_by_kind"] = {
            "actual": declarations,
            "expected": EXPECTED_DECLARATIONS,
        }
    if summary.get("parse_errors") != 0:
        failures["parse_errors"] = summary.get("parse_errors")

    auth_core_rpcs = catalog.get("plugin_summaries", {}).get("auth_core", {}).get(
        "rpc_declarations"
    )
    if auth_core_rpcs != EXPECTED_AUTH_CORE_RPCS:
        failures["auth_core_rpc_declarations"] = {
            "actual": auth_core_rpcs,
            "expected": EXPECTED_AUTH_CORE_RPCS,
        }

    if failures:
        print(
            json.dumps(
                {"error": "reviewed pylon_auth static baseline changed", **failures},
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    print(
        json.dumps(
            {
                "auth_core_rpc_declarations": auth_core_rpcs,
                "declarations_by_kind": declarations,
                "plugins": sorted(plugins),
                "scope": "reviewed pylon_auth static source baseline",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
