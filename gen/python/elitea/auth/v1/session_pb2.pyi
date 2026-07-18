from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class AuthContext(_message.Message):
    __slots__ = ("user_id", "email", "auth_type", "project_id", "roles", "session_id")
    USER_ID_FIELD_NUMBER: _ClassVar[int]
    EMAIL_FIELD_NUMBER: _ClassVar[int]
    AUTH_TYPE_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    ROLES_FIELD_NUMBER: _ClassVar[int]
    SESSION_ID_FIELD_NUMBER: _ClassVar[int]
    user_id: str
    email: str
    auth_type: str
    project_id: str
    roles: RoleSet
    session_id: str
    def __init__(self, user_id: _Optional[str] = ..., email: _Optional[str] = ..., auth_type: _Optional[str] = ..., project_id: _Optional[str] = ..., roles: _Optional[_Union[RoleSet, _Mapping]] = ..., session_id: _Optional[str] = ...) -> None: ...

class RoleSet(_message.Message):
    __slots__ = ("role_names", "is_admin", "is_project_admin")
    ROLE_NAMES_FIELD_NUMBER: _ClassVar[int]
    IS_ADMIN_FIELD_NUMBER: _ClassVar[int]
    IS_PROJECT_ADMIN_FIELD_NUMBER: _ClassVar[int]
    role_names: _containers.RepeatedScalarFieldContainer[str]
    is_admin: bool
    is_project_admin: bool
    def __init__(self, role_names: _Optional[_Iterable[str]] = ..., is_admin: _Optional[bool] = ..., is_project_admin: _Optional[bool] = ...) -> None: ...

class SessionResolveRequest(_message.Message):
    __slots__ = ("session_ref", "project_id")
    SESSION_REF_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    session_ref: str
    project_id: str
    def __init__(self, session_ref: _Optional[str] = ..., project_id: _Optional[str] = ...) -> None: ...

class SessionResolveResponse(_message.Message):
    __slots__ = ("context", "found")
    CONTEXT_FIELD_NUMBER: _ClassVar[int]
    FOUND_FIELD_NUMBER: _ClassVar[int]
    context: AuthContext
    found: bool
    def __init__(self, context: _Optional[_Union[AuthContext, _Mapping]] = ..., found: _Optional[bool] = ...) -> None: ...
