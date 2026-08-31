"""Publish a completed generation into PostgreSQL, automatically.

Without this, ADR-0022 decision 3 is available rather than delivered: the
storage backend works and a replica can read from it, but only for a wiki
somebody published by hand. This is the step that closes that gap — when a
``generate_wiki`` completes, its index goes into the database before the
invocation reports success.

WHERE THE INDEX IS.
-------------------
The worker writes a manifest artifact naming the file it built:
``unified_db_key`` plus ``unified_db_files``, resolved under
``{scratch_path}/cache/``. That is the authoritative answer and is used when
present.

When it is absent — the in-process path produces no manifest at all, which is
the whole finding from the end-to-end run — the newest ``*.wiki.db`` in the
cache directory is used instead. That is a heuristic, and it is the *same*
heuristic the legacy worker used for the same purpose
(``wiki_subprocess_worker`` globs and sorts by mtime), so it fails in the same
way rather than a new one. It is logged either way, so a run always says which
file it published.

WHAT A FAILURE MEANS.
---------------------
A wiki that generated but did not publish is a real, partial outcome: the
pages, manifest and structure artifacts are genuine and will land, but no other
replica can answer a question about it. So a publish failure is reported
**in band**, through the same ``errors`` list the legacy composer already
renders as "⚠️ Partial issues detected", rather than either failing the whole
invocation (which would discard good artifacts) or passing silently (which
would claim a queryable wiki that is not).
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def _cache_dir(settings) -> Path:
    return Path(settings.scratch_path) / "cache"


def _key_from_manifest(result: dict[str, Any]) -> str | None:
    """Read ``unified_db_key`` out of the manifest artifact, if there is one."""
    for artifact in result.get("artifacts") or []:
        if artifact.get("type") != "application/json":
            continue
        name = artifact.get("name") or ""
        if "wiki_manifest_" not in name:
            continue
        try:
            manifest = json.loads(artifact.get("data") or "")
        except ValueError:
            continue
        key = manifest.get("unified_db_key")
        if isinstance(key, str) and key:
            return key
    return None


def locate_index(settings, result: dict[str, Any]) -> Path | None:
    """Find the ``.wiki.db`` a generation produced."""
    cache = _cache_dir(settings)

    key = _key_from_manifest(result)
    if key:
        path = cache / f"{key}.wiki.db"
        if path.is_file():
            logger.info("index located from the manifest: %s", path)
            return path
        logger.warning(
            "manifest names unified_db_key=%s but %s does not exist", key, path
        )

    if not cache.is_dir():
        return None

    candidates = sorted(
        cache.glob("*.wiki.db"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    if not candidates:
        return None

    logger.info(
        "no usable unified_db_key in the result; publishing the newest index "
        "in %s: %s",
        cache,
        candidates[0].name,
    )
    return candidates[0]


def registry_from_result(result: dict[str, Any]) -> dict[str, Any]:
    """Build the ``wikis`` row from what the generation reported.

    ``repo`` is the canonical identifier's first segment — the legacy registry
    stored ``owner/repo`` while the identifier is ``owner/repo:branch:commit``,
    and ``WikiRegistryManager.register_wiki`` did this same split.
    """
    canonical = result.get("canonical_repo_identifier") or ""
    repo = canonical.split(":")[0] if canonical else ""
    provider = result.get("provider_type") or "github"

    registry: dict[str, Any] = {
        "repo": repo or None,
        "branch": result.get("branch") or None,
        "provider": provider,
        "host": f"{provider}.com" if provider in ("github", "gitlab") else provider,
        "display_name": result.get("wiki_title") or repo or None,
        "description": result.get("wiki_description") or None,
        "commit_hash": result.get("commit_hash") or None,
        "canonical_repo_identifier": canonical or None,
        "analysis_key": result.get("analysis_key") or None,
        "wiki_version_id": result.get("wiki_version_id") or None,
    }
    wiki_id = result.get("wiki_id")
    if wiki_id:
        registry["folder_path"] = f"{wiki_id}/"
    return {key: value for key, value in registry.items() if value is not None}


def publish_generation(settings, result: dict[str, Any]) -> dict[str, Any] | None:
    """Publish a completed generation. Returns the counts, or ``None``.

    ``None`` means nothing was attempted — no database configured, or the
    result carries no wiki id. A *failure* raises, and the caller turns it into
    an in-band error rather than swallowing it here: this function must not be
    the place where an unpublished wiki becomes invisible.
    """
    database_url = getattr(settings, "database_url", None)
    if not database_url:
        return None

    wiki_id = result.get("wiki_id")
    if not wiki_id:
        logger.warning("generation result carries no wiki_id; nothing to publish")
        return None

    path = locate_index(settings, result)
    if path is None:
        from .storage.publish import PublishError  # noqa: PLC0415

        raise PublishError(
            f"generation for {wiki_id} produced no .wiki.db under "
            f"{_cache_dir(settings)}; there is nothing to publish, so no "
            "replica will be able to answer about this wiki"
        )

    import psycopg  # noqa: PLC0415

    from .storage import install as storage_install  # noqa: PLC0415
    from .storage.publish import publish_wiki_db  # noqa: PLC0415

    connection = psycopg.connect(database_url)
    try:
        counts = publish_wiki_db(
            connection,
            wiki_id,
            path,
            registry=registry_from_result(result),
        )
    finally:
        connection.close()

    # So a reader on this process resolves the same path to this wiki instead
    # of falling back to the scratch file it just published.
    storage_install.register_wiki_path(path, wiki_id)

    logger.info("published %s from %s: %s", wiki_id, path.name, counts)
    return counts
