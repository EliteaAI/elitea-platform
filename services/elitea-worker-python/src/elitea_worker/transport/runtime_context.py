"""Retrieve a claim-bound execution actor PAT for user-initiated indexing."""

from __future__ import annotations

import base64
import json
from urllib.parse import quote, urlsplit

import httpx

from elitea_worker.agents.client_context import IndexExecutionClaim
from elitea_worker.execution.errors import (
    AuthorizationFailure,
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
    WorkerError,
)

TOKEN_CONTEXT_SCHEMA = "elitea.runtime.elitea-client-token.v1"
MAX_TOKEN_CONTEXT_BYTES = 32 * 1024


class ClaimBoundEliteaTokenClient:
    """Fetch one non-cached token using an already accepted claim and mTLS."""

    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        origin: str,
        timeout_seconds: float = 15.0,
        max_response_bytes: int = MAX_TOKEN_CONTEXT_BYTES,
        require_http2: bool = False,
    ) -> None:
        if timeout_seconds <= 0 or not 1 <= max_response_bytes <= MAX_TOKEN_CONTEXT_BYTES:
            raise ValueError("runtime client-token policy is incomplete")
        self._client = client
        self._origin = _canonical_https_origin(origin)
        self._timeout = timeout_seconds
        self._max_response_bytes = max_response_bytes
        self._require_http2 = require_http2

    async def __call__(self, claim: IndexExecutionClaim) -> str:
        url = (
            f"{self._origin}/executions/{quote(claim.execution_id, safe='')}"
            f"/generations/{claim.generation}"
            "/runtime-context/elitea-client-token"
        )
        fence = base64.urlsafe_b64encode(claim.fence_token).rstrip(b"=").decode("ascii")
        body = bytearray()
        try:
            async with self._client.stream(
                "POST",
                url,
                headers={
                    "x-elitea-claim-id": claim.claim_id,
                    "x-elitea-fence": fence,
                },
                content=b"",
                timeout=self._timeout,
                follow_redirects=False,
            ) as response:
                if self._require_http2 and response.http_version != "HTTP/2":
                    raise DependencyUnavailable(
                        "The runtime context service did not negotiate HTTP/2."
                    )
                if _response_origin(response) != self._origin:
                    raise InvalidInput("The runtime context response changed origin.")
                if response.status_code in (401, 403):
                    raise AuthorizationFailure(
                        "The claim-bound runtime context was rejected."
                    )
                if response.status_code < 200 or response.status_code >= 300:
                    raise DependencyUnavailable(
                        "The runtime context service did not accept the request."
                    )
                if response.headers.get("content-type", "").split(";", 1)[0].lower() != "application/json":
                    raise InvalidInput("The runtime context response type is malformed.")
                cache_directives = {
                    value.strip().lower()
                    for value in response.headers.get("cache-control", "").split(",")
                    if value.strip()
                }
                if not {"no-store", "no-cache"}.issubset(cache_directives):
                    raise InvalidInput("The runtime context cache policy is malformed.")
                if response.headers.get("pragma", "").strip().lower() != "no-cache":
                    raise InvalidInput("The runtime context cache policy is malformed.")
                declared = response.headers.get("content-length")
                if declared is None or not declared.isascii() or not declared.isdecimal():
                    raise InvalidInput("The runtime context length is malformed.")
                declared_length = int(declared)
                if declared_length < 1 or declared_length > self._max_response_bytes:
                    raise ResourceExhausted(
                        "The runtime context exceeds the approved limit."
                    )
                async for chunk in response.aiter_bytes():
                    if len(body) + len(chunk) > declared_length:
                        raise InvalidInput("The runtime context length is malformed.")
                    body.extend(chunk)
        except WorkerError:
            raise
        except httpx.HTTPError as exc:
            raise DependencyUnavailable("The runtime context service is unavailable.") from exc

        if len(body) != declared_length:
            raise InvalidInput("The runtime context length is malformed.")
        try:
            value = json.loads(
                body.decode("utf-8"),
                object_pairs_hook=_unique_object,
                parse_constant=_reject_constant,
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise InvalidInput("The runtime context response is malformed.") from exc
        if not isinstance(value, dict) or set(value) != {"schema_version", "project_id", "token"}:
            raise InvalidInput("The runtime context response is malformed.")
        project_id = value["project_id"]
        token = value["token"]
        if (
            value["schema_version"] != TOKEN_CONTEXT_SCHEMA
            or isinstance(project_id, bool)
            or not isinstance(project_id, int)
            or project_id < 1
            or str(project_id) != claim.resource_project_id
            or not isinstance(token, str)
            or not token
            or any(character in token for character in ("\r", "\n", "\x00"))
        ):
            raise AuthorizationFailure(
                "The runtime context does not match the accepted execution."
            )
        try:
            if len(token.encode("utf-8")) > self._max_response_bytes:
                raise AuthorizationFailure(
                    "The runtime context does not match the accepted execution."
                )
        except UnicodeEncodeError as exc:
            raise AuthorizationFailure(
                "The runtime context does not match the accepted execution."
            ) from exc
        return token


def _response_origin(response: httpx.Response) -> str:
    try:
        netloc = response.url.netloc.decode("ascii")
    except UnicodeDecodeError as exc:
        raise InvalidInput("The runtime context response changed origin.") from exc
    return _canonical_https_origin(f"{response.url.scheme}://{netloc}")


def _canonical_https_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("runtime context origin must be an HTTPS origin")
    try:
        port = parsed.port
        hostname = parsed.hostname.encode("ascii").decode("ascii").lower()
    except (UnicodeError, ValueError) as exc:
        raise ValueError("runtime context origin must be canonical") from exc
    host = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != 443:
        host = f"{host}:{port}"
    return f"https://{host}"


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate JSON member")
        result[key] = value
    return result


def _reject_constant(value: str) -> object:
    raise ValueError(f"non-finite JSON number: {value}")
