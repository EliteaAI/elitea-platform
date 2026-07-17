"""The only worker module allowed to import ``elitea_sdk``.

The first slice deliberately calls the existing Pydantic model directly. It
does not reload the SDK, call ``check_connection`` or return ``model_dump``.
"""

from __future__ import annotations

import hashlib
import importlib
import json
import sys
from contextlib import redirect_stdout
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from elitea_worker.constants import (
    CONFIGURATION_TYPE,
    OPENAPI_SCHEMA_SHA256,
    SDK_PACKAGE_TREE_SHA256,
)
from elitea_worker.execution.errors import DependencyUnavailable, UnsupportedCapability


@dataclass(frozen=True, slots=True)
class SdkValidationError:
    error_type: str
    location: tuple[str | int, ...]
    ordinal: int


@dataclass(frozen=True, slots=True)
class SdkValidationOutcome:
    errors: tuple[SdkValidationError, ...]

    @property
    def valid(self) -> bool:
        return not self.errors


class EliteaSdkAdapter:
    """Pinned SDK configuration-model adapter loaded once at composition time."""

    def __init__(self) -> None:
        # Some legacy SDK package initializers print optional-import diagnostics
        # while importing. Keep the CLI stdout contract clean and route those
        # diagnostics to stderr without altering the SDK checkout.
        with redirect_stdout(sys.stderr):
            module = importlib.import_module("elitea_sdk.configurations.openapi")
        package_root = Path(module.__file__).resolve().parents[1]
        if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
            raise DependencyUnavailable(
                "The installed Elitea SDK artifact does not match the admitted package tree."
            )
        openapi_model = module.OpenApiConfiguration
        schema = json.dumps(
            openapi_model.model_json_schema(),
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        actual = hashlib.sha256(schema).hexdigest()
        if actual != OPENAPI_SCHEMA_SHA256:
            raise DependencyUnavailable("The OpenAPI configuration schema does not match the admitted artifact.")
        self._models = {CONFIGURATION_TYPE: openapi_model}

    def validate(self, configuration_type: str, settings: dict[str, Any]) -> SdkValidationOutcome:
        try:
            model = self._models[configuration_type]
        except KeyError as exc:
            raise UnsupportedCapability() from exc

        try:
            # Business-compatibility boundary: exactly the legacy validation
            # algorithm, exactly once for each admitted request.
            model.model_validate(settings)
        except ValidationError as exc:
            raw_errors = exc.errors(
                include_url=False,
                include_context=False,
                include_input=False,
            )
            errors = tuple(
                SdkValidationError(
                    error_type=str(item.get("type", "unknown")),
                    location=tuple(item.get("loc", ())),
                    ordinal=index,
                )
                for index, item in enumerate(raw_errors)
            )
            return SdkValidationOutcome(errors)
        return SdkValidationOutcome(())


def _package_tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    paths = sorted(root.rglob("*.py"))
    for path in paths:
        relative = path.relative_to(root).as_posix().encode("utf-8")
        content = path.read_bytes()
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(len(content).to_bytes(8, "big"))
        digest.update(content)
    return digest.hexdigest()
