"""Point the engine's read path at PostgreSQL, without editing the engine.

``engine/`` is a verbatim copy guarded by digests. Editing it would end the
parity argument the port rests on, so the redirection happens here, at runtime,
and it is narrow enough to state in one sentence:

    ``UnifiedWikiDB(path, readonly=True)`` returns a PostgreSQL-backed reader;
    every other construction keeps the original file class.

WHY ``readonly`` IS THE RIGHT DISCRIMINATOR.
--------------------------------------------
It is not a proxy for intent — it *is* the intent, and the engine already
records it at every site:

    readonly=True   wiki_toolkit_wrapper, hybrid_wiki_toolkit_wrapper,
                    ask_subprocess_worker (x2), deep_research_subprocess_worker,
                    wiki_graph_optimized (cluster reader), research_tools
    (no flag)       filesystem_indexer, wiki_graph_optimized (clustering pass),
                    cluster_expansion

The first group is the query path; the second builds the index. So this split
gives exactly what ADR-0022 decision 3 asks for: **generation may stay
stateful on ephemeral scratch, querying must not be.** A replica that never
built an index can answer, which is the ADR's own verification criterion.

The wiki id is derived from the ``.wiki.db`` path the caller asked for, because
that is all the engine knows at the call site. :func:`register_wiki_path` lets
the generation side record the mapping when it publishes; without a mapping the
substitution declines and the file class is used, so an unpublished wiki reads
its own scratch file rather than silently returning nothing.
"""

from __future__ import annotations

import logging
import threading
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)

_lock = threading.Lock()

#: ``.wiki.db`` stem -> wiki_id, recorded at publish time.
_PATH_TO_WIKI: dict[str, str] = {}

#: Set by :func:`install`; ``None`` means the substitution is not active.
_CONNECTION_FACTORY: Callable[[], Any] | None = None

_ORIGINAL: Any = None


def register_wiki_path(db_path: str | Path, wiki_id: str) -> None:
    """Record which wiki a generated ``.wiki.db`` belongs to."""
    with _lock:
        _PATH_TO_WIKI[Path(db_path).name] = wiki_id


def wiki_id_for_path(db_path: str | Path) -> str | None:
    """Resolve a wiki id for a ``.wiki.db`` path, if one was registered."""
    with _lock:
        return _PATH_TO_WIKI.get(Path(db_path).name)


def is_installed() -> bool:
    return _CONNECTION_FACTORY is not None


def install(connection_factory: Callable[[], Any]) -> None:
    """Redirect read-only ``UnifiedWikiDB`` construction to PostgreSQL.

    ``connection_factory`` is called per reader, so each query gets its own
    connection rather than sharing one across threads — the engine runs its
    retrieval in worker threads and subprocesses.

    Idempotent: installing twice keeps one layer of substitution, because
    wrapping a wrapper would make the original unreachable.
    """
    global _CONNECTION_FACTORY, _ORIGINAL

    from ..engine import unified_db  # noqa: PLC0415

    with _lock:
        if _ORIGINAL is None:
            _ORIGINAL = unified_db.UnifiedWikiDB
        _CONNECTION_FACTORY = connection_factory
        original = _ORIGINAL

    def _construct(db_path, embedding_dim: int = 1536, *, readonly: bool = False):
        if not readonly:
            # The index build. Stays on ephemeral scratch by design.
            return original(db_path, embedding_dim=embedding_dim, readonly=False)

        wiki_id = wiki_id_for_path(db_path)
        if wiki_id is None:
            # Nothing published under this path. Falling back to the file is
            # right: the alternative is a reader that finds nothing and looks
            # like an empty wiki rather than an unpublished one.
            logger.debug(
                "no wiki id registered for %s; reading the scratch file", db_path
            )
            return original(db_path, embedding_dim=embedding_dim, readonly=True)

        from .unified_db_adapter import PostgresUnifiedDB  # noqa: PLC0415

        factory = _CONNECTION_FACTORY
        if factory is None:  # pragma: no cover - uninstalled between checks
            return original(db_path, embedding_dim=embedding_dim, readonly=True)

        logger.info("serving wiki %s from PostgreSQL (path %s)", wiki_id, db_path)
        return PostgresUnifiedDB(factory(), wiki_id)

    # Carried over so anything reading them off the class still works.
    _construct.__name__ = original.__name__
    _construct.__doc__ = original.__doc__

    unified_db.UnifiedWikiDB = _construct
    logger.info("PostgreSQL read path installed for UnifiedWikiDB(readonly=True)")


def uninstall() -> None:
    """Restore the original file class. Used by tests."""
    global _CONNECTION_FACTORY

    from ..engine import unified_db  # noqa: PLC0415

    with _lock:
        if _ORIGINAL is not None:
            unified_db.UnifiedWikiDB = _ORIGINAL
        _CONNECTION_FACTORY = None
        _PATH_TO_WIKI.clear()
