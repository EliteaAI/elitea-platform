#!/usr/bin/env python3
"""Exercise the current Python Form exporter through the target Go validator."""

from __future__ import annotations

import argparse
import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
from pathlib import Path
from types import ModuleType
from typing import Any


EXPECTED_INVALID = "Form configuration validation failed\n"


def _load_exporter(auth_form_root: Path) -> ModuleType:
    source = auth_form_root / "form_export.py"
    spec = importlib.util.spec_from_file_location("elitea_form_export_bridge", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Form exporter is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(command: list[str], *, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=cwd,
        check=False,
        capture_output=True,
        text=True,
    )


def _require_result(
    result: subprocess.CompletedProcess[str],
    *,
    code: int,
    stdout: str,
    stderr: str,
) -> None:
    if result.returncode != code or result.stdout != stdout or result.stderr != stderr:
        raise RuntimeError("Form snapshot bridge process contract changed")


def check_bridge(repo_root: Path, auth_form_root: Path) -> None:
    exporter = _load_exporter(auth_form_root)
    temporary_parent = Path("/private/tmp") if Path("/private/tmp").is_dir() else None
    with tempfile.TemporaryDirectory(dir=temporary_parent) as temporary:
        root = Path(temporary).resolve()
        os.chmod(root, 0o700)
        validator = root / "elitea-auth-validate"
        build = _run(
            [
                "go",
                "build",
                "-trimpath",
                "-o",
                str(validator),
                "./services/elitea-main/cmd/elitea-auth-validate",
            ],
            cwd=repo_root,
        )
        if build.returncode != 0:
            raise RuntimeError("target Form validator build failed")

        snapshot = root / "form-users.json"
        environment = {exporter.EXPORT_PATH_ENV: str(snapshot)}
        valid: dict[str, Any] = {
            "users": [
                {
                    "login": "bridge-admin",
                    "password": "TEST_ONLY_BRIDGE_PASSWORD",
                    "email": "bridge-admin@example.test",
                    "attributes": {"name": "Bridge Admin", "groups": ["users"]},
                }
            ]
        }
        if not exporter.publish_resolved_users(valid, environment):
            raise RuntimeError("current Form exporter did not publish")
        if stat.S_IMODE(snapshot.stat().st_mode) != 0o600:
            raise RuntimeError("current Form exporter permission contract changed")
        _require_result(
            _run([str(validator), "-form-users-file", str(snapshot)]),
            code=0,
            stdout="",
            stderr="",
        )

        # These shapes are serializable by the current bridge/current route but
        # deliberately fail the target security/business validator. They are a
        # deployment promotion gate, not silently normalized data.
        target_rejections: tuple[dict[str, Any], ...] = (
            {
                "users": [
                    {"login": "duplicate", "password": "first"},
                    {"login": "duplicate", "password": "TEST_ONLY_DUPLICATE"},
                ]
            },
            {
                "users": [
                    {
                        "login": "invalid-claim",
                        "password": "TEST_ONLY_INVALID_CLAIM",
                        "attributes": {"email": 42},
                    }
                ]
            },
            {"users": [{"login": "control\nlogin", "password": "TEST_ONLY_CONTROL"}]},
            {"users": [{"login": "oversized-" + "x" * 1024, "password": "TEST_ONLY_LONG"}]},
            {"users": [{"login": "empty-password", "password": ""}]},
        )
        for config in target_rejections:
            exporter.publish_resolved_users(config, environment)
            result = _run([str(validator), "--form-users-file=" + str(snapshot)])
            _require_result(result, code=1, stdout="", stderr=EXPECTED_INVALID)
            combined = result.stdout + result.stderr
            if "TEST_ONLY" in combined or str(snapshot) in combined:
                raise RuntimeError("Form snapshot validator leaked protected input")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--auth-form-root", required=True, type=Path)
    arguments = parser.parse_args()
    try:
        check_bridge(
            Path(__file__).resolve().parents[2],
            arguments.auth_form_root.resolve(strict=True),
        )
    except Exception as error:  # pylint: disable=W0718
        print(f"Form snapshot bridge check failed: {error}", file=sys.stderr)
        return 1
    print("Form snapshot bridge check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
