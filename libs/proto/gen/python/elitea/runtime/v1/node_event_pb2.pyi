from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class NodeEventV1(_message.Message):
    __slots__ = ("type", "stream_id", "message_id", "question_id", "content", "thinking", "response_metadata", "references", "sio_event", "created_at", "parent_message_id", "agent_name", "execution_generation")
    TYPE_FIELD_NUMBER: _ClassVar[int]
    STREAM_ID_FIELD_NUMBER: _ClassVar[int]
    MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    QUESTION_ID_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    THINKING_FIELD_NUMBER: _ClassVar[int]
    RESPONSE_METADATA_FIELD_NUMBER: _ClassVar[int]
    REFERENCES_FIELD_NUMBER: _ClassVar[int]
    SIO_EVENT_FIELD_NUMBER: _ClassVar[int]
    CREATED_AT_FIELD_NUMBER: _ClassVar[int]
    PARENT_MESSAGE_ID_FIELD_NUMBER: _ClassVar[int]
    AGENT_NAME_FIELD_NUMBER: _ClassVar[int]
    EXECUTION_GENERATION_FIELD_NUMBER: _ClassVar[int]
    type: str
    stream_id: str
    message_id: str
    question_id: str
    content: bytes
    thinking: str
    response_metadata: bytes
    references: bytes
    sio_event: str
    created_at: str
    parent_message_id: str
    agent_name: str
    execution_generation: str
    def __init__(self, type: _Optional[str] = ..., stream_id: _Optional[str] = ..., message_id: _Optional[str] = ..., question_id: _Optional[str] = ..., content: _Optional[bytes] = ..., thinking: _Optional[str] = ..., response_metadata: _Optional[bytes] = ..., references: _Optional[bytes] = ..., sio_event: _Optional[str] = ..., created_at: _Optional[str] = ..., parent_message_id: _Optional[str] = ..., agent_name: _Optional[str] = ..., execution_generation: _Optional[str] = ...) -> None: ...
