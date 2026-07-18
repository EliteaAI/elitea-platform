from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ToolkitUpdatedEvent(_message.Message):
    __slots__ = ("toolkit_id", "project_id", "updated_at", "update_type")
    class UpdateType(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
        __slots__ = ()
        UPDATE_TYPE_UNSPECIFIED: _ClassVar[ToolkitUpdatedEvent.UpdateType]
        UPDATE_TYPE_CONFIG: _ClassVar[ToolkitUpdatedEvent.UpdateType]
        UPDATE_TYPE_TOOLS: _ClassVar[ToolkitUpdatedEvent.UpdateType]
        UPDATE_TYPE_SECRETS: _ClassVar[ToolkitUpdatedEvent.UpdateType]
    UPDATE_TYPE_UNSPECIFIED: ToolkitUpdatedEvent.UpdateType
    UPDATE_TYPE_CONFIG: ToolkitUpdatedEvent.UpdateType
    UPDATE_TYPE_TOOLS: ToolkitUpdatedEvent.UpdateType
    UPDATE_TYPE_SECRETS: ToolkitUpdatedEvent.UpdateType
    TOOLKIT_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    UPDATED_AT_FIELD_NUMBER: _ClassVar[int]
    UPDATE_TYPE_FIELD_NUMBER: _ClassVar[int]
    toolkit_id: str
    project_id: str
    updated_at: int
    update_type: ToolkitUpdatedEvent.UpdateType
    def __init__(self, toolkit_id: _Optional[str] = ..., project_id: _Optional[str] = ..., updated_at: _Optional[int] = ..., update_type: _Optional[_Union[ToolkitUpdatedEvent.UpdateType, str]] = ...) -> None: ...

class ToolkitDeletedEvent(_message.Message):
    __slots__ = ("toolkit_id", "project_id", "deleted_at")
    TOOLKIT_ID_FIELD_NUMBER: _ClassVar[int]
    PROJECT_ID_FIELD_NUMBER: _ClassVar[int]
    DELETED_AT_FIELD_NUMBER: _ClassVar[int]
    toolkit_id: str
    project_id: str
    deleted_at: int
    def __init__(self, toolkit_id: _Optional[str] = ..., project_id: _Optional[str] = ..., deleted_at: _Optional[int] = ...) -> None: ...
