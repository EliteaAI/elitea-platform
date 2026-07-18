from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ChatCompletionsRequest(_message.Message):
    __slots__ = ("project_id", "model", "messages", "stream", "temperature", "max_tokens", "top_p", "extra_params_json", "request_id")
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    MESSAGES_FIELD_NUMBER: _ClassVar[int]
    STREAM_FIELD_NUMBER: _ClassVar[int]
    TEMPERATURE_FIELD_NUMBER: _ClassVar[int]
    MAX_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOP_P_FIELD_NUMBER: _ClassVar[int]
    EXTRA_PARAMS_JSON_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    project_id: str
    model: str
    messages: _containers.RepeatedCompositeFieldContainer[ChatMessage]
    stream: bool
    temperature: float
    max_tokens: int
    top_p: float
    extra_params_json: str
    request_id: str
    def __init__(self, project_id: _Optional[str] = ..., model: _Optional[str] = ..., messages: _Optional[_Iterable[_Union[ChatMessage, _Mapping]]] = ..., stream: _Optional[bool] = ..., temperature: _Optional[float] = ..., max_tokens: _Optional[int] = ..., top_p: _Optional[float] = ..., extra_params_json: _Optional[str] = ..., request_id: _Optional[str] = ...) -> None: ...

class ChatMessage(_message.Message):
    __slots__ = ("role", "content", "name", "tool_call_id")
    ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    NAME_FIELD_NUMBER: _ClassVar[int]
    TOOL_CALL_ID_FIELD_NUMBER: _ClassVar[int]
    role: str
    content: str
    name: str
    tool_call_id: str
    def __init__(self, role: _Optional[str] = ..., content: _Optional[str] = ..., name: _Optional[str] = ..., tool_call_id: _Optional[str] = ...) -> None: ...

class ChatCompletionsChunk(_message.Message):
    __slots__ = ("id", "delta_content", "finish_reason", "usage", "model")
    ID_FIELD_NUMBER: _ClassVar[int]
    DELTA_CONTENT_FIELD_NUMBER: _ClassVar[int]
    FINISH_REASON_FIELD_NUMBER: _ClassVar[int]
    USAGE_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    id: str
    delta_content: str
    finish_reason: str
    usage: TokenUsage
    model: str
    def __init__(self, id: _Optional[str] = ..., delta_content: _Optional[str] = ..., finish_reason: _Optional[str] = ..., usage: _Optional[_Union[TokenUsage, _Mapping]] = ..., model: _Optional[str] = ...) -> None: ...

class TokenUsage(_message.Message):
    __slots__ = ("prompt_tokens", "completion_tokens", "total_tokens")
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    def __init__(self, prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ...) -> None: ...

class ListModelsRequest(_message.Message):
    __slots__ = ("project_id",)
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    project_id: str
    def __init__(self, project_id: _Optional[str] = ...) -> None: ...

class ListModelsResponse(_message.Message):
    __slots__ = ("models",)
    MODELS_FIELD_NUMBER: _ClassVar[int]
    models: _containers.RepeatedCompositeFieldContainer[ModelInfo]
    def __init__(self, models: _Optional[_Iterable[_Union[ModelInfo, _Mapping]]] = ...) -> None: ...

class ModelInfo(_message.Message):
    __slots__ = ("model_id", "display_name", "provider", "context_window_tokens", "supports_streaming")
    MODEL_ID_FIELD_NUMBER: _ClassVar[int]
    DISPLAY_NAME_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_WINDOW_TOKENS_FIELD_NUMBER: _ClassVar[int]
    SUPPORTS_STREAMING_FIELD_NUMBER: _ClassVar[int]
    model_id: str
    display_name: str
    provider: str
    context_window_tokens: int
    supports_streaming: bool
    def __init__(self, model_id: _Optional[str] = ..., display_name: _Optional[str] = ..., provider: _Optional[str] = ..., context_window_tokens: _Optional[int] = ..., supports_streaming: _Optional[bool] = ...) -> None: ...

class HealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthResponse(_message.Message):
    __slots__ = ("status",)
    STATUS_FIELD_NUMBER: _ClassVar[int]
    status: str
    def __init__(self, status: _Optional[str] = ...) -> None: ...
