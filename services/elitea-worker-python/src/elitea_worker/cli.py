"""Stable standalone worker command line."""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path

from elitea_worker.app import OfflineValidationWorker
from elitea_worker.capabilities import capability_json, conformance_identity_fields
from elitea_worker.execution.errors import WorkerError
from elitea_worker.serve import serve_from_config


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="elitea-worker")
    subparsers = parser.add_subparsers(dest="command", required=True)

    capabilities = subparsers.add_parser("capabilities")
    capabilities.add_argument("--json", action="store_true", required=True)

    validate = subparsers.add_parser("validate")
    validate.add_argument("--envelope", type=Path, required=True)

    execute = subparsers.add_parser("execute")
    execute.add_argument("--envelope", type=Path, required=True)
    execute.add_argument("--fixture-bundle", type=Path, required=True)
    execute.add_argument("--output", type=Path, required=True)

    conformance = subparsers.add_parser("conformance")
    conformance.add_argument("--suite", choices=("runtime-v1",), required=True)

    serve = subparsers.add_parser("serve")
    serve.add_argument("--config", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    try:
        if args.command == "serve":
            asyncio.run(serve_from_config(args.config))
            return 0
        worker = OfflineValidationWorker()
        if args.command == "capabilities":
            print(capability_json())
            return 0
        if args.command == "validate":
            worker.validate_envelope(args.envelope)
            return 0
        if args.command == "execute":
            worker.execute(
                envelope_path=args.envelope,
                fixture_bundle_path=args.fixture_bundle,
                output_path=args.output,
            )
            return 0
        if args.command == "conformance":
            return _run_conformance(worker)
        raise AssertionError("unreachable command")
    except WorkerError as error:
        diagnostic = {
            "code": error.code,
            "safe_message": error.safe_message,
            "retryable": error.retryable,
        }
        print(json.dumps(diagnostic, sort_keys=True, separators=(",", ":")), file=sys.stderr)
        return error.exit_code


def _run_conformance(worker: OfflineValidationWorker) -> int:
    root = _conformance_root()
    cases: list[dict[str, str]] = []
    for name in ("valid", "invalid", "unsupported"):
        fixture = root / name
        status = "passed"
        try:
            with tempfile.TemporaryDirectory(prefix="elitea-runtime-v1-") as directory:
                output = Path(directory) / "output.pb"
                worker.execute(
                    envelope_path=fixture / "envelope.pb",
                    fixture_bundle_path=fixture / "fixture-bundle.json",
                    output_path=output,
                )
                if output.read_bytes() != (fixture / "expected-output.pb").read_bytes():
                    status = "failed"
        except (OSError, WorkerError):
            status = "failed"
        cases.append({"case": name, "status": status})
    passed = all(case["status"] == "passed" for case in cases)
    report = {
        "schema_version": "elitea.runtime-conformance-report.v1",
        "suite": "runtime-v1",
        "capability": "configuration.validate.v1",
        "status": "passed" if passed else "failed",
        "cases": cases,
        **conformance_identity_fields(),
    }
    print(json.dumps(report, sort_keys=True, separators=(",", ":")))
    return 0 if passed else 6


def _conformance_root() -> Path:
    configured = os.environ.get("ELITEA_CONFORMANCE_ROOT")
    if configured:
        return Path(configured) / "configuration-validation"
    packaged = Path("/opt/elitea/conformance/configuration-validation")
    if packaged.is_dir():
        return packaged
    repository = Path(__file__).resolve().parents[4]
    return repository / "testdata/proto/runtime/v1/configuration-validation"


if __name__ == "__main__":
    raise SystemExit(main())
