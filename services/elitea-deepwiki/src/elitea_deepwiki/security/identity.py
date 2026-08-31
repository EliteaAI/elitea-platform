"""Signed identity headers — the third implementation of one scheme.

ADR-0022 decision 5 has elitea-main proxy to this service "over mTLS with
HMAC-signed identity headers, the established llmproxy pattern". That pattern
is already written twice in Go:

    services/elitea-main/internal/llmproxy/identity.go        signs
    services/elitea-llm-gateway/internal/llmproxy/identity.go verifies

This is the third, and it must agree with them byte for byte or every request
from the facade fails. The canonical string, the header names and the
version-fallback rule below are transcribed from those files deliberately and
are not free to "improve":

    canonical(v1) = "v1\\n" + project + "\\n" + user + "\\n" + tenant
    canonical(v2) = canonical-body-of-v1-with-"v2" + "\\n" + execution
    signature     = "sha256=" + hex(HMAC-SHA256(secret, canonical))

The Go comment explains why the version prefix exists: the string is duplicated
across independently deployed modules, so changing it in place would fail every
request in both directions for the length of a rolling deploy. The same now
applies here, with a third module in the rotation.

**Verification accepts v2 always, and v1 only when no execution id is
present.** Falling back to v1 for a request that carries an execution id would
make that id caller-attachable, which is the thing signing it prevents.
"""

from __future__ import annotations

import hmac
import logging
from dataclasses import dataclass
from hashlib import sha256

logger = logging.getLogger(__name__)

HEADER_PROJECT_ID = "x-elitea-project-id"
HEADER_USER_ID = "x-elitea-user-id"
HEADER_TENANT_ID = "x-elitea-tenant-id"
HEADER_EXECUTION_ID = "x-elitea-execution-id"
HEADER_SIGNATURE = "x-elitea-identity-signature"

#: Every identity header a client must not be able to set for itself. The edge
#: resolves these; a value arriving from outside is a spoofing attempt, and the
#: middleware strips them before anything downstream can read one.
IDENTITY_HEADERS = (
    HEADER_PROJECT_ID,
    HEADER_USER_ID,
    HEADER_TENANT_ID,
    HEADER_EXECUTION_ID,
    HEADER_SIGNATURE,
)

SIGNATURE_VERSION_V1 = "v1"
SIGNATURE_VERSION_V2 = "v2"


@dataclass(frozen=True)
class Identity:
    """The resolved caller, as the facade signed it."""

    project_id: str = ""
    user_id: str = ""
    tenant_id: str = ""
    execution_id: str = ""

    def canonical(self, version: str) -> str:
        base = f"{version}\n{self.project_id}\n{self.user_id}\n{self.tenant_id}"
        if version == SIGNATURE_VERSION_V2:
            return f"{base}\n{self.execution_id}"
        return base

    def signature_version(self) -> str:
        return SIGNATURE_VERSION_V2 if self.execution_id else SIGNATURE_VERSION_V1

    def sign(self, secret: bytes, version: str | None = None) -> str:
        version = version or self.signature_version()
        digest = hmac.new(secret, self.canonical(version).encode(), sha256)
        return "sha256=" + digest.hexdigest()

    def is_empty(self) -> bool:
        return not (self.project_id or self.user_id or self.tenant_id)


def identity_from_headers(headers) -> Identity:
    """Read an identity off a Starlette/ASGI header mapping (case-insensitive)."""
    return Identity(
        project_id=headers.get(HEADER_PROJECT_ID, "") or "",
        user_id=headers.get(HEADER_USER_ID, "") or "",
        tenant_id=headers.get(HEADER_TENANT_ID, "") or "",
        execution_id=headers.get(HEADER_EXECUTION_ID, "") or "",
    )


def verify_signature(headers, secret: bytes) -> bool:
    """Whether the identity headers carry a valid signature under ``secret``.

    An empty secret disables verification, matching the Go verifier: the mTLS
    transport still authenticates the hop, and the edge only signs when a
    secret is configured. A configured secret with a missing or wrong
    signature is a refusal.
    """
    if not secret:
        return True

    got = headers.get(HEADER_SIGNATURE, "")
    if not got:
        return False

    identity = identity_from_headers(headers)

    if hmac.compare_digest(got, identity.sign(secret, SIGNATURE_VERSION_V2)):
        return True

    if identity.execution_id:
        # A v1 signature does not cover the execution id, so accepting one here
        # would make that id caller-attachable — precisely what signing it
        # prevents. Transcribed from the Go verifier, including this refusal.
        return False

    return hmac.compare_digest(got, identity.sign(secret, SIGNATURE_VERSION_V1))


def sign_headers(identity: Identity, secret: bytes) -> dict[str, str]:
    """Produce the headers a facade would send. Used by tests and the harness."""
    headers = {}
    if identity.project_id:
        headers[HEADER_PROJECT_ID] = identity.project_id
    if identity.user_id:
        headers[HEADER_USER_ID] = identity.user_id
    if identity.tenant_id:
        headers[HEADER_TENANT_ID] = identity.tenant_id
    if identity.execution_id:
        headers[HEADER_EXECUTION_ID] = identity.execution_id
    if secret:
        headers[HEADER_SIGNATURE] = identity.sign(secret)
    return headers
