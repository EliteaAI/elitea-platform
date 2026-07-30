from __future__ import annotations

import json
import os
import uuid
from typing import Any

import psycopg
import pytest
import requests
from psycopg import sql

from .fake_services import (
    CHAT_COMPLETIONS_PATH,
    EMBEDDINGS_PATH,
    ConfluenceFixture,
    ConfluenceHandler,
    FixtureHTTPServer,
    HTTPConfluenceClient,
    LiteLLMFixture,
    LiteLLMHandler,
    decode_data_url,
    decoded_requests,
    image_urls,
)
from .sdk_current import current_model_clients


pytestmark = pytest.mark.pgvector


def _database_url() -> str:
    value = os.getenv("ELITEA_CONFLUENCE_PARITY_PGVECTOR_URL")
    if not value:
        pytest.skip(
            "real PgVector unavailable: set "
            "ELITEA_CONFLUENCE_PARITY_PGVECTOR_URL or run run_pgvector.sh"
        )
    return value


def _psycopg_url(value: str) -> str:
    return value.replace("postgresql+psycopg://", "postgresql://", 1)


def _wrapper(
    current_sdk,
    *,
    source_url: str,
    model_url: str,
    database_url: str,
    schema: str,
):
    llm, embeddings = current_model_clients(current_sdk, model_url)
    return current_sdk.confluence_wrapper.model_construct(
        toolkit_id=41,
        llm=llm,
        embeddings=embeddings,
        embedding_model="fixture-embedding",
        vectorstore_type="PGVector",
        vectorstore_params={
            "use_jsonb": True,
            "collection_name": schema,
            "create_extension": False,
            "elitea_sdk_options": {"target_schema": schema},
            "connection_string": database_url,
        },
        max_docs_per_add=20,
        dataset=schema,
        vectorstore=None,
        vector_adapter=None,
        pg_helper=None,
        client=HTTPConfluenceClient(source_url),
        base_url=source_url,
        token="fixture-only",
        cloud=False,
        api_version="1",
        limit=1,
        labels=[],
        space="ENG",
        max_pages=1,
        include_attachments=True,
        include_comments=False,
        include_restricted_content=True,
        number_of_retries=1,
        min_retry_seconds=0,
        max_retry_seconds=0,
        keep_markdown_format=True,
        keep_newlines=True,
    )


def _read_rows(database_url: str, schema: str) -> list[dict[str, Any]]:
    query = sql.SQL(
        "SELECT document, cmetadata FROM {}.langchain_pg_embedding "
        "ORDER BY cmetadata->>'type' NULLS FIRST, cmetadata->>'id' NULLS FIRST, document"
    ).format(sql.Identifier(schema))
    with psycopg.connect(_psycopg_url(database_url)) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            return [
                {"document": document, "metadata": metadata}
                for document, metadata in cursor.fetchall()
            ]


def _drop_schema(database_url: str, schema: str) -> None:
    with psycopg.connect(_psycopg_url(database_url), autocommit=True) as connection:
        with connection.cursor() as cursor:
            cursor.execute(
                sql.SQL("DROP SCHEMA IF EXISTS {} CASCADE").format(
                    sql.Identifier(schema)
                )
            )


def _capture_events(
    monkeypatch: pytest.MonkeyPatch,
) -> list[tuple[str, dict[str, Any]]]:
    events: list[tuple[str, dict[str, Any]]] = []

    def capture_event(
        name: str,
        data: dict[str, Any],
        config: dict[str, Any] | None = None,
    ) -> None:
        del config
        events.append((name, data))

    base_module = __import__(
        "elitea_sdk.tools.base_indexer_toolkit",
        fromlist=["dispatch_custom_event"],
    )
    callback_module = __import__(
        "langchain_core.callbacks",
        fromlist=["dispatch_custom_event"],
    )
    monkeypatch.setattr(base_module, "dispatch_custom_event", capture_event)
    monkeypatch.setattr(callback_module, "dispatch_custom_event", capture_event)
    return events


def _normalized_events(
    events: list[tuple[str, dict[str, Any]]],
) -> list[tuple[str, dict[str, Any]]]:
    normalized: list[tuple[str, dict[str, Any]]] = []
    status_id: str | None = None
    for name, data in events:
        item = dict(data)
        if name == "index_data_status":
            assert set(item) == {
                "id",
                "index_name",
                "state",
                "error",
                "reindex",
                "indexed",
                "updated",
                "toolkit_id",
                "created_at",
                "updated_on",
            }
            uuid.UUID(item["id"])
            assert isinstance(item["created_at"], float)
            assert isinstance(item["updated_on"], float)
            status_id = status_id or item["id"]
            assert item["id"] == status_id
            item["id"] = "<index-meta-id>"
            item["created_at"] = "<timestamp>"
            item["updated_on"] = "<timestamp>"
        else:
            assert set(item) == {"message", "tool_name", "toolkit"}
        normalized.append((name, item))
    return normalized


def test_current_sdk_full_confluence_pgvector_golden(
    current_sdk,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = _database_url()
    schema = f"confluence_parity_{uuid.uuid4().hex[:12]}"
    confluence = ConfluenceFixture()
    litellm = LiteLLMFixture()
    events = _capture_events(monkeypatch)

    try:
        with (
            FixtureHTTPServer(confluence, ConfluenceHandler) as source,
            FixtureHTTPServer(litellm, LiteLLMHandler) as models,
        ):
            wrapper = _wrapper(
                current_sdk,
                source_url=source.base_url,
                model_url=models.base_url,
                database_url=database_url,
                schema=schema,
            )
            wrapper.set_runnable_config({"run_id": str(uuid.uuid4())})

            outcome = wrapper.index_data(
                index_name="golden",
                clean_index=False,
                content_format="view",
                include_attachments=True,
                include_comments=False,
                include_restricted_content=True,
                keep_markdown_format=True,
                bins_with_llm=True,
                max_pages=1,
                limit=1,
                meta_update_interval=0,
            )
            rows = _read_rows(database_url, schema)

        assert outcome == {
            "status": "ok",
            "message": "Successfully indexed 1 documents (3 chunks).",
        }
        content_rows = [
            row for row in rows if row["metadata"].get("type") != "index_meta"
        ]
        meta_rows = [
            row for row in rows if row["metadata"].get("type") == "index_meta"
        ]
        assert len(content_rows) == 3
        assert len(meta_rows) == 1
        by_id = {row["metadata"]["id"]: row for row in content_rows}
        assert set(by_id) == {"page-1", "att-text", "att-image"}

        parent = by_id["page-1"]
        assert "Parent content before the diagram and after it." in parent["document"]
        assert "diagram.pngPARENT_IMAGE_DESCRIPTION" in parent["document"]
        assert parent["metadata"]["dependent_docs"] == "att-text;att-image"
        assert parent["metadata"]["collection"] == "golden"

        text_attachment = by_id["att-text"]
        assert text_attachment["document"] == confluence.text_bytes.decode()
        assert text_attachment["metadata"]["parent_id"] == "page-1"
        assert text_attachment["metadata"]["chunk_id"] == 1
        assert text_attachment["metadata"]["collection"] == "golden"

        image_attachment = by_id["att-image"]
        assert image_attachment["document"] == "DEPENDENT_IMAGE_DESCRIPTION"
        assert image_attachment["metadata"]["parent_id"] == "page-1"
        assert image_attachment["metadata"]["chunk_id"] == 1
        assert image_attachment["metadata"]["processing_method"] == "llm"
        assert image_attachment["metadata"]["collection"] == "golden"

        metadata = meta_rows[0]["metadata"]
        assert metadata["state"] == "completed"
        assert metadata["indexed"] == 1
        assert metadata["updated"] == 3
        assert metadata["indexed_chunks"] == 3
        skipped = json.loads(metadata["skipped"])
        assert skipped["items_processed"] == 1
        # The current Confluence wrapper reports processed base documents but
        # leaves the generic total_fetched counter at zero.
        assert skipped["total_fetched"] == 0
        assert skipped["total_skipped"] == 0
        assert skipped["dependent_items_skipped"]["count"] == 0
        history = json.loads(metadata["history"])
        assert [entry["state"] for entry in history] == ["created", "completed"]
        assert history[-1]["indexed"] == 1
        assert history[-1]["updated"] == 3
        assert history[-1]["indexed_chunks"] == 3

        vision = decoded_requests(litellm.records, CHAT_COMPLETIONS_PATH)
        assert len(vision) == 2
        prompts = [
            request["messages"][0]["content"][0]["text"] for request in vision
        ]
        assert "## Image Type: Diagrams" in prompts[0]
        assert "functional specification format" in prompts[0]
        assert "You are an AI model designed for analyzing images." in prompts[1]
        assert "Extract all numerical values" in prompts[1]
        assert all(len(image_urls(request)) == 1 for request in vision)
        assert all(
            decode_data_url(image_urls(request)[0]).startswith(b"\x89PNG\r\n\x1a\n")
            for request in vision
        )

        embedding = decoded_requests(litellm.records, EMBEDDINGS_PATH)
        embedded_inputs = [
            item
            for request in embedding
            for item in (
                request["input"]
                if isinstance(request["input"], list)
                else [request["input"]]
            )
        ]
        assert len(embedding) == 4
        assert len(embedded_inputs) == 6
        # The production SDK client tokenizes embedding inputs before sending
        # them to the OpenAI-compatible endpoint. The index-meta token sequence
        # is sent for created, in-progress, and completed state.
        assert all(
            isinstance(value, list) and all(isinstance(token, int) for token in value)
            for value in embedded_inputs
        )
        assert embedded_inputs.count(embedded_inputs[0]) == 3
        assert len({tuple(value) for value in embedded_inputs}) == 4

        assert _normalized_events(events) == [
            (
                "thinking_step",
                {
                    "message": (
                        "There is no existing index_meta for collection 'golden'. "
                        "Initializing it."
                    ),
                    "tool_name": "index_data",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "index_data_status",
                {
                    "id": "<index-meta-id>",
                    "index_name": "golden",
                    "state": "in_progress",
                    "error": None,
                    "reindex": False,
                    "indexed": 0,
                    "updated": 0,
                    "toolkit_id": 41,
                    "created_at": "<timestamp>",
                    "updated_on": "<timestamp>",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Indexing data into collection with suffix 'golden'. "
                        "It can take some time..."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Loading the documents to index...{'index_name': 'golden', "
                        "'clean_index': False, 'content_format': 'view', "
                        "'include_attachments': True, 'include_comments': False, "
                        "'include_restricted_content': True, "
                        "'keep_markdown_format': True, 'bins_with_llm': True, "
                        "'max_pages': 1, 'limit': 1, 'meta_update_interval': 0}"
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Base documents were pre-loaded. Search for possible "
                        "document duplicates and remove them from the indexing list..."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Duplicates were removed. Processing documents to collect "
                        "dependencies and prepare them for indexing..."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Base documents are ready for indexing. 1 base documents "
                        "in total to index."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": "Verification of documents to index started",
                    "tool_name": "index_documents",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Retrieving already indexed data from PGVector vectorstore"
                    ),
                    "tool_name": "get_indexed_data",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": "Processing document #1: 'unknown'.",
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Dependent documents for 'unknown' were processed. Applying "
                        "chunking tool 'default' if specified and preparing documents "
                        "for indexing..."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Collecting the dependencies for document 'unknown' "
                        "(ID: 'page-1') to collect dependencies if any..."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": (
                        "Indexed document #1 'unknown' out of 1 (with 3 chunks)."
                    ),
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "thinking_step",
                {
                    "message": "3 documents have been indexed. Continuing...",
                    "tool_name": "tool_progress",
                    "toolkit": "ConfluenceAPIWrapper",
                },
            ),
            (
                "index_data_status",
                {
                    "id": "<index-meta-id>",
                    "index_name": "golden",
                    "state": "completed",
                    "error": None,
                    "reindex": False,
                    "indexed": 1,
                    "updated": 3,
                    "toolkit_id": 41,
                    "created_at": "<timestamp>",
                    "updated_on": "<timestamp>",
                },
            ),
        ]
    finally:
        _drop_schema(database_url, schema)


def test_current_sdk_source_failure_persists_terminal_failure(
    current_sdk,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database_url = _database_url()
    schema = f"confluence_failure_{uuid.uuid4().hex[:12]}"
    confluence = ConfluenceFixture(page_status=503)
    litellm = LiteLLMFixture()
    events = _capture_events(monkeypatch)

    try:
        with (
            FixtureHTTPServer(confluence, ConfluenceHandler) as source,
            FixtureHTTPServer(litellm, LiteLLMHandler) as models,
        ):
            wrapper = _wrapper(
                current_sdk,
                source_url=source.base_url,
                model_url=models.base_url,
                database_url=database_url,
                schema=schema,
            )
            wrapper.set_runnable_config({"run_id": str(uuid.uuid4())})

            with pytest.raises(requests.HTTPError) as caught:
                wrapper.index_data(
                    index_name="source-failure",
                    clean_index=False,
                    content_format="view",
                    include_attachments=True,
                    include_comments=False,
                    include_restricted_content=True,
                    keep_markdown_format=True,
                    bins_with_llm=True,
                    max_pages=1,
                    limit=1,
                    meta_update_interval=0,
                )
            rows = _read_rows(database_url, schema)

        assert caught.value.response is not None
        assert caught.value.response.status_code == 503
        assert len(rows) == 1
        metadata = rows[0]["metadata"]
        assert metadata["type"] == "index_meta"
        assert metadata["state"] == "failed"
        assert metadata["indexed"] == 0
        assert metadata["updated"] == 0
        assert metadata["indexed_chunks"] == 0
        assert "503 Server Error" in metadata["error"]
        history = json.loads(metadata["history"])
        assert [entry["state"] for entry in history] == ["created", "failed"]
        assert history[-1]["indexed"] == 0
        assert history[-1]["updated"] == 0
        assert "503 Server Error" in history[-1]["error"]

        status_events = [data for name, data in events if name == "index_data_status"]
        assert [event["state"] for event in status_events] == [
            "in_progress",
            "failed",
        ]
        assert status_events[-1]["indexed"] == 0
        assert status_events[-1]["updated"] == 0
        assert "503 Server Error" in status_events[-1]["error"]
        assert not decoded_requests(litellm.records, CHAT_COMPLETIONS_PATH)
        assert len(decoded_requests(litellm.records, EMBEDDINGS_PATH)) == 2
    finally:
        _drop_schema(database_url, schema)
