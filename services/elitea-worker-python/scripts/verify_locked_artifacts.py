#!/usr/bin/env python3
"""Verify build artifacts against the indexing capability lock."""

from __future__ import annotations

import argparse
import hashlib
import json
import platform
import re
from pathlib import Path


def _normalize_distribution(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def _verified_requirement_names(profile: dict) -> set[str]:
    requirements = profile.get("artifact_verified_requirements")
    if not isinstance(requirements, list) or not requirements:
        raise SystemExit("artifact_verified_requirements is empty")

    names: set[str] = set()
    for requirement in requirements:
        if (
            not isinstance(requirement, str)
            or requirement.count("==") != 1
        ):
            raise SystemExit(
                "artifact_verified_requirements must use exact == pins"
            )
        distribution, version = requirement.split("==", 1)
        if not distribution or not version:
            raise SystemExit(
                "artifact_verified_requirements contains an invalid pin"
            )
        name = _normalize_distribution(distribution)
        if name in names:
            raise SystemExit(
                "artifact_verified_requirements contains a duplicate"
            )
        names.add(name)
    return names


def _validate_artifact_closure(profile: dict) -> None:
    wheels = profile.get("verified_wheels")
    sources = profile.get("verified_source_archives")
    if not isinstance(wheels, dict) or not wheels:
        raise SystemExit("verified_wheels is empty")
    if not isinstance(sources, dict) or not sources:
        raise SystemExit("verified_source_archives is empty")

    wheel_names = {_normalize_distribution(name) for name in wheels}
    source_names = {_normalize_distribution(name) for name in sources}
    overlap = wheel_names & source_names
    if overlap:
        raise SystemExit(
            "an artifact-verified requirement has both wheel and source records"
        )
    if wheel_names | source_names != _verified_requirement_names(profile):
        raise SystemExit(
            "artifact records do not match artifact_verified_requirements"
        )


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
    _validate_artifact_closure(profile)
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
