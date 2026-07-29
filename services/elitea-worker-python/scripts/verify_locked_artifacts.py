#!/usr/bin/env python3
"""Verify build artifacts against the indexing capability lock."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("lock", type=Path)
    parser.add_argument("artifact_directory", type=Path)
    parser.add_argument(
        "section",
        choices=("verified_wheels", "verified_source_archives"),
    )
    args = parser.parse_args()

    profile = json.loads(args.lock.read_bytes())["indexing_capability_profile"]
    records = profile[args.section]
    if not isinstance(records, dict) or not records:
        raise SystemExit(f"{args.section} is empty")

    machine = platform.machine().lower()
    if machine == "arm64":
        machine = "aarch64"
    for distribution, record in sorted(records.items()):
        alternatives = record.get("artifacts")
        if alternatives is not None:
            if not isinstance(alternatives, list):
                raise SystemExit(f"{distribution}: invalid artifact alternatives")
            matching = [
                candidate
                for candidate in alternatives
                if candidate.get("platform_machine") == machine
            ]
            if len(matching) != 1:
                raise SystemExit(
                    f"{distribution}: no unique artifact for this platform"
                )
            record = matching[0]
        filename = record["filename"]
        expected = record["sha256"]
        artifact = args.artifact_directory / filename
        if not artifact.is_file():
            raise SystemExit(f"{distribution}: locked artifact is missing")
        actual = hashlib.sha256(artifact.read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit(f"{distribution}: locked artifact digest mismatch")

    print(f"verified-{args.section}={len(records)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
