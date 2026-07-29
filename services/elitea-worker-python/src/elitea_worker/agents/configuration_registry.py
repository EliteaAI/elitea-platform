"""Read-only shadow of the installed Elitea SDK configuration registry."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Protocol


MAX_REGISTRY_IDENTIFIER_BYTES = 128


class ConfigurationRegistryError(ValueError):
    """The installed registry cannot be projected into the shadow contract."""


class _ConfigurationModel(Protocol):
    model_config: Mapping[str, Any]

    @classmethod
    def model_json_schema(cls) -> dict[str, Any]: ...

    @classmethod
    def model_validate(cls, value: object) -> object: ...


RegistryLoader = Callable[[], Mapping[str, type[_ConfigurationModel]]]


@dataclass(frozen=True, slots=True)
class ConfigurationRegistryEntry:
    type: str
    section: str
    canonical_schema: bytes
    schema_digest: bytes
    validation_supported: bool
    connection_check_supported: bool


@dataclass(frozen=True, slots=True)
class ConfigurationRegistrySnapshot:
    entries: tuple[ConfigurationRegistryEntry, ...]
    catalog_digest: bytes


class ConfigurationRegistryShadow:
    """Load the SDK registry once and retain its immutable local projection."""

    __slots__ = ("_entries", "_models", "_snapshot")

    def __init__(self, loader: RegistryLoader) -> None:
        try:
            registry = dict(loader())
        except Exception:
            raise ConfigurationRegistryError(
                "installed configuration registry could not be loaded"
            ) from None
        snapshot = _build_snapshot(registry)
        self._models = MappingProxyType(registry)
        self._entries = MappingProxyType(
            {entry.type: entry for entry in snapshot.entries}
        )
        self._snapshot = snapshot

    @property
    def snapshot(self) -> ConfigurationRegistrySnapshot:
        return self._snapshot

    def matches(self, admitted: ConfigurationRegistrySnapshot) -> bool:
        """Compare without changing either the admitted or installed snapshot."""

        return self._snapshot == admitted

    def entry(self, configuration_type: str) -> ConfigurationRegistryEntry | None:
        """Return the immutable schema projection for one registered type."""

        return self._entries.get(configuration_type)

    def model(self, configuration_type: str) -> type[_ConfigurationModel] | None:
        """Return the model captured in the same one-time registry load."""

        return self._models.get(configuration_type)


def _build_snapshot(
    registry: Mapping[str, type[_ConfigurationModel]],
) -> ConfigurationRegistrySnapshot:
    if not registry:
        raise ConfigurationRegistryError("configuration registry is empty")

    entries = tuple(
        sorted(
            (
                _project_entry(configuration_type, model)
                for configuration_type, model in registry.items()
            ),
            key=lambda entry: (entry.type, entry.section),
        )
    )
    catalog = {
        "entries": [
            {
                "connection_check_supported": entry.connection_check_supported,
                "schema": json.loads(entry.canonical_schema),
                "section": entry.section,
                "type": entry.type,
                "validation_supported": entry.validation_supported,
            }
            for entry in entries
        ]
    }
    return ConfigurationRegistrySnapshot(
        entries=entries,
        catalog_digest=hashlib.sha256(_canonical_json(catalog)).digest(),
    )


def _project_entry(
    registered_type: str,
    model: type[_ConfigurationModel],
) -> ConfigurationRegistryEntry:
    metadata = _registry_metadata(model)
    configuration_type = metadata.get("type")
    section = metadata.get("section")
    if configuration_type != registered_type:
        raise ConfigurationRegistryError(
            "registered configuration type does not match its model metadata"
        )
    if not _valid_identifier(configuration_type) or not _valid_identifier(section):
        raise ConfigurationRegistryError("configuration registry identifier is invalid")

    try:
        schema = model.model_json_schema()
    except Exception:
        raise ConfigurationRegistryError(
            "configuration registry schema could not be generated"
        ) from None
    if not isinstance(schema, dict):
        raise ConfigurationRegistryError("configuration registry schema is not an object")

    canonical_schema = _canonical_json(schema)
    return ConfigurationRegistryEntry(
        type=configuration_type,
        section=section,
        canonical_schema=canonical_schema,
        schema_digest=hashlib.sha256(canonical_schema).digest(),
        validation_supported=callable(getattr(model, "model_validate", None)),
        connection_check_supported=callable(getattr(model, "check_connection", None)),
    )


def _registry_metadata(model: type[_ConfigurationModel]) -> Mapping[str, Any]:
    model_config = getattr(model, "model_config", None)
    if not isinstance(model_config, Mapping):
        raise ConfigurationRegistryError("configuration model metadata is missing")
    schema_extra = model_config.get("json_schema_extra")
    if not isinstance(schema_extra, Mapping):
        raise ConfigurationRegistryError("configuration model metadata is missing")
    metadata = schema_extra.get("metadata")
    if not isinstance(metadata, Mapping):
        raise ConfigurationRegistryError("configuration model metadata is missing")
    return metadata


def _valid_identifier(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        return False
    if not encoded or len(encoded) > MAX_REGISTRY_IDENTIFIER_BYTES:
        return False
    if not 97 <= encoded[0] <= 122:
        return False
    return all(
        97 <= character <= 122
        or 48 <= character <= 57
        or character in (45, 46, 95)
        for character in encoded[1:]
    )


def _canonical_json(value: object) -> bytes:
    try:
        encoded = json.dumps(
            value,
            allow_nan=False,
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        # Go's encoding/json keeps HTML characters with SetEscapeHTML(false),
        # but still escapes these two separators.
        encoded = encoded.replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
        return encoded.encode("utf-8")
    except (TypeError, UnicodeEncodeError, ValueError):
        raise ConfigurationRegistryError(
            "configuration registry schema is not valid JSON"
        ) from None
