"""The retrieval storage interface.

ADR-0022 decision 3 replaces the legacy per-wiki file layer — a SQLite
``.wiki.db`` (nodes, edges, FTS5, sqlite-vec), a separate BM25 SQLite, an mmap
docstore, FAISS binaries and a compressed code graph — with PostgreSQL. This
module is the seam that makes that a swap rather than a rewrite: everything
above it (the ask/deep-research/wiki-generation paths in the engine) talks to
:class:`RetrievalBackend`, and two implementations satisfy it.

    storage/sqlite.py    wraps the verbatim legacy modules — the reference
    storage/postgres.py  pgvector + tsvector + BM25 term statistics

The interface is deliberately narrow and *ranking-shaped*. It exposes the four
retrieval branches the P0 fixtures record, each returning a ranked list with
its own score, because that is exactly what parity is asserted on. It does not
expose "give me a connection", which would let the engine reach around the
seam and re-introduce a file dependency.

Score conventions, which differ per branch and are part of the contract:

===========  ==================  =========================================
branch       score field         better is
===========  ==================  =========================================
fts          ``fts_rank``        lower (FTS5 ``bm25()`` is negated)
             ``score_norm``      higher (``1/(1+exp(fts_rank))``)
dense        ``vec_distance``    lower (L2)
bm25         ``bm25_score``      higher
fused        ``combined_score``  higher
===========  ==================  =========================================
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol, Sequence, runtime_checkable

#: Weighted-RRF constants, from ``unified_db.search_hybrid`` and
#: ``unified_retriever``. These are contract, not tuning: the fused fixture is
#: reproducible from the component rankings only with these exact values.
DEFAULT_FTS_WEIGHT = 0.4
DEFAULT_VEC_WEIGHT = 0.6
RRF_CONSTANT = 60.0
DEFAULT_FTS_POOL = 30
DEFAULT_VEC_POOL = 30


@dataclass
class Node:
    """One indexed symbol.

    The field set is the subset of legacy ``repo_nodes`` that retrieval and
    result rendering actually read. Columns the legacy schema carries but no
    retrieval path consults (``analysis_level``, ``hub_assignment``,
    ``return_type``) are deliberately absent; adding them later is additive.
    """

    node_id: str
    rel_path: str = ""
    file_name: str = ""
    language: str = ""
    start_line: int = 0
    end_line: int = 0
    symbol_name: str = ""
    symbol_type: str = ""
    parent_symbol: str | None = None
    source_text: str = ""
    docstring: str = ""
    signature: str = ""
    chunk_type: str | None = None
    macro_cluster: int | None = None
    micro_cluster: int | None = None
    #: Derived by the legacy writer from ``symbol_type`` and ``rel_path``.
    #: Carried rather than recomputed, so the publisher can pass through what
    #: the generation already decided instead of re-deriving it differently.
    is_architectural: bool = False
    is_doc: bool = False
    is_test: bool = False

    def as_dict(self) -> dict[str, Any]:
        return {
            "node_id": self.node_id,
            "rel_path": self.rel_path,
            "file_name": self.file_name,
            "language": self.language,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "symbol_name": self.symbol_name,
            "symbol_type": self.symbol_type,
            "parent_symbol": self.parent_symbol,
            "source_text": self.source_text,
            "docstring": self.docstring,
            "signature": self.signature,
            "chunk_type": self.chunk_type,
            "macro_cluster": self.macro_cluster,
            "micro_cluster": self.micro_cluster,
            "is_architectural": self.is_architectural,
            "is_doc": self.is_doc,
            "is_test": self.is_test,
        }


@dataclass
class Hit:
    """One ranked result.

    ``scores`` carries the branch's own score field(s) rather than a single
    normalised number, because normalising here would erase exactly the
    differences a parity run has to see.
    """

    node_id: str
    rel_path: str = ""
    symbol_name: str = ""
    symbol_type: str = ""
    scores: dict[str, float] = field(default_factory=dict)

    def score(self, key: str) -> float:
        return self.scores[key]


def rrf_fuse(
    fts: Sequence[Hit],
    dense: Sequence[Hit],
    *,
    fts_weight: float = DEFAULT_FTS_WEIGHT,
    vec_weight: float = DEFAULT_VEC_WEIGHT,
    rrf_constant: float = RRF_CONSTANT,
    limit: int = 20,
) -> list[Hit]:
    """Weighted reciprocal-rank fusion, ported from ``search_hybrid``.

    Shared by both backends on purpose. The fusion is not a storage concern —
    it is arithmetic over two ranked lists — and having one implementation
    means a parity difference can only come from the component rankings, which
    is where it actually matters.

    Note what is NOT fused: the standalone BM25 index. The legacy hybrid search
    combined the FTS5 and vector branches only. Widening this to a three-way
    fusion would change every ranking and is not parity.
    """
    scores: dict[str, float] = {}
    merged: dict[str, Hit] = {}

    for position, hit in enumerate(fts, start=1):
        scores[hit.node_id] = scores.get(hit.node_id, 0.0) + fts_weight / (
            rrf_constant + position
        )
        merged[hit.node_id] = hit

    for position, hit in enumerate(dense, start=1):
        scores[hit.node_id] = scores.get(hit.node_id, 0.0) + vec_weight / (
            rrf_constant + position
        )
        merged.setdefault(hit.node_id, hit)

    fused = []
    for node_id, score in scores.items():
        source = merged[node_id]
        fused.append(
            Hit(
                node_id=node_id,
                rel_path=source.rel_path,
                symbol_name=source.symbol_name,
                symbol_type=source.symbol_type,
                scores={**source.scores, "combined_score": score},
            )
        )

    fused.sort(key=lambda hit: hit.scores["combined_score"], reverse=True)
    return fused[:limit]


@runtime_checkable
class RetrievalBackend(Protocol):
    """Per-wiki index storage.

    An instance is scoped to one ``wiki_id``. The legacy file backend gets that
    scope from the file it opens; the PostgreSQL backend gets it from a column.
    """

    #: Identifies the implementation in health output and parity reports.
    name: str

    #: The wiki this backend instance is scoped to.
    wiki_id: str

    # -- write ------------------------------------------------------------

    def upsert_nodes(self, nodes: Sequence[Node]) -> None:
        """Insert or replace nodes and refresh their full-text index entries."""
        ...

    def upsert_embeddings(self, embeddings: Sequence[tuple[str, Sequence[float]]]) -> None:
        """Insert or replace dense vectors, keyed by node id."""
        ...

    def build_bm25(self, documents: Sequence[tuple[str, str]]) -> None:
        """Build the standalone BM25 index from ``(node_id, text)`` pairs.

        Separate from ``upsert_nodes`` because the legacy BM25 index is built
        over the *docstore* documents rather than the node rows, and the two
        can carry different text. Keeping the input explicit stops that
        difference from being silently normalised away.
        """
        ...

    # -- read -------------------------------------------------------------

    def search_fts(self, query: str, *, limit: int = DEFAULT_FTS_POOL) -> list[Hit]:
        """Lexical search. Hits carry ``fts_rank`` and ``score_norm``."""
        ...

    def search_dense(self, embedding: Sequence[float], *, k: int = DEFAULT_VEC_POOL) -> list[Hit]:
        """Vector KNN. Hits carry ``vec_distance``."""
        ...

    def search_bm25(self, query: str, *, k: int = 10) -> list[Hit]:
        """Standalone BM25. Hits carry ``bm25_score``."""
        ...

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
        """FTS + dense, fused by weighted RRF. Hits carry ``combined_score``."""
        ...

    # -- lifecycle --------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        """Row counts and index parameters, for health and parity reports."""
        ...

    def close(self) -> None: ...
