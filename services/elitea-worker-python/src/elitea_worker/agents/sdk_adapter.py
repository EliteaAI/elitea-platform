"""The only worker module allowed to import ``elitea_sdk``.

Configuration behavior is selected from the installed SDK registry captured at
composition time. Validation and connection checking remain distinct explicit
operations; neither reloads the registry or rewrites provider-specific input.
"""

from __future__ import annotations

import hashlib
import importlib
import sys
from contextlib import redirect_stdout
from copy import deepcopy
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from elitea_worker.agents.client_context import EliteaClientContext
from elitea_worker.agents.configuration_registry import (
    ConfigurationRegistryShadow,
    RegistryLoader,
)
from elitea_worker.constants import (
    CONFIGURATION_CATALOG_REVISION,
    CONFIGURATION_CATALOG_SHA256,
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


@dataclass(frozen=True, slots=True)
class SdkConfigurationBinding:
    configuration_type: str
    schema_id: str
    schema_revision: str
    schema_digest: bytes
    validation_supported: bool
    connection_check_supported: bool


class EliteaSdkAdapter:
    """Pinned SDK configuration-model adapter loaded once at composition time."""

    def __init__(self, registry_loader: RegistryLoader | None = None) -> None:
        if registry_loader is None:
            # SDK package initializers discover optional integrations and may
            # print diagnostics. Keep stdout reserved for the worker protocol.
            with redirect_stdout(sys.stderr):
                module = importlib.import_module("elitea_sdk.configurations")
                package_root = Path(module.__file__).resolve().parents[1]
                if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
                    raise DependencyUnavailable(
                        "The installed Elitea SDK artifact does not match the admitted package tree."
                    )
                self._registry = ConfigurationRegistryShadow(
                    module.get_class_configurations
                )
        else:
            # Injection is restricted to composition/tests. The shadow still
            # copies and validates the registry exactly once.
            self._registry = ConfigurationRegistryShadow(registry_loader)

    @property
    def catalog_revision(self) -> str:
        return CONFIGURATION_CATALOG_REVISION

    @property
    def catalog_digest(self) -> bytes:
        # This remains the admitted catalog identity used by the current wire.
        # Each selected model is additionally bound to its computed schema
        # digest below, so a type cannot be validated against another schema.
        return bytes.fromhex(CONFIGURATION_CATALOG_SHA256)

    def schema(self, configuration_type: str) -> SdkConfigurationBinding:
        entry = self._registry.entry(configuration_type)
        if entry is None:
            raise UnsupportedCapability("Configuration type is not supported.")
        return SdkConfigurationBinding(
            configuration_type=entry.type,
            schema_id=f"elitea.configuration.{entry.type}",
            schema_revision=CONFIGURATION_CATALOG_REVISION,
            schema_digest=entry.schema_digest,
            validation_supported=entry.validation_supported,
            connection_check_supported=entry.connection_check_supported,
        )

    def validate(self, configuration_type: str, settings: dict[str, Any]) -> SdkValidationOutcome:
        binding = self.schema(configuration_type)
        if not binding.validation_supported:
            raise UnsupportedCapability(
                "Validation is not supported for this configuration type."
            )
        model = self._registry.model(binding.configuration_type)
        if model is None:
            raise UnsupportedCapability("Configuration type is not supported.")

        try:
            # Business-compatibility boundary: exactly the registered SDK
            # validation algorithm, exactly once for each admitted request.
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

    def check_connection(
        self,
        configuration_type: str,
        settings: dict[str, Any],
    ) -> str | dict[str, Any] | None:
        """Run a registered checker only for an explicit caller operation."""

        binding = self.schema(configuration_type)
        model = self._registry.model(binding.configuration_type)
        checker = (
            getattr(model, "check_connection", None) if model is not None else None
        )
        if not binding.connection_check_supported or not callable(checker):
            raise UnsupportedCapability(
                "Connection checking is not supported for this configuration type."
            )
        return checker(settings)


class EliteaSdkToolkitAdapter:
    """Pinned adapter for the current ``toolkit.available_tools`` algorithm.

    Evidence boundary:
    - ``centry/pylon_indexer/plugins/indexer_worker/methods/``
      ``indexer_toolkit_available_tools.py:32-39`` delegates to this SDK API
      and maps an escaping ``Exception`` to the current response shape.
    - ``elitea_sdk/tools/__init__.py:367-400`` owns type normalization,
      enumerator lookup, result values and toolkit error strings.

    This adapter deliberately performs one keyword call and no normalization,
    filtering, retry, caching or result rewrite.
    """

    def __init__(self) -> None:
        # Loading elitea_sdk.tools discovers optional toolkit modules and may
        # print import diagnostics. Keep command/result stdout free of those
        # diagnostics without changing the SDK's discovery semantics.
        with redirect_stdout(sys.stderr):
            module = importlib.import_module("elitea_sdk.tools")
        package_root = Path(module.__file__).resolve().parents[1]
        if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
            raise DependencyUnavailable(
                "The installed Elitea SDK artifact does not match the admitted package tree."
            )
        self._tools_module = module

    def get_toolkit_available_tools(
        self,
        toolkit_type: str,
        settings: dict[str, Any],
    ) -> dict[str, Any]:
        # Business-compatibility boundary: this is exactly the call performed
        # by the current indexer wrapper, exactly once per admitted execution.
        return self._tools_module.get_toolkit_available_tools(
            toolkit_type=toolkit_type,
            settings=settings,
        )


class EliteaSdkIndexingAdapter:
    """Pinned adapter for the current ``index_data`` SDK entrypoint.

    The authorized runtime composition supplies an initialized ``EliteAClient``.
    Client construction and credential redemption are deliberately outside this
    parity kernel. The adapter preserves the current worker's one public SDK
    call without copying its Pylon event, logging or response-cleaning wrapper.
    """

    def __init__(self, client: Any) -> None:
        client_type = _indexing_client_type()
        if not isinstance(client, client_type):
            raise TypeError(
                "client must be an EliteAClient from the admitted SDK artifact"
            )
        self._client = client

    @classmethod
    def from_context(cls, context: EliteaClientContext) -> EliteaSdkIndexingAdapter:
        """Construct one SDK client from claim-scoped in-memory authority."""

        client_type = _indexing_client_type()
        client = client_type(
            project_id=context.project_id,
            base_url=context.base_url,
            auth_token=context.auth_token,
        )
        return cls(client)

    def ingest(
        self,
        *,
        toolkit_config: dict[str, Any],
        tool_params: dict[str, Any],
        runtime_config: dict[str, Any],
        llm_model: str | None,
        llm_config: dict[str, Any],
        mcp_tokens: dict[str, Any] | None,
    ) -> dict[str, Any]:
        # Business-compatibility boundary: exactly the public SDK operation used
        # by the current indexer worker, exactly once per kernel invocation.
        return self._client.test_toolkit_tool(
            toolkit_config=deepcopy(toolkit_config),
            tool_name="index_data",
            tool_params=deepcopy(tool_params),
            runtime_config=runtime_config,
            llm_model=llm_model,
            llm_config=deepcopy(llm_config),
            mcp_tokens=mcp_tokens,
        )


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


@lru_cache(maxsize=1)
def _indexing_client_type() -> type[Any]:
    with redirect_stdout(sys.stderr):
        module = importlib.import_module("elitea_sdk.runtime.clients.client")
    package_root = Path(module.__file__).resolve().parents[2]
    if _package_tree_digest(package_root) != SDK_PACKAGE_TREE_SHA256:
        raise DependencyUnavailable(
            "The installed Elitea SDK artifact does not match the admitted package tree."
        )
    return module.EliteAClient
