from elitea.auth.v1 import session_pb2 as _session_pb2
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AuthorizeRequest(_message.Message):
    __slots__ = ("token", "auth_type", "project_id", "resource", "action")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    AUTH_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    RESOURCE_FIELD_NUMBER: _ClassVar[int]
    ACTION_FIELD_NUMBER: _ClassVar[int]
    token: str
    auth_type: str
    project_id: str
    resource: str
    action: str
    def __init__(self, token: _Optional[str] = ..., auth_type: _Optional[str] = ..., project_id: _Optional[str] = ..., resource: _Optional[str] = ..., action: _Optional[str] = ...) -> None: ...

class AuthorizeResponse(_message.Message):
    __slots__ = ("allowed", "context", "denial_reason")
    ALLOWED_FIELD_NUMBER: _ClassVar[int]
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    DENIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    allowed: bool
    context: _session_pb2.AuthContext
    denial_reason: str
    def __init__(self, allowed: _Optional[bool] = ..., context: _Optional[_Union[_session_pb2.AuthContext, _Mapping]] = ..., denial_reason: _Optional[str] = ...) -> None: ...

class ValidateTokenRequest(_message.Message):
    __slots__ = ("token", "auth_type")
    TOKEN_FIELD_NUMBER: _ClassVar[int]
    AUTH_TYPE_FIELD_NUMBER: _ClassVar[int]
    token: str
    auth_type: str
    def __init__(self, token: _Optional[str] = ..., auth_type: _Optional[str] = ...) -> None: ...

class ValidateTokenResponse(_message.Message):
    __slots__ = ("valid", "user_id", "expires_at", "denial_reason")
    VALID_FIELD_NUMBER: _ClassVar[int]
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EXPIRES_AT_FIELD_NUMBER: _ClassVar[int]
    DENIAL_REASON_FIELD_NUMBER: _ClassVar[int]
    valid: bool
    user_id: str
    expires_at: int
    denial_reason: str
    def __init__(self, valid: _Optional[bool] = ..., user_id: _Optional[str] = ..., expires_at: _Optional[int] = ..., denial_reason: _Optional[str] = ...) -> None: ...

class HealthRequest(_message.Message):
    __slots__ = ()
    def __init__(self) -> None: ...

class HealthResponse(_message.Message):
    __slots__ = ("status",)
    STATUS_FIELD_NUMBER: _ClassVar[int]
    status: str
    def __init__(self, status: _Optional[str] = ...) -> None: ...
