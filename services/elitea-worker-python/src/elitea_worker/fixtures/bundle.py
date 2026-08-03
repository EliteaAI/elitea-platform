"""Strict content-addressed offline fixture resolver.

The signed command binds deterministic ``ExecutionInputBundleV1`` protobuf
bytes. The canonical JSON file is only a test locator: it must project that
manifest exactly and may add only mechanically derived local blob names.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from elitea.runtime.v1 import common_pb2, input_pb2

from elitea_worker.constants import (
    AGENT_EXECUTION_REQUEST_ROLE,
    AGENT_INPUT_MEDIA_TYPE,
    JSON_MEDIA_TYPES,
    MAX_BUNDLE_ENTRIES,
    MAX_JSON_DEPTH,
    MAX_MANIFEST_BYTES,
    MAX_SETTINGS_BYTES,
    MAX_STRING_BYTES,
)
from elitea_worker.execution.errors import InvalidInput, ResourceExhausted
from elitea_worker.protocol.codec import parse_execution_input_bundle

SCHEMA_VERSION = "elitea.runtime.fixture-bundle.v1"
PROFILE = "TEST_ONLY_OFFLINE_CONFORMANCE_V1"
CANONICALIZATION = "ELITEA_TEST_JSON_CANONICAL_V1"
INPUT_BUNDLE_BLOB_NAME = "input-bundle.pb"
INPUT_BUNDLE_MEDIA_TYPE = "application/x-protobuf"

_IDENTIFIER = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")
_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:+@/-]*$")
_TOP_LEVEL_KEYS = frozenset(
    {"schema_version", "profile", "canonicalization", "input_bundle_manifest", "entries"}
)
_MANIFEST_KEYS = frozenset({"blob_name", "media_type", "byte_length", "digest"})
_ENTRY_KEYS = frozenset({"entry_id", "immutable_version", "semantic_role", "content"})
_CONTENT_KEYS = frozenset(
    {
        "content_id",
        "immutable_version",
        "media_type",
        "byte_length",
        "digest",
        "classification",
        "required_grant_audience",
        "blob_name",
    }
)


@dataclass(frozen=True, slots=True)
class FixtureContent:
    content_id: str
    immutable_version: str
    media_type: str
    byte_length: int
    digest: bytes
    classification: str
    required_grant_audience: str
    blob_name: str


@dataclass(frozen=True, slots=True)
class FixtureEntry:
    entry_id: str
    immutable_version: str
    semantic_role: str
    content: FixtureContent


@dataclass(frozen=True, slots=True)
class ResolvedFixtureEntry:
    bundle_id: str
    bundle_version: str
    bundle_digest: bytes
    entry: FixtureEntry
    content: bytes
    json_value: dict[str, Any]


class FixtureBundle:
    def __init__(
        self,
        *,
        root: Path,
        manifest: input_pb2.ExecutionInputBundleV1,
        digest: bytes,
        entries: tuple[FixtureEntry, ...],
    ) -> None:
        self._root = root
        self.input_bundle_id = manifest.input_bundle_id
        self.input_bundle_version = manifest.immutable_version
        self.digest = digest
        self._entries = {entry.entry_id: entry for entry in entries}

    @classmethod
    def load(
        cls,
        locator_path: Path,
        *,
        expected_bundle_id: str,
        expected_digest: bytes,
        expected_bundle_version: str,
        expected_byte_length: int,
    ) -> FixtureBundle:
        if len(expected_digest) != 32 or not _valid_identifier(expected_bundle_id):
            raise InvalidInput("The fixture bundle reference is malformed.")
        if (
            not _valid_version(expected_bundle_version)
            or isinstance(expected_byte_length, bool)
            or not isinstance(expected_byte_length, int)
            or expected_byte_length < 1
            or expected_byte_length > MAX_MANIFEST_BYTES
        ):
            raise InvalidInput("The fixture bundle reference is malformed.")
        root = locator_path.resolve(strict=True).parent
        locator_raw = _read_regular(locator_path, MAX_MANIFEST_BYTES)
        locator = _parse_canonical_json(locator_raw, description="fixture bundle locator")
        if not isinstance(locator, dict) or frozenset(locator) != _TOP_LEVEL_KEYS:
            raise InvalidInput("The fixture bundle locator has an invalid shape.")
        if (
            locator["schema_version"] != SCHEMA_VERSION
            or locator["profile"] != PROFILE
            or locator["canonicalization"] != CANONICALIZATION
        ):
            raise InvalidInput("The fixture bundle profile is not supported.")

        manifest_binding = _parse_manifest_binding(locator["input_bundle_manifest"])
        if (
            manifest_binding.digest != expected_digest
            or manifest_binding.byte_length != expected_byte_length
        ):
            raise InvalidInput("The input bundle locator does not match its signed command reference.")
        manifest_raw = _read_beneath_regular(
            root,
            (INPUT_BUNDLE_BLOB_NAME,),
            MAX_MANIFEST_BYTES,
        )
        if (
            len(manifest_raw) != manifest_binding.byte_length
            or hashlib.sha256(manifest_raw).digest() != manifest_binding.digest
        ):
            raise InvalidInput("The input bundle manifest does not match its immutable descriptor.")
        manifest = parse_execution_input_bundle(manifest_raw)
        if manifest.input_bundle_id != expected_bundle_id:
            raise InvalidInput("The input bundle ID does not match its signed command reference.")
        if manifest.immutable_version != expected_bundle_version:
            raise InvalidInput("The input bundle version does not match its signed command reference.")
        protobuf_entries = _project_manifest_entries(manifest)
        raw_entries = locator["entries"]
        if not isinstance(raw_entries, list) or not raw_entries:
            raise InvalidInput("The fixture bundle must contain at least one entry.")
        if len(raw_entries) > MAX_BUNDLE_ENTRIES:
            raise ResourceExhausted("The fixture bundle contains too many entries.")
        locator_entries = tuple(_parse_locator_entry(item) for item in raw_entries)
        if locator_entries != protobuf_entries:
            raise InvalidInput("The fixture locator entries do not match the input bundle manifest.")
        if len({entry.entry_id for entry in locator_entries}) != len(locator_entries):
            raise InvalidInput("The fixture bundle contains a duplicate entry ID.")
        if len({entry.content.blob_name for entry in locator_entries}) != len(locator_entries):
            raise InvalidInput("The fixture bundle contains a duplicate normalized blob name.")
        return cls(root=root, manifest=manifest, digest=manifest_binding.digest, entries=locator_entries)

    def resolve_json(self, entry_id: str) -> ResolvedFixtureEntry:
        try:
            entry = self._entries[entry_id]
        except KeyError as exc:
            raise InvalidInput("The requested fixture entry does not exist.") from exc
        content = entry.content
        if content.media_type.lower() not in JSON_MEDIA_TYPES:
            raise InvalidInput("The requested fixture entry has the wrong media type.")
        raw = _read_beneath_regular(
            self._root,
            PurePosixPath(content.blob_name).parts,
            MAX_SETTINGS_BYTES,
        )
        if len(raw) != content.byte_length or hashlib.sha256(raw).digest() != content.digest:
            raise InvalidInput("The fixture content does not match its immutable descriptor.")
        value = _parse_canonical_json(raw, description="settings entry")
        if not isinstance(value, dict):
            raise InvalidInput("Configuration settings must be a JSON object.")
        _check_json_limits(value)
        return ResolvedFixtureEntry(
            bundle_id=self.input_bundle_id,
            bundle_version=self.input_bundle_version,
            bundle_digest=self.digest,
            entry=entry,
            content=raw,
            json_value=value,
        )


@dataclass(frozen=True, slots=True)
class _ManifestBinding:
    byte_length: int
    digest: bytes


def _parse_manifest_binding(value: Any) -> _ManifestBinding:
    if not isinstance(value, dict) or frozenset(value) != _MANIFEST_KEYS:
        raise InvalidInput("The input bundle manifest binding has an invalid shape.")
    if (
        value["blob_name"] != INPUT_BUNDLE_BLOB_NAME
        or value["media_type"] != INPUT_BUNDLE_MEDIA_TYPE
    ):
        raise InvalidInput("The input bundle manifest binding is not supported.")
    length = _byte_length(value["byte_length"], MAX_MANIFEST_BYTES, "input bundle manifest")
    return _ManifestBinding(length, _digest(value["digest"], "input bundle manifest"))


def _parse_locator_entry(value: Any) -> FixtureEntry:
    if not isinstance(value, dict) or frozenset(value) != _ENTRY_KEYS:
        raise InvalidInput("A fixture bundle entry has an invalid shape.")
    content_value = value["content"]
    if not isinstance(content_value, dict) or frozenset(content_value) != _CONTENT_KEYS:
        raise InvalidInput("A fixture content entry has an invalid shape.")
    digest = _digest(content_value["digest"], "content")
    digest_hex = digest.hex()
    blob_name = _required_text(content_value["blob_name"], "blob name", pattern=None)
    expected_blob_name = f"blobs/sha256/{digest_hex}"
    path = PurePosixPath(blob_name)
    if (
        blob_name != expected_blob_name
        or path.is_absolute()
        or ".." in path.parts
        or "." in path.parts
        or "\\" in blob_name
    ):
        raise InvalidInput("A fixture blob name is not content-addressed.")
    content = FixtureContent(
        content_id=_required_text(content_value["content_id"], "content ID", _IDENTIFIER),
        immutable_version=_required_text(
            content_value["immutable_version"], "content version", _VERSION
        ),
        media_type=_required_text(content_value["media_type"], "media type", pattern=None),
        byte_length=_byte_length(content_value["byte_length"], MAX_SETTINGS_BYTES, "content"),
        digest=digest,
        classification=_required_text(
            content_value["classification"], "classification", _IDENTIFIER
        ),
        required_grant_audience=_required_text(
            content_value["required_grant_audience"], "grant audience", _IDENTIFIER
        ),
        blob_name=blob_name,
    )
    if content.media_type != "application/json":
        raise InvalidInput("The fixture content media type is not supported.")
    return FixtureEntry(
        entry_id=_required_text(value["entry_id"], "entry ID", _IDENTIFIER),
        immutable_version=_required_text(value["immutable_version"], "entry version", _VERSION),
        semantic_role=_required_text(value["semantic_role"], "semantic role", _IDENTIFIER),
        content=content,
    )


def _project_manifest_entries(
    manifest: input_pb2.ExecutionInputBundleV1,
) -> tuple[FixtureEntry, ...]:
    if not _valid_identifier(manifest.input_bundle_id) or not _valid_version(
        manifest.immutable_version
    ):
        raise InvalidInput("The input bundle manifest identity is malformed.")
    if not manifest.entries:
        raise InvalidInput("The input bundle manifest must contain at least one entry.")
    if len(manifest.entries) > MAX_BUNDLE_ENTRIES:
        raise ResourceExhausted("The input bundle manifest contains too many entries.")
    entries: list[FixtureEntry] = []
    for value in manifest.entries:
        if not value.HasField("content"):
            raise InvalidInput("An input bundle entry is missing its content descriptor.")
        content_value = value.content
        _require_proto_sha256(content_value.digest, "content digest")
        content = FixtureContent(
            content_id=_required_text(content_value.content_id, "content ID", _IDENTIFIER),
            immutable_version=_required_text(
                content_value.immutable_version, "content version", _VERSION
            ),
            media_type=_required_text(content_value.media_type, "media type", pattern=None),
            byte_length=_byte_length(content_value.byte_length, MAX_SETTINGS_BYTES, "content"),
            digest=bytes(content_value.digest.value),
            classification=_required_text(
                content_value.classification, "classification", _IDENTIFIER
            ),
            required_grant_audience=_required_text(
                content_value.required_grant_audience, "grant audience", _IDENTIFIER
            ),
            blob_name=f"blobs/sha256/{content_value.digest.value.hex()}",
        )
        expected_media_type = (
            AGENT_INPUT_MEDIA_TYPE
            if value.semantic_role == AGENT_EXECUTION_REQUEST_ROLE
            else "application/json"
        )
        if content.media_type != expected_media_type:
            raise InvalidInput("The input bundle content media type is not supported.")
        entries.append(
            FixtureEntry(
                entry_id=_required_text(value.entry_id, "entry ID", _IDENTIFIER),
                immutable_version=_required_text(
                    value.immutable_version, "entry version", _VERSION
                ),
                semantic_role=_required_text(value.semantic_role, "semantic role", _IDENTIFIER),
                content=content,
            )
        )
    if len({entry.entry_id for entry in entries}) != len(entries):
        raise InvalidInput("The input bundle manifest contains a duplicate entry ID.")
    return tuple(entries)


def parse_settings_json(raw: bytes) -> dict[str, Any]:
    """Decode immutable online settings without accepting JSON ambiguities."""

    if len(raw) > MAX_SETTINGS_BYTES:
        raise ResourceExhausted("The settings content exceeds the approved limit.")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InvalidInput("The settings content is malformed.") from exc
    if not isinstance(value, dict):
        raise InvalidInput("Configuration settings must be a JSON object.")
    _check_json_limits(value)
    return value


def parse_json_value(raw: bytes) -> Any:
    """Decode one bounded online JSON value without duplicate members."""

    if not raw or len(raw) > MAX_SETTINGS_BYTES:
        raise ResourceExhausted("The index input exceeds the approved limit.")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InvalidInput("The index input is malformed.") from exc
    _check_json_limits(value)
    return value


def project_input_manifest_entries(
    manifest: input_pb2.ExecutionInputBundleV1,
) -> tuple[FixtureEntry, ...]:
    """Validate and project the shared offline/online immutable manifest."""

    return _project_manifest_entries(manifest)


def _parse_canonical_json(raw: bytes, *, description: str) -> Any:
    if not raw.endswith(b"\n") or raw.endswith(b"\n\n"):
        raise InvalidInput(f"The {description} is not canonical JSON.")
    try:
        value = json.loads(
            raw.decode("utf-8"),
            object_pairs_hook=_unique_object,
            parse_constant=_reject_constant,
        )
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
        raise InvalidInput(f"The {description} is malformed.") from exc
    _check_json_limits(value)
    canonical = (
        json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode("utf-8")
    if canonical != raw:
        raise InvalidInput(f"The {description} is not canonical JSON.")
    return value


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON member")
        result[key] = value
    return result


def _reject_constant(value: str) -> Any:
    raise ValueError(f"non-finite JSON number: {value}")


def _check_json_limits(value: Any, depth: int = 0) -> None:
    if depth > MAX_JSON_DEPTH:
        raise ResourceExhausted("The JSON input exceeds the nesting limit.")
    if isinstance(value, float) and not math.isfinite(value):
        raise InvalidInput("The JSON input contains a non-finite number.")
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_STRING_BYTES:
            raise ResourceExhausted("A JSON string exceeds the approved limit.")
    elif isinstance(value, dict):
        for key, item in value.items():
            if len(key.encode("utf-8")) > MAX_STRING_BYTES:
                raise ResourceExhausted("A JSON field name exceeds the approved limit.")
            _check_json_limits(item, depth + 1)
    elif isinstance(value, list):
        for item in value:
            _check_json_limits(item, depth + 1)


def _read_regular(path: Path, limit: int) -> bytes:
    flags = os.O_RDONLY
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    try:
        descriptor = os.open(path, flags)
    except (OSError, ValueError) as exc:
        raise InvalidInput("Fixture content is unavailable or unsafe.") from exc
    try:
        return _read_regular_descriptor(descriptor, limit)
    finally:
        os.close(descriptor)


def _read_beneath_regular(root: Path, parts: tuple[str, ...], limit: int) -> bytes:
    if not parts or any(part in ("", ".", "..") for part in parts):
        raise InvalidInput("Fixture content path is unsafe.")
    directory_flags = os.O_RDONLY
    if hasattr(os, "O_DIRECTORY"):
        directory_flags |= os.O_DIRECTORY
    if hasattr(os, "O_NOFOLLOW"):
        directory_flags |= os.O_NOFOLLOW
    descriptors: list[int] = []
    try:
        descriptor = os.open(root, directory_flags)
        descriptors.append(descriptor)
        for component in parts[:-1]:
            descriptor = os.open(component, directory_flags, dir_fd=descriptor)
            if not stat.S_ISDIR(os.fstat(descriptor).st_mode):
                raise InvalidInput("Fixture content path is unsafe.")
            descriptors.append(descriptor)
        file_flags = os.O_RDONLY
        if hasattr(os, "O_NOFOLLOW"):
            file_flags |= os.O_NOFOLLOW
        file_descriptor = os.open(parts[-1], file_flags, dir_fd=descriptors[-1])
        descriptors.append(file_descriptor)
        return _read_regular_descriptor(file_descriptor, limit)
    except (OSError, ValueError) as exc:
        raise InvalidInput("Fixture content is unavailable or unsafe.") from exc
    finally:
        for descriptor in reversed(descriptors):
            os.close(descriptor)


def _read_regular_descriptor(descriptor: int, limit: int) -> bytes:
    if limit < 1:
        raise InvalidInput("A fixture content limit is malformed.")
    info = os.fstat(descriptor)
    if not stat.S_ISREG(info.st_mode):
        raise InvalidInput("Fixture content must be a regular file.")
    if info.st_size > limit:
        raise ResourceExhausted("Fixture content exceeds its approved limit.")
    result = bytearray()
    while len(result) <= limit:
        chunk = os.read(descriptor, min(64 * 1024, limit + 1 - len(result)))
        if not chunk:
            break
        result.extend(chunk)
    if len(result) > limit:
        raise ResourceExhausted("Fixture content exceeds its approved limit.")
    return bytes(result)


def _required_text(
    value: Any,
    description: str,
    pattern: re.Pattern[str] | None,
) -> str:
    if not isinstance(value, str) or not value or len(value) > 128:
        raise InvalidInput(f"The fixture {description} is invalid.")
    if pattern is not None and pattern.fullmatch(value) is None:
        raise InvalidInput(f"The fixture {description} is invalid.")
    return value


def _byte_length(value: Any, maximum: int, description: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise InvalidInput(f"The fixture {description} byte length is invalid.")
    if value > maximum:
        raise ResourceExhausted(f"The fixture {description} exceeds its approved limit.")
    return value


def _digest(value: Any, description: str) -> bytes:
    if not isinstance(value, str) or re.fullmatch(r"sha256:[0-9a-f]{64}", value) is None:
        raise InvalidInput(f"The fixture {description} digest is malformed.")
    return bytes.fromhex(value[7:])


def _require_proto_sha256(value: common_pb2.DigestV1, description: str) -> None:
    if value.algorithm != common_pb2.DIGEST_ALGORITHM_V1_SHA256 or len(value.value) != 32:
        raise InvalidInput(f"The input bundle {description} is malformed.")


def _valid_identifier(value: str) -> bool:
    return bool(value) and len(value) <= 128 and _IDENTIFIER.fullmatch(value) is not None


def _valid_version(value: str) -> bool:
    return bool(value) and len(value) <= 128 and _VERSION.fullmatch(value) is not None
