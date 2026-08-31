#!/usr/bin/env python3
"""Record retrieval-parity fixtures by running the legacy retrieval code.

This is the fixture set that gates ADR-0022 decision 3 — the SQLite/FAISS ->
PostgreSQL(pgvector + tsvector) storage port.  Nothing here is transcribed: the
rankings are produced by importing the legacy modules and executing them.

    plugin_implementation/unified_db.py    FTS5 (BM25 via sqlite rank), sqlite-vec
                                           KNN, and the RRF fusion in search_hybrid
    plugin_implementation/bm25_disk.py     the standalone disk BM25 postings index
    plugin_implementation/docstore.py      the mmap docstore BM25 is built from

Determinism, and why no LLM is needed
-------------------------------------
* The corpus is the checked-in sample repository under
  ``fixtures/retrieval/sample-repo/corpus/``.
* Chunking is done here by a deliberately trivial top-level ``def``/``class``
  splitter (``chunk_corpus``), *not* by the legacy tree-sitter pipeline.
  Parser/chunker parity is out of P0 scope; the chunk set is itself a
  checked-in fixture (``nodes.json``) so the retrieval fixtures stand on a
  frozen input regardless.
* Embeddings come from ``StubEmbedder``: a seeded, hash-bucketed bag-of-tokens
  projection with L2 normalisation.  It is a pure function of the text and the
  parameters recorded in the fixture, so every replay — including one against
  pgvector — reproduces the same vectors without calling a model.

Outputs (under ``fixtures/retrieval/sample-repo/``):

    corpus/                the sample repository (input, checked in)
    nodes.json             the frozen chunk set indexed into repo_nodes
    embedding_model.json   the stub embedder's parameters and per-node vectors
    index_stats.json       row counts, schema objects and BM25 index statistics
    queries/<slug>.json    per query: dense, bm25, fts and fused rankings WITH
                           scores (never just the top hit)

Usage:
    python tools/record_retrieval.py [--check]

Requires the legacy checkout plus ``networkx``, ``sqlite-vec``,
``langchain-core`` and ``langchain-community`` (see ../pyproject.toml).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import shutil
import struct
import sys
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Sequence

sys.path.insert(0, str(Path(__file__).resolve().parent))

from _legacy import legacy_root, source_pin  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "fixtures" / "retrieval" / "sample-repo"
CORPUS = FIXTURES / "corpus"

SOURCE_FILES = [
    "plugin_implementation/unified_db.py",
    "plugin_implementation/bm25_disk.py",
    "plugin_implementation/docstore.py",
    "plugin_implementation/unified_retriever.py",
]

#: Pinned identity of the sample repository, in the legacy identifier format
#: ``owner/repo:branch:commit8``.
SAMPLE_REPO_IDENTIFIER = "acme/notes-service:main:0000000"

EMBEDDING_DIM = 64
EMBEDDING_SEED = "deepwiki-conformance-v1"

#: Retrieval knobs; these are the legacy defaults from unified_retriever.py
#: (DEFAULT_FTS_WEIGHT / DEFAULT_VEC_WEIGHT / FTS_POOL / VEC_POOL) and
#: unified_db.search_hybrid (rrf_constant = 60).
FTS_WEIGHT = 0.4
VEC_WEIGHT = 0.6
FTS_POOL = 30
VEC_POOL = 30
RRF_CONSTANT = 60.0
TOP_K = 10
#: The per-branch lists are recorded in full (not truncated to TOP_K) so a
#: replay can recompute the fused ranking from them and check the RRF formula
#: rather than trusting the recorded fused list.
BM25_K = 100

QUERIES = [
    ("how are notes stored", "notes-storage"),
    ("verify bearer token signature", "token-verification"),
    ("rank search results by relevance", "search-ranking"),
    ("delete a note permanently", "note-deletion"),
    # Short queries: FTS5 MATCH is conjunctive, so long natural-language
    # questions return 0-1 rows while short term queries exercise the ranked
    # FTS list properly. Both shapes are recorded on purpose.
    ("note", "term-note"),
    ("search index", "term-search-index"),
    # A query with no lexical or dense support anywhere in the corpus.
    ("kubernetes scheduler", "no-match"),
]


# ---------------------------------------------------------------------------
# corpus -> nodes
# ---------------------------------------------------------------------------

_TOP_LEVEL = re.compile(r"^(def|class)\s+([A-Za-z_][A-Za-z0-9_]*)")
_NESTED = re.compile(r"^    (def)\s+([A-Za-z_][A-Za-z0-9_]*)")
_DOCSTRING = re.compile(r'"""(.*?)"""', re.DOTALL)


def _docstring_of(text: str) -> str:
    match = _DOCSTRING.search(text)
    return " ".join(match.group(1).split()) if match else ""


def chunk_corpus() -> List[Dict[str, Any]]:
    """Split the sample repository into symbol-level nodes.

    Deliberately simple and stable: a module-level node per file (its module
    docstring plus imports), one node per top-level ``def``/``class``, and one
    node per method inside a class.  Markdown files become a single doc node.
    """
    nodes: List[Dict[str, Any]] = []

    for path in sorted(CORPUS.rglob("*")):
        if not path.is_file():
            continue
        rel = path.relative_to(CORPUS).as_posix()
        text = path.read_text(encoding="utf-8")

        if path.suffix == ".md":
            nodes.append(
                {
                    "node_id": f"{rel}::module",
                    "rel_path": rel,
                    "file_name": path.name,
                    "language": "markdown",
                    "start_line": 1,
                    "end_line": len(text.splitlines()),
                    "symbol_name": path.stem,
                    "symbol_type": "file_doc",
                    "parent_symbol": None,
                    "signature": "",
                    "docstring": "",
                    "source_text": text,
                }
            )
            continue

        if path.suffix != ".py":
            continue

        lines = text.splitlines()
        # Boundaries of top-level definitions.
        starts = [i for i, line in enumerate(lines) if _TOP_LEVEL.match(line)]
        module_end = starts[0] if starts else len(lines)
        module_text = "\n".join(lines[:module_end]).strip()
        if module_text:
            nodes.append(
                {
                    "node_id": f"{rel}::module",
                    "rel_path": rel,
                    "file_name": path.name,
                    "language": "python",
                    "start_line": 1,
                    "end_line": module_end,
                    "symbol_name": path.stem,
                    "symbol_type": "module_doc",
                    "parent_symbol": None,
                    "signature": "",
                    "docstring": _docstring_of(module_text),
                    "source_text": module_text,
                }
            )

        for idx, start in enumerate(starts):
            end = starts[idx + 1] if idx + 1 < len(starts) else len(lines)
            block = lines[start:end]
            kind, name = _TOP_LEVEL.match(lines[start]).groups()
            body = "\n".join(block).rstrip()
            nodes.append(
                {
                    "node_id": f"{rel}::{name}",
                    "rel_path": rel,
                    "file_name": path.name,
                    "language": "python",
                    "start_line": start + 1,
                    "end_line": end,
                    "symbol_name": name,
                    "symbol_type": "class" if kind == "class" else "function",
                    "parent_symbol": None,
                    "signature": lines[start].strip(),
                    "docstring": _docstring_of(body),
                    "source_text": body,
                }
            )

            if kind != "class":
                continue

            method_starts = [
                i for i, line in enumerate(block) if _NESTED.match(line)
            ]
            for m_idx, m_start in enumerate(method_starts):
                m_end = (
                    method_starts[m_idx + 1]
                    if m_idx + 1 < len(method_starts)
                    else len(block)
                )
                m_block = block[m_start:m_end]
                m_name = _NESTED.match(block[m_start]).group(2)
                m_body = "\n".join(m_block).rstrip()
                nodes.append(
                    {
                        "node_id": f"{rel}::{name}.{m_name}",
                        "rel_path": rel,
                        "file_name": path.name,
                        "language": "python",
                        "start_line": start + m_start + 1,
                        "end_line": start + m_end,
                        "symbol_name": m_name,
                        "symbol_type": "method",
                        "parent_symbol": name,
                        "signature": block[m_start].strip(),
                        "docstring": _docstring_of(m_body),
                        "source_text": m_body,
                    }
                )

    nodes.sort(key=lambda n: n["node_id"])
    return nodes


# ---------------------------------------------------------------------------
# deterministic embeddings
# ---------------------------------------------------------------------------

_TOKEN = re.compile(r"[A-Za-z][A-Za-z0-9]+")


class StubEmbedder:
    """Seeded hash-bucketed bag-of-tokens embedder.

    ``embed(text)`` lowercases the text, splits it on ``[A-Za-z][A-Za-z0-9]+``,
    also emits the ``_``-separated sub-tokens of each identifier, hashes every
    token with ``sha256(seed + ":" + token)``, adds ``1.0`` into the bucket
    ``int(digest[:8], 16) % dim``, then L2-normalises.  Vectors are rounded to
    six decimal places so the JSON fixture is byte-stable across platforms.
    """

    def __init__(self, dim: int = EMBEDDING_DIM, seed: str = EMBEDDING_SEED):
        self.dim = dim
        self.seed = seed

    def tokens(self, text: str) -> List[str]:
        out: List[str] = []
        for raw in _TOKEN.findall(text.replace("_", " _ ")):
            token = raw.lower()
            out.append(token)
        for part in re.split(r"[^A-Za-z0-9]+", text):
            if "_" in part:
                out.extend(p.lower() for p in part.split("_") if p)
        return out

    def embed(self, text: str) -> List[float]:
        vector = [0.0] * self.dim
        for token in self.tokens(text):
            digest = hashlib.sha256(f"{self.seed}:{token}".encode()).hexdigest()
            vector[int(digest[:8], 16) % self.dim] += 1.0
        norm = math.sqrt(sum(value * value for value in vector))
        if norm == 0.0:
            return vector
        return [round(value / norm, 6) for value in vector]

    def params(self) -> Dict[str, Any]:
        return {
            "kind": "stub-hash-bag-of-tokens",
            "dim": self.dim,
            "seed": self.seed,
            "hash": "sha256",
            "bucket": "int(sha256(seed + ':' + token).hexdigest()[:8], 16) % dim",
            "token_pattern": _TOKEN.pattern,
            "underscore_handling": "identifiers are also split on '_' and the parts"
            " contribute their own buckets",
            "normalisation": "L2, values rounded to 6 decimal places",
            "why": "removes any live model from the retrieval fixtures; the same"
            " function must be used when replaying against pgvector",
        }


def node_embedding_text(node: Dict[str, Any]) -> str:
    """The text embedded for a node: name + signature + docstring + source."""
    return "\n".join(
        part
        for part in (
            node.get("symbol_name", ""),
            node.get("signature", ""),
            node.get("docstring", ""),
            node.get("source_text", ""),
        )
        if part
    )


# ---------------------------------------------------------------------------
# index construction + recording
# ---------------------------------------------------------------------------


def _import_legacy():
    root = legacy_root()
    if str(root) not in sys.path:
        sys.path.insert(0, str(root))
    from plugin_implementation import bm25_disk, docstore, unified_db  # noqa

    return unified_db, bm25_disk, docstore


def _round_scores(value: Any) -> Any:
    if isinstance(value, float):
        return round(value, 9)
    return value


def _project(row: Dict[str, Any], score_keys: Sequence[str]) -> Dict[str, Any]:
    out = {
        "node_id": row.get("node_id"),
        "rel_path": row.get("rel_path"),
        "symbol_name": row.get("symbol_name"),
        "symbol_type": row.get("symbol_type"),
    }
    for key in score_keys:
        if key in row:
            out[key] = _round_scores(row[key])
    return out


def build_and_record() -> Dict[Path, Any]:
    unified_db, bm25_disk, docstore = _import_legacy()
    from langchain_core.documents import Document

    nodes = chunk_corpus()
    embedder = StubEmbedder()
    embeddings = {n["node_id"]: embedder.embed(node_embedding_text(n)) for n in nodes}

    workdir = Path(tempfile.mkdtemp(prefix="deepwiki-conformance-"))
    try:
        db_path = workdir / "sample.wiki.db"
        db = unified_db.UnifiedWikiDB(db_path, embedding_dim=EMBEDDING_DIM)
        if not db.vec_available:
            raise RuntimeError(
                "sqlite-vec is not loadable in this interpreter; the dense ranking"
                " cannot be recorded. Install sqlite-vec (see ../pyproject.toml)."
            )

        db.upsert_nodes_batch(nodes)
        db.conn.commit()
        db._populate_fts5()
        db.upsert_embeddings_batch([(nid, vec) for nid, vec in embeddings.items()])
        db.conn.commit()

        # Standalone disk BM25 index, built through the legacy docstore path.
        cache_key = "sample"
        documents = [
            Document(
                page_content=node_embedding_text(node),
                metadata={"uuid": node["node_id"], "source": node["rel_path"]},
            )
            for node in nodes
        ]
        docstore.build_docstore_cache(documents, workdir, cache_key)
        bm25 = bm25_disk.load_or_build_bm25_index(workdir, cache_key, rebuild=True)
        if bm25 is None:
            raise RuntimeError("BM25 index build returned None")

        queries_out: Dict[str, Any] = {}
        for query, slug in QUERIES:
            query_vec = embedder.embed(query)

            fts = db.search_fts5(query, limit=FTS_POOL)
            vec = db.search_vec(query_vec, k=VEC_POOL)
            fused = db.search_hybrid(
                query=query,
                embedding=query_vec,
                fts_weight=FTS_WEIGHT,
                vec_weight=VEC_WEIGHT,
                limit=TOP_K,
                fts_k=FTS_POOL,
                vec_k=VEC_POOL,
            )
            bm25_hits = bm25.search(query, k=BM25_K)

            queries_out[slug] = {
                "query": query,
                "query_embedding": query_vec,
                "rankings": {
                    "fts": {
                        "producer": "UnifiedWikiDB.search_fts5",
                        "backend": "SQLite FTS5, tokenize='porter unicode61',"
                        " ORDER BY rank (bm25)",
                        "target": "PostgreSQL tsvector + GIN",
                        "scores": {
                            "fts_rank": "raw FTS5 bm25() rank; more negative is better",
                            "score_norm": "1 / (1 + exp(fts_rank)) — monotone in rank",
                        },
                        "match_semantics": "FTS5 MATCH is CONJUNCTIVE: every bare"
                        " term must appear in the row, so a multi-word natural"
                        " language question usually matches 0-1 rows. A tsvector"
                        " port must reproduce this (plainto_tsquery, not"
                        " websearch_to_tsquery/OR) or the fused ranking shifts."
                        " On an FTS5 syntax error the legacy code retries once"
                        " with the query suffixed by '*' and then returns [].",
                        "results": [
                            _project(row, ("fts_rank", "score_norm"))
                            for row in fts
                        ],
                        "total_matches": len(fts),
                    },
                    "dense": {
                        "producer": "UnifiedWikiDB.search_vec",
                        "backend": "sqlite-vec vec0 KNN, float32[64], L2 distance",
                        "target": "pgvector HNSW",
                        "scores": {"vec_distance": "lower is better"},
                        "results": [
                            _project(row, ("vec_distance",)) for row in vec
                        ],
                        "total_matches": len(vec),
                    },
                    "bm25": {
                        "producer": "bm25_disk.BM25SqliteIndex.search",
                        "backend": "standalone SQLite postings index over the mmap"
                        " docstore; k1=1.5, b=0.75, whitespace tokenizer",
                        "target": "PostgreSQL term-statistics tables or ts_rank"
                        " substitution (ADR-0022 Consequences)",
                        "scores": {"bm25_score": "higher is better"},
                        "results": [
                            {"node_id": doc_id, "bm25_score": round(score, 9)}
                            for doc_id, score in bm25_hits
                        ],
                        "total_matches": len(bm25_hits),
                    },
                    "fused": {
                        "producer": "UnifiedWikiDB.search_hybrid",
                        "formula": "combined_score(id) = fts_weight/(k + fts_rank_pos)"
                        " + vec_weight/(k + vec_rank_pos), 1-based positions,"
                        f" k={RRF_CONSTANT}, fts_weight={FTS_WEIGHT},"
                        f" vec_weight={VEC_WEIGHT}",
                        "note": "this is a *weighted* RRF over the FTS and dense"
                        " lists only — the standalone BM25 index is not an input;"
                        " ties are broken by Python's stable sort on"
                        " combined_score, so equal scores keep set iteration"
                        " order and are NOT a stable contract",
                        "scores": {"combined_score": "higher is better"},
                        "results": [
                            _project(row, ("combined_score", "fts_rank", "vec_distance"))
                            for row in fused
                        ],
                    },
                },
            }

        stats = {
            "node_count": db.node_count(),
            "edge_count": db.edge_count(),
            "fts_row_count": db.conn.execute(
                "SELECT count(*) FROM repo_fts"
            ).fetchone()[0],
            "vec_row_count": db.conn.execute(
                "SELECT count(*) FROM repo_vec"
            ).fetchone()[0],
            "bm25": {
                "doc_count": bm25.doc_count,
                "term_count": _bm25_term_count(bm25),
                "avgdl": round(bm25._avgdl, 9),
                "k1": bm25._k1,
                "b": bm25._b,
            },
            "sqlite_objects": [
                row[0]
                for row in db.conn.execute(
                    "SELECT name FROM sqlite_master WHERE type IN ('table','index')"
                    " AND name NOT LIKE 'sqlite_%' ORDER BY name"
                ).fetchall()
            ],
        }
        db.close()
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    pin = source_pin(SOURCE_FILES)

    outputs: Dict[Path, Any] = {
        FIXTURES
        / "nodes.json": {
            "_source": pin,
            "repo_identifier": SAMPLE_REPO_IDENTIFIER,
            "chunker": "conformance/tools/record_retrieval.py::chunk_corpus"
            " (NOT the legacy tree-sitter pipeline — chunker parity is out of"
            " P0 scope; this chunk set is the frozen input)",
            "node_count": len(nodes),
            "nodes": nodes,
        },
        FIXTURES
        / "embedding_model.json": {
            "_source": pin,
            "embedder": embedder.params(),
            "embedded_text": "symbol_name + signature + docstring + source_text,"
            " newline-joined, empty parts dropped",
            "vectors": embeddings,
        },
        FIXTURES
        / "index_stats.json": {
            "_source": pin,
            "repo_identifier": SAMPLE_REPO_IDENTIFIER,
            "legacy_storage": {
                "unified_db": "<cache_key>.wiki.db — repo_nodes, repo_edges,"
                " repo_fts (FTS5), repo_vec (sqlite-vec), wiki_meta",
                "bm25": "<cache_key>.bm25.sqlite — meta, docs, terms, postings",
                "docstore": "<cache_key>.docstore.bin + <cache_key>.doc_index.json",
            },
            "target_storage": "one dedicated PostgreSQL database; pgvector(HNSW)"
            " for repo_vec, tsvector+GIN for repo_fts, ordinary tables keyed by"
            " wiki_id for the rest (ADR-0022 decision 3)",
            "stats": stats,
        },
    }

    for slug, payload in queries_out.items():
        payload["_source"] = pin
        payload["parameters"] = {
            "top_k": TOP_K,
            "fts_pool": FTS_POOL,
            "vec_pool": VEC_POOL,
            "fts_weight": FTS_WEIGHT,
            "vec_weight": VEC_WEIGHT,
            "rrf_constant": RRF_CONSTANT,
        }
        outputs[FIXTURES / "queries" / f"{slug}.json"] = payload

    return outputs


def _bm25_term_count(index) -> int:
    import sqlite3

    conn = sqlite3.connect(f"file:{index._db_path}?mode=ro", uri=True)
    try:
        return conn.execute("SELECT count(*) FROM terms").fetchone()[0]
    finally:
        conn.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    outputs = build_and_record()

    if args.check:
        drift = []
        for path, payload in outputs.items():
            want = json.dumps(payload, indent=2, ensure_ascii=False) + "\n"
            if not path.is_file() or path.read_text(encoding="utf-8") != want:
                drift.append(str(path))
        if drift:
            print("retrieval fixtures are stale:", file=sys.stderr)
            for item in drift:
                print(f"  {item}", file=sys.stderr)
            return 1
        print("retrieval fixtures match the legacy engine")
        return 0

    for path, payload in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )
        print(f"wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
