from __future__ import annotations

import pytest

from elitea_worker.agents.checkpoint import CurrentAgentCheckpointFactory
from elitea_worker.execution.errors import DependencyUnavailable


class _Client:
    def __init__(self, values):
        self._values = iter(values)
        self.calls: list[str] = []

    def unsecret(self, name: str):
        self.calls.append(name)
        value = next(self._values)
        if isinstance(value, Exception):
            raise value
        return value


class _Connection:
    def __init__(self) -> None:
        self.closed = False

    def close(self) -> None:
        self.closed = True


class _Saver:
    def __init__(self, connection: _Connection, *, setup_error=None) -> None:
        self.connection = connection
        self.setup_calls = 0
        self._setup_error = setup_error

    def setup(self) -> None:
        self.setup_calls += 1
        if self._setup_error is not None:
            raise self._setup_error


def test_project_checkpoint_store_wins_and_is_closed_without_caching() -> None:
    connections: list[_Connection] = []
    connect_calls: list[tuple[str, bool]] = []

    def connect(value: str, *, autocommit: bool):
        connect_calls.append((value, autocommit))
        connection = _Connection()
        connections.append(connection)
        return connection

    factory = CurrentAgentCheckpointFactory(
        fallback_connection_string="postgresql://fallback/agentstate",
        connection_factory=connect,
        saver_factory=_Saver,
        sleep=lambda _: pytest.fail("project secret must not retry"),
    )
    client = _Client(["postgresql+psycopg://project/project_42"])

    with factory.open(client, project_id=42) as saver:
        assert saver.setup_calls == 1
        assert connections[0].closed is False

    assert client.calls == ["pgvector_project_connstr"]
    assert connect_calls == [("postgresql://project/project_42", True)]
    assert connections[0].closed is True


def test_agentstate_fallback_follows_bounded_current_retry_policy() -> None:
    sleeps: list[float] = []
    connection = _Connection()
    factory = CurrentAgentCheckpointFactory(
        fallback_connection_string="postgresql://postgres/agentstate",
        connection_factory=lambda value, *, autocommit: (
            connection
            if (value, autocommit) == ("postgresql://postgres/agentstate", True)
            else pytest.fail("unexpected connection policy")
        ),
        saver_factory=_Saver,
        sleep=sleeps.append,
    )
    client = _Client([RuntimeError("vault"), None, ""])

    with factory.open(client, project_id=7):
        pass

    assert client.calls == ["pgvector_project_connstr"] * 3
    assert sleeps == [0.5, 1.0]
    assert connection.closed is True


def test_checkpoint_failure_is_safe_and_closes_connection() -> None:
    connection = _Connection()
    factory = CurrentAgentCheckpointFactory(
        fallback_connection_string=None,
        connection_factory=lambda value, *, autocommit: connection,
        saver_factory=lambda value: _Saver(value, setup_error=RuntimeError("db")),
        sleep=lambda _: None,
    )

    with pytest.raises(DependencyUnavailable, match="checkpoint store"):
        with factory.open(_Client(["postgresql://project/state"]), project_id=9):
            pytest.fail("setup failure must prevent execution")
    assert connection.closed is True


def test_agent_body_failure_is_not_mislabeled_as_checkpoint_failure() -> None:
    connection = _Connection()
    factory = CurrentAgentCheckpointFactory(
        fallback_connection_string="postgresql://postgres/agentstate",
        connection_factory=lambda value, *, autocommit: connection,
        saver_factory=_Saver,
        sleep=lambda _: None,
        max_attempts=1,
    )
    body_error = RuntimeError("application fetch failed")

    with pytest.raises(RuntimeError) as raised:
        with factory.open(_Client([None]), project_id=1):
            raise body_error

    assert raised.value is body_error
    assert connection.closed is True


def test_missing_project_and_fallback_fails_closed() -> None:
    factory = CurrentAgentCheckpointFactory(
        fallback_connection_string=None,
        connection_factory=lambda value, *, autocommit: pytest.fail(
            "missing authority must not connect"
        ),
        saver_factory=_Saver,
        sleep=lambda _: None,
        max_attempts=1,
    )

    with pytest.raises(DependencyUnavailable, match="checkpoint store"):
        with factory.open(_Client([None]), project_id=1):
            pytest.fail("missing store must not execute")
