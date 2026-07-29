from elitea.runtime.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import containers as _containers
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Iterable as _Iterable, Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class ExecutionInputBundleReferenceV1(_message.Message):
    __slots__ = ("input_bundle_id", "immutable_version", "digest", "byte_length", "media_type")
    INPUT_BUNDLE_ID_FIELD_NUMBER: _ClassVar[int]
    IMMUTABLE_VERSION_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    BYTE_LENGTH_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    input_bundle_id: str
    immutable_version: str
    digest: _common_pb2.DigestV1
    byte_length: int
    media_type: str
    def __init__(self, input_bundle_id: _Optional[str] = ..., immutable_version: _Optional[str] = ..., digest: _Optional[_Union[_common_pb2.DigestV1, _Mapping]] = ..., byte_length: _Optional[int] = ..., media_type: _Optional[str] = ...) -> None: ...

class ScopedContentReferenceV1(_message.Message):
    __slots__ = ("content_id", "immutable_version", "media_type", "byte_length", "digest", "classification", "required_grant_audience")
    CONTENT_ID_FIELD_NUMBER: _ClassVar[int]
    IMMUTABLE_VERSION_FIELD_NUMBER: _ClassVar[int]
    MEDIA_TYPE_FIELD_NUMBER: _ClassVar[int]
    BYTE_LENGTH_FIELD_NUMBER: _ClassVar[int]
    DIGEST_FIELD_NUMBER: _ClassVar[int]
    CLASSIFICATION_FIELD_NUMBER: _ClassVar[int]
    REQUIRED_GRANT_AUDIENCE_FIELD_NUMBER: _ClassVar[int]
    content_id: str
    immutable_version: str
    media_type: str
    byte_length: int
    digest: _common_pb2.DigestV1
    classification: str
    required_grant_audience: str
    def __init__(self, content_id: _Optional[str] = ..., immutable_version: _Optional[str] = ..., media_type: _Optional[str] = ..., byte_length: _Optional[int] = ..., digest: _Optional[_Union[_common_pb2.DigestV1, _Mapping]] = ..., classification: _Optional[str] = ..., required_grant_audience: _Optional[str] = ...) -> None: ...

class ExecutionInputEntryV1(_message.Message):
    __slots__ = ("entry_id", "immutable_version", "semantic_role", "content")
    ENTRY_ID_FIELD_NUMBER: _ClassVar[int]
    IMMUTABLE_VERSION_FIELD_NUMBER: _ClassVar[int]
    SEMANTIC_ROLE_FIELD_NUMBER: _ClassVar[int]
    CONTENT_FIELD_NUMBER: _ClassVar[int]
    entry_id: str
    immutable_version: str
    semantic_role: str
    content: ScopedContentReferenceV1
    def __init__(self, entry_id: _Optional[str] = ..., immutable_version: _Optional[str] = ..., semantic_role: _Optional[str] = ..., content: _Optional[_Union[ScopedContentReferenceV1, _Mapping]] = ...) -> None: ...

class ExecutionInputBundleV1(_message.Message):
    __slots__ = ("input_bundle_id", "immutable_version", "entries")
    INPUT_BUNDLE_ID_FIELD_NUMBER: _ClassVar[int]
    IMMUTABLE_VERSION_FIELD_NUMBER: _ClassVar[int]
    ENTRIES_FIELD_NUMBER: _ClassVar[int]
    input_bundle_id: str
    immutable_version: str
    entries: _containers.RepeatedCompositeFieldContainer[ExecutionInputEntryV1]
    def __init__(self, input_bundle_id: _Optional[str] = ..., immutable_version: _Optional[str] = ..., entries: _Optional[_Iterable[_Union[ExecutionInputEntryV1, _Mapping]]] = ...) -> None: ...
