"""The clone-destination control (ADR-0022 decision 6), the half the engine
sidecar still owns in Python.

The git-host allowlist is enforced once more in the Go sub-application host
(``internal/apps/deepwiki/run``), against the same rules; ``EgressPolicy``
here is what ``apply_model_egress`` and the engine-side checks read, and the
two implementations must stay byte-identical in behaviour until the model
egress moves too. The identity scheme and the mTLS boundary that used to be
tested here are the Go host's (ADR-0023) and are tested there.
"""

from __future__ import annotations

import pytest

from elitea_deepwiki.config import Settings
from elitea_deepwiki.security.egress import (
    EgressPolicy,
    EgressRefused,
    check_repo_config,
    destination_host,
    host_of,
)


def test_an_unset_allowlist_refuses_everything():
    """Fail-closed. An egress control that silently allows all is worse than none."""
    policy = EgressPolicy.parse(None)
    assert policy.is_empty
    with pytest.raises(EgressRefused, match="No git-host allowlist is configured"):
        policy.check("github.com")


def test_a_host_on_the_list_is_permitted():
    policy = EgressPolicy.parse("github.com, gitlab.example.internal")
    policy.check("github.com")
    policy.check("GitLab.Example.Internal")  # case-insensitive


def test_a_host_off_the_list_is_refused():
    policy = EgressPolicy.parse("github.com")
    with pytest.raises(EgressRefused, match="not on the git-host allowlist"):
        policy.check("evil.example")


@pytest.mark.parametrize(
    "candidate,allowed",
    [
        ("api.github.com", True),
        ("github.com", False),
        ("a.b.github.com", False),
        ("notgithub.com", False),
        ("evil.com/api.github.com", False),
    ],
)
def test_wildcard_matches_one_label_only(candidate: str, allowed: bool):
    """`*.github.com` is direct subdomains, not the apex and not deeper.

    The cases that matter are the near-misses: `notgithub.com` must not match
    a naive endswith, and `a.b.github.com` must not match either — a wildcard
    that spans labels lets anyone who controls one subdomain reach the rest.
    """
    assert EgressPolicy.parse("*.github.com").permits(candidate) is allowed


def test_a_port_does_not_change_the_host():
    policy = EgressPolicy.parse("git.internal")
    assert policy.permits("git.internal:8443")
    assert not policy.permits("evil.example:8443")


def test_a_bare_star_disables_the_control_explicitly():
    """Available, but only by saying so in configuration a reviewer can see."""
    policy = EgressPolicy.parse("*")
    assert policy.allows_everything
    policy.check("anything.at.all")


@pytest.mark.parametrize(
    "value,expected",
    [
        ("https://github.com/owner/repo.git", "github.com"),
        ("http://127.0.0.1:18900", "127.0.0.1"),
        ("git@github.com:owner/repo.git", "github.com"),
        ("git.internal:8443", "git.internal"),
        ("github.com", "github.com"),
        ("", ""),
        (None, ""),
    ],
)
def test_host_extraction(value, expected):
    assert host_of(value) == expected


@pytest.mark.parametrize(
    "repo_config,expected",
    [
        ({"provider_type": "github", "provider_config": {}}, "github.com"),
        ({"provider_type": "gitlab", "provider_config": {}}, "gitlab.com"),
        (
            {
                "provider_type": "github",
                "provider_config": {"base_url": "https://ghe.internal/api/v3"},
            },
            "ghe.internal",
        ),
        (
            # GitLab reads `url` where GitHub reads `base_url` — a difference
            # found by running the engine. Both must resolve here.
            {
                "provider_type": "gitlab",
                "provider_config": {"url": "https://gitlab.internal"},
            },
            "gitlab.internal",
        ),
    ],
)
def test_the_destination_host_matches_what_the_engine_would_clone(
    repo_config, expected
):
    assert destination_host(repo_config) == expected


def test_an_enterprise_host_is_refused_when_only_the_public_one_is_allowed():
    """The case the control exists for.

    A request naming a GitHub Enterprise base URL clones from that host, not
    from github.com. Allowlisting the public host must not admit it.
    """
    policy = EgressPolicy.parse("github.com")
    repo_config = {
        "provider_type": "github",
        "provider_config": {"base_url": "https://ghe.attacker.example/api/v3"},
        "repository": "owner/repo",
    }
    with pytest.raises(EgressRefused, match="ghe.attacker.example"):
        check_repo_config(policy, repo_config)


def test_a_refusal_classifies_as_invalid_input():
    """So it reaches the caller as a tool error, not an internal fault."""
    from elitea_deepwiki.errors import classify

    assert classify(EgressRefused("nope")) == "invalid_input"
