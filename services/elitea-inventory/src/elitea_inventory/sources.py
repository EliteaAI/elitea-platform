"""Building the SDK source toolkit from the source object the facade expanded.

ADR-0022 decision 6 and ADR-0023 keep toolkit resolution in the FACADE. The
legacy plugin did the opposite: ``_tool_run_ingestion`` took a bare
``toolkit_id``, built an ``EliteAClient`` from an admin platform token held in
the plugin's own descriptor config, and fetched
``/api/v2/elitea_core/tool/prompt_lib/{project}/{toolkit}?expand=true`` — an
admin-authorised read of another toolkit's CREDENTIALS, performed by the
provider, on the strength of an id the caller supplied. Nothing in that request
proved the caller could see the toolkit.

Here the facade expands it and forwards the result. What arrives per invoke is::

    {
      "toolkit_id": 42,
      "type": "github",
      "name": "elitea-platform",
      "settings": {...},      # only what the SDK loader needs
      "branch": "main",       # optional
      "whitelist": [...],     # optional
      "blacklist": [...]      # optional
    }

and this module turns it into the SDK api-wrapper the ingestion pipeline reads
from. A body with no ``source`` for an ingest tool is refused as invalid input,
by name — never resolved.
"""

from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)

#: Keys the engine reads off the expanded object itself rather than passing to
#: the SDK loader.
_ENVELOPE_KEYS = ("toolkit_id", "type", "name", "settings", "branch", "whitelist", "blacklist")


class Source:
    """One expanded source: its identity, and the toolkit built from it."""

    def __init__(
        self,
        toolkit_id: Any,
        type: str,  # noqa: A002 - the wire name
        name: str,
        settings: dict[str, Any],
        branch: str | None = None,
        whitelist: list[str] | None = None,
        blacklist: list[str] | None = None,
    ) -> None:
        self.toolkit_id = toolkit_id
        self.type = type
        self.name = name
        self.settings = settings
        self.branch = branch
        self.whitelist = whitelist
        self.blacklist = blacklist

    def __repr__(self) -> str:  # pragma: no cover - diagnostics only
        return f"<Source {self.name!r} type={self.type!r} toolkit_id={self.toolkit_id!r}>"


def parse_source(raw: Any, allowed_types: tuple[str, ...]) -> Source:
    """Validate the expanded source object; refuse anything else by name.

    Every refusal is a ``ValueError``, which the error contract classifies as
    ``invalid_input`` — the caller supplied (or the facade failed to supply)
    something the engine cannot act on, and a retry with the same body will
    fail the same way.
    """
    if raw is None:
        raise ValueError(
            "source is required: this service does not resolve toolkit "
            "references, the facade expands them. Re-run the tool through the "
            "platform rather than calling the provider directly."
        )
    if not isinstance(raw, dict):
        raise ValueError(
            f"source must be the expanded source object, got {type(raw).__name__}. "
            f"A bare toolkit id is not resolved here."
        )

    source_type = str(raw.get("type") or "").strip().lower()
    if not source_type:
        raise ValueError("source.type is required (one of: " + ", ".join(allowed_types) + ")")
    if source_type not in allowed_types:
        raise ValueError(
            f"source.type {source_type!r} is not ingestible by this service. "
            f"Supported: {', '.join(allowed_types)}. Widen "
            f"ELITEA_INVENTORY_SOURCE_TYPES only for a type this engine has "
            f"actually been run against."
        )

    settings = raw.get("settings")
    if settings is None:
        settings = {}
    if not isinstance(settings, dict):
        raise ValueError(
            f"source.settings must be an object, got {type(settings).__name__}"
        )

    toolkit_id = raw.get("toolkit_id")
    name = str(raw.get("name") or "").strip() or (
        f"toolkit_{toolkit_id}" if toolkit_id is not None else source_type
    )

    def _patterns(key: str) -> list[str] | None:
        value = raw.get(key)
        if value is None or value == "":
            return None
        if isinstance(value, str):
            items = [item.strip() for item in value.split(",") if item.strip()]
            return items or None
        if isinstance(value, list):
            items = [str(item).strip() for item in value if str(item).strip()]
            return items or None
        raise ValueError(
            f"source.{key} must be a list or a comma-separated string, got "
            f"{type(value).__name__}"
        )

    branch = raw.get("branch")
    return Source(
        toolkit_id=toolkit_id,
        type=source_type,
        name=name,
        settings=settings,
        branch=str(branch) if branch else None,
        whitelist=_patterns("whitelist"),
        blacklist=_patterns("blacklist"),
    )


def build_toolkit(source: Source) -> Any:
    """Instantiate the SDK toolkit for ``source`` and return its api wrapper.

    This is the legacy shape minus the platform fetch: ``instantiate_toolkit``
    over a toolkit dict, then the api wrapper off the first tool. What the
    legacy code additionally injected — ``settings['elitea']``, an
    admin-authorised platform client — is deliberately NOT injected: the SDK
    uses it for artifact and datasource access on the toolkit's behalf, which
    for a github/ado_repos source is not needed, and supplying it would put an
    admin credential back into the ingestion path by the side door.
    """
    from elitea_sdk.tools import instantiate_toolkit  # noqa: PLC0415

    toolkit_data = {
        "id": source.toolkit_id,
        "name": source.name,
        "type": source.type,
        "settings": dict(source.settings),
    }
    instance = instantiate_toolkit(toolkit_data)

    tools = getattr(instance, "tools", None)
    if tools:
        wrapper = getattr(tools[0], "api_wrapper", None)
        if wrapper is not None:
            return wrapper
    wrapper = getattr(instance, "api_wrapper", None)
    if wrapper is not None:
        return wrapper
    # A toolkit with neither shape is not usable by the ingestion pipeline,
    # which reads files through the api wrapper. Returning the instance would
    # fail later inside the pipeline with an AttributeError on whichever
    # method it reached for first.
    raise ValueError(
        f"the {source.type} toolkit for source {source.name!r} exposes no API "
        f"wrapper, so the ingestion pipeline has nothing to read files through"
    )


__all__ = ["Source", "build_toolkit", "parse_source"]
