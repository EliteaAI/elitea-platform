from elitea.core.v1 import predict_pb2 as _predict_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SubmitAgentTaskRequest(_message.Message):
    __slots__ = ("predict", "priority")
    PREDICT_FIELD_NUMBER: _ClassVar[int]
    PRIORITY_FIELD_NUMBER: _ClassVar[int]
    predict: _predict_pb2.PredictRequest
    priority: int
    def __init__(self, predict: _Optional[_Union[_predict_pb2.PredictRequest, _Mapping]] = ..., priority: _Optional[int] = ...) -> None: ...

class SubmitIndexTaskRequest(_message.Message):
    __slots__ = ("datasource_id", "project_id", "collection_id", "mode", "config_json")
    class IndexMode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        INDEX_MODE_UNSPECIFIED: _ClassVar[SubmitIndexTaskRequest.IndexMode]
        INDEX_MODE_FULL: _ClassVar[SubmitIndexTaskRequest.IndexMode]
        INDEX_MODE_INCREMENTAL: _ClassVar[SubmitIndexTaskRequest.IndexMode]
    INDEX_MODE_UNSPECIFIED: SubmitIndexTaskRequest.IndexMode
    INDEX_MODE_FULL: SubmitIndexTaskRequest.IndexMode
    INDEX_MODE_INCREMENTAL: SubmitIndexTaskRequest.IndexMode
    DATASOURCE_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    COLLECTION_ID_FIELD_NUMBER: _ClassVar[int]
    MODE_FIELD_NUMBER: _ClassVar[int]
    CONFIG_JSON_FIELD_NUMBER: _ClassVar[int]
    datasource_id: str
    project_id: str
    collection_id: str
    mode: SubmitIndexTaskRequest.IndexMode
    config_json: str
    def __init__(self, datasource_id: _Optional[str] = ..., project_id: _Optional[str] = ..., collection_id: _Optional[str] = ..., mode: _Optional[_Union[SubmitIndexTaskRequest.IndexMode, str]] = ..., config_json: _Optional[str] = ...) -> None: ...

class SubmitTaskResponse(_message.Message):
    __slots__ = ("task_id", "queued_at")
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    QUEUED_AT_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    queued_at: int
    def __init__(self, task_id: _Optional[str] = ..., queued_at: _Optional[int] = ...) -> None: ...

class StreamTaskRequest(_message.Message):
    __slots__ = ("task_id", "resume_from_sequence")
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    RESUME_FROM_SEQUENCE_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    resume_from_sequence: int
    def __init__(self, task_id: _Optional[str] = ..., resume_from_sequence: _Optional[int] = ...) -> None: ...

class AgentTaskEvent(_message.Message):
    __slots__ = ("chunk", "task")
    CHUNK_FIELD_NUMBER: _ClassVar[int]
    TASK_FIELD_NUMBER: _ClassVar[int]
    chunk: _predict_pb2.StreamChunk
    task: _predict_pb2.PredictTask
    def __init__(self, chunk: _Optional[_Union[_predict_pb2.StreamChunk, _Mapping]] = ..., task: _Optional[_Union[_predict_pb2.PredictTask, _Mapping]] = ...) -> None: ...

class IndexTaskEvent(_message.Message):
    __slots__ = ("task_id", "event_type", "documents_indexed", "documents_total", "error_message")
    class IndexEventType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        INDEX_EVENT_TYPE_UNSPECIFIED: _ClassVar[IndexTaskEvent.IndexEventType]
        INDEX_EVENT_TYPE_PROGRESS: _ClassVar[IndexTaskEvent.IndexEventType]
        INDEX_EVENT_TYPE_COMPLETED: _ClassVar[IndexTaskEvent.IndexEventType]
        INDEX_EVENT_TYPE_FAILED: _ClassVar[IndexTaskEvent.IndexEventType]
    INDEX_EVENT_TYPE_UNSPECIFIED: IndexTaskEvent.IndexEventType
    INDEX_EVENT_TYPE_PROGRESS: IndexTaskEvent.IndexEventType
    INDEX_EVENT_TYPE_COMPLETED: IndexTaskEvent.IndexEventType
    INDEX_EVENT_TYPE_FAILED: IndexTaskEvent.IndexEventType
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    EVENT_TYPE_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTS_INDEXED_FIELD_NUMBER: _ClassVar[int]
    DOCUMENTS_TOTAL_FIELD_NUMBER: _ClassVar[int]
    ERROR_MESSAGE_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    event_type: IndexTaskEvent.IndexEventType
    documents_indexed: int
    documents_total: int
    error_message: str
    def __init__(self, task_id: _Optional[str] = ..., event_type: _Optional[_Union[IndexTaskEvent.IndexEventType, str]] = ..., documents_indexed: _Optional[int] = ..., documents_total: _Optional[int] = ..., error_message: _Optional[str] = ...) -> None: ...

class CancelTaskRequest(_message.Message):
    __slots__ = ("task_id",)
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    def __init__(self, task_id: _Optional[str] = ...) -> None: ...

class CancelTaskResponse(_message.Message):
    __slots__ = ("accepted", "message")
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    accepted: bool
    message: str
    def __init__(self, accepted: _Optional[bool] = ..., message: _Optional[str] = ...) -> None: ...

class GetTaskStatusRequest(_message.Message):
    __slots__ = ("task_id",)
    TASK_ID_FIELD_NUMBER: _ClassVar[int]
    task_id: str
    def __init__(self, task_id: _Optional[str] = ...) -> None: ...

class GetTaskStatusResponse(_message.Message):
    __slots__ = ("task",)
    TASK_FIELD_NUMBER: _ClassVar[int]
    task: _predict_pb2.PredictTask
    def __init__(self, task: _Optional[_Union[_predict_pb2.PredictTask, _Mapping]] = ...) -> None: ...
