"""The mTLS terminus: refuse unauthenticated hops, never trust a client header.

ADR-0022 decision 5: elitea-main is the only door, it proxies over mTLS with
HMAC-signed identity headers, "the service refuses non-mTLS traffic", and
"client-supplied identity headers are stripped at the edge".

Two controls, and they are independent on purpose:

**The transport.** TLS with ``CERT_REQUIRED`` is terminated by uvicorn, not
here — a request that reaches this middleware has already presented a
certificate the configured CA signed. What this middleware adds is the refusal
when mTLS is *required* and the transport did not authenticate, which is the
case a misconfigured deployment produces: TLS configured without a CA file,
or the app served over plain HTTP behind something that forwards to it.

**The identity.** Even over an authenticated hop, the identity headers are
data. They are stripped from the inbound request unconditionally and then
re-derived only from a valid signature. Stripping first is what makes the
order safe: no code downstream can read a header that a client set, because by
the time anything else runs the header is gone.

WHY STRIP AND THEN VERIFY, RATHER THAN VERIFY AND KEEP.
------------------------------------------------------
If verification succeeded the headers would be identical either way. The
difference is what happens when it *fails* or is *disabled*: keeping them means
an unverified value stays readable downstream, and the next person to add a
handler that reads ``X-Elitea-Project-Id`` has a spoofable input. Stripping
means the only way to see an identity is through
``request.state.identity``, which exists only when a signature was checked.
"""

from __future__ import annotations

import logging
from typing import Iterable

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from .identity import (
    IDENTITY_HEADERS,
    Identity,
    identity_from_headers,
    verify_signature,
)

logger = logging.getLogger(__name__)

#: Paths served before an identity exists. ``/health`` is what a readiness
#: probe calls, and a probe has no project.
UNAUTHENTICATED_PATHS = frozenset({"/health"})


def _refuse(status_code: int, message: str) -> JSONResponse:
    """The legacy transport-error envelope, which the facade already parses."""
    return JSONResponse(
        {"errorCode": str(status_code), "message": message, "details": []},
        status_code=status_code,
    )


class MutualTLSMiddleware(BaseHTTPMiddleware):
    """Refuse hops that are not mutually authenticated, when that is required."""

    def __init__(self, app, *, required: bool) -> None:
        super().__init__(app)
        self._required = required

    async def dispatch(self, request, call_next):
        if not self._required or request.url.path in UNAUTHENTICATED_PATHS:
            return await call_next(request)

        scope = request.scope
        if scope.get("scheme") not in ("https", "wss"):
            logger.warning(
                "refusing %s %s: mTLS is required and the hop is %s",
                request.method,
                request.url.path,
                scope.get("scheme"),
            )
            return _refuse(421, "Misdirected Request")

        # uvicorn puts the peer certificate here when ssl_cert_reqs requires
        # one. Absent means TLS terminated without client verification, which
        # is a misconfiguration rather than an attack — and is refused all the
        # same, because the alternative is serving as if mTLS were on.
        if not scope.get("extensions", {}).get("tls", {}).get("client_cert_chain"):
            peer = scope.get("client")
            logger.warning(
                "refusing %s %s from %s: no verified client certificate",
                request.method,
                request.url.path,
                peer,
            )
            return _refuse(496, "No Client Certificate")

        return await call_next(request)


class IdentityMiddleware(BaseHTTPMiddleware):
    """Strip client identity headers, then re-derive them from a signature."""

    def __init__(self, app, *, secret: bytes, required: bool) -> None:
        super().__init__(app)
        self._secret = secret
        self._required = required

    async def dispatch(self, request, call_next):
        raw_headers: Iterable[tuple[bytes, bytes]] = request.scope.get("headers", [])
        presented = {
            name.decode("latin-1").lower(): value.decode("latin-1")
            for name, value in raw_headers
        }

        identity = Identity()
        if self._secret:
            if verify_signature(presented, self._secret):
                identity = identity_from_headers(presented)
            elif self._required and request.url.path not in UNAUTHENTICATED_PATHS:
                logger.warning(
                    "refusing %s %s: identity signature missing or invalid",
                    request.method,
                    request.url.path,
                )
                return _refuse(401, "Unauthorized")
            else:
                logger.warning(
                    "dropping unverified identity headers on %s %s",
                    request.method,
                    request.url.path,
                )

        # Unconditional, and after verification rather than before, so a
        # handler can never read a header a client set — verified or not.
        request.scope["headers"] = [
            (name, value)
            for name, value in raw_headers
            if name.decode("latin-1").lower() not in IDENTITY_HEADERS
        ]
        request.state.identity = identity

        return await call_next(request)
