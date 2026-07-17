from elitea.runtime.v1 import common_pb2 as _common_pb2
from google.protobuf.internal import enum_type_wrapper as _enum_type_wrapper
from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from collections.abc import Mapping as _Mapping
from typing import ClassVar as _ClassVar, Optional as _Optional, Union as _Union

DESCRIPTOR: _descriptor.FileDescriptor

class SignatureProfileV1(int, metaclass=_enum_type_wrapper.EnumTypeWrapper):
    __slots__ = ()
    SIGNATURE_PROFILE_V1_UNSPECIFIED: _ClassVar[SignatureProfileV1]
    SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256: _ClassVar[SignatureProfileV1]
SIGNATURE_PROFILE_V1_UNSPECIFIED: SignatureProfileV1
SIGNATURE_PROFILE_V1_TEST_ONLY_HMAC_SHA256: SignatureProfileV1

class SignedWorkerCommandEnvelopeV1(_message.Message):
    __slots__ = ("envelope_schema_revision", "signature_profile", "key_id", "worker_command_bytes", "worker_command_digest", "signature")
    ENVELOPE_SCHEMA_REVISION_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_PROFILE_FIELD_NUMBER: _ClassVar[int]
    KEY_ID_FIELD_NUMBER: _ClassVar[int]
    WORKER_COMMAND_BYTES_FIELD_NUMBER: _ClassVar[int]
    WORKER_COMMAND_DIGEST_FIELD_NUMBER: _ClassVar[int]
    SIGNATURE_FIELD_NUMBER: _ClassVar[int]
    envelope_schema_revision: str
    signature_profile: SignatureProfileV1
    key_id: str
    worker_command_bytes: bytes
    worker_command_digest: _common_pb2.DigestV1
    signature: bytes
    def __init__(self, envelope_schema_revision: _Optional[str] = ..., signature_profile: _Optional[_Union[SignatureProfileV1, str]] = ..., key_id: _Optional[str] = ..., worker_command_bytes: _Optional[bytes] = ..., worker_command_digest: _Optional[_Union[_common_pb2.DigestV1, _Mapping]] = ..., signature: _Optional[bytes] = ...) -> None: ...

class WorkerExecutionEnvelopeV1(_message.Message):
    __slots__ = ("signed_command", "fence")
    SIGNED_COMMAND_FIELD_NUMBER: _ClassVar[int]
    FENCE_FIELD_NUMBER: _ClassVar[int]
    signed_command: SignedWorkerCommandEnvelopeV1
    fence: _common_pb2.ExecutionFenceV1
    def __init__(self, signed_command: _Optional[_Union[SignedWorkerCommandEnvelopeV1, _Mapping]] = ..., fence: _Optional[_Union[_common_pb2.ExecutionFenceV1, _Mapping]] = ...) -> None: ...
