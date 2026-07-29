from __future__ import annotations

import hashlib

import pytest

from elitea_worker.agents.configuration_registry import (
    ConfigurationRegistryError,
    ConfigurationRegistryShadow,
)


class _GithubConfiguration:
    model_config = {
        "json_schema_extra": {
            "metadata": {"type": "github", "section": "credentials"}
        }
    }

    @classmethod
    def model_json_schema(cls) -> dict:
        return {"type": "object", "required": ["token"]}

    @classmethod
    def model_validate(cls, value: object) -> object:
        return value


class _PgVectorConfiguration:
    model_config = {
        "json_schema_extra": {
            "metadata": {"type": "pgvector", "section": "vectorstorage"}
        }
    }

    @classmethod
    def model_json_schema(cls) -> dict:
        return {"type": "object"}

    @classmethod
    def model_validate(cls, value: object) -> object:
        return value


class _CheckedConfiguration:
    model_config = {
        "json_schema_extra": {
            "metadata": {"type": "checked", "section": "credentials"}
        }
    }

    @classmethod
    def model_json_schema(cls) -> dict:
        return {"type": "object"}

    @classmethod
    def model_validate(cls, value: object) -> object:
        return value

    @staticmethod
    def check_connection(settings: dict) -> None:
        return None


def test_registry_is_loaded_once_and_projected_without_provider_cases() -> None:
    calls = 0

    def load_registry() -> dict[str, type]:
        nonlocal calls
        calls += 1
        return {
            "pgvector": _PgVectorConfiguration,
            "github": _GithubConfiguration,
        }

    shadow = ConfigurationRegistryShadow(load_registry)

    first = shadow.snapshot
    second = shadow.snapshot
    assert calls == 1
    assert first is second
    assert [(entry.type, entry.section) for entry in first.entries] == [
        ("github", "credentials"),
        ("pgvector", "vectorstorage"),
    ]
    assert first.entries[0].canonical_schema == b'{"required":["token"],"type":"object"}'
    assert first.entries[0].schema_digest == hashlib.sha256(
        first.entries[0].canonical_schema
    ).digest()
    assert first.entries[0].validation_supported is True
    assert first.entries[0].connection_check_supported is False
    assert shadow.matches(first) is True
    assert shadow.entry("github") is first.entries[0]
    assert shadow.model("github") is _GithubConfiguration
    assert shadow.entry("unknown") is None
    assert shadow.model("unknown") is None

    checked = ConfigurationRegistryShadow(
        lambda: {"checked": _CheckedConfiguration}
    ).snapshot.entries[0]
    assert checked.validation_supported is True
    assert checked.connection_check_supported is True


def test_registry_models_are_copied_with_the_same_one_time_snapshot() -> None:
    source: dict[str, type] = {"github": _GithubConfiguration}
    shadow = ConfigurationRegistryShadow(lambda: source)

    source["github"] = _PgVectorConfiguration
    source["pgvector"] = _PgVectorConfiguration

    assert shadow.model("github") is _GithubConfiguration
    assert shadow.entry("github") is shadow.snapshot.entries[0]
    assert shadow.model("pgvector") is None


def test_catalog_digest_matches_go_registry_snapshot_golden() -> None:
    shadow = ConfigurationRegistryShadow(
        lambda: {
            "github": _GithubConfiguration,
            "pgvector": _PgVectorConfiguration,
        }
    )

    # services/elitea-main/internal/domain/configurations/registry_snapshot_test.go
    assert shadow.snapshot.catalog_digest.hex() == (
        "60fe3a8019b71af3b3aa30277efda471cf042e5a9f789040dbc3ca61cce92b2b"
    )


def test_registry_rejects_type_metadata_drift_without_exposing_loader_errors() -> None:
    with pytest.raises(ConfigurationRegistryError, match="does not match"):
        ConfigurationRegistryShadow(lambda: {"gitlab": _GithubConfiguration})

    def broken_loader() -> dict[str, type]:
        raise RuntimeError("password=do-not-emit")

    with pytest.raises(ConfigurationRegistryError) as caught:
        ConfigurationRegistryShadow(broken_loader)
    assert "do-not-emit" not in str(caught.value)
