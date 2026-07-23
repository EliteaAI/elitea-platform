from __future__ import annotations

import hashlib
import importlib
import json
import subprocess
import tomllib
from pathlib import Path

import pytest

from elitea_worker.agents.configuration_registry import ConfigurationRegistryShadow
from elitea_worker.agents.sdk_adapter import _package_tree_digest
from elitea_worker.constants import (
    CONFIGURATION_CATALOG_SHA256,
    SDK_DISTRIBUTION_VERSION,
    SDK_PACKAGE_TREE_SHA256,
    SDK_SOURCE_ARCHIVE_SHA256,
    SDK_SOURCE_REVISION,
)


_SERVICE_ROOT = Path(__file__).resolve().parents[2]
_PLATFORM_ROOT = _SERVICE_ROOT.parents[1]
_SDK_ROOT = _PLATFORM_ROOT.parent / "elitea-sdk"
_GO_CATALOG = (
    _PLATFORM_ROOT
    / "services"
    / "elitea-main"
    / "internal"
    / "runtimecomposition"
    / "current_sdk_configuration_catalog_snapshot.json"
)


def test_worker_dependency_and_lock_share_one_sdk_identity() -> None:
    lock = json.loads((_SERVICE_ROOT / "elitea-sdk.lock.json").read_bytes())
    project = tomllib.loads((_SERVICE_ROOT / "pyproject.toml").read_text())
    dependency = next(
        item for item in project["project"]["dependencies"] if item.startswith("elitea-sdk")
    )

    assert dependency == f"elitea-sdk=={SDK_DISTRIBUTION_VERSION}"
    containerfile = (_SERVICE_ROOT / "Containerfile").read_text()
    assert f"ARG ELITEA_SDK_REVISION={SDK_SOURCE_REVISION}" in containerfile
    assert (
        '"elitea-sdk @ git+https://github.com/EliteaAI/elitea-sdk.git@'
        '${ELITEA_SDK_REVISION}"'
    ) in containerfile
    assert lock["distribution_version"] == SDK_DISTRIBUTION_VERSION
    assert lock["source"]["revision"] == SDK_SOURCE_REVISION
    assert lock["source"]["git_archive_sha256"] == SDK_SOURCE_ARCHIVE_SHA256
    assert lock["installed_package_tree"]["sha256"] == SDK_PACKAGE_TREE_SHA256
    assert lock["installed_package_tree"]["file_count"] > 0


def test_local_pinned_sdk_checkout_matches_lock_when_available() -> None:
    if not (_SDK_ROOT / ".git").exists():
        pytest.skip("pinned SDK evidence checkout is unavailable")
    revision = subprocess.run(
        ["git", "-C", str(_SDK_ROOT), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if revision != SDK_SOURCE_REVISION:
        pytest.skip("local SDK checkout is not at the admitted revision")

    lock = json.loads((_SERVICE_ROOT / "elitea-sdk.lock.json").read_bytes())
    sdk_project = tomllib.loads((_SDK_ROOT / "pyproject.toml").read_text())
    package_root = _SDK_ROOT / "elitea_sdk"
    archive = subprocess.run(
        ["git", "-C", str(_SDK_ROOT), "archive", "--format=tar", revision],
        check=True,
        capture_output=True,
    ).stdout

    assert sdk_project["project"]["version"] == SDK_DISTRIBUTION_VERSION
    assert len(list(package_root.rglob("*.py"))) == lock["installed_package_tree"][
        "file_count"
    ]
    assert _package_tree_digest(package_root) == SDK_PACKAGE_TREE_SHA256
    assert hashlib.sha256(archive).hexdigest() == SDK_SOURCE_ARCHIVE_SHA256


def test_go_binding_catalog_matches_worker_registry_shadow() -> None:
    module = importlib.import_module("elitea_sdk.configurations")
    assert module.FAILED_IMPORTS == {}
    shadow = ConfigurationRegistryShadow(module.get_class_configurations).snapshot
    document = json.loads(_GO_CATALOG.read_bytes())

    assert document["complete"] is True
    assert document["sdk_revision"] == SDK_SOURCE_REVISION
    assert document["catalog_revision"] == SDK_SOURCE_REVISION
    assert document["catalog_digest"] == f"sha256:{shadow.catalog_digest.hex()}"
    assert shadow.catalog_digest.hex() == CONFIGURATION_CATALOG_SHA256
    assert document["entry_count"] == len(shadow.entries) == len(document["entries"])
    assert document["entries"] == [
        {
            "configuration_type": entry.type,
            "section": entry.section,
            "schema_id": f"elitea.configuration.{entry.type}",
            "schema_revision": SDK_SOURCE_REVISION,
            "schema_digest": f"sha256:{entry.schema_digest.hex()}",
            "validation_supported": entry.validation_supported,
            "connection_check_supported": entry.connection_check_supported,
        }
        for entry in shadow.entries
    ]
