#!/usr/bin/env python3
"""Compare pylon_main literal guards with the sanitized live grant snapshot."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


KNOWN_GUARDS_WITHOUT_LIVE_GRANT = frozenset(
    {
        "models.admin.tracing.view",
        "models.monitoring.tracing.collect",
    }
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--static",
        type=Path,
        default=Path("testdata/legacy/legacy-rbac-static-catalog.json"),
    )
    parser.add_argument(
        "--live",
        type=Path,
        default=Path("testdata/postgres/legacy-rbac-matrix.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    static = json.loads(args.static.read_text(encoding="utf-8"))
    live = json.loads(args.live.read_text(encoding="utf-8"))

    declared = set(static["literal_permissions"])
    granted = set(live["global_permission_catalog"])
    for role in live["project_roles"]:
        granted.update(role["permissions"])

    missing = frozenset(declared - granted)
    if missing != KNOWN_GUARDS_WITHOUT_LIVE_GRANT:
        print(
            json.dumps(
                {
                    "error": "pylon_main guard/live-grant drift changed",
                    "expected_missing": sorted(KNOWN_GUARDS_WITHOUT_LIVE_GRANT),
                    "actual_missing": sorted(missing),
                },
                sort_keys=True,
            ),
            file=sys.stderr,
        )
        return 1

    print(
        json.dumps(
            {
                "declared_literal_guards": len(declared),
                "live_granted_permissions": len(granted),
                "known_guards_without_live_grant": sorted(missing),
                "scope": "pylon_main literal decorators versus sanitized live role grants",
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
