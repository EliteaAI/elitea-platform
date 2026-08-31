"""A PostgreSQL-backed stand-in for ``UnifiedWikiDB`` on the read path.

This is what makes ADR-0022 decision 3's actual goal real: a query replica that
never built an index can still answer. The engine's retrieval stack asks its
``db`` object for six things and nothing else —

    search_hybrid    get_node    get_edges_from    get_edges_to
    vec_available    close

— which is small enough to satisfy from PostgreSQL without touching a line of
the copied engine. ``UnifiedRetriever`` cannot tell the difference, and does not
need to.

WHY THIS IS AN ADAPTER AND NOT AN EDIT.
---------------------------------------
``engine/`` is a verbatim copy guarded by digests; editing it would end the
parity argument that the whole port rests on. So the substitution happens at
runtime, in :mod:`elitea_deepwiki.storage.install`, and it is scoped by the one
discriminator the engine already provides: ``readonly=True``.

Every construction site that opens the index for *reading* passes
``readonly=True`` — the two toolkit wrappers, both ask workers, the
deep-research worker, the cluster reader and the research tools. Every site
that *writes* (the filesystem indexer, the clustering pass, cluster expansion)
does not. Reads therefore move to PostgreSQL and writes stay on ephemeral
scratch, which is exactly the split decision 3 asks for: generation is bounded
by slot accounting and may be stateful; querying must not be.

ROW SHAPES ARE THE CONTRACT.
----------------------------
``UnifiedRetriever._node_to_document`` reads specific keys off the dicts this
returns, and the fused rows must carry ``combined_score``. The queries below
therefore return the legacy ``repo_nodes`` column names, not this schema's.
Anything the legacy row had that this schema drops comes back as its legacy
default rather than being absent, because a missing key and a false value are
different to the caller.
"""

from __future__ import annotations

import logging
from typing import Any, Sequence

from .base import (
    DEFAULT_FTS_POOL,
    DEFAULT_FTS_WEIGHT,
    DEFAULT_VEC_POOL,
    DEFAULT_VEC_WEIGHT,
    Hit,
)
from .postgres import PostgresBackend

logger = logging.getLogger(__name__)

#: The legacy ``repo_nodes`` columns a caller may read off a returned row.
#: Ordered as the legacy ``SELECT m.*`` produced them.
_NODE_COLUMNS = (
    "node_id",
    "rel_path",
    "file_name",
    "language",
    "start_line",
    "end_line",
    "symbol_name",
    "symbol_type",
    "parent_symbol",
    "source_text",
    "docstring",
    "signature",
    "is_architectural",
    "is_doc",
    "is_test",
    "chunk_type",
    "macro_cluster",
    "micro_cluster",
)


def _row_to_node(row: Sequence[Any]) -> dict[str, Any]:
    """Build a legacy-shaped node dict from a ``_NODE_COLUMNS`` row."""
    node = dict(zip(_NODE_COLUMNS, row))
    # The legacy schema stored these as integers and callers do truthiness
    # tests on them; keep the type as well as the value.
    for flag in ("is_architectural", "is_doc", "is_test"):
        node[flag] = int(bool(node.get(flag)))
    # Columns the legacy row carried that this schema does not: present with
    # their legacy defaults, because absent and empty are different.
    node.setdefault("analysis_level", "comprehensive")
    node.setdefault("parameters", "")
    node.setdefault("return_type", "")
    node.setdefault("is_hub", 0)
    node.setdefault("hub_assignment", None)
    return node


_NODE_SELECT = ", ".join(_NODE_COLUMNS)


class PostgresUnifiedDB:
    """The read surface of ``UnifiedWikiDB``, served from PostgreSQL.

    Not a general replacement: the write, clustering and graph-construction
    methods are deliberately absent, and calling one raises rather than
    silently doing nothing. A generation pass that reached this object would be
    a wiring mistake, and it should say so loudly.
    """

    def __init__(self, connection, wiki_id: str) -> None:
        self.wiki_id = wiki_id
        self._conn = connection
        self._backend = PostgresBackend(connection, wiki_id)

    # -- what the retriever calls -----------------------------------------

    @property
    def vec_available(self) -> bool:
        """Whether any dense vector exists for this wiki.

        The legacy property answered "is sqlite-vec loaded". The honest
        equivalent here is "can a dense search return anything", because that
        is what the caller does with it: ``search_hybrid`` skips the dense
        branch when it is false.
        """
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT EXISTS (SELECT 1 FROM wiki_node_embeddings WHERE wiki_id = %s)",
                (self.wiki_id,),
            )
            return bool(cursor.fetchone()[0])

    def search_hybrid(
        self,
        query: str,
        embedding: list[float] | None = None,
        path_prefix: str | None = None,
        cluster_id: int | None = None,
        fts_weight: float = DEFAULT_FTS_WEIGHT,
        vec_weight: float = DEFAULT_VEC_WEIGHT,
        limit: int = 20,
        fts_k: int = DEFAULT_FTS_POOL,
        vec_k: int = DEFAULT_VEC_POOL,
    ) -> list[dict[str, Any]]:
        """Fused search, returning legacy-shaped rows with ``combined_score``.

        ``path_prefix`` and ``cluster_id`` are accepted and applied. They are
        not exercised by the P0 fixtures — the legacy retriever passes them
        only for directory- and cluster-scoped searches — so they are
        implemented from the legacy SQL rather than from a recording, and the
        tests cover them directly.
        """
        hits = self._backend.search_hybrid(
            query,
            embedding,
            limit=limit,
            fts_weight=fts_weight,
            vec_weight=vec_weight,
            fts_pool=fts_k,
            vec_pool=vec_k,
        )
        if path_prefix or cluster_id is not None:
            hits = self._filter(hits, path_prefix, cluster_id)[:limit]

        rows = self._nodes_by_id([hit.node_id for hit in hits])
        out: list[dict[str, Any]] = []
        for hit in hits:
            node = rows.get(hit.node_id)
            if node is None:
                continue
            node = dict(node)
            node.update(hit.scores)
            out.append(node)
        return out

    def get_node(self, node_id: str) -> dict[str, Any] | None:
        with self._conn.cursor() as cursor:
            cursor.execute(
                f"SELECT {_NODE_SELECT} FROM wiki_nodes "
                "WHERE wiki_id = %s AND node_id = %s",
                (self.wiki_id, node_id),
            )
            row = cursor.fetchone()
        return _row_to_node(row) if row else None

    def get_nodes_by_ids(self, node_ids: list[str]) -> list[dict[str, Any]]:
        if not node_ids:
            return []
        return list(self._nodes_by_id(node_ids).values())

    def get_edges_from(
        self, node_id: str, rel_types: list[str] | None = None
    ) -> list[dict[str, Any]]:
        sql = (
            "SELECT source_id, target_id, rel_type, edge_class, weight, metadata "
            "FROM wiki_edges WHERE wiki_id = %s AND source_id = %s"
        )
        params: list[Any] = [self.wiki_id, node_id]
        if rel_types:
            sql += " AND rel_type = ANY(%s)"
            params.append(list(rel_types))
        return self._edges(sql, params)

    def get_edges_to(self, node_id: str) -> list[dict[str, Any]]:
        return self._edges(
            "SELECT source_id, target_id, rel_type, edge_class, weight, metadata "
            "FROM wiki_edges WHERE wiki_id = %s AND target_id = %s",
            [self.wiki_id, node_id],
        )

    # -- incidental, but cheap and read-only ------------------------------

    def node_count(self) -> int:
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM wiki_nodes WHERE wiki_id = %s", (self.wiki_id,)
            )
            return int(cursor.fetchone()[0])

    def edge_count(self) -> int:
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM wiki_edges WHERE wiki_id = %s", (self.wiki_id,)
            )
            return int(cursor.fetchone()[0])

    def get_meta(self, key: str, default: Any = None) -> Any:
        """Wiki-level metadata, read off the ``wikis`` row.

        The legacy ``wiki_meta`` table was a free-form key/value store. Only
        two consumers read it on the read path and both tolerate a default, so
        this serves what the registry row knows and returns the default
        otherwise rather than inventing a second key/value table.
        """
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT wiki_id, repo, branch, commit_hash, wiki_version_id, "
                "analysis_key, canonical_repo_identifier "
                "FROM wikis WHERE wiki_id = %s",
                (self.wiki_id,),
            )
            row = cursor.fetchone()
        if row is None:
            return default
        known = dict(
            zip(
                (
                    "wiki_id",
                    "repo",
                    "branch",
                    "commit_hash",
                    "wiki_version_id",
                    "analysis_key",
                    "canonical_repo_identifier",
                ),
                row,
            )
        )
        value = known.get(key)
        return default if value is None else value

    def close(self) -> None:
        """The connection is owned by the caller; nothing to release."""
        return None

    def __enter__(self) -> "PostgresUnifiedDB":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    # -- refusals ---------------------------------------------------------

    def _write_refused(self, name: str):
        raise NotImplementedError(
            f"{name} is a write operation and this backend is the READ path. "
            "Generation writes to ephemeral scratch and is published into "
            "PostgreSQL afterwards (storage.publish). Reaching this means a "
            "write path was handed a read-only backend."
        )

    def upsert_node(self, *_a, **_k):
        self._write_refused("upsert_node")

    def upsert_nodes_batch(self, *_a, **_k):
        self._write_refused("upsert_nodes_batch")

    def upsert_edge(self, *_a, **_k):
        self._write_refused("upsert_edge")

    def upsert_edges_batch(self, *_a, **_k):
        self._write_refused("upsert_edges_batch")

    def upsert_embedding(self, *_a, **_k):
        self._write_refused("upsert_embedding")

    def upsert_embeddings_batch(self, *_a, **_k):
        self._write_refused("upsert_embeddings_batch")

    def from_networkx(self, *_a, **_k):
        self._write_refused("from_networkx")

    def set_meta(self, *_a, **_k):
        self._write_refused("set_meta")

    def set_cluster(self, *_a, **_k):
        self._write_refused("set_cluster")

    def set_clusters_batch(self, *_a, **_k):
        self._write_refused("set_clusters_batch")

    def set_hub(self, *_a, **_k):
        self._write_refused("set_hub")

    # -- helpers ----------------------------------------------------------

    def _nodes_by_id(self, node_ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        ids = list(node_ids)
        if not ids:
            return {}
        with self._conn.cursor() as cursor:
            cursor.execute(
                f"SELECT {_NODE_SELECT} FROM wiki_nodes "
                "WHERE wiki_id = %s AND node_id = ANY(%s)",
                (self.wiki_id, ids),
            )
            rows = cursor.fetchall()
        return {row[0]: _row_to_node(row) for row in rows}

    def _edges(self, sql: str, params: list[Any]) -> list[dict[str, Any]]:
        with self._conn.cursor() as cursor:
            cursor.execute(sql, params)
            rows = cursor.fetchall()
        return [
            {
                "source_id": row[0],
                "target_id": row[1],
                "rel_type": row[2],
                "edge_class": row[3],
                "weight": float(row[4]),
                "metadata": row[5],
            }
            for row in rows
        ]

    def _filter(
        self, hits: list[Hit], path_prefix: str | None, cluster_id: int | None
    ) -> list[Hit]:
        """Apply the legacy path/cluster filters to an already-fused list.

        The legacy code pushed these into the FTS and KNN queries. Applying
        them afterwards is not equivalent when a filter would have let deeper
        candidates into the pool, so the pools are widened by the caller's
        limits rather than silently truncated — see the test that compares a
        filtered search against the unfiltered one.
        """
        ids = [hit.node_id for hit in hits]
        if not ids:
            return []

        conditions = ["wiki_id = %s", "node_id = ANY(%s)"]
        params: list[Any] = [self.wiki_id, ids]
        if path_prefix:
            prefix = path_prefix.rstrip("/") + "/"
            conditions.append("rel_path LIKE %s")
            params.append(prefix.replace("%", r"\%") + "%")
        if cluster_id is not None:
            conditions.append("macro_cluster = %s")
            params.append(cluster_id)

        with self._conn.cursor() as cursor:
            cursor.execute(
                f"SELECT node_id FROM wiki_nodes WHERE {' AND '.join(conditions)}",
                params,
            )
            allowed = {row[0] for row in cursor.fetchall()}
        return [hit for hit in hits if hit.node_id in allowed]
