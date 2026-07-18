from google.protobuf import descriptor as _descriptor
from google.protobuf import message as _message
from typing import ClassVar as _ClassVar, Optional as _Optional

DESCRIPTOR: _descriptor.FileDescriptor

class PaginationRequest(_message.Message):
    __slots__ = ("page_size", "page_token", "offset")
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    OFFSET_FIELD_NUMBER: _ClassVar[int]
    page_size: int
    page_token: str
    offset: int
    def __init__(self, page_size: _Optional[int] = ..., page_token: _Optional[str] = ..., offset: _Optional[int] = ...) -> None: ...

class PaginatedResponse(_message.Message):
    __slots__ = ("next_page_token", "total_count", "page", "page_size")
    NEXT_PAGE_TOKEN_FIELD_NUMBER: _ClassVar[int]
    TOTAL_COUNT_FIELD_NUMBER: _ClassVar[int]
    PAGE_FIELD_NUMBER: _ClassVar[int]
    PAGE_SIZE_FIELD_NUMBER: _ClassVar[int]
    next_page_token: str
    total_count: int
    page: int
    page_size: int
    def __init__(self, next_page_token: _Optional[str] = ..., total_count: _Optional[int] = ..., page: _Optional[int] = ..., page_size: _Optional[int] = ...) -> None: ...
