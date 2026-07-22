from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import patch

import pytest
from pydantic import BaseModel, ConfigDict

from elitea_worker.agents.sdk_adapter import EliteaSdkAdapter
from elitea_worker.constants import MAX_JSON_DEPTH
from elitea_worker.execution.errors import (
    IncompatibleVersion,
    InternalFailure,
    InvalidInput,
    ResourceExhausted,
    UnsupportedCapability,
)
from elitea_worker.handlers.validation import (
    ConfigurationValidationHandler,
    ConfigurationValidationRequest,
)


def _model_config(configuration_type: str, section: str) -> ConfigDict:
    return ConfigDict(
        json_schema_extra={
            "metadata": {"type": configuration_type, "section": section}
        }
    )


class _GithubConfiguration(BaseModel):
    model_config = _model_config("github", "credentials")

    base_url: str
    access_token: str | None = None


class _PgVectorConfiguration(BaseModel):
    model_config = _model_config("pgvector", "vectorstorage")

    connection_string: str


class _ConfluenceConfiguration(BaseModel):
    model_config = _model_config("confluence", "credentials")

    url: str
    token: str | None = None


class _OpenApiConfiguration(BaseModel):
    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "metadata": {"type": "openapi", "section": "credentials"}
        },
    )

    auth_type: str | None = None
    api_key: str | None = None
    scope: Any = None


class _CheckedConfiguration(BaseModel):
    model_config = _model_config("checked", "credentials")

    api_key: str

    @staticmethod
    def check_connection(settings: dict[str, Any]) -> dict[str, Any]:
        return {"type": "checked", "configured": bool(settings.get("api_key"))}


_FAKE_REGISTRY: dict[str, type[BaseModel]] = {
    "github": _GithubConfiguration,
    "pgvector": _PgVectorConfiguration,
    "confluence": _ConfluenceConfiguration,
    "openapi": _OpenApiConfiguration,
    "checked": _CheckedConfiguration,
}


def _adapter() -> EliteaSdkAdapter:
    return EliteaSdkAdapter(registry_loader=lambda: _FAKE_REGISTRY)


def _request(
    adapter: EliteaSdkAdapter,
    settings: dict[str, Any],
    configuration_type: str = "openapi",
) -> ConfigurationValidationRequest:
    binding = adapter.schema(configuration_type)
    return ConfigurationValidationRequest(
        configuration_revision_id="configuration-revision-1",
        configuration_type=configuration_type,
        catalog_revision=adapter.catalog_revision,
        catalog_digest=adapter.catalog_digest,
        schema_id=binding.schema_id,
        schema_revision=binding.schema_revision,
        schema_digest=binding.schema_digest,
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        settings_entry_id="settings",
        settings_entry_version="1",
        settings_content_digest=b"s" * 32,
        settings=settings,
    )


@pytest.mark.parametrize(
    ("configuration_type", "settings"),
    [
        ("github", {"base_url": "https://github.example", "access_token": "token"}),
        ("pgvector", {"connection_string": "postgresql://project-vector"}),
        ("confluence", {"url": "https://confluence.example", "token": "token"}),
        ("openapi", {"api_key": "token", "scope": {"nested": ["read"]}}),
        ("checked", {"api_key": "token"}),
    ],
)
def test_registered_configuration_type_selects_its_model_exactly_once(
    configuration_type: str,
    settings: dict[str, Any],
) -> None:
    adapter = _adapter()
    model = _FAKE_REGISTRY[configuration_type]

    with patch.object(model, "model_validate", wraps=model.model_validate) as validation:
        result = ConfigurationValidationHandler(adapter).execute(
            _request(adapter, settings, configuration_type)
        )

    assert result.valid is True
    validation.assert_called_once_with(settings)


def test_openapi_is_an_ordinary_registry_type_with_sdk_owned_field_semantics() -> None:
    adapter = _adapter()
    settings = {
        "api_key": "credential-bearing-input",
        "scope": {"audiences": ["read", "write"]},
        "provider_extension": {"enabled": True},
    }

    result = ConfigurationValidationHandler(adapter).execute(
        _request(adapter, settings, "openapi")
    )

    assert result.valid is True
    assert result.schema_id == "elitea.configuration.openapi"


def test_invalid_registered_configuration_returns_stable_safe_issues() -> None:
    adapter = _adapter()

    result = ConfigurationValidationHandler(adapter).execute(
        _request(adapter, {}, "github")
    )

    assert result.valid is False
    assert [
        (issue.code, issue.json_pointer, issue.safe_message)
        for issue in result.issues
    ] == [("REQUIRED_FIELD", "/base_url", "A required value is missing.")]


def test_unknown_type_is_unsupported_without_model_invocation() -> None:
    adapter = _adapter()
    request = replace(
        _request(adapter, {}, "openapi"),
        configuration_type="unknown",
        schema_id="elitea.configuration.unknown",
    )

    with patch.object(
        _OpenApiConfiguration,
        "model_validate",
        wraps=_OpenApiConfiguration.model_validate,
    ) as validation:
        with pytest.raises(UnsupportedCapability):
            ConfigurationValidationHandler(adapter).execute(request)

    validation.assert_not_called()


def test_selected_type_must_match_its_computed_schema_digest() -> None:
    adapter = _adapter()
    request = replace(
        _request(adapter, {"connection_string": "postgresql://project"}, "pgvector"),
        schema_digest=b"x" * 32,
    )

    with patch.object(
        _PgVectorConfiguration,
        "model_validate",
        wraps=_PgVectorConfiguration.model_validate,
    ) as validation:
        with pytest.raises(IncompatibleVersion):
            ConfigurationValidationHandler(adapter).execute(request)

    validation.assert_not_called()


def test_unexpected_sdk_failure_is_terminal_internal_without_leaking_text() -> None:
    adapter = _adapter()
    secret_canary = "unexpected model failure with password=do-not-emit"

    with patch.object(adapter, "validate", side_effect=RuntimeError(secret_canary)):
        with pytest.raises(InternalFailure) as caught:
            ConfigurationValidationHandler(adapter).execute(
                _request(adapter, {}, "openapi")
            )

    assert caught.value.code == "INTERNAL"
    assert caught.value.safe_message == "The runtime operation failed."
    assert caught.value.retryable is False
    assert secret_canary not in str(caught.value)


@pytest.mark.parametrize(
    ("settings", "error_type"),
    [
        ({"scope": "v" * (64 * 1024 + 1)}, ResourceExhausted),
        ({"scope": float("inf")}, InvalidInput),
        ({"scope": object()}, InvalidInput),
    ],
)
def test_generic_json_bounds_are_rejected_before_sdk(
    settings: dict[str, Any],
    error_type: type[Exception],
) -> None:
    adapter = _adapter()

    with patch.object(
        _OpenApiConfiguration,
        "model_validate",
        wraps=_OpenApiConfiguration.model_validate,
    ) as validation:
        with pytest.raises(error_type):
            ConfigurationValidationHandler(adapter).execute(
                _request(adapter, settings, "openapi")
            )

    validation.assert_not_called()


def test_generic_json_nesting_limit_is_rejected_before_sdk() -> None:
    adapter = _adapter()
    nested: dict[str, Any] = {}
    cursor = nested
    for _ in range(MAX_JSON_DEPTH + 1):
        child: dict[str, Any] = {}
        cursor["child"] = child
        cursor = child

    with pytest.raises(ResourceExhausted):
        ConfigurationValidationHandler(adapter).execute(
            _request(adapter, {"scope": nested}, "openapi")
        )


def test_connection_checker_runs_only_for_explicit_supported_operation() -> None:
    adapter = _adapter()
    settings = {"api_key": "token"}
    checker = _CheckedConfiguration.check_connection

    with patch.object(
        _CheckedConfiguration,
        "check_connection",
        wraps=checker,
    ) as connection_check:
        assert adapter.validate("checked", settings).valid is True
        connection_check.assert_not_called()

        assert adapter.check_connection("checked", settings) == {
            "type": "checked",
            "configured": True,
        }
        connection_check.assert_called_once_with(settings)


def test_connection_checker_rejects_a_type_without_registered_support() -> None:
    adapter = _adapter()

    with pytest.raises(UnsupportedCapability, match="Connection checking"):
        adapter.check_connection(
            "pgvector",
            {"connection_string": "postgresql://project-vector"},
        )


def test_adapter_captures_registry_once() -> None:
    calls = 0

    def load_registry() -> dict[str, type[BaseModel]]:
        nonlocal calls
        calls += 1
        return _FAKE_REGISTRY

    adapter = EliteaSdkAdapter(registry_loader=load_registry)

    adapter.schema("github")
    adapter.validate("pgvector", {"connection_string": "postgresql://project"})
    adapter.schema("confluence")

    assert calls == 1
