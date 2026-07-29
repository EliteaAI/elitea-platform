from __future__ import annotations

import pytest
import requests
from langchain_community.document_loaders.confluence import ContentFormat

from .fake_services import (
    CHAT_COMPLETIONS_PATH,
    ConfluenceFixture,
    ConfluenceHandler,
    FixtureHTTPServer,
    HTTPConfluenceClient,
    LiteLLMFixture,
    LiteLLMHandler,
    decoded_requests,
    image_urls,
)
from .sdk_current import current_model_clients


def _loader(current_sdk, client, llm, *, number_of_retries: int = 1):
    return current_sdk.confluence_loader(
        client,
        llm,
        True,
        url=client.url,
        space_key="ENG",
        include_attachments=True,
        include_restricted_content=True,
        content_format=ContentFormat.VIEW,
        keep_markdown_format=True,
        limit=1,
        max_pages=1,
        min_retry_seconds=0,
        max_retry_seconds=0,
        number_of_retries=number_of_retries,
    )


def test_current_sdk_augments_parent_once_with_exact_confluence_prompt(
    current_sdk,
) -> None:
    confluence = ConfluenceFixture()
    litellm = LiteLLMFixture()
    with (
        FixtureHTTPServer(confluence, ConfluenceHandler) as source,
        FixtureHTTPServer(litellm, LiteLLMHandler) as models,
    ):
        client = HTTPConfluenceClient(source.base_url)
        llm, _ = current_model_clients(current_sdk, models.base_url)
        loader = _loader(current_sdk, client, llm)

        documents = list(loader._lazy_load(kwargs={}))

    assert len(documents) == 1
    parent = documents[0]
    assert parent.metadata == {
        "title": "Architecture",
        "id": "page-1",
        "source": f"{source.base_url}/spaces/ENG/pages/page-1",
        "when": "2026-07-27T08:00:00.000Z",
    }
    assert "Parent content before the diagram and after it." in parent.page_content
    assert "diagram.pngPARENT_IMAGE_DESCRIPTION" in parent.page_content
    calls = decoded_requests(litellm.records, CHAT_COMPLETIONS_PATH)
    assert len(calls) == 1
    prompt = calls[0]["messages"][0]["content"][0]["text"]
    assert "## Image Type: Diagrams" in prompt
    assert "functional specification format" in prompt
    urls = image_urls(calls[0])
    assert len(urls) == 1
    assert urls[0].startswith("data:image/png;base64,")
    assert not any(
        "base64" in record.body.decode("utf-8", errors="ignore")
        for record in confluence.records
    )


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_current_sdk_page_fetch_propagates_http_failures(
    current_sdk,
    status: int,
) -> None:
    confluence = ConfluenceFixture(page_status=status)
    with FixtureHTTPServer(confluence, ConfluenceHandler) as source:
        loader = _loader(
            current_sdk,
            HTTPConfluenceClient(source.base_url),
            llm=None,
        )
        with pytest.raises(requests.HTTPError) as caught:
            list(loader._lazy_load(kwargs={}))
    assert caught.value.response is not None
    assert caught.value.response.status_code == status


def test_current_sdk_page_fetch_retries_then_preserves_success_contract(
    current_sdk,
) -> None:
    confluence = ConfluenceFixture(page_status_sequence=[503, 200])
    with FixtureHTTPServer(confluence, ConfluenceHandler) as source:
        loader = _loader(
            current_sdk,
            HTTPConfluenceClient(source.base_url),
            llm=None,
            number_of_retries=2,
        )

        documents = list(loader._lazy_load(kwargs={}))

    assert len(documents) == 1
    assert documents[0].metadata["id"] == "page-1"
    page_requests = [
        record
        for record in confluence.records
        if record.path == "/rest/api/content"
    ]
    assert len(page_requests) == 2


@pytest.mark.parametrize("status", [401, 403, 429, 500, 503])
def test_current_sdk_dependent_download_failure_becomes_indexable_error_document(
    current_sdk,
    status: int,
) -> None:
    from langchain_core.documents import Document

    confluence = ConfluenceFixture(attachment_status={"notes.txt": status})
    with FixtureHTTPServer(confluence, ConfluenceHandler) as source:
        client = HTTPConfluenceClient(source.base_url)
        wrapper = current_sdk.confluence_wrapper.model_construct(
            base_url=source.base_url,
            client=client,
            llm=None,
            embeddings=None,
            vectorstore_type=None,
            vectorstore_params=None,
        )
        object.__setattr__(wrapper, "_index_include_attachments", True)
        object.__setattr__(wrapper, "_include_extensions", [])
        object.__setattr__(wrapper, "_skip_extensions", [])
        parent = Document(
            page_content="parent",
            metadata={
                "id": "page-1",
                "updated_on": "2026-07-27T08:00:00.000Z",
                "_attachments_data": confluence.attachments,
            },
        )

        dependents = list(wrapper._process_document(parent))

    failed = next(item for item in dependents if item.metadata["id"] == "att-text")
    assert failed.page_content == (
        f"[Failed to download {source.base_url}/download/attachments/page-1/"
        f"notes.txt: HTTP status code {status}]"
    )
    assert failed.page_content.strip()
    assert failed.metadata["media_type"] == "text/plain"
    assert "content_in_bytes" not in failed.metadata
