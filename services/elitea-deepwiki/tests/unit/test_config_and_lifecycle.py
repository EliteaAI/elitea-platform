"""Unit tests for settings parsing and the invocation manager's lifecycle."""

from __future__ import annotations

import asyncio

import pytest

from elitea_deepwiki.config import ConfigError, Settings


# ---------------------------------------------------------------------------
# settings
# ---------------------------------------------------------------------------


def test_defaults_need_no_environment(monkeypatch: pytest.MonkeyPatch):
    for name in (
        "ELITEA_DEEPWIKI_MAX_PARALLEL_WORKERS",
        "DEEPWIKI_MAX_PARALLEL_WORKERS",
        "ELITEA_DEEPWIKI_SLOTS_MODE",
        "DEEPWIKI_JOBS_ENABLED",
        "ELITEA_DEEPWIKI_INVOCATION_RETENTION_SECONDS",
    ):
        monkeypatch.delenv(name, raising=False)

    settings = Settings.from_env()
    assert settings.max_parallel_workers == 1
    assert settings.jobs_enabled is False
    assert settings.invocation_retention_seconds == 3600


def test_legacy_environment_names_still_work(monkeypatch: pytest.MonkeyPatch):
    """An existing deployment's env keeps working across cutover."""
    monkeypatch.setenv("DEEPWIKI_MAX_PARALLEL_WORKERS", "4")
    monkeypatch.setenv("DEEPWIKI_JOBS_ENABLED", "true")
    monkeypatch.setenv("DEEPWIKI_NAMESPACE", "wikis")

    settings = Settings.from_env()
    assert settings.max_parallel_workers == 4
    assert settings.jobs_enabled is True
    assert settings.namespace == "wikis"


def test_new_names_win_over_legacy_aliases(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("DEEPWIKI_MAX_PARALLEL_WORKERS", "4")
    monkeypatch.setenv("ELITEA_DEEPWIKI_MAX_PARALLEL_WORKERS", "9")
    assert Settings.from_env().max_parallel_workers == 9


@pytest.mark.parametrize(
    "name,value",
    [
        ("ELITEA_DEEPWIKI_MAX_PARALLEL_WORKERS", "three"),
        ("ELITEA_DEEPWIKI_MAX_PARALLEL_WORKERS", "0"),
        ("ELITEA_DEEPWIKI_SLOTS_MODE", "maybe"),
        ("ELITEA_DEEPWIKI_INVOCATION_RETENTION_SECONDS", "-1"),
    ],
)
def test_a_bad_value_fails_at_startup(
    monkeypatch: pytest.MonkeyPatch, name: str, value: str
):
    """Strict parse.

    The legacy code did ``int(os.environ.get(...))`` inside a handler wrapped
    in a bare except, so a typo became "mode: error, capacity 0" at request
    time. Here it is a boot failure.
    """
    monkeypatch.setenv(name, value)
    with pytest.raises(ConfigError):
        Settings.from_env()


# ---------------------------------------------------------------------------
# invocation manager
# ---------------------------------------------------------------------------


def test_the_upload_transport_is_a_base_dependency():
    """The base image (SPI shell, every runner) uploads what a generation
    produced through engine/artifacts_platform_client, which imports
    `requests` lazily. Declared only under the `engine` extra, that import
    failed in the base image AFTER a successful generation — six pages
    generated, none landed, reported in band. The declaration is pinned here
    because a fake client in every unit test cannot see a missing module.
    """
    import re
    from pathlib import Path

    # The [project] table's own `dependencies` array — the first one in the
    # file; the extras' arrays come later. Read as text so the test does not
    # depend on tomllib (3.11+) where the suite may run on an older Python.
    text = (Path(__file__).resolve().parents[2] / "pyproject.toml").read_text()
    match = re.search(r"^dependencies = \[(.*?)^\]", text, re.S | re.M)
    assert match is not None, "no [project] dependencies array"
    base = [line.strip().strip(",").strip('"') for line in match.group(1).splitlines()]
    names = [d.split(">")[0].split("=")[0].split("[")[0].strip() for d in base if d and not d.startswith("#")]
    assert "requests" in names, names
