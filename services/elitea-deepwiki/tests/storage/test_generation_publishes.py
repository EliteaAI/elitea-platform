"""Generation publishes its index, automatically.

Until this landed, ADR-0022 decision 3 was available rather than delivered: the
backend worked and a replica could read from it, but only for a wiki somebody
had published by hand.

The tests drive the real :class:`LegacyToolRunner` with the engine's tool
callable stubbed to return a canned result, exactly as the composition tests do
— what is under test is the wiring, not the analysis.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import pytest

from elitea_deepwiki.config import Settings
from elitea_deepwiki.legacy_runner import LegacyToolRunner
from elitea_deepwiki.publishing import locate_index, registry_from_result
from elitea_deepwiki.sidecar import SidecarContext

from .conftest import load

WIKI_ID = "generated--wiki"


def build_scratch_index(cache_dir: Path, corpus, embeddings, key: str) -> Path:
    """Write a real .wiki.db where the engine would have left one."""
    from elitea_deepwiki.engine.unified_db import UnifiedWikiDB

    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{key}.wiki.db"
    db = UnifiedWikiDB(path, embedding_dim=64)
    db.upsert_nodes_batch([node.as_dict() for node in corpus])
    db.conn.commit()
    db._populate_fts5()
    db.upsert_embeddings_batch([(nid, vec) for nid, vec in embeddings.items()])
    db.conn.commit()
    db.close()
    return path


def worker_result(key: str | None, wiki_id: str = WIKI_ID) -> dict:
    """A generation result shaped like the worker's, manifest included."""
    artifacts = []
    if key is not None:
        artifacts.append(
            {
                "name": f"{wiki_id}/wiki_manifest_20260101T000000Z-aaaaaaaa.json",
                "type": "application/json",
                "data": json.dumps(
                    {
                        "schema_version": 2,
                        "wiki_id": wiki_id,
                        "wiki_version_id": "20260101T000000Z-aaaaaaaa",
                        "pages": [],
                        "unified_db_key": key,
                        "unified_db_files": [f"{key}.wiki.db"],
                    }
                ),
            }
        )
    return {
        "success": True,
        "result": "Wiki generation completed successfully",
        "artifacts": artifacts,
        "repository_context": "context",
        "wiki_id": wiki_id,
        "wiki_version_id": "20260101T000000Z-aaaaaaaa",
        "canonical_repo_identifier": "acme/notes-service:main:bee856bf",
        "commit_hash": "bee856bf4f3599b57d3ea63c37a8d67a1d350c99",
        "provider_type": "github",
        "branch": "main",
        "wiki_title": "notes-service",
        "wiki_description": "A small notes service.",
        "analysis_key": "acme/notes-service:main:bee856bf@20260101T000000Z-aaaaaaaa",
    }


async def run_generate_wiki(settings: Settings, result: dict) -> dict:
    """Drive the real runner the way the sidecar does, with the engine's tool stubbed.

    The Go host merges, checks egress, composes and uploads; what this package
    still does for a completed generation is run the tool and PUBLISH its
    index. The result dict comes back as the sidecar streams it to the host.
    """
    import asyncio  # noqa: PLC0415

    runner = LegacyToolRunner(
        settings=settings, tools={"generate_wiki": lambda **_kw: result}
    )
    context = SidecarContext("invocation_test", "generate_wiki", asyncio.Queue())
    engine_result = await runner.run_engine_tool("generate_wiki", {}, context)
    await runner.publish(engine_result, context)
    return engine_result


@pytest.fixture
def settings(dsn: str, tmp_path: Path) -> Settings:
    return Settings(scratch_path=str(tmp_path), runner="legacy", database_url=dsn)


# ---------------------------------------------------------------------------
# locating the index
# ---------------------------------------------------------------------------


def test_the_manifest_names_the_index(settings: Settings, corpus, embeddings):
    path = build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "aaaa1111"
    )
    assert locate_index(settings, worker_result("aaaa1111")) == path


def test_the_newest_index_is_used_when_no_manifest_names_one(
    settings: Settings, corpus, embeddings
):
    """The in-process path produces no manifest at all.

    That is the finding from the end-to-end run, and it is why this fallback
    exists. It is the same mtime heuristic the legacy worker used, so it fails
    the same way rather than in a new one.
    """
    cache = Path(settings.scratch_path) / "cache"
    older = build_scratch_index(cache, corpus, embeddings, "older")
    import os
    import time

    os.utime(older, (time.time() - 600, time.time() - 600))
    newer = build_scratch_index(cache, corpus, embeddings, "newer")

    assert locate_index(settings, worker_result(None)) == newer


def test_a_manifest_naming_a_missing_file_falls_back(
    settings: Settings, corpus, embeddings
):
    actual = build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "actual"
    )
    assert locate_index(settings, worker_result("does-not-exist")) == actual


def test_no_index_at_all_is_none(settings: Settings):
    assert locate_index(settings, worker_result(None)) is None


def test_the_registry_row_splits_the_canonical_identifier():
    """`owner/repo:branch:commit` -> repo `owner/repo`, as the legacy did."""
    registry = registry_from_result(worker_result("k"))
    assert registry["repo"] == "acme/notes-service"
    assert registry["branch"] == "main"
    assert registry["host"] == "github.com"
    assert registry["folder_path"] == f"{WIKI_ID}/"
    assert registry["display_name"] == "notes-service"
    assert "None" not in json.dumps(registry)


# ---------------------------------------------------------------------------
# the wiring
# ---------------------------------------------------------------------------


async def test_a_completed_generation_is_queryable_from_a_fresh_reader(
    postgres_backend, settings: Settings, corpus, embeddings
):
    """The point of the whole slice.

    generate_wiki completes, and afterwards a reader that shares nothing with
    it but the database can retrieve — without anyone publishing by hand.
    """
    build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "auto1111"
    )

    result = await run_generate_wiki(settings, worker_result("auto1111"))
    assert result["success"] is True
    # A publish failure is reported in band as an `errors` entry the host's
    # composer renders as "⚠️ Partial issues detected"; none here.
    assert not any("could not be published" in e for e in result.get("errors", [])), result
    from elitea_deepwiki.storage.unified_db_adapter import PostgresUnifiedDB

    reader = PostgresUnifiedDB(postgres_backend._conn, WIKI_ID)
    assert reader.node_count() == len(corpus)
    assert reader.vec_available is True
    assert reader.search_hybrid("store note", embedding=None, limit=5)

    # And the registry row the legacy JSON blob used to hold.
    assert reader.get_meta("repo") == "acme/notes-service"
    assert reader.get_meta("commit_hash").startswith("bee856bf")


async def test_the_engine_result_is_unchanged_by_publishing(
    postgres_backend, settings: Settings, corpus, embeddings
):
    """Publishing must not alter what the host composes from.

    The host composes the frozen artifact set (ADR-0022 decision 2) from the
    engine result the sidecar streams back AFTER publishing; a mistake in
    publishing could add or reorder artifacts. This pins the result as
    published against the same result unpublished: only an in-band `errors`
    entry may ever differ, and only on failure.
    """
    build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "unchanged"
    )
    published = await run_generate_wiki(settings, worker_result("unchanged"))
    not_published = worker_result("unchanged")
    assert {k: v for k, v in published.items() if k != "errors"} == {
        k: v for k, v in not_published.items() if k != "errors"
    }
    assert not published.get("errors")
async def test_no_database_configured_publishes_nothing_and_still_succeeds(
    settings: Settings, corpus, embeddings
):
    """A single-pod dev stack must keep working with no database at all."""
    build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "nodb"
    )
    result = await run_generate_wiki(
        replace(settings, database_url=None), worker_result("nodb")
    )
    assert result["success"] is True
    assert not result.get("errors")


async def test_a_publish_failure_is_reported_in_band_not_swallowed(
    postgres_backend, settings: Settings
):
    """A wiki that generated but did not publish must say so.

    The artifacts are genuine and still land, so the invocation completes —
    but silence here would claim a queryable wiki that no other replica can
    answer about. The message rides the result's `errors` list, which the
    host's composer renders as "⚠️ Partial issues detected".
    """
    # No index on disk at all: nothing to publish.
    result = await run_generate_wiki(settings, worker_result(None))
    assert result["success"] is True
    assert any("could not be published" in e for e in result.get("errors", [])), result
    # The artifacts themselves are unaffected.
    assert result["artifacts"] == worker_result(None)["artifacts"]


async def test_a_publish_failure_does_not_fail_the_invocation(
    postgres_backend, settings: Settings
):
    """Discarding good artifacts over an unpublished index would be worse."""
    result = await run_generate_wiki(
        replace(settings, database_url="postgresql://nobody@127.0.0.1:1/nope"),
        worker_result(None),
    )
    assert result["success"] is True
    assert "error_category" not in result


async def test_ask_does_not_publish(postgres_backend, settings: Settings):
    """Only generate_wiki produces an index; ask must not try to publish one.

    The guard is the sidecar's: it publishes after a successful generate_wiki
    and nothing else. A runner whose publish would blow up proves the guard
    was honoured.
    """
    import json as _json  # noqa: PLC0415

    from httpx import ASGITransport, AsyncClient  # noqa: PLC0415

    from elitea_deepwiki.sidecar import create_sidecar  # noqa: PLC0415

    class Runner(LegacyToolRunner):
        async def publish(self, result, context):  # noqa: ARG002
            raise AssertionError("ask must not publish")

    runner = Runner(
        settings=settings,
        tools={"ask": lambda **_kw: {"success": True, "answer": "yes"}},
    )
    app = create_sidecar(settings, runner)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://engine") as client:
        response = await client.post(
            "/engine/invoke",
            json={"invocation_id": "invocation_ask", "tool": "ask", "arguments": {"question": "?"}},
        )
    lines = [_json.loads(line) for line in response.text.splitlines() if line.strip()]
    assert lines[-1] == {"result": {"success": True, "answer": "yes"}}


async def test_publishing_registers_the_path_for_this_process(
    postgres_backend, settings: Settings, corpus, embeddings
):
    """After publishing, a reader here resolves the path to the wiki.

    Without the registration, the substitution would decline and this pod would
    keep reading the scratch file it just published — working, but not what the
    configuration asked for.
    """
    from elitea_deepwiki.storage import install as storage_install

    storage_install.uninstall()
    path = build_scratch_index(
        Path(settings.scratch_path) / "cache", corpus, embeddings, "registered"
    )
    try:
        await run_generate_wiki(settings, worker_result("registered"))
        assert storage_install.wiki_id_for_path(path) == WIKI_ID
    finally:
        storage_install.uninstall()
