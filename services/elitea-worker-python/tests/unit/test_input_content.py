from __future__ import annotations

import asyncio
import base64
import hashlib

import httpx
import pytest

from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput
from elitea_worker.transport.input_content import (
    ClaimBoundInputReference,
    ClaimBoundInputRequestBuilder,
    InputReadGrant,
    ScopedInputContentClient,
)


def test_fetches_bounded_scoped_https_and_verifies_digest() -> None:
    async def run() -> None:
        content = b"{}\n"

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.headers["x-elitea-claim-id"] == "claim-1"
            assert request.headers["x-elitea-fence"] == "fence-1"
            content_digest = base64.b64encode(hashlib.sha256(content).digest()).decode()
            return httpx.Response(
                200,
                content=content,
                extensions={"http_version": b"HTTP/2"},
                headers={
                    "content-length": str(len(content)),
                    "content-digest": f"sha-256=:{content_digest}:",
                    "cache-control": "private, no-store",
                    "content-type": "application/json",
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = ScopedInputContentClient(
                http,
                allowed_origins=frozenset({"https://content.internal"}),
                max_content_bytes=1024,
                require_http2=True,
            )
            result = await client.fetch(
                InputReadGrant(
                    url="https://content.internal/v1/read/object",
                    expected_length=len(content),
                    expected_sha256=hashlib.sha256(content).digest(),
                    expected_media_type="application/json",
                    headers=(
                        ("X-Elitea-Claim-Id", "claim-1"),
                        ("X-Elitea-Fence", "fence-1"),
                    ),
                )
            )
            assert result == content

    asyncio.run(run())


def test_production_content_client_rejects_http11_negotiation() -> None:
    async def run() -> None:
        content = b"{}"
        digest = base64.b64encode(hashlib.sha256(content).digest()).decode()

        def handler(_: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                content=content,
                extensions={"http_version": b"HTTP/1.1"},
                headers={
                    "content-length": str(len(content)),
                    "content-digest": f"sha-256=:{digest}:",
                    "cache-control": "private, no-store",
                    "content-type": "application/json",
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = ScopedInputContentClient(
                http,
                allowed_origins=frozenset({"https://content.internal"}),
                max_content_bytes=1024,
                require_http2=True,
            )
            with pytest.raises(DependencyUnavailable, match="HTTP/2"):
                await client.fetch(
                    InputReadGrant(
                        url="https://content.internal/object",
                        expected_length=len(content),
                        expected_sha256=hashlib.sha256(content).digest(),
                        expected_media_type="application/json",
                    )
                )

    asyncio.run(run())


def test_claim_bound_builder_matches_internal_go_route_and_headers() -> None:
    content = b"{}\n"
    grant = ClaimBoundInputRequestBuilder(origin="https://content.internal").build(
        ClaimBoundInputReference(
            execution_id="execution/one",
            generation=2,
            content_id="settings id",
            immutable_version="v/1",
            claim_id="claim-1",
            fence_token=b"f" * 32,
            expected_length=len(content),
            expected_sha256=hashlib.sha256(content).digest(),
            media_type="application/json",
        )
    )

    assert grant.url == (
        "https://content.internal/executions/execution%2Fone/generations/2/"
        "inputs/settings%20id/versions/v%2F1"
    )
    assert grant.headers == (
        ("X-Elitea-Claim-Id", "claim-1"),
        ("X-Elitea-Fence", "ZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmZmY"),
    )


def test_rejects_unapproved_or_insecure_origin_before_request() -> None:
    async def run() -> None:
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda _: httpx.Response(500))) as http:
            client = ScopedInputContentClient(
                http,
                allowed_origins=frozenset({"https://content.internal"}),
                max_content_bytes=1024,
            )
            with pytest.raises(InvalidInput, match="not allowed"):
                await client.fetch(
                    InputReadGrant(
                        url="http://attacker.invalid/object",
                        expected_length=0,
                        expected_sha256=hashlib.sha256(b"").digest(),
                        expected_media_type="application/json",
                    )
                )

    asyncio.run(run())


@pytest.mark.parametrize(
    "origin",
    [
        "https://user@content.internal",
        "https://content.internal?grant=leak",
        "https://content.internal#fragment",
        "https://content.internal/not-an-origin",
    ],
)
def test_claim_bound_builder_rejects_non_origin_components(origin: str) -> None:
    with pytest.raises(ValueError, match="HTTPS origin"):
        ClaimBoundInputRequestBuilder(origin=origin)
