"""The legacy file backend, behind the storage interface.

This wraps the verbatim copies in :mod:`elitea_deepwiki.storage.legacy` —
``UnifiedWikiDB`` (repo_nodes, FTS5, sqlite-vec) and ``BM25SqliteIndex`` over
the mmap docstore — without changing any of their retrieval code. Every
ranking it returns is produced by the same lines that produced the P0
fixtures.

It exists for one reason: so a parity run compares the PostgreSQL backend
against a *live reference implementation* rather than against a JSON file. A
fixture can only say "these were the scores once"; the reference can be
re-queried, with new queries, on new corpora, for as long as the port needs it.

ADR-0022 retires this backend from production. It is not the target; it is the
control.

Requires the ``storage-legacy`` extra (networkx, sqlite-vec, langchain-core,
langchain-community), which is why the import is local to the constructor —
the SPI shell image must not need the legacy closure to start.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any, Sequence

from .base import (
    DEFAULT_FTS_POOL,
    DEFAULT_FTS_WEIGHT,
    DEFAULT_VEC_POOL,
    DEFAULT_VEC_WEIGHT,
    Hit,
    Node,
    rrf_fuse,
)


class SqliteBackend:
    """Reference backend: the legacy ``.wiki.db`` plus its BM25 sidecar."""

    name = "sqlite-legacy"

    def __init__(
        self,
        wiki_id: str,
        *,
        directory: str | Path | None = None,
        embedding_dim: int = 1536,
    ) -> None:
        from .legacy import bm25_disk, docstore, unified_db  # noqa: PLC0415

        self.wiki_id = wiki_id
        self._bm25_disk = bm25_disk
        self._docstore = docstore

        self._owns_directory = directory is None
        self._directory = Path(
            directory or tempfile.mkdtemp(prefix=f"deepwiki-{wiki_id}-")
        )
        self._directory.mkdir(parents=True, exist_ok=True)
        self._cache_key = "index"

        self._db = unified_db.UnifiedWikiDB(
            self._directory / f"{self._cache_key}.wiki.db",
            embedding_dim=embedding_dim,
        )
        self._bm25 = None

    # -- write ------------------------------------------------------------

    def upsert_nodes(self, nodes: Sequence[Node]) -> None:
        self._db.upsert_nodes_batch([node.as_dict() for node in nodes])
        self._db.conn.commit()
        # The legacy writer rebuilds FTS5 wholesale rather than maintaining it
        # incrementally; keep that, so the index state after a write is the
        # state the fixtures were recorded against.
        self._db._populate_fts5()

    def upsert_embeddings(
        self, embeddings: Sequence[tuple[str, Sequence[float]]]
    ) -> None:
        if not self._db.vec_available:
            raise RuntimeError(
                "sqlite-vec is not loadable in this interpreter, so the "
                "reference backend cannot serve the dense branch. Install the "
                "'storage-legacy' extra."
            )
        self._db.upsert_embeddings_batch(
            [(node_id, list(vector)) for node_id, vector in embeddings]
        )
        self._db.conn.commit()

    def build_bm25(self, documents: Sequence[tuple[str, str]]) -> None:
        from langchain_core.documents import Document  # noqa: PLC0415

        self._docstore.build_docstore_cache(
            [
                Document(page_content=text, metadata={"uuid": node_id})
                for node_id, text in documents
            ],
            self._directory,
            self._cache_key,
        )
        self._bm25 = self._bm25_disk.load_or_build_bm25_index(
            self._directory, self._cache_key, rebuild=True
        )
        if self._bm25 is None:
            raise RuntimeError("legacy BM25 index build returned None")

    # -- read -------------------------------------------------------------

    @staticmethod
    def _hit(row: dict[str, Any], scores: dict[str, float]) -> Hit:
        return Hit(
            node_id=row["node_id"],
            rel_path=row.get("rel_path", "") or "",
            symbol_name=row.get("symbol_name", "") or "",
            symbol_type=row.get("symbol_type", "") or "",
            scores=scores,
        )

    def search_fts(self, query: str, *, limit: int = DEFAULT_FTS_POOL) -> list[Hit]:
        return [
            self._hit(
                row,
                {
                    "fts_rank": float(row["fts_rank"]),
                    "score_norm": float(row["score_norm"]),
                },
            )
            for row in self._db.search_fts5(query, limit=limit)
        ]

    def search_dense(
        self, embedding: Sequence[float], *, k: int = DEFAULT_VEC_POOL
    ) -> list[Hit]:
        return [
            self._hit(row, {"vec_distance": float(row["vec_distance"])})
            for row in self._db.search_vec(list(embedding), k=k)
        ]

    def search_bm25(self, query: str, *, k: int = 10) -> list[Hit]:
        if self._bm25 is None:
            return []
        return [
            Hit(node_id=node_id, scores={"bm25_score": float(score)})
            for node_id, score in self._bm25.search(query, k)
        ]

    def search_hybrid(
        self,
        query: str,
        embedding: Sequence[float] | None = None,
        *,
        limit: int = 20,
        fts_weight: float = DEFAULT_FTS_WEIGHT,
        vec_weight: float = DEFAULT_VEC_WEIGHT,
        fts_pool: int = DEFAULT_FTS_POOL,
        vec_pool: int = DEFAULT_VEC_POOL,
    ) -> list[Hit]:
        fts = self.search_fts(query, limit=fts_pool)
        dense = (
            self.search_dense(embedding, k=vec_pool)
            if embedding and self._db.vec_available
            else []
        )
        return rrf_fuse(
            fts,
            dense,
            fts_weight=fts_weight,
            vec_weight=vec_weight,
            limit=limit,
        )

    # -- lifecycle --------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        return {
            "backend": self.name,
            "wiki_id": self.wiki_id,
            "node_count": self._db.node_count(),
            "fts_row_count": self._db.conn.execute(
                "SELECT count(*) FROM repo_fts"
            ).fetchone()[0],
            "vec_available": self._db.vec_available,
            "bm25_doc_count": self._bm25.doc_count if self._bm25 else 0,
        }

    def close(self) -> None:
        self._db.close()
        if self._owns_directory:
            import shutil  # noqa: PLC0415

            shutil.rmtree(self._directory, ignore_errors=True)

    def __enter__(self) -> "SqliteBackend":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()
