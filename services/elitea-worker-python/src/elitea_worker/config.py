"""Strict, file-only production worker deployment configuration."""

from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from elitea_worker.constants import (
    LIMITS_REVISION,
    MAX_GRPC_REQUEST_BYTES,
    MAX_GRPC_RESPONSE_BYTES,
    MAX_LEASE_POLL_INTERVAL_MILLIS,
)
from elitea_worker.execution.errors import InvalidInput


_MAX_CONFIG_BYTES = 64 * 1024
_MAX_IDENTITY_BYTES = 256
_V1_REDIS_ENTRY_BYTES = 64 * 1024
_V1_REDIS_FIELD_BYTES = 48 * 1024
_V1_INPUT_CONTENT_BYTES = 256 * 1024
_V1_OUTPUT_FRAME_BYTES = 64 * 1024


class RuntimeLimits(BaseModel):
    """All queue, body, deadline and shutdown bounds used by ``serve``."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    redis_read_batch: int = Field(gt=0, le=64)
    redis_block_millis: int = Field(ge=100, le=30_000)
    redis_reclaim_idle_millis: int = Field(ge=1_000, le=86_400_000)
    redis_reclaim_interval_millis: int = Field(ge=100, le=60_000)
    dependency_retry_millis: int = Field(ge=100, le=60_000)
    delivery_max_concurrency: int = Field(gt=0, le=128)
    delivery_queue_capacity: int = Field(gt=0, le=512)
    sync_max_workers: int = Field(gt=0, le=128)
    sync_max_in_flight: int = Field(gt=0, le=512)
    admission_timeout_millis: int = Field(gt=0, le=60_000)
    grpc_deadline_millis: int = Field(gt=0, le=300_000)
    content_timeout_millis: int = Field(gt=0, le=300_000)
    http_max_connections: int = Field(gt=0, le=512)
    http_max_keepalive_connections: int = Field(ge=0, le=512)
    output_max_queued_frames: int = Field(gt=0, le=128)
    output_max_queued_bytes: int = Field(gt=0, le=64 * 1024 * 1024)
    output_max_sessions: int = Field(gt=0, le=8)
    output_ack_timeout_millis: int = Field(gt=0, le=300_000)
    output_stream_deadline_millis: int = Field(gt=0, le=3_600_000)
    lease_poll_interval_millis: int = Field(
        gt=0,
        le=MAX_LEASE_POLL_INTERVAL_MILLIS,
    )
    shutdown_timeout_millis: int = Field(gt=0, le=300_000)

    @model_validator(mode="after")
    def validate_related_bounds(self) -> RuntimeLimits:
        if self.delivery_queue_capacity < self.delivery_max_concurrency:
            raise ValueError("delivery queue must hold at least one item per worker")
        if self.sync_max_in_flight < self.sync_max_workers:
            raise ValueError("sync in-flight bound cannot be below the thread count")
        if _V1_OUTPUT_FRAME_BYTES > self.output_max_queued_bytes:
            raise ValueError("one output frame must fit inside the output queue")
        if self.http_max_keepalive_connections > self.http_max_connections:
            raise ValueError("HTTP keepalive connections cannot exceed all connections")
        return self

    # These fixed properties are protocol-revision facts, not deployment knobs.
    # Consumers remain explicit while operators cannot select an incompatible
    # local wire profile.
    @property
    def redis_max_entry_bytes(self) -> int:
        return _V1_REDIS_ENTRY_BYTES

    @property
    def redis_max_field_bytes(self) -> int:
        return _V1_REDIS_FIELD_BYTES

    @property
    def grpc_max_request_bytes(self) -> int:
        return MAX_GRPC_REQUEST_BYTES

    @property
    def grpc_max_response_bytes(self) -> int:
        return MAX_GRPC_RESPONSE_BYTES

    @property
    def content_max_body_bytes(self) -> int:
        return _V1_INPUT_CONTENT_BYTES

    @property
    def output_max_frame_bytes(self) -> int:
        return _V1_OUTPUT_FRAME_BYTES


class RuntimeDeployConfig(BaseModel):
    """Deployment-selected identities and paths; it never embeds credentials."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    schema_version: Literal["elitea.runtime-deploy.v1"]
    limits_revision: str = Field(min_length=1, max_length=256)
    workload_session_id: str
    producer_id: str
    consumer_id: str
    redis_url: str = Field(min_length=1, max_length=2048)
    redis_password_path: Path
    redis_stream: str = Field(min_length=1, max_length=512)
    redis_group: str = Field(min_length=1, max_length=256)
    control_target: str = Field(min_length=1, max_length=512)
    output_target: str = Field(min_length=1, max_length=512)
    content_origin: str = Field(min_length=1, max_length=2048)
    ca_path: Path
    certificate_path: Path
    private_key_path: Path
    ed25519_keyring_path: Path
    spool_root: Path
    spool_key_path: Path
    limits: RuntimeLimits

    @field_validator("workload_session_id", "producer_id", "consumer_id")
    @classmethod
    def validate_identity(cls, value: str) -> str:
        if not _bounded_text(value, _MAX_IDENTITY_BYTES):
            raise ValueError("runtime identity is malformed")
        return value

    @field_validator("redis_stream", "redis_group")
    @classmethod
    def validate_redis_name(cls, value: str) -> str:
        if not _bounded_text(value, 512):
            raise ValueError("Redis stream or group is malformed")
        return value

    @field_validator("redis_url")
    @classmethod
    def validate_redis_url(cls, value: str) -> str:
        if not _canonical_redis_url_text(value):
            raise ValueError("Redis must use a canonical rediss ACL URL")
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("Redis must use a canonical rediss ACL URL") from exc
        if (
            parsed.scheme != "rediss"
            or not parsed.hostname
            or port is None
            or not _valid_acl_username(parsed.username)
            or parsed.password is not None
            or parsed.query
            or parsed.fragment
            or parsed.path != "/0"
            or not _canonical_explicit_port(parsed.netloc, port)
        ):
            raise ValueError("Redis must use a canonical rediss ACL URL")
        return value

    @field_validator("control_target", "output_target")
    @classmethod
    def validate_grpc_target(cls, value: str) -> str:
        if (
            not _bounded_text(value, 512)
            or "://" in value
            or "/" in value
            or "@" in value
            or value.startswith(":")
        ):
            raise ValueError("gRPC target is malformed")
        return value

    @field_validator("content_origin")
    @classmethod
    def validate_content_origin(cls, value: str) -> str:
        parsed = urlsplit(value)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError("content origin must be an HTTPS origin")
        return value.rstrip("/")

    @field_validator(
        "ca_path",
        "certificate_path",
        "private_key_path",
        "ed25519_keyring_path",
        "spool_root",
        "spool_key_path",
        "redis_password_path",
    )
    @classmethod
    def validate_absolute_path(cls, value: Path) -> Path:
        if not value.is_absolute():
            raise ValueError("runtime material paths must be absolute")
        return value

    @model_validator(mode="after")
    def validate_revision(self) -> RuntimeDeployConfig:
        if self.limits_revision != LIMITS_REVISION:
            raise ValueError("runtime limits revision is not compatible")
        return self


def load_deploy_config(path: Path) -> RuntimeDeployConfig:
    """Load a bounded regular JSON file without following symlinks."""

    try:
        raw = read_regular_file(
            path,
            max_bytes=_MAX_CONFIG_BYTES,
            private=False,
            description="runtime deployment configuration",
        )
        value: Any = json.loads(raw)
        if not isinstance(value, dict):
            raise ValueError("deployment configuration must be an object")
        return RuntimeDeployConfig.model_validate(value)
    except InvalidInput:
        raise
    except Exception as exc:
        raise InvalidInput("The runtime deployment configuration is invalid.") from exc


def read_regular_file(
    path: Path,
    *,
    max_bytes: int,
    private: bool,
    description: str,
) -> bytes:
    """Read one bounded file and reject symlinks and unsafe permissions."""

    if max_bytes < 1 or not description:
        raise ValueError("file policy is invalid")
    try:
        absolute = path.absolute()
        if path.resolve(strict=True) != absolute:
            raise OSError("symlinked paths are not accepted")
        flags = os.O_RDONLY
        if hasattr(os, "O_CLOEXEC"):
            flags |= os.O_CLOEXEC
        if hasattr(os, "O_NOFOLLOW"):
            flags |= os.O_NOFOLLOW
        descriptor = os.open(absolute, flags)
        try:
            info = os.fstat(descriptor)
            if not stat.S_ISREG(info.st_mode) or info.st_size < 1 or info.st_size > max_bytes:
                raise OSError("file type or size is invalid")
            permissions = stat.S_IMODE(info.st_mode)
            if permissions & 0o022:
                raise OSError("file is group/world writable")
            if private and permissions & 0o077:
                raise OSError("private file is group/world accessible")
            chunks = bytearray()
            while len(chunks) < info.st_size:
                chunk = os.read(descriptor, min(64 * 1024, info.st_size - len(chunks)))
                if not chunk:
                    break
                chunks.extend(chunk)
            if len(chunks) != info.st_size:
                raise OSError("file changed while being read")
            return bytes(chunks)
        finally:
            os.close(descriptor)
    except (OSError, RuntimeError, ValueError) as exc:
        raise InvalidInput(f"The {description} is unavailable or unsafe.") from exc


def validate_private_directory(path: Path, *, description: str) -> Path:
    """Validate an existing owner-private directory without changing its mode."""

    try:
        absolute = path.absolute()
        if path.resolve(strict=True) != absolute:
            raise OSError("symlinked paths are not accepted")
        info = absolute.lstat()
        if (
            not stat.S_ISDIR(info.st_mode)
            or stat.S_IMODE(info.st_mode) & 0o077
            or info.st_uid != os.geteuid()
        ):
            raise OSError("directory ownership or permissions are unsafe")
        return absolute
    except (OSError, RuntimeError, ValueError) as exc:
        raise InvalidInput(f"The {description} is unavailable or unsafe.") from exc


def _bounded_text(value: str, max_bytes: int) -> bool:
    return (
        bool(value)
        and len(value.encode("utf-8")) <= max_bytes
        and not any(character in value for character in ("\r", "\n", "\x00"))
    )


def _valid_acl_username(value: str | None) -> bool:
    if not value or len(value) > 256:
        return False
    return all(
        character.isascii()
        and (character.isalnum() or character in (".", "_", "-"))
        for character in value
    )


def _canonical_redis_url_text(value: str) -> bool:
    return all(
        0x21 <= ord(character) <= 0x7E and character not in ("%", "?", "#")
        for character in value
    )


def _canonical_explicit_port(authority: str, port: int) -> bool:
    _, separator, host_and_port = authority.rpartition("@")
    if not separator:
        return False
    if host_and_port.startswith("["):
        closing = host_and_port.find("]")
        return closing > 0 and host_and_port[closing + 1 :] == f":{port}"
    host, separator, port_text = host_and_port.rpartition(":")
    return bool(host and separator and port_text == str(port))
