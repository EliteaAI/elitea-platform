from __future__ import annotations

import requests

from .fake_services import (
    ConfluenceFixture,
    ConfluenceHandler,
    FixtureHTTPServer,
    LiteLLMFixture,
    LiteLLMHandler,
)


def test_confluence_fixture_serves_pages_attachments_and_failures() -> None:
    fixture = ConfluenceFixture(attachment_status={"diagram.png": 429})
    with FixtureHTTPServer(fixture, ConfluenceHandler) as service:
        pages = requests.get(
            f"{service.base_url}/rest/api/content",
            params={"space": "ENG", "start": 0},
            timeout=5,
        )
        pages.raise_for_status()
        assert [item["id"] for item in pages.json()["results"]] == ["page-1"]

        attachments = requests.get(
            f"{service.base_url}/rest/api/content/page-1/child/attachment",
            timeout=5,
        )
        attachments.raise_for_status()
        assert [item["id"] for item in attachments.json()["results"]] == [
            "att-text",
            "att-image",
        ]

        image = requests.get(
            f"{service.base_url}/download/attachments/page-1/diagram.png",
            timeout=5,
        )
        assert image.status_code == 429
        assert [record.path for record in fixture.records] == [
            "/rest/api/content",
            "/rest/api/content/page-1/child/attachment",
            "/download/attachments/page-1/diagram.png",
        ]


def test_litellm_fixture_records_vision_and_embedding_requests() -> None:
    fixture = LiteLLMFixture()
    with FixtureHTTPServer(fixture, LiteLLMHandler) as service:
        vision = requests.post(
            f"{service.base_url}/v1/chat/completions",
            json={"model": "vision", "messages": [{"role": "user", "content": []}]},
            timeout=5,
        )
        vision.raise_for_status()
        assert (
            vision.json()["choices"][0]["message"]["content"]
            == "PARENT_IMAGE_DESCRIPTION"
        )

        embeddings = requests.post(
            f"{service.base_url}/v1/embeddings",
            json={"model": "embedding", "input": ["one", "two"]},
            timeout=5,
        )
        embeddings.raise_for_status()
        assert len(embeddings.json()["data"]) == 2
        assert len(embeddings.json()["data"][0]["embedding"]) == 8
        assert [record.path for record in fixture.records] == [
            "/v1/chat/completions",
            "/v1/embeddings",
        ]
