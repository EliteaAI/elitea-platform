"""Shared fixtures for the DeepWiki service tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, AsyncIterator

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from elitea_deepwiki.app import create_app
from elitea_deepwiki.config import Settings

#: The phase-P0 golden fixtures. These tests are the reason they exist: they
#: turn the recorded legacy behaviour into a gate on the ported service.
CONFORMANCE = Path(__file__).resolve().parents[1] / "conformance" / "fixtures"


def load_fixture(*parts: str) -> Any:
    return json.loads(CONFORMANCE.joinpath(*parts).read_text(encoding="utf-8"))


@pytest.fixture
def settings() -> Settings:
    """Settings pinned to the values the P0 fixtures were recorded with."""
    return Settings(
        service_location_url="http://127.0.0.1:8080",
        scratch_path="/tmp/deepwiki",
        jobs_enabled=False,
        max_parallel_workers=3,
        max_concurrent_jobs=3,
    )


@pytest_asyncio.fixture
async def client(settings: Settings) -> AsyncIterator[AsyncClient]:
    """An HTTP client bound to the real ASGI app, lifespan included."""
    app = create_app(settings=settings)
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="http://deepwiki.test"
    ) as http:
        async with app.router.lifespan_context(app):
            yield http


def make_client(app) -> AsyncClient:
    return AsyncClient(
        transport=ASGITransport(app=app), base_url="http://deepwiki.test"
    )
