from google.protobuf.internal import containers as _containers
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class GatewayUsageRecord(_message.Message):
    __slots__ = ("record_id", "request_id", "project_id", "user_id", "model", "provider", "prompt_tokens", "completion_tokens", "total_tokens", "latency_ms", "recorded_at", "status_code", "application_id")
    class StatusCode(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        STATUS_CODE_UNSPECIFIED: _ClassVar[GatewayUsageRecord.StatusCode]
        STATUS_CODE_OK: _ClassVar[GatewayUsageRecord.StatusCode]
        STATUS_CODE_RATE_LIMITED: _ClassVar[GatewayUsageRecord.StatusCode]
        STATUS_CODE_PROVIDER_ERROR: _ClassVar[GatewayUsageRecord.StatusCode]
        STATUS_CODE_CONTEXT_LENGTH_EXCEEDED: _ClassVar[GatewayUsageRecord.StatusCode]
        STATUS_CODE_CANCELLED: _ClassVar[GatewayUsageRecord.StatusCode]
    STATUS_CODE_UNSPECIFIED: GatewayUsageRecord.StatusCode
    STATUS_CODE_OK: GatewayUsageRecord.StatusCode
    STATUS_CODE_RATE_LIMITED: GatewayUsageRecord.StatusCode
    STATUS_CODE_PROVIDER_ERROR: GatewayUsageRecord.StatusCode
    STATUS_CODE_CONTEXT_LENGTH_EXCEEDED: GatewayUsageRecord.StatusCode
    STATUS_CODE_CANCELLED: GatewayUsageRecord.StatusCode
    RECORD_ID_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    MODEL_FIELD_NUMBER: _ClassVar[int]
    PROVIDER_FIELD_NUMBER: _ClassVar[int]
    PROMPT_TOKENS_FIELD_NUMBER: _ClassVar[int]
    COMPLETION_TOKENS_FIELD_NUMBER: _ClassVar[int]
    TOTAL_TOKENS_FIELD_NUMBER: _ClassVar[int]
    LATENCY_MS_FIELD_NUMBER: _ClassVar[int]
    RECORDED_AT_FIELD_NUMBER: _ClassVar[int]
    STATUS_CODE_FIELD_NUMBER: _ClassVar[int]
    APPLICATION_ID_FIELD_NUMBER: _ClassVar[int]
    record_id: str
    request_id: str
    project_id: str
    user_id: str
    model: str
    provider: str
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    latency_ms: int
    recorded_at: int
    status_code: GatewayUsageRecord.StatusCode
    application_id: str
    def __init__(self, record_id: _Optional[str] = ..., request_id: _Optional[str] = ..., project_id: _Optional[str] = ..., user_id: _Optional[str] = ..., model: _Optional[str] = ..., provider: _Optional[str] = ..., prompt_tokens: _Optional[int] = ..., completion_tokens: _Optional[int] = ..., total_tokens: _Optional[int] = ..., latency_ms: _Optional[int] = ..., recorded_at: _Optional[int] = ..., status_code: _Optional[_Union[GatewayUsageRecord.StatusCode, str]] = ..., application_id: _Optional[str] = ...) -> None: ...

class UsageLogRequest(_message.Message):
    __slots__ = ("records",)
    RECORDS_FIELD_NUMBER: _ClassVar[int]
    records: _containers.RepeatedCompositeFieldContainer[GatewayUsageRecord]
    def __init__(self, records: _Optional[_Iterable[_Union[GatewayUsageRecord, _Mapping]]] = ...) -> None: ...

class UsageLogResponse(_message.Message):
    __slots__ = ("accepted",)
    ACCEPTED_FIELD_NUMBER: _ClassVar[int]
    accepted: int
    def __init__(self, accepted: _Optional[int] = ...) -> None: ...
