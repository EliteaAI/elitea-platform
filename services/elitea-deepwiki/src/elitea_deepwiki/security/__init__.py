"""The service's security boundary — ADR-0022 decisions 5 and 6.
    egress.py      the git-host allowlist, checked before a credential is used
"""

from .egress import EgressPolicy, EgressRefused, check_repo_config, destination_host

__all__ = [
    "EgressPolicy",
    "EgressRefused",
    "check_repo_config",
    "destination_host",
]
