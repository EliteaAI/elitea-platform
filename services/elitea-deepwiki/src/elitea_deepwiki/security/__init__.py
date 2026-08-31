"""The service's security boundary — ADR-0022 decisions 5 and 6.

    identity.py    the signed identity scheme, transcribed from the two Go
                   implementations it has to agree with
    middleware.py  the mTLS terminus and header stripping
    egress.py      the git-host allowlist, checked before a credential is used
"""

from .egress import EgressPolicy, EgressRefused, check_repo_config, destination_host
from .identity import Identity, sign_headers, verify_signature

__all__ = [
    "EgressPolicy",
    "EgressRefused",
    "Identity",
    "check_repo_config",
    "destination_host",
    "sign_headers",
    "verify_signature",
]
