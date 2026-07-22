"""Bounded synchronous kernel for the current SDK ``index_data`` operation.

This module contains no Pylon task, event or response-wrapper behavior. Input
values have already been fetched through the scoped data plane and remain in
worker memory. The synchronous SDK call cannot be preempted; cancellation waits
for its thread to exit under ``ExecutionSupervisor.run_sync`` semantics.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from elitea.runtime.v1 import node_event_pb2
from langchain_core.callbacks import BaseCallbackHandler

from elitea_worker.agents.sdk_adapter import EliteaSdkIndexingAdapter
from elitea_worker.constants import MAX_SAFE_STRING_BYTES
from elitea_worker.execution.errors import InvalidInput, ResourceExhausted
from elitea_worker.execution.supervisor import ExecutionRunner
from elitea_worker.protocol.node_event import (
    MAX_CURRENT_NODE_EVENT_JSON_BYTES,
    InvalidCurrentNodeEvent,
    decode_current_node_event_json,
)


_CURRENT_INDEX_CUSTOM_EVENTS = {
    "index_data_status": (
        "agent_index_data_status",
        frozenset(
            {
                "id",
                "index_name",
                "state",
                "error",
                "reindex",
                "indexed",
                "updated",
                "created_at",
                "updated_on",
                "toolkit_id",
            }
        ),
    ),
    "index_data_removed": (
        "agent_index_data_removed",
        frozenset({"index_name", "toolkit_id", "project_id"}),
    ),
}


@dataclass(frozen=True, slots=True)
class CurrentIndexNodeEventContext:
    """Current index-status fields derived from the claimed execution."""

    stream_id: str
    task_id: str
    initiator: str
    project_id: int | str
    user_id: int | str
    toolkit_id: int | str | None


class CurrentIndexNodeEventCallback(BaseCallbackHandler):
    """Map current SDK index custom callbacks to bounded ``NodeEventV1``.

    The current Pylon callback also copied the whole materialized toolkit and
    tool-parameter dictionaries into response metadata. Those dictionaries can
    contain redeemed credentials and are not required to identify an index
    status. The language-neutral runtime instead carries the authoritative
    execution, project, user and toolkit identities while the SDK-owned status
    fields remain byte-for-byte JSON values.
    """

    def __init__(
        self,
        context: CurrentIndexNodeEventContext,
        publish: Callable[[node_event_pb2.NodeEventV1], None],
    ) -> None:
        super().__init__()
        self._context = context
        self._publish = publish
        self._failure: Exception | None = None
        self._failure_lock = threading.Lock()

    def on_custom_event(
        self,
        name: str,
        data: Any,
        *,
        run_id: Any,
        tags: list[str] | None = None,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        """Handle the two state-bearing callbacks emitted by index toolkits."""

        _ = tags, kwargs
        selected = _CURRENT_INDEX_CUSTOM_EVENTS.get(name)
        if selected is None:
            return
        try:
            if not isinstance(data, dict):
                raise InvalidInput("The index progress callback is malformed.")
            event_type, fields = selected
            now = datetime.now(tz=timezone.utc).isoformat()
            payload = {
                "name": name,
                "run_id": str(run_id),
                "tool_run_id": str(run_id),
                "metadata": _current_json_value(metadata),
                "datetime": now,
                **{
                    field: _current_json_value(data[field])
                    for field in sorted(fields)
                    if field in data
                },
            }
            if name == "index_data_status":
                payload.update(
                    {
                        "task_id": self._context.task_id,
                        "initiator": self._context.initiator,
                        "project_id": self._context.project_id,
                        "user_id": self._context.user_id,
                    }
                )
            elif "project_id" not in payload:
                payload["project_id"] = self._context.project_id
            if not payload.get("toolkit_id") and self._context.toolkit_id is not None:
                payload["toolkit_id"] = self._context.toolkit_id

            raw = json.dumps(
                {
                    "type": event_type,
                    "stream_id": self._context.stream_id,
                    "content": None,
                    "response_metadata": payload,
                    "references": [],
                    "created_at": now,
                },
                ensure_ascii=False,
                allow_nan=False,
                separators=(",", ":"),
            ).encode("utf-8")
            if len(raw) > MAX_CURRENT_NODE_EVENT_JSON_BYTES:
                raise ResourceExhausted(
                    "The index progress event exceeds the approved output limit."
                )
            try:
                event = decode_current_node_event_json(raw)
            except InvalidCurrentNodeEvent as exc:
                raise InvalidInput("The index progress callback is malformed.") from exc
            self._publish(event)
        except Exception as exc:
            with self._failure_lock:
                if self._failure is None:
                    self._failure = exc
            raise

    def raise_if_failed(self) -> None:
        """Surface callback errors that the synchronous SDK deliberately catches."""

        with self._failure_lock:
            failure = self._failure
        if failure is not None:
            raise failure


def _current_json_value(value: Any) -> Any:
    """Apply the current callback's JSON conversion without allowing NaN."""

    try:
        return json.loads(
            json.dumps(
                value,
                ensure_ascii=False,
                allow_nan=False,
                default=lambda item: str(item),
                separators=(",", ":"),
            )
        )
    except (TypeError, ValueError, UnicodeError, RecursionError) as exc:
        raise InvalidInput("The index progress callback is malformed.") from exc


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
