from __future__ import annotations

from pathlib import Path

import pytest

from .sdk_current import load_current_sdk


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line(
        "markers",
        "pgvector: requires a real PostgreSQL server with the vector extension",
    )


@pytest.fixture(scope="session")
def platform_root() -> Path:
    return Path(__file__).resolve().parents[5]


@pytest.fixture(scope="session")
def current_sdk(platform_root: Path):
    return load_current_sdk(platform_root)
