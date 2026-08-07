"""Current browser-event projection for SDK-owned agent execution.

This callback contains no Pylon transport or database code. It emits the same
``NodeEvent`` shapes used by the current UI; elitea-main persists
``partial_message`` deltas into the existing tenant ``chat_message_trace_step``
table and forwards the live events over SSE.
"""

from __future__ import annotations

import json
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable

from elitea.runtime.v1 import node_event_pb2
from langchain_core.callbacks import BaseCallbackHandler

from elitea_worker.execution.errors import InvalidInput, ResourceExhausted
from elitea_worker.handlers.agent import AgentExecutionPayload
from elitea_worker.protocol.node_event import (
    MAX_CURRENT_NODE_EVENT_JSON_BYTES,
    InvalidCurrentNodeEvent,
    decode_current_node_event_json,
)


_HIERARCHY_KEYS = (
    "parent_agent_name",
    "parent_agent_call_id",
    "parent_agent_path",
    "sibling_ordinal",
    "child_thread_id",
    "thread_id",
    "checkpoint_ns",
    "langgraph_node",
)
_CUSTOM_EVENTS: dict[str, tuple[str, frozenset[str]]] = {
    "on_tool_node": ("agent_on_tool_node", frozenset({"state", "input_variables", "tool_result"})),
    "on_function_tool_node": ("agent_on_function_tool_node", frozenset({"state", "input_variables", "input_mapping", "tool_result"})),
    "on_loop_tool_node": ("agent_on_loop_tool_node", frozenset({"state", "input_variables", "tool_result"})),
    "on_loop_node": ("agent_on_loop_node", frozenset({"state", "input_variables", "accumulated_response"})),
    "on_conditional_edge": ("agent_on_conditional_edge", frozenset({"state", "condition"})),
    "on_decision_edge": ("agent_on_decision_edge", frozenset({"state", "decisional_inputs"})),
    "on_transitional_edge": ("agent_on_transitional_edge", frozenset({"state", "next_step"})),
    "thinking_step": ("agent_thinking_step", frozenset({"message", "tool_name", "toolkit"})),
    "thinking_step_update": ("agent_thinking_step_update", frozenset({"message", "tool_name", "toolkit", "markdown"})),
    "file_modified": ("agent_file_modified", frozenset({"message", "filepath", "tool_name", "toolkit", "operation_type", "meta", "media_type"})),
    "index_data_status": ("agent_index_data_status", frozenset({"id", "index_name", "state", "error", "reindex", "indexed", "updated", "created_at", "updated_on", "toolkit_id"})),
    "index_data_removed": ("agent_index_data_removed", frozenset({"index_name", "toolkit_id", "project_id"})),
    "mcp_authorization_required": ("mcp_authorization_required", frozenset({"server_url", "resource_metadata_url", "www_authenticate", "resource_metadata", "authorization_servers", "tool_run_id", "tool_name", "toolkit_name", "toolkit_type"})),
    "swarm_agent_start": ("agent_swarm_agent_start", frozenset({"agent_name", "is_parent", "message_count"})),
    "swarm_agent_response": ("agent_swarm_agent_response", frozenset({"agent_name", "is_parent", "content", "has_tool_calls", "tool_calls"})),
    "swarm_handoff": ("agent_swarm_handoff", frozenset({"from_agent", "to_agent"})),
}
_MAX_TRACE_TEXT_BYTES = 128 * 1024
_CUSTOM_STATE_TRANSCRIPT_FIELDS = ("messages", "chat_history")


def _normalize_hitl_pause(
    result: dict[str, Any],
    *,
    execution_id: str,
) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
    """Preserve the current singular/plural HITL result contract.

    Sensitive-tool interrupts already carry the SDK-owned interrupt identity.
    A pipeline ``HITLNode`` exposes the same pause contract without an
    ``interrupt_id``.  One worker execution can settle at only one sequential
    terminal pause, so its durable execution identity is the stable fallback:
    command redelivery keeps the same card identity while a later continuation
    execution receives a new one.
    """

    raw_singular = result.get("hitl_interrupt")
    if raw_singular is not None and not isinstance(raw_singular, dict):
        raise InvalidInput("The agent HITL interrupt is malformed.")
    singular = dict(raw_singular) if raw_singular is not None else None
    raw_plural = result.get("hitl_interrupts")
    if raw_plural is None:
        plural: list[dict[str, Any]] = []
    elif isinstance(raw_plural, list) and all(
        isinstance(item, dict) for item in raw_plural
    ):
        plural = [dict(item) for item in raw_plural]
    else:
        raise InvalidInput("The agent HITL interrupt list is malformed.")
    if not plural and singular is not None:
        plural = [singular]
    if singular is None and plural:
        singular = dict(plural[0])

    if singular is not None and len(plural) == 1:
        interrupt_id = singular.get("interrupt_id") or plural[0].get(
            "interrupt_id"
        )
        if not isinstance(interrupt_id, str) or not interrupt_id:
            if not execution_id:
                raise InvalidInput(
                    "The agent HITL interrupt identity is unavailable."
                )
            interrupt_id = execution_id
        singular["interrupt_id"] = interrupt_id
        plural[0]["interrupt_id"] = interrupt_id
    return singular, plural


@dataclass(frozen=True, slots=True)
class CurrentAgentNodeEventContext:
    execution_id: str
    stream_id: str
    message_id: str
    execution_generation: str
    sio_event: str
    thread_id: str
    project_id: int | str
    chat_project_id: int | str


class CurrentAgentNodeEventCallback(BaseCallbackHandler):
    """Project LangChain callbacks to bounded current UI and trace deltas."""

    def __init__(
        self,
        context: CurrentAgentNodeEventContext,
        publish: Callable[[node_event_pb2.NodeEventV1], None],
    ) -> None:
        super().__init__()
        self.raise_error = True
        self._context = context
        self._publish = publish
        self._failure: Exception | None = None
        self._lock = threading.Lock()
        self._tools: dict[str, dict[str, Any]] = {}
        self._llm: dict[str, dict[str, Any]] = {}
        self._last_content: dict[str, str] = {}
        self._last_thinking: dict[str, str] = {}

    def emit_agent_start(self, *, invoked_skills: list[Any] | None = None) -> None:
        self._emit("agent_start", response_metadata={"invoked_skills": invoked_skills or []})

    def emit_terminal(
        self,
        result: dict[str, Any],
        payload: AgentExecutionPayload,
    ) -> node_event_pb2.NodeEventV1:
        """Emit exactly one current terminal outcome for a completed or HITL run."""

        hitl_interrupt, hitl_interrupts = _normalize_hitl_pause(
            result,
            execution_id=self._context.execution_id,
        )
        if hitl_interrupt is not None:
            thread_id = result.get("thread_id")
            if not isinstance(thread_id, str) or not thread_id:
                thread_id = self._context.thread_id
            message = hitl_interrupt.get("message")
            if not isinstance(message, str) or not message:
                message = "Awaiting human review..."
            return self._emit(
                "agent_hitl_interrupt",
                content=message,
                response_metadata={
                    "thread_id": thread_id,
                    "chat_project_id": self._context.chat_project_id,
                    "message": message,
                    "hitl_interrupt": _json_value(hitl_interrupt),
                    "hitl_interrupts": _json_value(hitl_interrupts),
                    "node_name": _json_value(hitl_interrupt.get("node_name")),
                    "available_actions": _json_value(
                        hitl_interrupt.get("available_actions", [])
                    ),
                    "routes": _json_value(hitl_interrupt.get("routes", {})),
                    "edit_state_key": _json_value(
                        hitl_interrupt.get("edit_state_key")
                    ),
                },
            )

        if result.get("paused") is True:
            raise InvalidInput("The paused agent result has no supported interrupt.")

        content = _extract_response_content(result)
        thread_id = result.get("thread_id")
        if not isinstance(thread_id, str) or not thread_id:
            thread_id = self._context.thread_id
        if result.get("execution_finished") is True:
            self._emit(
                "pipeline_finish",
                content=content,
                response_metadata={
                    "finish_reason": "finished",
                    "next_step": "END",
                    "thread_id": thread_id,
                },
            )
        self._emit(
            "agent_response",
            content=content,
            response_metadata={"finish_reason": "stop", "thread_id": thread_id},
        )
        return self._emit(
            "full_message",
            content=content,
            response_metadata={
                "project_id": self._context.project_id,
                "chat_project_id": self._context.chat_project_id,
                "application_details": _json_value(payload.application),
                "thread_id": thread_id,
                "llm_start_timestamp": None,
                "additional_response_meta": {},
                "files_modified": [],
                "image_thumbnails": {},
                "index_statuses": {},
                "chat_history_tokens_input": 0,
                "llm_response_tokens_output": 0,
                "should_continue": payload.should_continue,
                "hitl_resume": payload.hitl_resume,
                "parallel_reconcile": bool(payload.parallel_reconcile),
                "context_info": _json_value(result.get("context_info")),
                "invoked_skills": _json_value(payload.invoked_skills),
            },
        )

    def emit_completion(
        self,
        result: dict[str, Any],
        payload: AgentExecutionPayload,
    ) -> node_event_pb2.NodeEventV1:
        """Compatibility alias for callers that still expect a completed result."""

        terminal = self.emit_terminal(result, payload)
        if terminal.type != "full_message":
            raise InvalidInput("The agent execution did not complete.")
        return terminal

    def on_tool_start(
        self,
        serialized: dict[str, Any],
        input_str: str,
        *,
        run_id: Any,
        metadata: dict[str, Any] | None = None,
        inputs: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        _ = input_str, kwargs
        self._guard(self._tool_start, serialized, run_id, metadata, inputs)

    def _tool_start(self, serialized, run_id, metadata, inputs) -> None:
        selected = _run_id(run_id)
        now = _now()
        tool_name = _bounded_text(serialized.get("name"), "tool")
        hierarchy = _hierarchy(metadata)
        tool_meta = {
            "name": tool_name,
            "metadata": {
                **_tool_display_metadata(serialized, metadata),
                **hierarchy,
            },
        }
        entry = {
            "tool_name": tool_name,
            "tool_run_id": selected,
            "run_id": selected,
            "tool_meta": tool_meta,
            "tool_inputs": _json_value(inputs),
            "metadata": {**_tool_display_metadata(serialized, metadata), **hierarchy},
            "timestamp_start": now,
            "timestamp_finish": None,
            "finish_reason": None,
            "tool_output": None,
            "error": None,
        }
        with self._lock:
            self._tools[selected] = entry
        self._emit("agent_tool_start", response_metadata=entry)
        self._emit_partial(tool_calls={selected: entry})

    def on_tool_end(self, output: Any, *, run_id: Any, **kwargs: Any) -> None:
        _ = kwargs
        self._guard(self._tool_finish, run_id, output, False)

    def on_tool_error(self, error: BaseException, *, run_id: Any, **kwargs: Any) -> None:
        _ = kwargs
        self._guard(self._tool_finish, run_id, error, True)

    def _tool_finish(self, run_id: Any, value: Any, failed: bool) -> None:
        selected = _run_id(run_id)
        with self._lock:
            previous = self._tools.get(selected)
            if previous is None:
                return
            entry = dict(previous)
            entry["timestamp_finish"] = _now()
            entry["finish_reason"] = "error" if failed else "stop"
            entry["tool_output"] = None if failed else _trace_text(value)
            entry["error"] = _trace_text(value) if failed else None
            self._tools[selected] = entry
        self._emit(
            "agent_tool_error" if failed else "agent_tool_end",
            # Successful tool output already has one established owner in
            # response_metadata.tool_output. Duplicating the same potentially
            # large value into content made a 51 KiB current Aha result exceed
            # the 64 KiB data-plane frame even though the control plane held
            # only references. Errors retain content for the existing error UI.
            content=entry["error"] if failed else None,
            response_metadata=entry,
        )
        self._emit_partial(tool_calls={selected: entry})

    def on_llm_start(
        self,
        serialized: dict[str, Any],
        prompts: list[str],
        *,
        run_id: Any,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        _ = prompts, kwargs
        self._guard(self._llm_start, serialized, run_id, metadata)

    def on_chat_model_start(self, serialized, messages, *, run_id, metadata=None, **kwargs):
        _ = messages, kwargs
        self._guard(self._llm_start, serialized, run_id, metadata)

    def _llm_start(self, serialized, run_id, metadata) -> None:
        selected = _run_id(run_id)
        now = _now()
        model = _model_name(serialized, metadata)
        hierarchy = _hierarchy(metadata)
        state = {"timestamp_start": now, "model_name": model, **hierarchy}
        with self._lock:
            self._llm[selected] = state
        self._emit(
            "agent_llm_start",
            response_metadata={
                "tool_name": hierarchy.get("langgraph_node") or "Thinking step",
                "tool_run_id": selected,
                "metadata": {"ls_model_name": model, **hierarchy},
                **state,
            },
        )

    def on_llm_new_token(self, token: str, *, run_id: Any, chunk: Any = None, **kwargs: Any) -> None:
        _ = kwargs
        self._guard(self._llm_chunk, token, run_id, chunk)

    def _llm_chunk(self, token: str, run_id: Any, chunk: Any) -> None:
        selected = _run_id(run_id)
        content, thinking = _chunk_values(token, chunk)
        content = _delta(content, self._last_content.get(selected, ""))
        thinking = _delta(thinking, self._last_thinking.get(selected, ""))
        if content:
            self._last_content[selected] = self._last_content.get(selected, "") + content
        if thinking:
            self._last_thinking[selected] = self._last_thinking.get(selected, "") + thinking
        if not content and not thinking:
            return
        self._emit(
            "agent_llm_chunk",
            content=content or None,
            thinking=thinking or None,
            response_metadata={"tool_run_id": selected},
        )

    def on_llm_end(self, response: Any, *, run_id: Any, **kwargs: Any) -> None:
        _ = kwargs
        self._guard(self._llm_end, response, run_id)

    def _llm_end(self, response: Any, run_id: Any) -> None:
        selected = _run_id(run_id)
        with self._lock:
            state = dict(self._llm.pop(selected, {}))
        step = _thinking_step(response, selected, state)
        self._emit(
            "agent_llm_end",
            response_metadata={"tool_run_id": selected, "thinking_steps": [step]},
        )
        self._emit_partial(thinking_steps=[step])

    def on_custom_event(
        self,
        name: str,
        data: Any,
        *,
        run_id: Any,
        metadata: dict[str, Any] | None = None,
        **kwargs: Any,
    ) -> None:
        _ = kwargs
        self._guard(self._custom_event, name, data, run_id, metadata)

    def _custom_event(self, name, data, run_id, metadata) -> None:
        selected = _CUSTOM_EVENTS.get(name)
        if selected is None:
            return
        if not isinstance(data, dict):
            raise InvalidInput("The agent custom event is malformed.")
        event_type, fields = selected
        payload = {
            "name": name,
            "run_id": _run_id(run_id),
            "tool_run_id": _run_id(run_id),
            "metadata": _hierarchy(metadata),
            "datetime": _now(),
            **{key: _json_value(data[key]) for key in sorted(fields) if key in data},
        }
        if event_type == "agent_swarm_agent_response":
            payload["chat_project_id"] = self._context.chat_project_id
        payload = self._bounded_custom_event_payload(event_type, payload)
        self._emit(event_type, response_metadata=payload)

    def _bounded_custom_event_payload(
        self,
        event_type: str,
        payload: dict[str, Any],
    ) -> dict[str, Any]:
        """Drop only redundant transcript copies from an oversized SDK event.

        The current SDK includes its accumulated ``messages`` state in graph
        transition events. Tool output already has an authoritative owner in
        ``agent_tool_end``/``partial_message``; copying the entire transcript
        again makes later turns grow without bound and defers a callback
        failure until otherwise-successful agent finalization. Preserve the
        remaining pipeline state byte-for-byte and mark the omitted duplicate
        fields so consumers can distinguish a bounded projection.
        """

        if len(self._event_json(event_type, response_metadata=payload)) <= (
            MAX_CURRENT_NODE_EVENT_JSON_BYTES
        ):
            return payload
        state = payload.get("state")
        if not isinstance(state, dict):
            return payload
        projected_state = dict(state)
        omitted = [
            field
            for field in _CUSTOM_STATE_TRANSCRIPT_FIELDS
            if field in projected_state
        ]
        if not omitted:
            return payload
        for field in omitted:
            projected_state.pop(field, None)
        projected = dict(payload)
        projected["state"] = projected_state
        projected["state_projection"] = {
            "omitted_duplicate_fields": omitted,
        }
        return projected

    def _emit_partial(
        self,
        *,
        tool_calls: dict[str, Any] | None = None,
        thinking_steps: list[Any] | None = None,
    ) -> None:
        self._emit(
            "partial_message",
            response_metadata={
                "project_id": self._context.project_id,
                "chat_project_id": self._context.chat_project_id,
                "thread_id": self._context.thread_id,
                "thinking_steps": thinking_steps or [],
                "tool_calls": tool_calls or {},
                "additional_response_meta": {},
            },
        )

    def _emit(
        self,
        event_type: str,
        *,
        content: Any = None,
        thinking: str | None = None,
        response_metadata: dict[str, Any] | None = None,
    ) -> node_event_pb2.NodeEventV1:
        raw = self._event_json(
            event_type,
            content=content,
            thinking=thinking,
            response_metadata=response_metadata,
        )
        if len(raw) > MAX_CURRENT_NODE_EVENT_JSON_BYTES:
            raise ResourceExhausted("The agent event exceeds its output limit.")
        try:
            event = decode_current_node_event_json(raw)
        except InvalidCurrentNodeEvent as exc:
            raise InvalidInput("The agent event is malformed.") from exc
        self._publish(event)
        return event

    def _event_json(
        self,
        event_type: str,
        *,
        content: Any = None,
        thinking: str | None = None,
        response_metadata: dict[str, Any] | None = None,
    ) -> bytes:
        return json.dumps(
            {
                "type": event_type,
                "stream_id": self._context.stream_id,
                "message_id": self._context.message_id,
                "content": content,
                "thinking": thinking,
                "response_metadata": response_metadata or {},
                "references": [],
                "sio_event": self._context.sio_event,
                "created_at": _now(),
                "execution_generation": self._context.execution_generation,
            },
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")

    def _guard(self, function, *args) -> None:
        try:
            function(*args)
        except Exception as exc:
            with self._lock:
                if self._failure is None:
                    self._failure = exc
            raise

    def raise_if_failed(self) -> None:
        with self._lock:
            failure = self._failure
        if failure is not None:
            raise failure


def _thinking_step(response: Any, run_id: str, state: dict[str, Any]) -> dict[str, Any]:
    generation = None
    generations = getattr(response, "generations", None)
    if isinstance(generations, list) and generations and isinstance(generations[0], list) and generations[0]:
        generation = generations[0][-1]
    dumped = generation.model_dump() if generation is not None and callable(getattr(generation, "model_dump", None)) else {}
    message = dumped.get("message") if isinstance(dumped.get("message"), dict) else {}
    text, thinking = _message_values(message, dumped.get("text"))
    if not text:
        # Current agent callbacks keep tool-call-only model turns visible as an
        # LLM activity chip. Preserve that outcome without duplicating tool
        # arguments into the thinking-step/output stream; agent_tool_start owns
        # the typed inputs and their independent size/security boundary.
        text = _tool_call_decision_text(message)
    hierarchy = {key: state[key] for key in _HIERARCHY_KEYS if key in state}
    response_metadata = {
        "model_name": state.get("model_name"),
        "tool_name": hierarchy.get("langgraph_node"),
        "metadata": hierarchy,
    }
    return {
        "tool_run_id": run_id,
        "type": dumped.get("type") or "ChatGeneration",
        "text": _trace_text(text),
        "thinking": _trace_text(thinking),
        "timestamp_start": state.get("timestamp_start"),
        "timestamp_finish": _now(),
        "message": {"response_metadata": response_metadata},
        **hierarchy,
    }


def _extract_response_content(response: dict[str, Any]) -> str:
    """Preserve the current worker's standardized-output then messages fallback."""

    content = response.get("output", "")
    if not content:
        messages = response.get("messages")
        if isinstance(messages, list) and messages:
            last = messages[-1]
            if isinstance(last, dict):
                content = last.get("content", "")
            else:
                content = getattr(last, "content", str(last))
    return _normalize_response_content(content)


def _normalize_response_content(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        stripped = content.strip()
        if stripped.startswith("[") and "tool_use" in stripped:
            try:
                parsed = json.loads(stripped)
            except json.JSONDecodeError:
                return content
            if isinstance(parsed, list):
                return _normalize_response_content(parsed)
        return content
    if isinstance(content, list):
        text_parts: list[str] = []
        has_only_tool_blocks = True
        for block in content:
            if isinstance(block, dict):
                if block.get("type") == "text":
                    text_parts.append(str(block.get("text", "")))
                    has_only_tool_blocks = False
                elif "text" in block and "type" not in block:
                    text_parts.append(str(block.get("text", "")))
                    has_only_tool_blocks = False
                elif block.get("type") in {"tool_use", "tool_result", "thinking"}:
                    continue
                else:
                    text_parts.append(json.dumps(block, ensure_ascii=False))
                    has_only_tool_blocks = False
            elif isinstance(block, str):
                text_parts.append(block)
                has_only_tool_blocks = False
            else:
                text_parts.append(str(block))
                has_only_tool_blocks = False
        if has_only_tool_blocks and not text_parts:
            return ""
        return "".join(text_parts)
    return json.dumps(content, ensure_ascii=False)


def _message_values(message: dict[str, Any], fallback: Any = None) -> tuple[str, str]:
    text_parts: list[str] = []
    thinking_parts: list[str] = []
    content = message.get("content", fallback)
    if isinstance(content, str):
        text_parts.append(content)
    elif isinstance(content, list):
        for item in content:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                text_parts.append(item["text"])
            if item.get("type") in {"thinking", "reasoning"}:
                value = item.get("thinking") or item.get("reasoning")
                if isinstance(value, str):
                    thinking_parts.append(value)
    additional = message.get("additional_kwargs")
    if isinstance(additional, dict) and isinstance(additional.get("thinking"), str):
        thinking_parts.append(additional["thinking"])
    return "\n".join(text_parts), "\n".join(thinking_parts)


def _tool_call_decision_text(message: dict[str, Any]) -> str:
    calls: Any = None
    additional = message.get("additional_kwargs")
    if isinstance(additional, dict):
        calls = additional.get("tool_calls")
    if not isinstance(calls, list):
        calls = message.get("tool_calls")
    if not isinstance(calls, list):
        return ""

    decisions: list[str] = []
    for call in calls:
        if not isinstance(call, dict):
            continue
        function = call.get("function")
        name = function.get("name") if isinstance(function, dict) else call.get("name")
        if isinstance(name, str) and name:
            decisions.append(f"Planned to call tool '{_bounded_text(name, 'tool')}'")
    return "\n".join(decisions)


def _chunk_values(token: Any, chunk: Any) -> tuple[str, str]:
    content = token if isinstance(token, str) else ""
    thinking = ""
    if chunk is not None:
        text = getattr(chunk, "text", None)
        if isinstance(text, str) and text:
            content = text
        message = getattr(chunk, "message", None)
        additional = getattr(message, "additional_kwargs", None)
        if isinstance(additional, dict) and isinstance(additional.get("thinking"), str):
            thinking = additional["thinking"]
    return content, thinking


def _delta(value: str, previous: str) -> str:
    if not value:
        return ""
    return value[len(previous) :] if previous and value.startswith(previous) else value


def _hierarchy(metadata: Any) -> dict[str, Any]:
    if not isinstance(metadata, dict):
        return {}
    return {key: _json_value(metadata[key]) for key in _HIERARCHY_KEYS if key in metadata}


def _tool_display_metadata(serialized: Any, metadata: Any) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for source in (serialized.get("metadata") if isinstance(serialized, dict) else None, metadata):
        if not isinstance(source, dict):
            continue
        for key in ("display_name", "toolkit_name", "toolkit_type", "agent_type", "original_name"):
            if key in source:
                result[key] = _json_value(source[key])
    return result


def _model_name(serialized: Any, metadata: Any) -> str:
    if isinstance(metadata, dict):
        for key in ("ls_model_name", "model_name"):
            if isinstance(metadata.get(key), str) and metadata[key]:
                return _bounded_text(metadata[key], "model")
    if isinstance(serialized, dict) and isinstance(serialized.get("name"), str):
        return _bounded_text(serialized["name"], "model")
    return "model"


def _run_id(value: Any) -> str:
    selected = str(value)
    if not selected or len(selected.encode("utf-8")) > 512 or any(c in selected for c in "\x00\r\n"):
        raise InvalidInput("The agent callback run identity is malformed.")
    return selected


def _bounded_text(value: Any, fallback: str) -> str:
    if isinstance(value, str) and value and len(value.encode("utf-8")) <= 2048:
        return value
    return fallback


def _trace_text(value: Any) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        try:
            value = json.dumps(_json_value(value), ensure_ascii=False, separators=(",", ":"))
        except (TypeError, ValueError):
            value = str(value)
    encoded = value.encode("utf-8", errors="replace")
    if len(encoded) > _MAX_TRACE_TEXT_BYTES:
        encoded = encoded[:_MAX_TRACE_TEXT_BYTES]
        value = encoded.decode("utf-8", errors="ignore")
    return value


def _json_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 8:
        return None
    if value is None or isinstance(value, (str, int, bool)):
        return value
    if isinstance(value, float):
        return value if value == value and abs(value) != float("inf") else None
    if isinstance(value, dict):
        return {str(key): _json_value(item, depth=depth + 1) for key, item in list(value.items())[:256]}
    if isinstance(value, (list, tuple)):
        return [_json_value(item, depth=depth + 1) for item in value[:256]]
    return str(value)


def _now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()
