"""Safe, input-bound ``configuration.validate.v1`` handler."""

from __future__ import annotations

import hmac
import math
from dataclasses import dataclass
from typing import Any

from elitea_worker.agents.sdk_adapter import EliteaSdkAdapter, SdkValidationError
from elitea_worker.constants import (
    MAX_ISSUES,
    MAX_JSON_DEPTH,
    MAX_STRING_BYTES,
)
from elitea_worker.execution.errors import (
    IncompatibleVersion,
    InternalFailure,
    InvalidInput,
    ResourceExhausted,
    UnsupportedCapability,
    WorkerError,
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


class ConfigurationValidationHandler:
    def __init__(self, sdk: EliteaSdkAdapter) -> None:
        self._sdk = sdk

    def execute(self, request: ConfigurationValidationRequest) -> ConfigurationValidationResult:
        self._validate_identity(request)
        _validate_json_value(request.settings)

        try:
            outcome = self._sdk.validate(request.configuration_type, request.settings)
        except WorkerError:
            raise
        except Exception:
            # Preserve the current validator's terminal-error behavior while
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

    def _validate_identity(self, request: ConfigurationValidationRequest) -> None:
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
        self.validate_binding(
            configuration_type=request.configuration_type,
            catalog_revision=request.catalog_revision,
            catalog_digest=request.catalog_digest,
            schema_id=request.schema_id,
            schema_revision=request.schema_revision,
            schema_digest=request.schema_digest,
        )

    def validate_binding(
        self,
        *,
        configuration_type: str,
        catalog_revision: str,
        catalog_digest: bytes,
        schema_id: str,
        schema_revision: str,
        schema_digest: bytes,
    ) -> None:
        """Bind one command to the admitted catalog and selected SDK schema."""

        if (
            not configuration_type
            or not catalog_revision
            or not schema_id
            or not schema_revision
            or len(catalog_digest) != 32
            or len(schema_digest) != 32
        ):
            raise InvalidInput()
        if catalog_revision != self._sdk.catalog_revision or not hmac.compare_digest(
            catalog_digest,
            self._sdk.catalog_digest,
        ):
            raise IncompatibleVersion()
        binding = self._sdk.schema(configuration_type)
        if not binding.validation_supported:
            raise UnsupportedCapability(
                "Validation is not supported for this configuration type."
            )
        if (
            schema_id != binding.schema_id
            or schema_revision != binding.schema_revision
            or not hmac.compare_digest(schema_digest, binding.schema_digest)
        ):
            raise IncompatibleVersion()


def _validate_json_value(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ResourceExhausted("The settings input exceeds the nesting limit.")
    if value is None or isinstance(value, (bool, int)):
        return
    if isinstance(value, float):
        if not math.isfinite(value):
            raise InvalidInput("The settings input contains a non-finite number.")
        return
    if isinstance(value, str):
        try:
            length = len(value.encode("utf-8"))
        except UnicodeEncodeError:
            raise InvalidInput("The settings input contains invalid text.") from None
        if length > MAX_STRING_BYTES:
            raise ResourceExhausted("A settings string exceeds the approved limit.")
        return
    if isinstance(value, dict):
        for key, item in value.items():
            if not isinstance(key, str):
                raise InvalidInput("A settings field name is not valid JSON text.")
            _validate_json_value(key, depth)
            _validate_json_value(item, depth + 1)
        return
    if isinstance(value, list):
        for item in value:
            _validate_json_value(item, depth + 1)
        return
    raise InvalidInput("The settings input is not a JSON value.")


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
