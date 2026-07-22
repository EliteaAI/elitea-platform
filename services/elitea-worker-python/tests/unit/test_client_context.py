from __future__ import annotations

import asyncio

import pytest

from elitea_worker.agents.client_context import (
    ClaimBoundEliteaClientContextFactory,
    IndexExecutionClaim,
)
from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput


def test_factory_fetches_fresh_token_for_each_exact_claim() -> None:
    async def run() -> None:
        observed: list[IndexExecutionClaim] = []

        async def fetch(claim: IndexExecutionClaim) -> str:
            observed.append(claim)
            return f"token-{len(observed)}"

        factory = ClaimBoundEliteaClientContextFactory(
            base_url="https://elitea.internal/",
            token_fetcher=fetch,
        )
        claim = _claim()

        first = await factory(claim)
        second = await factory(claim)

        assert observed == [claim, claim]
        assert first.project_id == 42
        assert first.base_url == "https://elitea.internal"
        assert first.auth_token == "token-1"
        assert second.auth_token == "token-2"
        assert "token-1" not in repr(first)

    asyncio.run(run())


def test_factory_rejects_noncanonical_project_or_missing_token() -> None:
    async def run() -> None:
        async def missing(_: IndexExecutionClaim) -> str:
            return ""

        factory = ClaimBoundEliteaClientContextFactory(
            base_url="https://elitea.internal",
            token_fetcher=missing,
        )
        with pytest.raises(DependencyUnavailable):
            await factory(_claim())

        with pytest.raises(InvalidInput):
            await factory(
                IndexExecutionClaim(
                    execution_id="execution-1",
                    generation=1,
                    claim_id="claim-1",
                    fence_token=b"f" * 32,
                    resource_project_id="042",
                )
            )

    asyncio.run(run())


def test_factory_rejects_plaintext_platform_origin() -> None:
    async def fetch(_: IndexExecutionClaim) -> str:
        return "token"

    with pytest.raises(ValueError, match="policy is incomplete"):
        ClaimBoundEliteaClientContextFactory(
            base_url="http://elitea.internal",
            token_fetcher=fetch,
        )


def _claim() -> IndexExecutionClaim:
    return IndexExecutionClaim(
        execution_id="execution-1",
        generation=1,
        claim_id="claim-1",
        fence_token=b"f" * 32,
        resource_project_id="42",
    )
