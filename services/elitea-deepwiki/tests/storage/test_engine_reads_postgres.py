"""The engine's retrieval stack, served from PostgreSQL.

ADR-0022's Verification line asks for exactly one thing of this layer:

    an `ask` served by a replica that did not build the index returns the
    fixture answer

That is what :func:`test_a_replica_that_never_built_the_index_can_retrieve`
does. The rest of this module establishes the pieces it stands on: the adapter
satisfies the surface the engine's ``UnifiedRetriever`` actually uses, the
publisher moves a generated index into PostgreSQL, and the substitution only
touches the read path.

These tests drive the REAL ``UnifiedRetriever`` from the verbatim engine copy,
not a reimplementation of it. They need the ``storage-legacy`` extra for that
import; they do not need the full engine closure.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from elitea_deepwiki.storage.base import Node

from .conftest import load

pytest.importorskip("networkx", reason="the storage-legacy extra")

WIKI_ID = "acme--notes-service--main"


@pytest.fixture
def retriever_factory(postgres_backend):
    """Build the engine's own UnifiedRetriever over the PostgreSQL adapter."""
    from elitea_deepwiki.engine.unified_retriever import UnifiedRetriever
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    def build(embedding=None):
        db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
        return UnifiedRetriever(db, embedding_fn=(lambda _q: embedding))

    return build


# ---------------------------------------------------------------------------
# the adapter satisfies what the engine asks of it
# ---------------------------------------------------------------------------


def test_the_adapter_covers_the_surface_the_retriever_uses(postgres_backend):
    """Whatever ``UnifiedRetriever`` touches on its ``db``, the adapter has.

    Derived from the engine source rather than from a list kept by hand, so a
    future engine re-sync that starts using a seventh method fails here instead
    of at runtime in a worker thread.
    """
    import ast

    from elitea_deepwiki.engine import unified_retriever
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    source = Path(unified_retriever.__file__).read_text(encoding="utf-8")
    tree = ast.parse(source)

    used: set[str] = set()
    for node in ast.walk(tree):
        # self.db.<name>
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Attribute)
            and node.value.attr == "db"
        ):
            used.add(node.attr)

    assert used, "could not find any self.db usage; the parse is wrong"
    missing = [name for name in sorted(used) if not hasattr(PostgresUnifiedDB, name)]
    assert not missing, f"the adapter is missing {missing} (used by UnifiedRetriever)"


def test_search_hybrid_returns_legacy_shaped_rows(postgres_backend):
    """``_node_to_document`` reads specific keys; they must all be present."""
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    rows = db.search_hybrid("store note", embedding=None, limit=5)

    assert rows, "expected hits for a query the fixtures show matching"
    for row in rows:
        for key in (
            "node_id",
            "symbol_name",
            "symbol_type",
            "rel_path",
            "file_name",
            "language",
            "start_line",
            "end_line",
            "docstring",
            "signature",
            "source_text",
            "chunk_type",
            "macro_cluster",
            "micro_cluster",
            "is_architectural",
            "is_doc",
        ):
            assert key in row, f"{key} missing from a search_hybrid row"
        assert "combined_score" in row


def test_write_methods_refuse_rather_than_no_op(postgres_backend):
    """A write reaching the read backend is a wiring bug and must say so.

    Silently accepting the write is the dangerous alternative: a generation
    that appeared to succeed and stored nothing.
    """
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    for method in (
        "upsert_nodes_batch",
        "upsert_embeddings_batch",
        "from_networkx",
        "set_meta",
        "set_clusters_batch",
    ):
        with pytest.raises(NotImplementedError):
            getattr(db, method)()


def test_vec_available_reports_whether_dense_search_can_answer(postgres_backend):
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    assert db.vec_available is True
    assert db.node_count() == len(load("nodes.json")["nodes"])


# ---------------------------------------------------------------------------
# the engine's retriever, driven over PostgreSQL
# ---------------------------------------------------------------------------


def test_the_engines_retriever_runs_over_postgres(retriever_factory):
    """The real UnifiedRetriever, unmodified, returning LangChain Documents."""
    fixture = load("queries", "phrase-store-note.json")
    retriever = retriever_factory(embedding=fixture["query_embedding"])

    docs = retriever.search_repository(fixture["query"], k=5, apply_expansion=False)

    assert docs, "the engine's retriever returned nothing over PostgreSQL"
    recorded = {row["node_id"] for row in fixture["rankings"]["fused"]["results"]}
    returned = {doc.metadata["node_id"] for doc in docs}
    assert returned <= recorded, returned - recorded

    first = docs[0]
    assert first.page_content, "page_content comes from source_text"
    assert first.metadata["is_initially_retrieved"] is True
    assert first.metadata["source"] == first.metadata["rel_path"]


def test_graph_expansion_reads_edges_from_postgres(postgres_backend, retriever_factory):
    """1-hop expansion uses get_edges_from/get_edges_to, which the adapter serves.

    The fixture corpus has no edges — the P0 recorder never built the graph —
    so a couple are inserted here. Without them this test would pass by
    retrieving nothing through the expansion path, which is the failure mode
    it exists to rule out.
    """
    nodes = [n["node_id"] for n in load("nodes.json")["nodes"]]
    store = next(n for n in nodes if n.endswith("::NoteStore"))
    save = next(n for n in nodes if n.endswith("::NoteStore.save_note"))

    with postgres_backend._conn.cursor() as cursor:
        cursor.execute(
            "INSERT INTO wiki_edges (wiki_id, source_id, target_id, rel_type, weight) "
            "VALUES (%s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
            (WIKI_ID, store, save, "contains", 1.0),
        )
    postgres_backend._conn.commit()

    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    out = db.get_edges_from(store)
    assert [e["target_id"] for e in out] == [save]
    assert out[0]["rel_type"] == "contains"
    assert db.get_edges_to(save)[0]["source_id"] == store
    assert db.get_edges_from(store, rel_types=["calls"]) == []


def test_path_prefix_and_cluster_filters_apply(postgres_backend):
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    unfiltered = db.search_hybrid("note", embedding=None, limit=30)
    assert len({row["rel_path"].split("/")[0] for row in unfiltered}) > 1

    filtered = db.search_hybrid("note", embedding=None, limit=30, path_prefix="notes")
    assert filtered, "the prefix filter removed everything"
    assert all(row["rel_path"].startswith("notes/") for row in filtered)
    assert {r["node_id"] for r in filtered} < {r["node_id"] for r in unfiltered}


# ---------------------------------------------------------------------------
# publish, then read from a replica that never built anything
# ---------------------------------------------------------------------------


def _build_scratch_index(directory: Path, corpus, embeddings) -> Path:
    """Build a real legacy .wiki.db, exactly as a generation pod would."""
    from elitea_deepwiki.engine.unified_db import UnifiedWikiDB

    path = directory / "generated.wiki.db"
    db = UnifiedWikiDB(path, embedding_dim=64)
    db.upsert_nodes_batch([node.as_dict() for node in corpus])
    db.conn.commit()
    db._populate_fts5()
    db.upsert_embeddings_batch([(nid, vec) for nid, vec in embeddings.items()])
    db.conn.commit()
    db.close()
    return path


def test_publish_moves_a_generated_index_into_postgres(
    postgres_backend, corpus, embeddings, tmp_path: Path
):
    from elitea_deepwiki.storage.publish import publish_wiki_db

    path = _build_scratch_index(tmp_path, corpus, embeddings)
    counts = publish_wiki_db(
        postgres_backend._conn,
        "published--wiki",
        path,
        registry={"repo": "acme/notes-service", "branch": "main"},
    )

    assert counts["nodes"] == len(corpus)
    assert counts["embeddings"] == len(embeddings)

    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    db = PostgresUnifiedDB(postgres_backend._conn, "published--wiki")
    assert db.node_count() == len(corpus)
    assert db.vec_available is True
    assert db.get_meta("repo") == "acme/notes-service"


def test_publishing_an_empty_index_is_refused(postgres_backend, tmp_path: Path):
    """An empty publish over a good wiki would be silent data loss."""
    from elitea_deepwiki.engine.unified_db import UnifiedWikiDB
    from elitea_deepwiki.storage.publish import PublishError, publish_wiki_db

    path = tmp_path / "empty.wiki.db"
    UnifiedWikiDB(path, embedding_dim=64).close()

    with pytest.raises(PublishError, match="no repo_nodes rows"):
        publish_wiki_db(postgres_backend._conn, "empty--wiki", path)


def test_a_replica_that_never_built_the_index_can_retrieve(
    postgres_backend, corpus, embeddings, tmp_path: Path
):
    """ADR-0022's verification criterion for this layer.

    A generation pod builds an index on its own scratch and publishes it. A
    *different* replica — with no scratch file at all, only the database —
    then answers a retrieval over it. That is the whole point of decision 3,
    and it is the one thing the file backend structurally cannot do.
    """
    from elitea_deepwiki.engine.unified_retriever import UnifiedRetriever
    from elitea_deepwiki.storage.publish import publish_wiki_db
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    # --- the generation pod ---------------------------------------------
    generation_scratch = tmp_path / "pod-a"
    generation_scratch.mkdir()
    built = _build_scratch_index(generation_scratch, corpus, embeddings)
    publish_wiki_db(postgres_backend._conn, "replica--test", built)

    # The pod is gone, and so is everything it wrote.
    import shutil

    shutil.rmtree(generation_scratch)
    assert not built.exists()

    # --- a query replica, which never built anything ---------------------
    fixture = load("queries", "phrase-store-note.json")
    retriever = UnifiedRetriever(
        PostgresUnifiedDB(postgres_backend._conn, "replica--test"),
        embedding_fn=lambda _q: fixture["query_embedding"],
    )
    docs = retriever.search_repository(fixture["query"], k=5, apply_expansion=False)

    assert docs, "a replica with no scratch file could not answer"
    recorded = [row["node_id"] for row in fixture["rankings"]["fused"]["results"]]
    assert docs[0].metadata["node_id"] == recorded[0], (
        "the replica answered, but not with the recorded top hit"
    )


# ---------------------------------------------------------------------------
# the substitution
# ---------------------------------------------------------------------------


def test_the_substitution_only_redirects_reads(postgres_backend, tmp_path: Path):
    """readonly=True goes to PostgreSQL; a write construction stays on the file.

    This is the whole safety property of the install: generation must keep
    working on ephemeral scratch, or a published wiki could never be built in
    the first place.
    """
    from elitea_deepwiki.engine import unified_db
    from elitea_deepwiki.storage import install as storage_install
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    original = unified_db.UnifiedWikiDB
    path = tmp_path / "scratch.wiki.db"

    storage_install.install(lambda: postgres_backend._conn)
    try:
        storage_install.register_wiki_path(path, WIKI_ID)

        reader = unified_db.UnifiedWikiDB(path, embedding_dim=64, readonly=True)
        assert isinstance(reader, PostgresUnifiedDB)
        assert reader.node_count() == len(load("nodes.json")["nodes"])

        writer = unified_db.UnifiedWikiDB(path, embedding_dim=64)
        assert isinstance(writer, original)
        writer.close()
    finally:
        storage_install.uninstall()

    assert unified_db.UnifiedWikiDB is original


def test_an_unregistered_path_falls_back_to_the_file(postgres_backend, tmp_path: Path):
    """An unpublished wiki reads its own scratch rather than an empty database.

    Returning an empty PostgreSQL reader would make "not published yet" look
    exactly like "this wiki has no content", which is the wrong answer to give
    a caller.
    """
    from elitea_deepwiki.engine import unified_db
    from elitea_deepwiki.storage import install as storage_install
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    path = tmp_path / "unregistered.wiki.db"
    unified_db.UnifiedWikiDB(path, embedding_dim=64).close()

    storage_install.install(lambda: postgres_backend._conn)
    try:
        reader = unified_db.UnifiedWikiDB(path, embedding_dim=64, readonly=True)
        assert not isinstance(reader, PostgresUnifiedDB)
        reader.close()
    finally:
        storage_install.uninstall()


def test_install_is_idempotent(postgres_backend):
    """Installing twice must not wrap the wrapper and lose the original."""
    from elitea_deepwiki.engine import unified_db
    from elitea_deepwiki.storage import install as storage_install

    original = unified_db.UnifiedWikiDB
    storage_install.install(lambda: postgres_backend._conn)
    storage_install.install(lambda: postgres_backend._conn)
    storage_install.uninstall()
    assert unified_db.UnifiedWikiDB is original


def test_unreadable_vectors_raise_instead_of_publishing_none(
    postgres_backend, corpus, embeddings, tmp_path: Path, monkeypatch
):
    """The silent-data-loss path, which the other tests cannot reach.

    ``repo_vec`` is a sqlite-vec virtual table. Without the extension loaded,
    every read of it raises "no such module: vec0". The first version of the
    publisher caught that, logged a warning and published ZERO vectors — which
    at query time is indistinguishable from a wiki that never had embeddings:
    dense retrieval just returns nothing, fused ranking silently becomes
    FTS-only, and no error is raised anywhere.

    Every other test here loads the extension successfully, so none of them can
    catch a regression to that behaviour. This one forces the condition: it
    opens the source *without* sqlite-vec and requires a refusal.
    """
    import sqlite3 as _sqlite3

    from elitea_deepwiki.storage import publish as publish_module

    path = _build_scratch_index(tmp_path, corpus, embeddings)

    def _open_without_sqlite_vec(source_path):
        connection = _sqlite3.connect(f"file:{source_path}?mode=ro", uri=True)
        connection.row_factory = _sqlite3.Row
        return connection

    monkeypatch.setattr(publish_module, "_open_readonly", _open_without_sqlite_vec)

    with pytest.raises(publish_module.PublishError, match="cannot be read"):
        publish_module.publish_wiki_db(
            postgres_backend._conn, "no-vec--wiki", path
        )


def test_a_wiki_with_no_embeddings_publishes_and_says_so(
    postgres_backend, corpus, tmp_path: Path
):
    """The legitimate counterpart: no repo_vec table at all.

    A wiki generated without embeddings is valid — the retriever falls back to
    FTS-only. It must publish, and the returned counts must say zero rather
    than the caller having to guess.
    """
    from elitea_deepwiki.engine.unified_db import UnifiedWikiDB
    from elitea_deepwiki.storage.publish import publish_wiki_db
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    path = tmp_path / "no-embeddings.wiki.db"
    db = UnifiedWikiDB(path, embedding_dim=64)
    db.upsert_nodes_batch([node.as_dict() for node in corpus])
    db.conn.commit()
    db._populate_fts5()
    db.conn.execute("DROP TABLE IF EXISTS repo_vec")
    db.conn.commit()
    db.close()

    counts = publish_wiki_db(postgres_backend._conn, "no-embeddings--wiki", path)
    assert counts["nodes"] == len(corpus)
    assert counts["embeddings"] == 0

    reader = PostgresUnifiedDB(postgres_backend._conn, "no-embeddings--wiki")
    assert reader.vec_available is False
    # FTS-only still answers.
    assert reader.search_hybrid("store note", embedding=None, limit=5)
