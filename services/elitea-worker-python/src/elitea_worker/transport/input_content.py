"""Scoped, bounded HTTPS content retrieval separate from control and Redis."""

from __future__ import annotations

import hashlib
import hmac
import base64
import binascii
from dataclasses import dataclass
from urllib.parse import quote, urlsplit

import httpx

from elitea_worker.execution.errors import (
    AuthorizationFailure,
    DependencyUnavailable,
    InvalidInput,
    ResourceExhausted,
    WorkerError,
)


@dataclass(frozen=True, slots=True)
class InputReadGrant:
    url: str
    expected_length: int
    expected_sha256: bytes
    expected_media_type: str
    headers: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class ClaimBoundInputReference:
    execution_id: str
    generation: int
    content_id: str
    immutable_version: str
    claim_id: str
    fence_token: bytes
    expected_length: int
    expected_sha256: bytes
    media_type: str


class ClaimBoundInputRequestBuilder:
    def __init__(
        self,
        *,
        origin: str,
        claim_header_name: str = "X-Elitea-Claim-Id",
        fence_header_name: str = "X-Elitea-Fence",
    ) -> None:
        self._origin = _canonical_https_origin(origin)
        self._claim_header = _header_name(claim_header_name)
        self._fence_header = _header_name(fence_header_name)

    def build(self, reference: ClaimBoundInputReference) -> InputReadGrant:
        required = (
            reference.execution_id,
            reference.content_id,
            reference.immutable_version,
            reference.claim_id,
        )
        if any(not value for value in required) or reference.generation < 1:
            raise InvalidInput("The claim-bound content reference is malformed.")
        if len(reference.fence_token) != 32:
            raise InvalidInput("The claim-bound content fence is malformed.")
        path = (
            f"/executions/{quote(reference.execution_id, safe='')}"
            f"/generations/{reference.generation}"
            f"/inputs/{quote(reference.content_id, safe='')}"
            f"/versions/{quote(reference.immutable_version, safe='')}"
        )
        fence = base64.urlsafe_b64encode(reference.fence_token).rstrip(b"=").decode("ascii")
        return InputReadGrant(
            url=self._origin + path,
            expected_length=reference.expected_length,
            expected_sha256=reference.expected_sha256,
            expected_media_type=reference.media_type,
            headers=(
                (self._claim_header, reference.claim_id),
                (self._fence_header, fence),
            ),
        )


class ScopedInputContentClient:
    def __init__(
        self,
        client: httpx.AsyncClient,
        *,
        allowed_origins: frozenset[str],
        max_content_bytes: int,
        timeout_seconds: float = 15.0,
        allowed_request_headers: frozenset[str] = frozenset(
            {"x-elitea-claim-id", "x-elitea-fence"}
        ),
    ) -> None:
        if not allowed_origins or max_content_bytes < 1 or timeout_seconds <= 0:
            raise ValueError("input-content policy is incomplete")
        self._client = client
        self._allowed_origins = frozenset(
            _canonical_https_origin(origin) for origin in allowed_origins
        )
        self._max_content_bytes = max_content_bytes
        self._timeout = timeout_seconds
        self._allowed_request_headers = frozenset(
            _header_name(name).lower() for name in allowed_request_headers
        )

    async def fetch(self, grant: InputReadGrant) -> bytes:
        parsed = urlsplit(grant.url)
        try:
            origin = _canonical_https_origin(f"{parsed.scheme}://{parsed.netloc}")
        except ValueError as exc:
            raise InvalidInput("The scoped content endpoint is not allowed.") from exc
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or bool(parsed.fragment)
            or bool(parsed.query)
            or origin not in self._allowed_origins
        ):
            raise InvalidInput("The scoped content endpoint is not allowed.")
        if (
            len(grant.expected_sha256) != 32
            or grant.expected_length < 1
            or grant.expected_media_type != "application/json"
        ):
            raise InvalidInput("The scoped content descriptor is malformed.")
        if grant.expected_length > self._max_content_bytes:
            raise ResourceExhausted("The scoped content exceeds the approved input limit.")

        headers: dict[str, str] = {}
        for name, value in grant.headers:
            try:
                normalized = _header_name(name)
            except ValueError as exc:
                raise InvalidInput("The scoped content request headers are malformed.") from exc
            if (
                normalized.lower() not in self._allowed_request_headers
                or normalized.lower() in headers
                or "\r" in value
                or "\n" in value
            ):
                raise InvalidInput("The scoped content request headers are malformed.")
            headers[normalized.lower()] = value
        digest = hashlib.sha256()
        result = bytearray()
        try:
            async with self._client.stream(
                "GET",
                grant.url,
                headers=headers,
                timeout=self._timeout,
                follow_redirects=False,
            ) as response:
                try:
                    response_origin = _canonical_https_origin(
                        f"{response.url.scheme}://{response.url.netloc.decode('ascii')}"
                    )
                except (UnicodeDecodeError, ValueError) as exc:
                    raise InvalidInput("The scoped content response changed origin.") from exc
                if response_origin != origin:
                    raise InvalidInput("The scoped content response changed origin.")
                if response.status_code in (401, 403):
                    raise AuthorizationFailure("The scoped content grant was rejected.")
                if response.status_code < 200 or response.status_code >= 300:
                    raise DependencyUnavailable("The scoped content service did not accept the request.")
                response_digest = _content_digest(response.headers.get("content-digest"))
                if (
                    response.headers.get("cache-control", "").lower().replace(" ", "")
                    != "private,no-store"
                ):
                    raise InvalidInput("The content response cache policy is malformed.")
                response_media_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if response_media_type != grant.expected_media_type:
                    raise InvalidInput("The content response media type is malformed.")
                declared = response.headers.get("content-length")
                if declared is not None:
                    try:
                        declared_length = int(declared)
                    except ValueError as exc:
                        raise InvalidInput("The content length is malformed.") from exc
                    if declared_length != grant.expected_length:
                        raise InvalidInput("The content length does not match its descriptor.")
                async for chunk in response.aiter_bytes():
                    if len(result) + len(chunk) > grant.expected_length:
                        raise InvalidInput("The content length does not match its descriptor.")
                    result.extend(chunk)
                    digest.update(chunk)
        except WorkerError:
            raise
        except httpx.HTTPError as exc:
            raise DependencyUnavailable("The scoped content service is unavailable.") from exc
        actual_digest = digest.digest()
        if (
            len(result) != grant.expected_length
            or not hmac.compare_digest(actual_digest, grant.expected_sha256)
            or not hmac.compare_digest(response_digest, actual_digest)
        ):
            raise InvalidInput("The scoped content does not match its immutable descriptor.")
        return bytes(result)


def _content_digest(value: str | None) -> bytes:
    if value is None or not value.startswith("sha-256=:") or not value.endswith(":"):
        raise InvalidInput("The content response digest is malformed.")
    encoded = value[len("sha-256=:") : -1]
    if not encoded or "," in encoded or " " in encoded:
        raise InvalidInput("The content response digest is malformed.")
    try:
        digest = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise InvalidInput("The content response digest is malformed.") from exc
    if len(digest) != 32:
        raise InvalidInput("The content response digest is malformed.")
    return digest


def _header_name(value: str) -> str:
    if not value or any(character not in "!#$%&'*+-.^_`|~0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ" for character in value):
        raise ValueError("invalid HTTP header name")
    return value


def _canonical_https_origin(value: str) -> str:
    parsed = urlsplit(value)
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/")
        or bool(parsed.query)
        or bool(parsed.fragment)
    ):
        raise ValueError("claim-bound content origin must be an HTTPS origin")
    try:
        port = parsed.port
        hostname = parsed.hostname.encode("ascii").decode("ascii").lower()
    except (UnicodeError, ValueError) as exc:
        raise ValueError("claim-bound content origin must be canonical") from exc
    host = f"[{hostname}]" if ":" in hostname else hostname
    if port is not None and port != 443:
        host = f"{host}:{port}"
    return f"https://{host}"
