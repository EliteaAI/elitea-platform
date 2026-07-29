from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest


_SCRIPT = (
    Path(__file__).resolve().parents[2]
    / "scripts"
    / "verify_locked_artifacts.py"
)
_SPEC = importlib.util.spec_from_file_location("verify_locked_artifacts", _SCRIPT)
assert _SPEC is not None and _SPEC.loader is not None
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)


def test_artifact_closure_requires_exact_requirement_record_parity() -> None:
    profile = {
        "artifact_verified_requirements": [
            "cryptography==48.0.1",
            "FigmaPy==2018.1.0",
        ],
        "verified_wheels": {"cryptography": {}},
        "verified_source_archives": {"FigmaPy": {}},
    }

    _MODULE._validate_artifact_closure(profile)

    profile["artifact_verified_requirements"].append("azure-core==1.38.0")
    with pytest.raises(
        SystemExit,
        match="artifact records do not match",
    ):
        _MODULE._validate_artifact_closure(profile)


@pytest.mark.parametrize(
    "requirements",
    [
        ["cryptography>=48.0.1"],
        ["cryptography==48.0.1", "cryptography==48.0.1"],
    ],
)
def test_artifact_closure_rejects_non_exact_or_duplicate_pins(
    requirements: list[str],
) -> None:
    profile = {
        "artifact_verified_requirements": requirements,
        "verified_wheels": {"cryptography": {}},
        "verified_source_archives": {"FigmaPy": {}},
    }

    with pytest.raises(SystemExit):
        _MODULE._validate_artifact_closure(profile)
