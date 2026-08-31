"""Publish a generated index from ephemeral scratch into PostgreSQL.

ADR-0022 decision 3 makes query replicas stateless; decision 4 demotes the PVC
to ephemeral scratch. Those two together mean generation may still build files
— it is bounded by slot accounting and runs on the pod that owns the work — but
whatever it builds has to reach PostgreSQL before any other replica can answer
a query about it.

This is that step. It reads the ``.wiki.db`` a generation produced and writes
its nodes, edges, embeddings and BM25 statistics through
:class:`~elitea_deepwiki.storage.postgres.PostgresBackend`.

It is deliberately a separate, callable step rather than something bolted into
the engine: the engine is a verbatim copy, and a publish that fails must be
visible as a publish failure rather than as a generation that appears to have
worked and then cannot be queried.
"""

from __future__ import annotations

import logging
import sqlite3
from pathlib import Path
from typing import Any, Iterator

from .base import Node
from .postgres import PostgresBackend

logger = logging.getLogger(__name__)

#: Columns read out of the legacy ``repo_nodes`` table.
_SOURCE_COLUMNS = (
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
    "chunk_type",
    "macro_cluster",
    "micro_cluster",
    "is_architectural",
    "is_doc",
    "is_test",
)

_BATCH = 500


class PublishError(RuntimeError):
    """Raised when a generated index cannot be published."""


def _open_readonly(path: Path) -> sqlite3.Connection:
    """Open a generated index, with sqlite-vec loaded.

    ``repo_vec`` is a sqlite-vec *virtual* table. A plain connection cannot
    read it — every query raises "no such module: vec0" — so without loading
    the extension here the publisher silently ships zero dense vectors and
    retrieval comes back FTS-only, with nothing to say it happened. That is
    exactly the failure this function exists to prevent.
    """
    connection = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    connection.row_factory = sqlite3.Row
    try:
        import sqlite_vec  # noqa: PLC0415

        connection.enable_load_extension(True)
        sqlite_vec.load(connection)
        connection.enable_load_extension(False)
    except Exception:  # noqa: BLE001 - absence is handled where it matters
        logger.debug("sqlite-vec not loadable while opening %s", path, exc_info=True)
    return connection


def _iter_nodes(connection: sqlite3.Connection) -> Iterator[Node]:
    columns = ", ".join(_SOURCE_COLUMNS)
    for row in connection.execute(f"SELECT {columns} FROM repo_nodes"):
        yield Node(
            node_id=row["node_id"],
            rel_path=row["rel_path"] or "",
            file_name=row["file_name"] or "",
            language=row["language"] or "",
            start_line=row["start_line"] or 0,
            end_line=row["end_line"] or 0,
            symbol_name=row["symbol_name"] or "",
            symbol_type=row["symbol_type"] or "",
            parent_symbol=row["parent_symbol"],
            source_text=row["source_text"] or "",
            docstring=row["docstring"] or "",
            signature=row["signature"] or "",
            chunk_type=row["chunk_type"],
            macro_cluster=row["macro_cluster"],
            micro_cluster=row["micro_cluster"],
            # Pass through what the generation decided; re-deriving them here
            # would be a second implementation of the same rule.
            is_architectural=bool(row["is_architectural"]),
            is_doc=bool(row["is_doc"]),
            is_test=bool(row["is_test"]),
        )


def _iter_embeddings(
    connection: sqlite3.Connection,
) -> Iterator[tuple[str, list[float]]]:
    """Read dense vectors out of the sqlite-vec table, if there is one.

    A wiki generated without embeddings is legitimate — the retriever falls
    back to FTS-only — so a missing ``repo_vec`` is not an error here. It is
    reported, because "no vectors were published" and "the dense branch is
    quietly empty" look identical at query time otherwise.
    """
    import struct  # noqa: PLC0415

    present = connection.execute(
        "SELECT count(*) FROM sqlite_master WHERE name = 'repo_vec'"
    ).fetchone()[0]
    if not present:
        # Legitimate: a wiki generated without embeddings. The retriever falls
        # back to FTS-only, and the caller sees embeddings=0 in the counts.
        logger.warning("no repo_vec table: publishing without dense vectors")
        return

    try:
        rows = connection.execute("SELECT node_id, embedding FROM repo_vec").fetchall()
    except sqlite3.OperationalError as exc:
        # The table exists and cannot be read — almost always sqlite-vec not
        # loaded. Publishing zero vectors here would look identical to a wiki
        # that never had any, so it raises instead.
        raise PublishError(
            f"repo_vec exists but cannot be read ({exc}). The publisher needs "
            "the sqlite-vec extension; refusing to publish an index with its "
            "dense vectors silently missing."
        ) from exc

    for row in rows:
        blob = row["embedding"]
        if not blob:
            continue
        count = len(blob) // 4
        if count:
            yield row["node_id"], list(struct.unpack(f"{count}f", blob))


def _iter_edges(connection: sqlite3.Connection) -> Iterator[dict[str, Any]]:
    try:
        rows = connection.execute(
            "SELECT source_id, target_id, rel_type, edge_class, weight FROM repo_edges"
        ).fetchall()
    except sqlite3.OperationalError:
        return
    for row in rows:
        yield {
            "source_id": row["source_id"],
            "target_id": row["target_id"],
            "rel_type": row["rel_type"] or "",
            "edge_class": row["edge_class"],
            "weight": float(row["weight"] or 1.0),
        }


def publish_wiki_db(
    connection,
    wiki_id: str,
    db_path: str | Path,
    *,
    registry: dict[str, Any] | None = None,
) -> dict[str, int]:
    """Publish one generated ``.wiki.db`` into PostgreSQL.

    Returns the counts written, so a caller can assert something arrived
    rather than assume it.
    """
    path = Path(db_path)
    if not path.is_file():
        raise PublishError(f"no generated index at {path}")

    source = _open_readonly(path)
    try:
        backend = PostgresBackend(connection, wiki_id)

        if registry:
            _update_registry(connection, wiki_id, registry)

        nodes = list(_iter_nodes(source))
        if not nodes:
            raise PublishError(
                f"{path} contains no repo_nodes rows; refusing to publish an "
                "empty index over a possibly-good one"
            )

        for start in range(0, len(nodes), _BATCH):
            backend.upsert_nodes(nodes[start : start + _BATCH])

        embeddings = list(_iter_embeddings(source))
        for start in range(0, len(embeddings), _BATCH):
            backend.upsert_embeddings(embeddings[start : start + _BATCH])

        edges = list(_iter_edges(source))
        _write_edges(connection, wiki_id, edges)

        # The legacy standalone BM25 index was built over the mmap docstore's
        # documents. Those are not in the .wiki.db, so the statistics are
        # rebuilt here from the same concatenation the nodes carry. That is
        # faithful for a docstore built from the same nodes — which is how the
        # engine builds it — and is stated rather than assumed because a
        # docstore holding different text would rank differently.
        backend.build_bm25(
            [(node.node_id, _document_text(node)) for node in nodes]
        )

        counts = {
            "nodes": len(nodes),
            "embeddings": len(embeddings),
            "edges": len(edges),
        }
        logger.info("published %s: %s", wiki_id, counts)
        return counts
    finally:
        source.close()


def _document_text(node: Node) -> str:
    return "\n".join(
        part
        for part in (node.symbol_name, node.signature, node.docstring, node.source_text)
        if part
    )


def _write_edges(connection, wiki_id: str, edges: list[dict[str, Any]]) -> None:
    if not edges:
        return
    with connection.cursor() as cursor:
        cursor.executemany(
            """
            INSERT INTO wiki_edges
                (wiki_id, source_id, target_id, rel_type, edge_class, weight)
            VALUES (%s, %s, %s, %s, %s, %s)
            ON CONFLICT (wiki_id, source_id, target_id, rel_type) DO UPDATE SET
                edge_class = EXCLUDED.edge_class,
                weight     = EXCLUDED.weight
            """,
            [
                (
                    wiki_id,
                    edge["source_id"],
                    edge["target_id"],
                    edge["rel_type"],
                    edge["edge_class"],
                    edge["weight"],
                )
                for edge in edges
            ],
        )
    connection.commit()


def _update_registry(connection, wiki_id: str, registry: dict[str, Any]) -> None:
    """Write the wiki's registry row — the successor to ``_registry/wikis.json``.

    An UPSERT on a primary key, which is the whole point: the legacy manager
    rewrote one shared JSON blob under no lock, so two concurrent generations
    lost one of the entries.

    Only the fields the caller actually supplied are written. Naming every
    column and passing NULL for the absent ones does not work: several are NOT
    NULL with defaults, and PostgreSQL checks NOT NULL while attempting the
    insert, *before* ``ON CONFLICT`` can turn it into an update. So a partial
    registry would fail the whole publish.
    """
    known = (
        "repo",
        "branch",
        "provider",
        "host",
        "display_name",
        "description",
        "folder_path",
        "commit_hash",
        "canonical_repo_identifier",
        "analysis_key",
        "wiki_version_id",
    )
    fields = [name for name in known if registry.get(name) is not None]
    if not fields:
        return

    columns = ", ".join(fields)
    placeholders = ", ".join(["%s"] * len(fields))
    assignments = ", ".join(f"{name} = EXCLUDED.{name}" for name in fields)

    with connection.cursor() as cursor:
        cursor.execute(
            f"""
            INSERT INTO wikis (wiki_id, {columns}, updated_at)
            VALUES (%s, {placeholders}, now())
            ON CONFLICT (wiki_id) DO UPDATE SET {assignments}, updated_at = now()
            """,
            [wiki_id, *(registry[name] for name in fields)],
        )
    connection.commit()
