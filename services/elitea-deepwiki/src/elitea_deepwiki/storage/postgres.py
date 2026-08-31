"""The PostgreSQL backend — pgvector, tsvector and BM25 term statistics.

ADR-0022 decision 3. Three branches, three different degrees of parity with
the legacy file backend, and the differences are stated rather than smoothed:

**dense — exact.** pgvector's ``<->`` is L2, the same metric sqlite-vec's
``vec0`` KNN uses. Search runs as an exact sequential scan: no HNSW index
exists yet, deliberately (see ``migrations/0001``), because an approximate
index would make it impossible for the parity fixtures to distinguish a
storage-port bug from index recall.

**bm25 — exact.** The legacy standalone index is a whitespace-tokenised BM25
with ``k1=1.5``, ``b=0.75`` and
``idf = ln(1 + (N - df + 0.5) / (df + 0.5))``, computed over an mmap docstore.
Every part of that is reproducible, so it is reproduced: the same tokenizer,
the same formula, the same statistics, over ``wiki_bm25_*`` tables. Scores
match the fixtures to floating-point noise.

**fts — match set and ordering only.** The legacy branch is SQLite FTS5's
``bm25()`` over a ``porter unicode61`` index. PostgreSQL has neither that
tokenizer (Snowball is Porter2, FTS5 is Porter1) nor that scoring function.
This backend matches with ``plainto_tsquery`` — conjunctive, like FTS5's bare
terms — and scores with the same BM25 machinery over ``deepwiki_porter``
lexemes at FTS5's ``k1=1.2``, ``b=0.75``, negated to keep the legacy sign
convention. The absolute ``fts_rank`` values are therefore *not* expected to
equal the fixtures'. What is compared is the match set and the ordering, and
the residual divergence is measured and reported rather than assumed away.

The fused branch consumes FTS *positions*, not FTS scores, so fused parity
follows from ordering parity — which is why the ordering is the thing the
tests assert.

Requires the ``storage-postgres`` extra (psycopg).
"""

from __future__ import annotations

import math
from collections import Counter
from typing import Any, Iterable, Sequence

from .base import (
    DEFAULT_FTS_POOL,
    DEFAULT_FTS_WEIGHT,
    DEFAULT_VEC_POOL,
    DEFAULT_VEC_WEIGHT,
    Hit,
    Node,
    rrf_fuse,
)

#: The legacy standalone index's parameters (``bm25_disk.py``).
BM25_K1 = 1.5
BM25_B = 0.75

#: SQLite FTS5's ``bm25()`` defaults, used for the lexical branch so its
#: length normalisation at least matches the implementation being replaced.
FTS_K1 = 1.2
FTS_B = 0.75

#: The text-search configuration created by migration 0001.
TS_CONFIG = "deepwiki_porter"

#: Folds every non-alphanumeric character to a space, reproducing FTS5's
#: ``unicode61`` tokenizer. PostgreSQL's parser would otherwise keep
#: ``self.connection.execute`` whole as a ``host`` token and never index
#: ``connection`` at all. Migration 0001 applies the identical expression to
#: the stored ``fts`` column; the two MUST stay in step, so both sides read it
#: from here rather than spelling it out twice.
UNICODE61_FOLD = "regexp_replace(%s, '[^[:alnum:]]+', ' ', 'g')"

BRANCH_BM25 = "bm25"
BRANCH_FTS = "fts"


def whitespace_tokens(text: str) -> list[str]:
    """The legacy BM25 tokenizer.

    ``bm25_disk._default_tokenizer`` prefers langchain's
    ``default_preprocessing_func``, which is ``text.split()``, and falls back
    to the same thing. Both paths are a bare whitespace split with empty
    tokens dropped — no lowercasing, no punctuation stripping. Reproducing it
    exactly is what makes the BM25 branch exactly equal rather than merely
    similar; "improving" the tokenizer here would silently end parity.
    """
    return [token for token in text.split() if token]


def bm25_idf(doc_count: int, df: int) -> float:
    """``ln(1 + (N - df + 0.5) / (df + 0.5))`` — the legacy idf, verbatim."""
    return math.log(1.0 + (doc_count - df + 0.5) / (df + 0.5))


def score_norm(fts_rank: float) -> float:
    """``1 / (1 + exp(rank))`` — ``unified_db._attach_score_norm``, verbatim.

    Monotone in rank, so a more-negative (better) rank maps nearer to 1.0.
    Saturates cleanly instead of raising on extreme finite ranks.
    """
    if not math.isfinite(fts_rank):
        return 0.0
    try:
        return 1.0 / (1.0 + math.exp(fts_rank))
    except OverflowError:
        return 0.0 if fts_rank > 0 else 1.0


class PostgresBackend:
    """Per-wiki index storage on PostgreSQL."""

    name = "postgres"

    def __init__(self, connection, wiki_id: str) -> None:
        self.wiki_id = wiki_id
        self._conn = connection
        self._ensure_wiki_row()

    def _ensure_wiki_row(self) -> None:
        """The nodes table references ``wikis``; a backend needs its row."""
        with self._conn.cursor() as cursor:
            cursor.execute(
                "INSERT INTO wikis (wiki_id, repo, branch) VALUES (%s, %s, %s) "
                "ON CONFLICT (wiki_id) DO NOTHING",
                (self.wiki_id, self.wiki_id, "main"),
            )
        self._conn.commit()

    # -- write ------------------------------------------------------------

    def upsert_nodes(self, nodes: Sequence[Node]) -> None:
        """Insert or replace nodes.

        ``fts`` is a generated column, so the lexical index is maintained by
        the write itself — there is no equivalent of the legacy
        ``_populate_fts5`` full rebuild to forget to call.
        """
        if not nodes:
            return
        rows = [
            (
                self.wiki_id,
                node.node_id,
                node.rel_path,
                node.file_name,
                node.language,
                node.start_line,
                node.end_line,
                node.symbol_name,
                node.symbol_type,
                node.parent_symbol,
                node.source_text,
                node.docstring,
                node.signature,
                node.chunk_type,
                node.macro_cluster,
                node.micro_cluster,
            )
            for node in nodes
        ]
        with self._conn.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO wiki_nodes (
                    wiki_id, node_id, rel_path, file_name, language,
                    start_line, end_line, symbol_name, symbol_type,
                    parent_symbol, source_text, docstring, signature,
                    chunk_type, macro_cluster, micro_cluster
                ) VALUES (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                ON CONFLICT (wiki_id, node_id) DO UPDATE SET
                    rel_path      = EXCLUDED.rel_path,
                    file_name     = EXCLUDED.file_name,
                    language      = EXCLUDED.language,
                    start_line    = EXCLUDED.start_line,
                    end_line      = EXCLUDED.end_line,
                    symbol_name   = EXCLUDED.symbol_name,
                    symbol_type   = EXCLUDED.symbol_type,
                    parent_symbol = EXCLUDED.parent_symbol,
                    source_text   = EXCLUDED.source_text,
                    docstring     = EXCLUDED.docstring,
                    signature     = EXCLUDED.signature,
                    chunk_type    = EXCLUDED.chunk_type,
                    macro_cluster = EXCLUDED.macro_cluster,
                    micro_cluster = EXCLUDED.micro_cluster
                """,
                rows,
            )
        self._conn.commit()
        self._rebuild_fts_statistics()

    def upsert_embeddings(
        self, embeddings: Sequence[tuple[str, Sequence[float]]]
    ) -> None:
        if not embeddings:
            return
        rows = [
            (self.wiki_id, node_id, _vector_literal(vector))
            for node_id, vector in embeddings
        ]
        with self._conn.cursor() as cursor:
            cursor.executemany(
                "INSERT INTO wiki_node_embeddings (wiki_id, node_id, embedding) "
                "VALUES (%s, %s, %s::vector) "
                "ON CONFLICT (wiki_id, node_id) DO UPDATE "
                "SET embedding = EXCLUDED.embedding",
                rows,
            )
        self._conn.commit()

    def build_bm25(self, documents: Sequence[tuple[str, str]]) -> None:
        """Build the standalone BM25 statistics from ``(node_id, text)`` pairs.

        Mirrors ``bm25_disk.build_bm25_index``, including its skip rule:
        a document that tokenises to nothing is dropped and does not occupy a
        ``doc_idx``. That rule shifts every later document's index, so it also
        shifts ``avgdl`` — reproducing it is not cosmetic.
        """
        self._store_statistics(
            BRANCH_BM25,
            [(node_id, whitespace_tokens(text)) for node_id, text in documents],
            k1=BM25_K1,
            b=BM25_B,
        )

    def _rebuild_fts_statistics(self) -> None:
        """Derive the lexical branch's statistics from the stored tsvectors.

        Reading the lexemes back out of ``fts`` rather than re-tokenising in
        Python guarantees the statistics describe exactly what the index
        matches on. A term that ``plainto_tsquery`` can find always has a
        posting, and one it cannot never does.
        """
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT node_id, (
                    SELECT array_agg(lexeme ORDER BY lexeme)
                    FROM unnest(fts) AS l(lexeme, positions, weights)
                ), (
                    SELECT coalesce(sum(coalesce(array_length(positions, 1), 1)), 0)
                    FROM unnest(fts) AS l(lexeme, positions, weights)
                )
                FROM wiki_nodes
                WHERE wiki_id = %s
                ORDER BY node_id
                """,
                (self.wiki_id,),
            )
            rows = cursor.fetchall()

        documents: list[tuple[str, list[str]]] = []
        for node_id, lexemes, _length in rows:
            documents.append((node_id, list(lexemes or [])))

        # Term frequency per document has to come from the tsvector's position
        # counts, not from the deduplicated lexeme list.
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT n.node_id, l.lexeme,
                       coalesce(array_length(l.positions, 1), 1) AS tf
                FROM wiki_nodes n, unnest(n.fts) AS l(lexeme, positions, weights)
                WHERE n.wiki_id = %s
                """,
                (self.wiki_id,),
            )
            frequencies: dict[str, Counter[str]] = {}
            for node_id, lexeme, tf in cursor.fetchall():
                frequencies.setdefault(node_id, Counter())[lexeme] = int(tf)

        expanded = [
            (node_id, frequencies.get(node_id, Counter()))
            for node_id, _lexemes in documents
        ]
        self._store_statistics_from_counters(
            BRANCH_FTS, expanded, k1=FTS_K1, b=FTS_B
        )

    def _store_statistics(
        self,
        branch: str,
        documents: Sequence[tuple[str, Sequence[str]]],
        *,
        k1: float,
        b: float,
    ) -> None:
        self._store_statistics_from_counters(
            branch,
            [(node_id, Counter(tokens)) for node_id, tokens in documents],
            k1=k1,
            b=b,
            lengths={node_id: len(tokens) for node_id, tokens in documents},
        )

    def _store_statistics_from_counters(
        self,
        branch: str,
        documents: Sequence[tuple[str, Counter]],
        *,
        k1: float,
        b: float,
        lengths: dict[str, int] | None = None,
    ) -> None:
        doc_rows: list[tuple[Any, ...]] = []
        posting_rows: list[tuple[Any, ...]] = []
        df: Counter[str] = Counter()
        total_length = 0
        doc_idx = 0

        for node_id, counts in documents:
            length = (
                lengths[node_id] if lengths is not None else sum(counts.values())
            )
            # Legacy skip rule: an empty document occupies no doc_idx at all.
            if length == 0:
                continue
            doc_rows.append((self.wiki_id, branch, doc_idx, node_id, length))
            for term, tf in counts.items():
                posting_rows.append((self.wiki_id, branch, term, doc_idx, int(tf)))
                df[term] += 1
            total_length += length
            doc_idx += 1

        doc_count = doc_idx
        avgdl = (total_length / doc_count) if doc_count else 1.0

        with self._conn.cursor() as cursor:
            for table in (
                "wiki_bm25_postings",
                "wiki_bm25_terms",
                "wiki_bm25_docs",
                "wiki_bm25_meta",
            ):
                cursor.execute(
                    f"DELETE FROM {table} WHERE wiki_id = %s AND branch = %s",
                    (self.wiki_id, branch),
                )

            cursor.execute(
                "INSERT INTO wiki_bm25_meta "
                "(wiki_id, branch, doc_count, avgdl, k1, b) "
                "VALUES (%s, %s, %s, %s, %s, %s)",
                (self.wiki_id, branch, doc_count, avgdl, k1, b),
            )
            if doc_rows:
                cursor.executemany(
                    "INSERT INTO wiki_bm25_docs "
                    "(wiki_id, branch, doc_idx, node_id, length) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    doc_rows,
                )
            if df:
                cursor.executemany(
                    "INSERT INTO wiki_bm25_terms (wiki_id, branch, term, df) "
                    "VALUES (%s, %s, %s, %s)",
                    [(self.wiki_id, branch, term, count) for term, count in df.items()],
                )
            if posting_rows:
                cursor.executemany(
                    "INSERT INTO wiki_bm25_postings "
                    "(wiki_id, branch, term, doc_idx, tf) "
                    "VALUES (%s, %s, %s, %s, %s)",
                    posting_rows,
                )
        self._conn.commit()

    # -- read -------------------------------------------------------------

    def _bm25_scores(
        self, branch: str, terms: Sequence[str]
    ) -> dict[str, float]:
        """Score every document matching ``terms``, in one query per branch.

        The arithmetic is done in SQL so the whole posting list never has to
        cross into Python. The formula is the legacy one, term for term,
        including the per-query-term multiplier the legacy loop applied by
        iterating a ``Counter``.
        """
        if not terms:
            return {}

        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT doc_count, avgdl, k1, b FROM wiki_bm25_meta "
                "WHERE wiki_id = %s AND branch = %s",
                (self.wiki_id, branch),
            )
            meta = cursor.fetchone()
            if meta is None:
                return {}
            doc_count, avgdl, k1, b = meta
            if not doc_count:
                return {}
            avgdl = float(avgdl) if avgdl > 0 else 1.0

            query_tf = Counter(terms)
            cursor.execute(
                """
                SELECT d.node_id,
                       sum(
                           ln(1.0 + (%s::float8 - t.df + 0.5) / (t.df + 0.5))
                           * ((p.tf * (%s::float8 + 1.0))
                              / (p.tf + %s::float8
                                 * (1.0 - %s::float8
                                    + %s::float8 * d.length / %s::float8)))
                           * q.query_tf
                       ) AS score
                FROM wiki_bm25_postings p
                JOIN wiki_bm25_terms t
                  ON t.wiki_id = p.wiki_id
                 AND t.branch  = p.branch
                 AND t.term    = p.term
                JOIN wiki_bm25_docs d
                  ON d.wiki_id = p.wiki_id
                 AND d.branch  = p.branch
                 AND d.doc_idx = p.doc_idx
                JOIN unnest(%s::text[], %s::float8[]) AS q(term, query_tf)
                  ON q.term = p.term
                WHERE p.wiki_id = %s AND p.branch = %s AND t.df > 0
                GROUP BY d.node_id
                """,
                (
                    float(doc_count),
                    float(k1),
                    float(k1),
                    float(b),
                    float(b),
                    avgdl,
                    list(query_tf.keys()),
                    [float(value) for value in query_tf.values()],
                    self.wiki_id,
                    branch,
                ),
            )
            return {node_id: float(score) for node_id, score in cursor.fetchall()}

    def _node_metadata(self, node_ids: Iterable[str]) -> dict[str, dict[str, str]]:
        ids = list(node_ids)
        if not ids:
            return {}
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT node_id, rel_path, symbol_name, symbol_type "
                "FROM wiki_nodes WHERE wiki_id = %s AND node_id = ANY(%s)",
                (self.wiki_id, ids),
            )
            return {
                row[0]: {
                    "rel_path": row[1],
                    "symbol_name": row[2],
                    "symbol_type": row[3],
                }
                for row in cursor.fetchall()
            }

    def _hits(
        self, scored: Sequence[tuple[str, dict[str, float]]]
    ) -> list[Hit]:
        metadata = self._node_metadata(node_id for node_id, _ in scored)
        hits = []
        for node_id, scores in scored:
            meta = metadata.get(node_id, {})
            hits.append(
                Hit(
                    node_id=node_id,
                    rel_path=meta.get("rel_path", ""),
                    symbol_name=meta.get("symbol_name", ""),
                    symbol_type=meta.get("symbol_type", ""),
                    scores=scores,
                )
            )
        return hits

    def search_fts(self, query: str, *, limit: int = DEFAULT_FTS_POOL) -> list[Hit]:
        """Conjunctive lexical match, BM25-scored, legacy sign convention.

        ``plainto_tsquery`` ANDs its lexemes, which is what FTS5 does with bare
        terms in a ``MATCH`` expression.

        ``websearch_to_tsquery`` also ANDs unquoted terms, so it is not a
        disjunction hazard — but it additionally reads ``or``, ``-`` and double
        quotes as *operators*, which means a user question containing the word
        "or" would silently become a disjunction. ``plainto_tsquery`` treats
        every character as data, which is what a question typed into an ask
        box should be.
        """
        if not query or not query.strip():
            return []

        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT n.node_id
                FROM wiki_nodes n
                WHERE n.wiki_id = %s
                  AND n.fts @@ plainto_tsquery(
                          %s, regexp_replace(%s, '[^[:alnum:]]+', ' ', 'g')
                      )
                """,
                (self.wiki_id, TS_CONFIG, query),
            )
            matched = [row[0] for row in cursor.fetchall()]

            if not matched:
                return []

            # The query's lexemes under the same configuration. A tsquery is
            # not unnestable, so the lexeme set is taken from to_tsvector of
            # the same text — which is exactly what plainto_tsquery ANDs.
            cursor.execute(
                "SELECT array_agg(lexeme) FROM unnest(to_tsvector("
                "  %s, regexp_replace(%s, '[^[:alnum:]]+', ' ', 'g')"
                "))",
                (TS_CONFIG, query),
            )
            row = cursor.fetchone()
            terms = list(row[0] or []) if row else []

        scores = self._bm25_scores(BRANCH_FTS, terms)

        scored: list[tuple[str, dict[str, float]]] = []
        for node_id in matched:
            # Negated: the legacy branch reports FTS5's rank, where more
            # negative is better, and everything downstream (score_norm, the
            # ORDER BY, the fixtures) assumes that sign.
            rank = -scores.get(node_id, 0.0)
            scored.append(
                (node_id, {"fts_rank": rank, "score_norm": score_norm(rank)})
            )

        # Ascending rank == descending relevance. Ties break on node_id so the
        # order is total and a parity run cannot be defeated by hash ordering.
        scored.sort(key=lambda item: (item[1]["fts_rank"], item[0]))
        return self._hits(scored[:limit])

    def search_dense(
        self, embedding: Sequence[float], *, k: int = DEFAULT_VEC_POOL
    ) -> list[Hit]:
        """Exact L2 KNN. No HNSW index exists yet — see migration 0001."""
        with self._conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT e.node_id, e.embedding <-> %s::vector AS distance
                FROM wiki_node_embeddings e
                WHERE e.wiki_id = %s
                ORDER BY distance, e.node_id
                LIMIT %s
                """,
                (_vector_literal(embedding), self.wiki_id, k),
            )
            rows = cursor.fetchall()
        return self._hits(
            [(node_id, {"vec_distance": float(distance)}) for node_id, distance in rows]
        )

    def search_bm25(self, query: str, *, k: int = 10) -> list[Hit]:
        terms = whitespace_tokens(query or "")
        scores = self._bm25_scores(BRANCH_BM25, terms)
        if not scores:
            return []
        ordered = sorted(scores.items(), key=lambda item: (-item[1], item[0]))[:k]
        return self._hits([(node_id, {"bm25_score": score}) for node_id, score in ordered])

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
        dense = self.search_dense(embedding, k=vec_pool) if embedding else []
        return rrf_fuse(
            fts, dense, fts_weight=fts_weight, vec_weight=vec_weight, limit=limit
        )

    # -- lifecycle --------------------------------------------------------

    def stats(self) -> dict[str, Any]:
        with self._conn.cursor() as cursor:
            cursor.execute(
                "SELECT count(*) FROM wiki_nodes WHERE wiki_id = %s", (self.wiki_id,)
            )
            nodes = cursor.fetchone()[0]
            cursor.execute(
                "SELECT count(*) FROM wiki_node_embeddings WHERE wiki_id = %s",
                (self.wiki_id,),
            )
            vectors = cursor.fetchone()[0]
            cursor.execute(
                "SELECT branch, doc_count, avgdl, k1, b FROM wiki_bm25_meta "
                "WHERE wiki_id = %s ORDER BY branch",
                (self.wiki_id,),
            )
            branches = {
                row[0]: {
                    "doc_count": row[1],
                    "avgdl": float(row[2]),
                    "k1": float(row[3]),
                    "b": float(row[4]),
                }
                for row in cursor.fetchall()
            }
        return {
            "backend": self.name,
            "wiki_id": self.wiki_id,
            "node_count": nodes,
            "vector_count": vectors,
            "bm25_branches": branches,
            "dense_index": "exact scan (no HNSW yet — migration 0001)",
            "text_search_config": TS_CONFIG,
        }

    def close(self) -> None:
        """The connection is owned by the caller; nothing to release here."""
        return None


def _vector_literal(vector: Sequence[float]) -> str:
    """Render a vector in pgvector's text input form."""
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"
