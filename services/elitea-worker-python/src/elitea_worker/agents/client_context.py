"""Claim-scoped in-memory authorization for the existing EliteA SDK client."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from urllib.parse import urlsplit

from elitea_worker.execution.errors import DependencyUnavailable, InvalidInput, WorkerError


@dataclass(frozen=True, slots=True)
class IndexExecutionClaim:
    execution_id: str
    generation: int
    claim_id: str
    fence_token: bytes
    resource_project_id: str

    def __post_init__(self) -> None:
        required_text = (
            self.execution_id,
            self.claim_id,
            self.resource_project_id,
        )
        if (
            any(not _bounded_text(value, 256) for value in required_text)
            or self.generation < 1
            or len(self.fence_token) != 32
        ):
            raise InvalidInput("The index execution claim identity is malformed.")


@dataclass(frozen=True, slots=True)
class EliteaClientContext:
    project_id: int
    base_url: str
    auth_token: str = field(repr=False)

    def __post_init__(self) -> None:
        if self.project_id < 1 or not _valid_base_url(self.base_url):
            raise DependencyUnavailable(
                "The claim-scoped SDK client context is unavailable."
            )
        if not _bounded_text(self.auth_token, 64 * 1024):
            raise DependencyUnavailable(
                "The claim-scoped SDK client context is unavailable."
            )


ClaimBoundTokenFetcher = Callable[[IndexExecutionClaim], Awaitable[str]]


class ClaimBoundEliteaClientContextFactory:
    """Combine trusted nonsecret origin with a claim-bound execution actor PAT."""

    def __init__(
        self,
        *,
        base_url: str,
        token_fetcher: ClaimBoundTokenFetcher,
    ) -> None:
        if not _valid_base_url(base_url) or token_fetcher is None:
            raise ValueError("claim-bound SDK client context policy is incomplete")
        self._base_url = base_url.rstrip("/")
        self._token_fetcher = token_fetcher

    async def __call__(self, claim: IndexExecutionClaim) -> EliteaClientContext:
        try:
            project_id = int(claim.resource_project_id)
        except (TypeError, ValueError) as exc:
            raise InvalidInput("The index execution project identity is malformed.") from exc
        if str(project_id) != claim.resource_project_id or project_id < 1:
            raise InvalidInput("The index execution project identity is malformed.")
        try:
            token = await self._token_fetcher(claim)
        except WorkerError:
            raise
        except Exception as exc:
            raise DependencyUnavailable(
                "The claim-scoped SDK client context is unavailable."
            ) from exc
        if not isinstance(token, str):
            raise DependencyUnavailable(
                "The claim-scoped SDK client context is unavailable."
            )
        return EliteaClientContext(
            project_id=project_id,
            base_url=self._base_url,
            auth_token=token,
        )


def _valid_base_url(value: object) -> bool:
    if not _bounded_text(value, 2048):
        return False
    parsed = urlsplit(value)
    return bool(
        parsed.scheme == "https"
        and parsed.hostname
        and parsed.username is None
        and parsed.password is None
        and parsed.path in {"", "/"}
        and not parsed.query
        and not parsed.fragment
    )


def _bounded_text(value: object, maximum_bytes: int) -> bool:
    if not isinstance(value, str) or not value or any(
        character in value for character in ("\r", "\n", "\x00")
    ):
        return False
    try:
        return len(value.encode("utf-8")) <= maximum_bytes
    except UnicodeEncodeError:
        return False
