"""Shared fixtures for the DeepWiki service tests."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from elitea_deepwiki.config import Settings

#: The phase-P0 golden fixtures. These tests are the reason they exist: they
#: turn the recorded legacy behaviour into a gate on the ported service.
#:
#: They live OUTSIDE this service since P1.0, at conformance/provider/, because
#: the SPI contract belongs to no single provider. This service's recordings
#: are one profile under fixtures/<provider>/. parents[3] is the repository
#: root: tests -> elitea-deepwiki -> services -> root.
CONFORMANCE = (
    Path(__file__).resolve().parents[3]
    / "conformance"
    / "provider"
    / "fixtures"
    / "deepwiki"
)


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
