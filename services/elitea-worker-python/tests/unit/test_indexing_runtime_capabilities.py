from __future__ import annotations

import asyncio
import json
import tomllib
from pathlib import Path
from types import SimpleNamespace

import pytest

import elitea_worker.serve as serve_module
from elitea_worker.execution.errors import DependencyUnavailable
from elitea_worker.indexing_runtime_capabilities import (
    _profile_digest,
    require_indexing_runtime_capabilities,
)


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_LOCK_PATH = _SERVICE_ROOT / "elitea-sdk.lock.json"


def _profile() -> dict:
    return json.loads(_LOCK_PATH.read_bytes())["indexing_capability_profile"]


def _passing_check(**overrides) -> str:
    profile = _profile()
    versions = profile["verified_distributions"]

    def importer(name: str):
        if name == "elitea_sdk":
            return SimpleNamespace(__file__="/opt/elitea_sdk/__init__.py")
        return SimpleNamespace()

    parameters = {
        "lock_path": _LOCK_PATH,
        "distribution_version": versions.__getitem__,
        "import_module": importer,
        "find_executable": lambda name: f"/usr/bin/{name}",
        "find_shared_library": lambda name: f"lib{name}.so",
        "package_tree_digest": lambda path: json.loads(
            _LOCK_PATH.read_bytes()
        )["installed_package_tree"]["sha256"],
        "ocr_probe": lambda: None,
    }
    parameters.update(overrides)
    return require_indexing_runtime_capabilities(**parameters)


def test_profile_digest_and_exact_requirements_match_project_extra() -> None:
    profile = _profile()
    project = tomllib.loads((_SERVICE_ROOT / "pyproject.toml").read_text())

    assert profile["profile_sha256"] == _profile_digest(profile)
    assert project["project"]["optional-dependencies"]["indexing-current"] == (
        profile["python_requirements"]
    )
    assert all("==" in requirement for requirement in profile["python_requirements"])
    assert "elitea-sdk[all]" not in json.dumps(project)


def test_complete_profile_is_admitted() -> None:
    assert _passing_check() == _profile()["profile_sha256"]


@pytest.mark.parametrize(
    ("override", "expected_cause"),
    [
        (
            {
                "distribution_version": lambda name: (
                    "missing" if name == "atlassian-python-api" else
                    _profile()["verified_distributions"][name]
                )
            },
            "distribution:atlassian-python-api:version-mismatch",
        ),
        (
            {
                "import_module": lambda name: (
                    (_ for _ in ()).throw(ModuleNotFoundError())
                    if name == "elitea_sdk.tools.confluence"
                    else (
                        SimpleNamespace(__file__="/opt/elitea_sdk/__init__.py")
                        if name == "elitea_sdk"
                        else SimpleNamespace()
                    )
                )
            },
            "import:elitea_sdk.tools.confluence:ModuleNotFoundError",
        ),
        (
            {
                "find_executable": lambda name: (
                    None if name == "pdftoppm" else f"/usr/bin/{name}"
                )
            },
            "executable:pdftoppm:missing",
        ),
        (
            {"find_shared_library": lambda name: None},
            "shared-library:cairo:missing",
        ),
        (
            {
                "ocr_probe": lambda: (_ for _ in ()).throw(
                    RuntimeError("probe failed")
                )
            },
            "ocr-runtime:RuntimeError",
        ),
    ],
)
def test_missing_capability_fails_with_safe_public_error(
    override: dict,
    expected_cause: str,
) -> None:
    with pytest.raises(DependencyUnavailable) as captured:
        _passing_check(**override)

    assert captured.value.safe_message == (
        "The indexing runtime capability profile is incomplete."
    )
    assert captured.value.retryable is True
    assert captured.value.__cause__ is not None
    assert expected_cause in str(captured.value.__cause__)


def test_profile_admits_exact_langchain_ocr_wrapper_and_artifact() -> None:
    profile = _profile()

    assert "pytesseract==0.3.13" in profile["python_requirements"]
    assert "unstructured_pytesseract==0.3.13" not in profile[
        "python_requirements"
    ]
    assert profile["verified_distributions"]["pytesseract"] == "0.3.13"
    assert "unstructured-pytesseract" not in profile["verified_distributions"]
    assert "pytesseract" in profile["required_imports"]
    assert "unstructured_pytesseract" not in profile["required_imports"]
    assert "fonts-dejavu-core" in profile["system_packages"]
    assert profile["verified_wheels"]["pytesseract"] == {
        "filename": "pytesseract-0.3.13-py3-none-any.whl",
        "license": "Apache License 2.0",
        "sha256": (
            "7a99c6c2ac598360693d83a416e36e0b"
            "33a67638bb9d77fdcac094a3589d4b34"
        ),
    }


def test_serve_verifies_profile_before_deployment(monkeypatch) -> None:
    calls: list[str] = []
    config = object()

    def load(_path: Path):
        calls.append("load")
        return config

    def verify():
        calls.append("verify")

    async def serve(actual, *, stop):
        assert actual is config
        assert isinstance(stop, asyncio.Event)
        calls.append("serve")

    monkeypatch.setattr(serve_module, "load_deploy_config", load)
    monkeypatch.setattr(
        serve_module,
        "require_indexing_runtime_capabilities",
        verify,
    )
    monkeypatch.setattr(serve_module, "serve_deployment", serve)

    asyncio.run(serve_module.serve_from_config(Path("/not-opened/runtime.json")))

    assert calls == ["load", "verify", "serve"]
