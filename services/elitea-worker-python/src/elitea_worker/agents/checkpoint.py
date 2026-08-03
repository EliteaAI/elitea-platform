"""Claim-scoped composition of the current LangGraph checkpoint store.

The language-neutral execution contract carries only durable thread/checkpoint
identifiers. PostgreSQL connection material is resolved inside the claimed
worker process and is passed directly to the synchronous SDK/LangGraph runtime.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any, Protocol

from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput


PGVECTOR_PROJECT_CONNSTR_SECRET = "pgvector_project_connstr"
_MAX_CONNECTION_STRING_BYTES = 16 * 1024


class _Connection(Protocol):
    def close(self) -> None: ...


ConnectionFactory = Callable[..., _Connection]
SaverFactory = Callable[[_Connection], Any]
Sleep = Callable[[float], None]


class CurrentAgentCheckpointFactory:
    """Open one current-compatible PostgresSaver for one claimed execution.

    The current indexer resolves the project-specific pgvector secret first and
    otherwise uses its deployment ``agentstate`` database. This implementation
    preserves that selection without caching raw database credentials in the
    worker process. A reclaimed execution therefore opens the same durable
    project/thread namespace on whichever worker owns the new claim.
    """

    def __init__(
        self,
        *,
        fallback_connection_string: str | None,
        connection_factory: ConnectionFactory | None = None,
        saver_factory: SaverFactory | None = None,
        sleep: Sleep = time.sleep,
        max_attempts: int = 3,
        base_retry_seconds: float = 0.5,
    ) -> None:
        if (
            isinstance(max_attempts, bool)
            or not isinstance(max_attempts, int)
            or max_attempts < 1
            or max_attempts > 5
            or base_retry_seconds < 0
            or base_retry_seconds > 5
        ):
            raise ValueError("agent checkpoint retry policy is invalid")
        if fallback_connection_string is not None:
            _validate_connection_string(fallback_connection_string)
        self._fallback = fallback_connection_string
        self._connection_factory = connection_factory
        self._saver_factory = saver_factory
        self._sleep = sleep
        self._max_attempts = max_attempts
        self._base_retry_seconds = base_retry_seconds

    @contextmanager
    def open(self, client: Any, *, project_id: int) -> Iterator[Any]:
        if client is None or isinstance(project_id, bool) or project_id < 1:
            raise InvalidInput("The agent checkpoint project identity is malformed.")
        connection_string = self._resolve_connection_string(client)
        connection_factory, saver_factory = self._factories()
        connection: _Connection | None = None
        try:
            try:
                connection = connection_factory(
                    _normalize_psycopg_connection_string(connection_string),
                    autocommit=True,
                )
                saver = saver_factory(connection)
                setup = getattr(saver, "setup", None)
                if not callable(setup):
                    raise TypeError("the checkpoint saver does not support setup")
                setup()
            except (DependencyUnavailable, InvalidInput):
                raise
            except Exception as exc:
                raise DependencyUnavailable(
                    "The durable agent checkpoint store is unavailable."
                ) from exc

            # The saver owns only checkpoint setup and cleanup. Exceptions from
            # the SDK invocation must retain their real classification instead
            # of being mislabeled as checkpoint-store failures.
            yield saver
        finally:
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    # The operation outcome is already fixed at this point. A
                    # close failure must not expose connection material or
                    # replace the business result.
                    pass

    def _resolve_connection_string(self, client: Any) -> str:
        unsecret = getattr(client, "unsecret", None)
        if not callable(unsecret):
            raise DependencyUnavailable(
                "The durable agent checkpoint store is unavailable."
            )
        for attempt in range(self._max_attempts):
            try:
                value = unsecret(PGVECTOR_PROJECT_CONNSTR_SECRET)
            except Exception:
                value = None
            if value:
                _validate_connection_string(value)
                return value
            if attempt + 1 < self._max_attempts and self._base_retry_seconds:
                self._sleep(self._base_retry_seconds * (2**attempt))
        if self._fallback is None:
            raise DependencyUnavailable(
                "The durable agent checkpoint store is unavailable."
            )
        return self._fallback

    def _factories(self) -> tuple[ConnectionFactory, SaverFactory]:
        connection_factory = self._connection_factory
        saver_factory = self._saver_factory
        if connection_factory is None:
            from psycopg import Connection

            connection_factory = Connection.connect
        if saver_factory is None:
            from langgraph.checkpoint.postgres import PostgresSaver

            saver_factory = PostgresSaver
        return connection_factory, saver_factory


def _validate_connection_string(value: object) -> None:
    if (
        not isinstance(value, str)
        or not value
        or any(character in value for character in ("\r", "\n", "\x00"))
        or len(value.encode("utf-8")) > _MAX_CONNECTION_STRING_BYTES
    ):
        raise DependencyUnavailable(
            "The durable agent checkpoint store is unavailable."
        )


def _normalize_psycopg_connection_string(value: str) -> str:
    if value.startswith("postgresql+psycopg://"):
        return "postgresql://" + value.removeprefix("postgresql+psycopg://")
    return value
