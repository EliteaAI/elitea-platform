from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class PredictRequest(_message.Message):
    __slots__ = ("application_id", "project_id", "conversation_id", "message_id", "input", "stream_id", "variables", "auth_context_json")
    class VariablesEntry(_message.Message):
        __slots__ = ("key", "value")
        KEY_FIELD_NUMBER: _ClassVar[int]
        VALUE_FIELD_NUMBER: _ClassVar[int]
        key: str
        value: str
        def __init__(self, key: _Optional[str] = ..., value: _Optional[str] = ...) -> None: ...
    APPLICATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CONVERSATION_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    INPUT_FIELD_NUMBER: _ClassVar[int]
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    VARIABLES_FIELD_NUMBER: _ClassVar[int]
    AUTH_CONTEXT_JSON_FIELD_NUMBER: _ClassVar[int]
    application_id: str
    project_id: str
    conversation_id: str
    message_id: str
    input: str
    stream_id: str
    variables: _containers.ScalarMap[str, str]
    auth_context_json: bytes
    def __init__(self, application_id: _Optional[str] = ..., project_id: _Optional[str] = ..., conversation_id: _Optional[str] = ..., message_id: _Optional[str] = ..., input: _Optional[str] = ..., stream_id: _Optional[str] = ..., variables: _Optional[_Mapping[str, str]] = ..., auth_context_json: _Optional[bytes] = ...) -> None: ...

class StreamChunk(_message.Message):
    __slots__ = ("stream_id", "chunk_type", "content", "metadata_json", "sequence_number")
    class ChunkType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        CHUNK_TYPE_UNSPECIFIED: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_TOKEN: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_TOOL_CALL: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_TOOL_RESULT: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_FINAL: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_ERROR: _ClassVar[StreamChunk.ChunkType]
        CHUNK_TYPE_CHILD_MESSAGE: _ClassVar[StreamChunk.ChunkType]
    CHUNK_TYPE_UNSPECIFIED: StreamChunk.ChunkType
    CHUNK_TYPE_TOKEN: StreamChunk.ChunkType
    CHUNK_TYPE_TOOL_CALL: StreamChunk.ChunkType
    CHUNK_TYPE_TOOL_RESULT: StreamChunk.ChunkType
    CHUNK_TYPE_FINAL: StreamChunk.ChunkType
    CHUNK_TYPE_ERROR: StreamChunk.ChunkType
    CHUNK_TYPE_CHILD_MESSAGE: StreamChunk.ChunkType
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    CHUNK_TYPE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    METADATA_JSON_FIELD_NUMBER: _ClassVar[int]
    SEQUENCE_NUMBER_FIELD_NUMBER: _ClassVar[int]
    stream_id: str
    chunk_type: StreamChunk.ChunkType
    content: str
    metadata_json: str
    sequence_number: int
    def __init__(self, stream_id: _Optional[str] = ..., chunk_type: _Optional[_Union[StreamChunk.ChunkType, str]] = ..., content: _Optional[str] = ..., metadata_json: _Optional[str] = ..., sequence_number: _Optional[int] = ...) -> None: ...

class PredictTask(_message.Message):
    __slots__ = ("task_id", "status", "application_id", "project_id", "created_at", "updated_at", "error_message")
    class TaskStatus(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        TASK_STATUS_UNSPECIFIED: _ClassVar[PredictTask.TaskStatus]
        TASK_STATUS_QUEUED: _ClassVar[PredictTask.TaskStatus]
        TASK_STATUS_RUNNING: _ClassVar[PredictTask.TaskStatus]
        TASK_STATUS_COMPLETED: _ClassVar[PredictTask.TaskStatus]
        TASK_STATUS_FAILED: _ClassVar[PredictTask.TaskStatus]
        TASK_STATUS_CANCELLED: _ClassVar[PredictTask.TaskStatus]
    TASK_STATUS_UNSPECIFIED: PredictTask.TaskStatus
    TASK_STATUS_QUEUED: PredictTask.TaskStatus
    TASK_STATUS_RUNNING: PredictTask.TaskStatus
    TASK_STATUS_COMPLETED: PredictTask.TaskStatus
    TASK_STATUS_FAILED: PredictTask.TaskStatus
    TASK_STATUS_CANCELLED: PredictTask.TaskStatus
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    STATUS_FIELD_NUMBER: _ClassVar[int]
    APPLICATION_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    status: PredictTask.TaskStatus
    application_id: str
    project_id: str
    created_at: int
    updated_at: int
    error_message: str
    def __init__(self, task_id: _Optional[str] = ..., status: _Optional[_Union[PredictTask.TaskStatus, str]] = ..., application_id: _Optional[str] = ..., project_id: _Optional[str] = ..., created_at: _Optional[int] = ..., updated_at: _Optional[int] = ..., error_message: _Optional[str] = ...) -> None: ...
