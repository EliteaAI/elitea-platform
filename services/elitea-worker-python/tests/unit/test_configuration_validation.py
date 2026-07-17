from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest

import elitea_worker.handlers.validation as validation_handler_module
from elitea_worker.agents.sdk_adapter import EliteaSdkAdapter
from elitea_worker.constants import (
    CONFIGURATION_CATALOG_REVISION,
    CONFIGURATION_CATALOG_SHA256,
    OPENAPI_SCHEMA_ID,
    OPENAPI_SCHEMA_REVISION,
    OPENAPI_SCHEMA_SHA256,
)
from elitea_worker.execution.errors import (
    InternalFailure,
    InvalidInput,
    ResourceExhausted,
    UnsupportedCapability,
)
from elitea_worker.handlers.validation import (
    ConfigurationValidationHandler,
    ConfigurationValidationRequest,
)


def _request(settings: dict, configuration_type: str = "openapi") -> ConfigurationValidationRequest:
    return ConfigurationValidationRequest(
        configuration_revision_id="configuration-revision-1",
        configuration_type=configuration_type,
        catalog_revision=CONFIGURATION_CATALOG_REVISION,
        catalog_digest=bytes.fromhex(CONFIGURATION_CATALOG_SHA256),
        schema_id=OPENAPI_SCHEMA_ID,
        schema_revision=OPENAPI_SCHEMA_REVISION,
        schema_digest=bytes.fromhex(OPENAPI_SCHEMA_SHA256),
        input_bundle_id="bundle-1",
        input_bundle_digest=b"b" * 32,
        settings_entry_id="settings",
        settings_entry_version="1",
        settings_content_digest=b"s" * 32,
        settings=settings,
    )


def test_valid_empty_and_known_non_secret_settings_preserve_legacy_acceptance() -> None:
    handler = ConfigurationValidationHandler(EliteaSdkAdapter())

    assert handler.execute(_request({})).valid is True
    assert handler.execute(
        _request({"auth_type": "Custom", "custom_header_name": "X-API-Key"})
    ).valid is True


def test_unknown_legacy_extra_is_intentional_profile_rejection() -> None:
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        with pytest.raises(InvalidInput, match="Unknown settings fields"):
            ConfigurationValidationHandler(adapter).execute(
                _request({"non_sensitive_extension": "preserved-by-legacy"})
            )
        call.assert_not_called()


def test_invalid_literal_is_stable_and_safe() -> None:
    handler = ConfigurationValidationHandler(EliteaSdkAdapter())

    result = handler.execute(_request({"auth_type": "Digest"}))

    assert result.valid is False
    assert [(issue.code, issue.json_pointer, issue.safe_message) for issue in result.issues] == [
        ("VALUE_NOT_ALLOWED", "/auth_type", "Value is not one of the allowed choices.")
    ]
    rendered = repr(result)
    assert "Input should be" not in rendered
    assert "Digest" not in rendered


def test_each_admitted_request_calls_exact_legacy_model_once() -> None:
    adapter = EliteaSdkAdapter()
    handler = ConfigurationValidationHandler(adapter)
    model = adapter._models["openapi"]  # narrow behavioral seam under test

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        assert handler.execute(_request({})).valid is True
        assert call.call_count == 1


def test_unexpected_sdk_failure_is_terminal_internal_without_leaking_text() -> None:
    adapter = EliteaSdkAdapter()
    secret_canary = "unexpected model failure with password=do-not-emit"

    with patch.object(adapter, "validate", side_effect=RuntimeError(secret_canary)):
        with pytest.raises(InternalFailure) as caught:
            ConfigurationValidationHandler(adapter).execute(_request({}))

    assert caught.value.code == "INTERNAL"
    assert caught.value.safe_message == "The runtime operation failed."
    assert caught.value.retryable is False
    assert secret_canary not in str(caught.value)


def test_unknown_type_is_unsupported_without_sdk_invocation() -> None:
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        with pytest.raises(UnsupportedCapability):
            ConfigurationValidationHandler(adapter).execute(_request({}, "unknown"))
        call.assert_not_called()


@pytest.mark.parametrize(
    "settings",
    [
        {"api_key": "not-a-fixture-secret"},
        {"api_key": None},
        {"client_secret": "not-a-fixture-secret"},
        {"client_secret": None},
    ],
)
def test_credentials_are_intentional_protocol_failure_not_schema_result(settings: dict) -> None:
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        with pytest.raises(InvalidInput, match="Credential-bearing"):
            ConfigurationValidationHandler(adapter).execute(_request(settings))
        call.assert_not_called()


@pytest.mark.parametrize(
    "settings",
    [
        {"scope": {"note": "TEST_ONLY_SECRET_CANARY"}},
        {"scope": ["read"]},
    ],
)
def test_container_value_is_rejected_before_sdk(settings: dict) -> None:
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        with pytest.raises(InvalidInput, match="Container settings values"):
            ConfigurationValidationHandler(adapter).execute(_request(settings))
        call.assert_not_called()


@pytest.mark.parametrize(
    ("settings", "error_type"),
    [
        ({"scope": "v" * (64 * 1024 + 1)}, ResourceExhausted),
        ({"scope": float("inf")}, InvalidInput),
    ],
)
def test_scalar_bounds_are_rejected_before_sdk(
    settings: dict, error_type: type[Exception]
) -> None:
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    with patch.object(model, "model_validate", wraps=model.model_validate) as call:
        with pytest.raises(error_type):
            ConfigurationValidationHandler(adapter).execute(_request(settings))
        call.assert_not_called()


def test_machine_readable_legacy_parity_matrix_matches_pinned_sdk_and_profile() -> None:
    root = Path(__file__).resolve().parents[4]
    profile = json.loads(
        (
            root
            / "testdata/proto/runtime/v1/configuration-validation/openapi-credential-free-profile.json"
        ).read_bytes()
    )
    assert set(profile["top_level_field_policy"]["allowed_non_secret_fields"]) == set(
        validation_handler_module._CREDENTIAL_FREE_OPENAPI_FIELDS
    )
    assert set(profile["top_level_field_policy"]["forbidden_model_secret_fields"]) == set(
        validation_handler_module._OPENAPI_SECRET_FIELDS
    )
    assert profile["top_level_value_policy"]["max_string_utf8_bytes"] == 64 * 1024
    assert profile["value_semantics"]["sdk_model_modified"] is False
    matrix = json.loads(
        (
            root
            / "testdata/proto/runtime/v1/configuration-validation/openapi-legacy-parity-matrix.json"
        ).read_bytes()
    )
    adapter = EliteaSdkAdapter()
    model = adapter._models["openapi"]

    required = {
        "method_lowercase_basic",
        "partial_oauth_client_id",
        "null_non_secret_fields",
        "custom_header_string_not_coerced",
        "custom_header_name_x_api_key_is_non_secret_value",
        "all_known_non_secret_fields",
        "nested_x_api_key_legacy_extra_bypass",
        "container_canary_under_allowed_field",
    }
    assert required <= {case["id"] for case in matrix["cases"]}

    for case in matrix["cases"]:
        settings = case["settings"]
        legacy = adapter.validate("openapi", settings)
        expected_legacy = case["legacy_model_validate"]
        assert ("VALID" if legacy.valid else "INVALID") == expected_legacy["outcome"], case["id"]
        assert [error.error_type for error in legacy.errors] == expected_legacy["errors"][
            "types"
        ], case["id"]
        assert [list(error.location) for error in legacy.errors] == expected_legacy[
            "errors"
        ]["locations"], case["id"]

        target = case["target"]
        with patch.object(model, "model_validate", wraps=model.model_validate) as call:
            if target["profile"]["outcome"] == "ADMIT":
                result = ConfigurationValidationHandler(adapter).execute(_request(settings))
                assert result.valid is legacy.valid, case["id"]
                assert call.call_count == 1, case["id"]
                assert target["sdk"]["invoked"] is True
                assert target["sdk"]["call_count"] == 1
                assert target["sdk"]["outcome"] == expected_legacy["outcome"]
                assert target["sdk"]["errors"] == expected_legacy["errors"]
                assert target["intentional_security_difference"] is None
            else:
                with pytest.raises(InvalidInput):
                    ConfigurationValidationHandler(adapter).execute(_request(settings))
                call.assert_not_called()
                assert target["sdk"] == {"call_count": 0, "invoked": False}
                assert target["intentional_security_difference"] is not None
