"""Unit tests for settings parsing and the invocation manager's lifecycle."""

from __future__ import annotations

import asyncio

import pytest

from elitea_deepwiki.config import ConfigError, Settings
from elitea_deepwiki.invocations import (
    InMemoryInvocationStore,
    InvocationCancelled,
    InvocationContext,
    InvocationManager,
)


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


async def test_submit_runs_and_stores_a_terminal_result():
    manager = InvocationManager()
    await manager.start()
    try:

        async def call(context: InvocationContext):
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

        invocation = await manager.submit("Wikis", "generate_wiki", call)
        body = await _wait_terminal(manager, invocation.invocation_id)
        assert body["status"] == "Completed"
    finally:
        await manager.stop()


async def test_poll_of_an_unknown_key_returns_none():
    manager = InvocationManager()
    assert await manager.poll("Wikis", "generate_wiki", "nope") is None
    assert await manager.cancel("Wikis", "generate_wiki", "nope") is False


async def test_checkpoint_raises_after_cancel():
    manager = InvocationManager()
    await manager.start()
    reached = asyncio.Event()
    try:

        async def call(context: InvocationContext):
            reached.set()
            while True:
                await context.checkpoint()
                await asyncio.sleep(0.01)

        invocation = await manager.submit("Wikis", "generate_wiki", call)
        await asyncio.wait_for(reached.wait(), timeout=5)
        assert await manager.cancel("Wikis", "generate_wiki", invocation.invocation_id)

        body = await _wait_terminal(manager, invocation.invocation_id)
        assert body["status"] == "Error"
    finally:
        await manager.stop()


async def test_a_cancelled_invocation_is_not_reported_as_completed():
    """InvocationCancelled must not be swallowed into a success."""
    manager = InvocationManager()
    await manager.start()
    try:

        async def call(context: InvocationContext):
            raise InvocationCancelled(context.invocation_id)

        invocation = await manager.submit("Wikis", "ask", call)
        body = await _wait_terminal(manager, invocation.invocation_id, tool="ask")
        assert body["status"] == "Error"
    finally:
        await manager.stop()


async def test_shutdown_records_a_terminal_result_for_in_flight_work():
    """A poll that outlives the process must not be told the id never existed.

    This is the weakest form of the spec's durable-operation-state rule that
    an in-memory store can satisfy: within the process's own lifetime, a
    cancelled-by-shutdown invocation ends as an error rather than vanishing.
    Surviving an actual restart needs the PostgreSQL store.
    """
    store = InMemoryInvocationStore()
    manager = InvocationManager(store=store)
    await manager.start()
    running = asyncio.Event()

    async def call(_context: InvocationContext):
        running.set()
        await asyncio.sleep(3600)

    invocation = await manager.submit("Wikis", "generate_wiki", call)
    await asyncio.wait_for(running.wait(), timeout=5)
    await manager.stop()

    body = await manager.poll("Wikis", "generate_wiki", invocation.invocation_id)
    assert body is not None
    assert body["status"] == "Error"


async def test_terminal_invocations_are_pruned_after_retention():
    manager = InvocationManager(retention_seconds=0, housekeeping_interval=0.01)
    await manager.start()
    try:

        async def call(context: InvocationContext):
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

        invocation = await manager.submit("Wikis", "generate_wiki", call)
        await _wait_terminal(manager, invocation.invocation_id)

        # Pruned entries 404 on the next poll, exactly like the legacy
        # 'pruned' task status.
        for _ in range(200):
            if await manager.poll(
                "Wikis", "generate_wiki", invocation.invocation_id
            ) is None:
                break
            await asyncio.sleep(0.01)
        else:  # pragma: no cover
            raise AssertionError("terminal invocation was never pruned")
    finally:
        await manager.stop()


async def test_events_drain_once():
    manager = InvocationManager()
    await manager.start()
    emitted = asyncio.Event()
    release = asyncio.Event()
    try:

        async def call(context: InvocationContext):
            await context.thinking("one")
            await context.thinking("two")
            emitted.set()
            await release.wait()
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

        invocation = await manager.submit("Wikis", "generate_wiki", call)
        await asyncio.wait_for(emitted.wait(), timeout=5)

        first = await manager.poll("Wikis", "generate_wiki", invocation.invocation_id)
        second = await manager.poll("Wikis", "generate_wiki", invocation.invocation_id)
        release.set()

        assert [event["data"]["message"] for event in first["custom_events"]] == [
            "one",
            "two",
        ]
        assert "custom_events" not in second
    finally:
        await manager.stop()


async def _wait_terminal(
    manager: InvocationManager,
    invocation_id: str,
    *,
    toolkit: str = "Wikis",
    tool: str = "generate_wiki",
    timeout: float = 5.0,
) -> dict:
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        body = await manager.poll(toolkit, tool, invocation_id)
        if body is not None and body.get("status") not in ("Started", "InProgress"):
            return body
        await asyncio.sleep(0.01)
    raise AssertionError(f"invocation {invocation_id} never reached a terminal state")
