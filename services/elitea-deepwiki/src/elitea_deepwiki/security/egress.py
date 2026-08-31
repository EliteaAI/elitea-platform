"""Git-host egress allowlist, enforced before any credential is used.

ADR-0022 decision 6, and one of its named verification criteria:

    a clone to a non-allowlisted git host is refused before any credential is
    decrypted

Decryption happens on the facade (P2), which does the pre-decrypt check with
the vault in reach. This is the second half of that control and the one that
actually governs the socket: the service refuses the invocation before the
engine builds a clone URL, and therefore before the token this request carries
is ever written into one.

That ordering is the whole point. The legacy engine embedded credentials
directly into clone URLs — ``https://{token}@host/owner/repo.git`` — so a
mistyped or attacker-influenced host meant handing a live token to whoever
answered. Checking after the URL is built would be too late; checking here is
before the credential is used at all.

FAIL-CLOSED, DELIBERATELY.
--------------------------
An unset allowlist refuses every clone. The alternative — treating "unset" as
"allow everything" — is an egress control that silently does nothing, which is
worse than not having one, because it looks like it is there.

Nothing depends on the permissive behaviour yet: the service is not deployed.
Choosing fail-closed now, before anyone can come to rely on the gap, is the
cheapest this decision will ever be.

MATCHING.
---------
Entries are hostnames, compared case-insensitively, with an optional leading
``*.`` for direct subdomains:

    github.com        matches github.com and nothing else
    *.github.com      matches api.github.com; NOT github.com, NOT a.b.github.com

A bare ``*`` is accepted and disables the control. It exists so a deployment
that genuinely wants no restriction has to say so out loud, in configuration
that shows up in review, rather than getting it by leaving a variable unset.
Ports are ignored: the control is about *where* the request goes, and a
different port on the same host is the same host.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urlparse

logger = logging.getLogger(__name__)


class EgressRefused(ValueError):
    """Raised when a destination is not on the allowlist.

    A ``ValueError`` on purpose: the legacy error classifier maps it to
    ``invalid_input``, which is what a request naming a forbidden host is. It
    reaches the caller as a normal tool error rather than an internal fault.
    """


@dataclass(frozen=True)
class EgressPolicy:
    """An immutable allowlist decision function."""

    entries: tuple[str, ...] = ()

    @classmethod
    def parse(cls, raw: str | None) -> "EgressPolicy":
        """Build a policy from a comma- or whitespace-separated list."""
        if not raw:
            return cls(())
        parts = [part.strip().lower() for part in raw.replace(",", " ").split()]
        return cls(tuple(part for part in parts if part))

    @property
    def allows_everything(self) -> bool:
        return "*" in self.entries

    @property
    def is_empty(self) -> bool:
        return not self.entries

    def permits(self, host: str) -> bool:
        if self.allows_everything:
            return True
        if not host:
            return False

        candidate = host.strip().lower()
        # A host may arrive with its port; the control is about destination,
        # and :443 vs :8443 on one host is one host.
        if candidate.startswith("["):  # bracketed IPv6 literal
            candidate = candidate[1:].split("]", 1)[0]
        elif candidate.count(":") == 1:
            candidate = candidate.split(":", 1)[0]

        for entry in self.entries:
            if entry.startswith("*."):
                suffix = entry[1:]  # ".github.com"
                if candidate.endswith(suffix) and "." not in candidate[
                    : -len(suffix)
                ]:
                    return True
            elif candidate == entry:
                return True
        return False

    def check(self, host: str, *, what: str = "destination") -> None:
        """Refuse unless ``host`` is allowed."""
        if self.is_empty:
            raise EgressRefused(
                f"No git-host allowlist is configured, so the {what} "
                f"{host!r} is refused. Set ELITEA_DEEPWIKI_GIT_ALLOWLIST to the "
                f"hosts this deployment may clone from (or '*' to disable the "
                f"control explicitly)."
            )
        if not self.permits(host):
            raise EgressRefused(
                f"The {what} {host!r} is not on the git-host allowlist "
                f"({', '.join(self.entries)}), so this invocation is refused "
                f"before any credential is used."
            )

    def describe(self) -> dict[str, object]:
        return {
            "configured": not self.is_empty,
            "unrestricted": self.allows_everything,
            "entries": list(self.entries),
        }


def host_of(value: str | None) -> str:
    """Extract a hostname from a URL, a ``host:port``, or a bare hostname.

    Returns ``""`` when nothing host-like is present, and the caller treats
    that as a refusal rather than as "no restriction applies".
    """
    if not value:
        return ""
    candidate = value.strip()
    if "://" in candidate:
        parsed = urlparse(candidate)
        return (parsed.hostname or "").lower()
    if candidate.startswith("git@") and ":" in candidate:
        return candidate[4:].split(":", 1)[0].lower()
    # A bare host or host:port.
    return urlparse(f"//{candidate}").hostname or candidate.lower()


#: Provider configuration keys that carry the host, per provider. GitHub reads
#: ``base_url`` and GitLab reads ``url`` — a difference found by running the
#: engine, not by reading it, and one this module must not get wrong.
_HOST_KEYS = ("base_url", "url", "api_url", "host")

#: Where each provider's default host lives when the configuration names none.
_DEFAULT_HOSTS = {
    "github": "github.com",
    "gitlab": "gitlab.com",
    "bitbucket": "bitbucket.org",
    "ado_repos": "dev.azure.com",
}


def destination_host(repo_config: dict) -> str:
    """The host a ``repo_config`` will cause a clone from.

    Mirrors what the engine's provider factory does with the same dict: read
    the provider's configured base URL, falling back to the provider's public
    default when none is given.
    """
    provider = (repo_config.get("provider_type") or "github").lower()
    provider_config = repo_config.get("provider_config") or {}

    for key in _HOST_KEYS:
        host = host_of(provider_config.get(key))
        if host:
            return host

    # Some shapes put the repository itself as a full URL.
    host = host_of(repo_config.get("repository"))
    if host:
        return host

    return _DEFAULT_HOSTS.get(provider, "")


def check_repo_config(policy: EgressPolicy, repo_config: dict) -> str:
    """Refuse a repo_config whose clone destination is not allowlisted.

    Returns the host, so a caller can log what it permitted.
    """
    host = destination_host(repo_config)
    policy.check(host or "<unresolvable>", what="clone destination")
    return host


def allowed_hosts(policies: Iterable[str]) -> EgressPolicy:  # pragma: no cover
    """Convenience for building a policy in tests."""
    return EgressPolicy(tuple(policies))
