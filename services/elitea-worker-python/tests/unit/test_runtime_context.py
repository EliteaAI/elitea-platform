from __future__ import annotations

import asyncio
import base64
import json

import httpx
import pytest

from elitea_worker.agents.client_context import IndexExecutionClaim
from elitea_worker.execution.errors import AuthorizationFailure, InvalidInput
from elitea_worker.transport.runtime_context import ClaimBoundEliteaTokenClient


def test_fetches_exact_claim_bound_token_context_over_http2() -> None:
    async def run() -> None:
        claim = _claim()
        encoded = json.dumps(
            {
                "schema_version": "elitea.runtime.elitea-client-token.v1",
                "project_id": 42,
                "token": "claim-bound-execution-actor-pat",
            },
            separators=(",", ":"),
        ).encode("utf-8")

        def handler(request: httpx.Request) -> httpx.Response:
            assert request.method == "POST"
            assert request.url.raw_path.decode("ascii") == (
                "/executions/execution%2F1/generations/2/"
                "runtime-context/elitea-client-token"
            )
            assert request.headers["x-elitea-claim-id"] == "claim-1"
            assert request.headers["x-elitea-fence"] == base64.urlsafe_b64encode(
                b"f" * 32
            ).rstrip(b"=").decode("ascii")
            return httpx.Response(
                200,
                request=request,
                content=encoded,
                extensions={"http_version": b"HTTP/2"},
                headers={
                    "content-type": "application/json",
                    "content-length": str(len(encoded)),
                    "cache-control": "no-store, no-cache, must-revalidate",
                    "pragma": "no-cache",
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            token = await ClaimBoundEliteaTokenClient(
                http,
                origin="https://content.internal",
                require_http2=True,
            )(claim)
        assert token == "claim-bound-execution-actor-pat"

    asyncio.run(run())


@pytest.mark.parametrize(
    "mutate",
    [
        lambda value: value.update(project_id=43),
        lambda value: value.update(schema_version="unknown"),
        lambda value: value.update(extra="leak"),
    ],
)
def test_rejects_context_not_bound_to_exact_project_and_schema(mutate) -> None:
    async def run() -> None:
        value = {
            "schema_version": "elitea.runtime.elitea-client-token.v1",
            "project_id": 42,
            "token": "pat",
        }
        mutate(value)
        encoded = json.dumps(value, separators=(",", ":")).encode()

        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                request=request,
                content=encoded,
                headers={
                    "content-type": "application/json",
                    "content-length": str(len(encoded)),
                    "cache-control": "no-store, no-cache, must-revalidate",
                    "pragma": "no-cache",
                },
            )

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            with pytest.raises((AuthorizationFailure, InvalidInput)):
                await ClaimBoundEliteaTokenClient(
                    http,
                    origin="https://content.internal",
                )(_claim())

    asyncio.run(run())


def _claim() -> IndexExecutionClaim:
    return IndexExecutionClaim(
        execution_id="execution/1",
        generation=2,
        claim_id="claim-1",
        fence_token=b"f" * 32,
        resource_project_id="42",
    )
