from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ErrorResponse(_message.Message):
    __slots__ = ("code", "message", "request_id", "details", "http_status")
    CODE_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    REQUEST_ID_FIELD_NUMBER: _ClassVar[int]
    DETAILS_FIELD_NUMBER: _ClassVar[int]
    HTTP_STATUS_FIELD_NUMBER: _ClassVar[int]
    code: str
    message: str
    request_id: str
    details: _containers.RepeatedCompositeFieldContainer[ValidationError]
    http_status: int
    def __init__(self, code: _Optional[str] = ..., message: _Optional[str] = ..., request_id: _Optional[str] = ..., details: _Optional[_Iterable[_Union[ValidationError, _Mapping]]] = ..., http_status: _Optional[int] = ...) -> None: ...

class ValidationError(_message.Message):
    __slots__ = ("field", "message", "rejected_value")
    FIELD_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_FIELD_NUMBER: _ClassVar[int]
    REJECTED_VALUE_FIELD_NUMBER: _ClassVar[int]
    field: str
    message: str
    rejected_value: str
    def __init__(self, field: _Optional[str] = ..., message: _Optional[str] = ..., rejected_value: _Optional[str] = ...) -> None: ...
