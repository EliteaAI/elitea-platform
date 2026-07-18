from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class TenantContext(_message.Message):
    __slots__ = ("project_id", "schema_name", "organization_id")
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    SCHEMA_NAME_FIELD_NUMBER: _ClassVar[int]
    ORGANIZATION_ID_FIELD_NUMBER: _ClassVar[int]
    project_id: ProjectID
    schema_name: SchemaName
    organization_id: str
    def __init__(self, project_id: _Optional[_Union[ProjectID, _Mapping]] = ..., schema_name: _Optional[_Union[SchemaName, _Mapping]] = ..., organization_id: _Optional[str] = ...) -> None: ...

class ProjectID(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...

class SchemaName(_message.Message):
    __slots__ = ("value",)
    VALUE_FIELD_NUMBER: _ClassVar[int]
    value: str
    def __init__(self, value: _Optional[str] = ...) -> None: ...
