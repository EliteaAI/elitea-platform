"""Safe, input-bound ``configuration.validate.v1`` handler."""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from elitea_worker.agents.sdk_adapter import EliteaSdkAdapter, SdkValidationError
from elitea_worker.constants import (
    CONFIGURATION_CATALOG_REVISION,
    CONFIGURATION_CATALOG_SHA256,
    CONFIGURATION_TYPE,
    MAX_ISSUES,
    MAX_STRING_BYTES,
    OPENAPI_SCHEMA_ID,
    OPENAPI_SCHEMA_REVISION,
    OPENAPI_SCHEMA_SHA256,
)
from elitea_worker.execution.errors import (
    IncompatibleVersion,
    InternalFailure,
    InvalidInput,
    ResourceExhausted,
    WorkerError,
    UnsupportedCapability,
)


@dataclass(frozen=True, slots=True)
class ConfigurationValidationRequest:
    configuration_revision_id: str
    configuration_type: str
    catalog_revision: str
    catalog_digest: bytes
    schema_id: str
    schema_revision: str
    schema_digest: bytes
    input_bundle_id: str
    input_bundle_digest: bytes
    settings_entry_id: str
    settings_entry_version: str
    settings_content_digest: bytes
    settings: dict[str, Any]


@dataclass(frozen=True, slots=True)
class ConfigurationValidationIssue:
    code: str
    json_pointer: str
    safe_message: str


@dataclass(frozen=True, slots=True)
class ConfigurationValidationResult:
    configuration_revision_id: str
    configuration_type: str
    catalog_revision: str
    catalog_digest: bytes
    schema_id: str
    schema_revision: str
    schema_digest: bytes
    input_bundle_id: str
    input_bundle_digest: bytes
    settings_entry_id: str
    settings_entry_version: str
    settings_content_digest: bytes
    valid: bool
    issues: tuple[ConfigurationValidationIssue, ...]


_SAFE_ERRORS: dict[str, tuple[str, str]] = {
    "literal_error": ("VALUE_NOT_ALLOWED", "Value is not one of the allowed choices."),
    "enum": ("VALUE_NOT_ALLOWED", "Value is not one of the allowed choices."),
    "missing": ("REQUIRED_FIELD", "A required value is missing."),
    "extra_forbidden": ("UNKNOWN_FIELD", "This field is not allowed."),
    "value_error": ("INVALID_CONFIGURATION", "Configuration fields are inconsistent."),
    "greater_than": ("VALUE_OUT_OF_RANGE", "Value is outside the allowed range."),
    "greater_than_equal": ("VALUE_OUT_OF_RANGE", "Value is outside the allowed range."),
    "less_than": ("VALUE_OUT_OF_RANGE", "Value is outside the allowed range."),
    "less_than_equal": ("VALUE_OUT_OF_RANGE", "Value is outside the allowed range."),
}
_OPENAPI_SECRET_FIELDS = frozenset({"api_key", "client_secret"})
_CREDENTIAL_FREE_OPENAPI_FIELDS = frozenset(
    {
        "auth_type",
        "client_id",
        "custom_header_name",
        "method",
        "scope",
        "token_url",
    }
)


class ConfigurationValidationHandler:
    def __init__(self, sdk: EliteaSdkAdapter) -> None:
        self._sdk = sdk

    def execute(self, request: ConfigurationValidationRequest) -> ConfigurationValidationResult:
        self._validate_identity(request)
        secret_fields = request.settings.keys() & _OPENAPI_SECRET_FIELDS
        if secret_fields:
            # This is a protocol/admission failure, intentionally not a schema
            # issue. The admitted credential-free subset still uses the exact
            # legacy SDK model without modification.
            raise InvalidInput(
                "Credential-bearing settings are not accepted by the credential-free profile."
            )
        if any(key not in _CREDENTIAL_FREE_OPENAPI_FIELDS for key in request.settings):
            # The pinned SDK uses extra='allow'. Rejecting an unknown public
            # field before model_validate is an explicit target security
            # difference, not an accidental SDK behavior change.
            raise InvalidInput("Unknown settings fields are not accepted by the credential-free profile.")
        for value in request.settings.values():
            if isinstance(value, (dict, list)):
                raise InvalidInput(
                    "Container settings values are not accepted by the credential-free profile."
                )
            if isinstance(value, str) and len(value.encode("utf-8")) > MAX_STRING_BYTES:
                raise ResourceExhausted("A settings value exceeds the approved limit.")
            if isinstance(value, float) and not math.isfinite(value):
                raise InvalidInput("A settings value is not a finite JSON scalar.")
            if value is not None and not isinstance(value, (str, int, float, bool)):
                raise InvalidInput("A settings value is not a JSON scalar.")

        try:
            outcome = self._sdk.validate(request.configuration_type, request.settings)
        except WorkerError:
            raise
        except Exception:
            # Preserve the legacy validator's terminal-error behavior while
            # keeping adapter, model and exception text out of the contract.
            # BaseException is intentionally not caught: process shutdown and
            # interpreter-level cancellation keep their normal semantics.
            raise InternalFailure() from None
        issues = _map_errors(outcome.errors)
        return ConfigurationValidationResult(
            configuration_revision_id=request.configuration_revision_id,
            configuration_type=request.configuration_type,
            catalog_revision=request.catalog_revision,
            catalog_digest=request.catalog_digest,
            schema_id=request.schema_id,
            schema_revision=request.schema_revision,
            schema_digest=request.schema_digest,
            input_bundle_id=request.input_bundle_id,
            input_bundle_digest=request.input_bundle_digest,
            settings_entry_id=request.settings_entry_id,
            settings_entry_version=request.settings_entry_version,
            settings_content_digest=request.settings_content_digest,
            valid=outcome.valid,
            issues=issues,
        )

    @staticmethod
    def _validate_identity(request: ConfigurationValidationRequest) -> None:
        if request.configuration_type != CONFIGURATION_TYPE:
            raise UnsupportedCapability("Configuration type is not supported.")
        if (
            request.catalog_revision != CONFIGURATION_CATALOG_REVISION
            or request.catalog_digest.hex() != CONFIGURATION_CATALOG_SHA256
            or request.schema_id != OPENAPI_SCHEMA_ID
            or request.schema_revision != OPENAPI_SCHEMA_REVISION
            or request.schema_digest.hex() != OPENAPI_SCHEMA_SHA256
        ):
            raise IncompatibleVersion()
        required = (
            request.configuration_revision_id,
            request.input_bundle_id,
            request.settings_entry_id,
            request.settings_entry_version,
        )
        digests = (
            request.catalog_digest,
            request.schema_digest,
            request.input_bundle_digest,
            request.settings_content_digest,
        )
        if any(not value for value in required) or any(len(value) != 32 for value in digests):
            raise InvalidInput()


def _json_pointer(location: tuple[str | int, ...]) -> str:
    if not location:
        return ""
    parts = (str(item).replace("~", "~0").replace("/", "~1") for item in location)
    return "/" + "/".join(parts)


def _map_errors(errors: tuple[SdkValidationError, ...]) -> tuple[ConfigurationValidationIssue, ...]:
    mapped: list[tuple[str, str, int, ConfigurationValidationIssue]] = []
    seen: set[tuple[str, str]] = set()
    for error in errors:
        code, message = _SAFE_ERRORS.get(
            error.error_type,
            ("INVALID_VALUE", "Value does not satisfy the configuration schema."),
        )
        pointer = _json_pointer(error.location)
        identity = (code, pointer)
        if identity in seen:
            continue
        seen.add(identity)
        issue = ConfigurationValidationIssue(code, pointer, message)
        mapped.append((pointer, code, error.ordinal, issue))
        if len(mapped) == MAX_ISSUES:
            break
    mapped.sort(key=lambda item: (item[0], item[1], item[2]))
    return tuple(item[3] for item in mapped)
