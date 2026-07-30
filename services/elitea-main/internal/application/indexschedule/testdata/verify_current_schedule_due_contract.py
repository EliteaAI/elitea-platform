#!/usr/bin/env python3
"""Verify frozen current index-scheduler due observations with croniter 1.4.1."""

from __future__ import annotations

import importlib.metadata
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

try:
    from croniter import croniter
except ModuleNotFoundError as error:
    print(f"SKIP: croniter is unavailable: {error}", file=sys.stderr)
    raise SystemExit(77) from error

FIXTURE = Path(__file__).with_name("current_python_schedule_due_contract.json")


def parse_last_run(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.tzinfo.utcoffset(parsed) is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def main() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    expected_version = fixture["provenance"]["observed_croniter_version"]
    actual_version = importlib.metadata.version("croniter")
    if actual_version != expected_version:
        raise SystemExit(
            f"croniter version drift: got {actual_version}, expected {expected_version}"
        )

    mismatches: list[dict] = []
    for case in fixture["cases"]:
        if not case["enabled"]:
            due = False
            occurrence = ""
        else:
            location = ZoneInfo(case["timezone"])
            last_run = parse_last_run(case["last_run"]).astimezone(location)
            now = datetime.fromisoformat(case["now"].replace("Z", "+00:00")).astimezone(location)
            next_run = croniter(case["cron"], last_run, ret_type=datetime).get_next()
            due = next_run <= now
            occurrence = (
                next_run.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
                if due
                else ""
            )
        expected_occurrence = case["occurrence"].replace("+00:00", "Z")
        if due != case["due"] or occurrence != expected_occurrence:
            mismatches.append(
                {
                    "name": case["name"],
                    "due": due,
                    "expected_due": case["due"],
                    "occurrence": occurrence,
                    "expected_occurrence": expected_occurrence,
                }
            )
    if mismatches:
        raise SystemExit(json.dumps(mismatches, indent=2))
    print(f"verified {len(fixture['cases'])} due cases with croniter {actual_version}")


if __name__ == "__main__":
    main()
