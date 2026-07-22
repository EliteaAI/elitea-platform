"""Bounded synchronous kernel for the current SDK ``index_data`` operation.

This module contains no Pylon task, event or response-wrapper behavior. Input
values have already been fetched through the scoped data plane and remain in
worker memory. The synchronous SDK call cannot be preempted; cancellation waits
for its thread to exit under ``ExecutionSupervisor.run_sync`` semantics.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from elitea_worker.agents.sdk_adapter import EliteaSdkIndexingAdapter
from elitea_worker.constants import MAX_SAFE_STRING_BYTES
from elitea_worker.execution.errors import InvalidInput
from elitea_worker.execution.supervisor import ExecutionRunner


@dataclass(frozen=True, slots=True)
class IndexIngestInputBinding:
    entry_id: str
    immutable_version: str
    content_digest: bytes


@dataclass(frozen=True, slots=True)
class ResolvedIndexIngestInput:
    binding: IndexIngestInputBinding
    value: Any


@dataclass(frozen=True, slots=True)
class IndexIngestRequest:
    input_bundle_id: str
    input_bundle_digest: bytes
    toolkit_configuration: ResolvedIndexIngestInput
    tool_parameters: ResolvedIndexIngestInput
    llm_model: ResolvedIndexIngestInput | None
    llm_configuration: ResolvedIndexIngestInput | None
    mcp_tokens: ResolvedIndexIngestInput | None
    runtime_config: dict[str, Any]


@dataclass(frozen=True, slots=True)
class IndexIngestResult:
    """Trusted-memory SDK result plus immutable input bindings.

    ``sdk_result`` can contain protected values inherited from the current SDK
    response and must not be serialized directly. A later output composer owns
    the reviewed current-response projection and artifact persistence.
    """

    input_bundle_id: str
    input_bundle_digest: bytes
    toolkit_configuration: IndexIngestInputBinding
    tool_parameters: IndexIngestInputBinding
    llm_model: IndexIngestInputBinding | None
    llm_configuration: IndexIngestInputBinding | None
    mcp_tokens: IndexIngestInputBinding | None
    sdk_result: dict[str, Any]


class IndexIngestHandler:
    """Invoke the current synchronous SDK business method through one bound.

    One admitted kernel invocation makes one SDK call. Redis redelivery can run
    a later invocation again; this class makes no exactly-once-effect claim.
    """

    def __init__(
        self,
        sdk: EliteaSdkIndexingAdapter,
        supervisor: ExecutionRunner,
    ) -> None:
        self._sdk = sdk
        self._supervisor = supervisor

    async def execute(self, request: IndexIngestRequest) -> IndexIngestResult:
        _validate_request(request)
        llm_configuration = _optional_value(request.llm_configuration) or {}
        sdk_result = await self._supervisor.run_sync(
            self._sdk.ingest,
            toolkit_config=request.toolkit_configuration.value,
            tool_params=request.tool_parameters.value,
            runtime_config=request.runtime_config,
            llm_model=_effective_llm_model(request.llm_model, llm_configuration),
            # The current wrapper uses kwargs.get("llm_settings", {}), so an
            # absent reference maps to an empty dict rather than None.
            llm_config=llm_configuration,
            mcp_tokens=_optional_value(request.mcp_tokens),
        )
        return IndexIngestResult(
            input_bundle_id=request.input_bundle_id,
            input_bundle_digest=request.input_bundle_digest,
            toolkit_configuration=request.toolkit_configuration.binding,
            tool_parameters=request.tool_parameters.binding,
            llm_model=_optional_binding(request.llm_model),
            llm_configuration=_optional_binding(request.llm_configuration),
            mcp_tokens=_optional_binding(request.mcp_tokens),
            sdk_result=sdk_result,
        )


def _validate_request(request: IndexIngestRequest) -> None:
    if (
        not _valid_text(request.input_bundle_id)
        or not isinstance(request.input_bundle_digest, bytes)
        or len(request.input_bundle_digest) != 32
    ):
        raise InvalidInput()
    required = (request.toolkit_configuration, request.tool_parameters)
    optional = (request.llm_model, request.llm_configuration, request.mcp_tokens)
    if any(not _valid_binding(item.binding) for item in required):
        raise InvalidInput()
    if any(
        item is not None and not _valid_binding(item.binding) for item in optional
    ):
        raise InvalidInput()
    if (
        not isinstance(request.toolkit_configuration.value, dict)
        or not request.toolkit_configuration.value
    ):
        raise InvalidInput()
    if not isinstance(request.tool_parameters.value, dict):
        raise InvalidInput()
    if request.llm_model is not None and not isinstance(request.llm_model.value, str):
        raise InvalidInput()
    if request.llm_configuration is not None and not isinstance(
        request.llm_configuration.value, dict
    ):
        raise InvalidInput()
    if request.mcp_tokens is not None and not isinstance(
        request.mcp_tokens.value, dict
    ):
        raise InvalidInput()
    if not isinstance(request.runtime_config, dict):
        raise InvalidInput()


def _valid_binding(binding: IndexIngestInputBinding) -> bool:
    return bool(
        _valid_text(binding.entry_id)
        and _valid_text(binding.immutable_version)
        and isinstance(binding.content_digest, bytes)
        and len(binding.content_digest) == 32
    )


def _valid_text(value: object) -> bool:
    if not isinstance(value, str) or not value:
        return False
    try:
        return len(value.encode("utf-8")) <= MAX_SAFE_STRING_BYTES
    except UnicodeEncodeError:
        return False


def _optional_value(value: ResolvedIndexIngestInput | None) -> Any:
    return None if value is None else value.value


def _optional_binding(
    value: ResolvedIndexIngestInput | None,
) -> IndexIngestInputBinding | None:
    return None if value is None else value.binding


def _effective_llm_model(
    value: ResolvedIndexIngestInput | None,
    llm_configuration: dict[str, Any],
) -> str | None:
    model = _optional_value(value)
    if not model:
        model = llm_configuration.get("model_name")
    if model is not None and not isinstance(model, str):
        raise InvalidInput()
    return model
