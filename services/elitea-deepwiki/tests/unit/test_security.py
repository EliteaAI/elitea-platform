"""The security boundary — ADR-0022 decisions 5 and 6.

Two controls with two verification criteria the ADR names directly:

* the service refuses non-mTLS traffic, and client-supplied identity headers
  are stripped at the edge (decision 5);
* a clone to a non-allowlisted git host is refused before any credential is
  used (decision 6).

The identity scheme is a third implementation of one that already exists twice
in Go, so it is tested against vectors computed independently here rather than
against itself.
"""

from __future__ import annotations

import hmac
from hashlib import sha256

import pytest
from fastapi import Request
from httpx import ASGITransport, AsyncClient

from elitea_deepwiki.app import create_app
from elitea_deepwiki.config import Settings
from elitea_deepwiki.security.egress import (
    EgressPolicy,
    EgressRefused,
    check_repo_config,
    destination_host,
    host_of,
)
from elitea_deepwiki.security.identity import (
    HEADER_EXECUTION_ID,
    HEADER_PROJECT_ID,
    HEADER_SIGNATURE,
    HEADER_USER_ID,
    Identity,
    sign_headers,
    verify_signature,
)

SECRET = b"shared-secret"


# ---------------------------------------------------------------------------
# the identity scheme
# ---------------------------------------------------------------------------


def independent_signature(secret: bytes, *fields: str) -> str:
    """Compute the expected signature without using the code under test.

    The canonical string is transcribed from elitea-main's identity.go. Signing
    it here by hand is what makes this a cross-implementation check rather than
    the module agreeing with itself.
    """
    canonical = "\n".join(fields)
    return "sha256=" + hmac.new(secret, canonical.encode(), sha256).hexdigest()


def test_v1_matches_the_go_canonical_string():
    identity = Identity(project_id="7", user_id="42", tenant_id="t")
    assert identity.sign(SECRET) == independent_signature(
        SECRET, "v1", "7", "42", "t"
    )


def test_v2_covers_the_execution_id():
    identity = Identity(project_id="7", user_id="42", tenant_id="t", execution_id="e1")
    assert identity.sign(SECRET) == independent_signature(
        SECRET, "v2", "7", "42", "t", "e1"
    )


def test_an_execution_id_selects_v2_automatically():
    assert Identity(project_id="1").signature_version() == "v1"
    assert Identity(project_id="1", execution_id="x").signature_version() == "v2"


def test_a_valid_signature_verifies():
    identity = Identity(project_id="7", user_id="42", tenant_id="t")
    assert verify_signature(sign_headers(identity, SECRET), SECRET)


def test_a_tampered_field_does_not_verify():
    """The point of signing: the headers cannot be edited in flight."""
    headers = sign_headers(Identity(project_id="7", user_id="42"), SECRET)
    headers[HEADER_PROJECT_ID] = "8"
    assert not verify_signature(headers, SECRET)


def test_a_wrong_secret_does_not_verify():
    headers = sign_headers(Identity(project_id="7"), SECRET)
    assert not verify_signature(headers, b"another-secret")


def test_a_missing_signature_is_refused_when_a_secret_is_configured():
    assert not verify_signature({HEADER_PROJECT_ID: "7"}, SECRET)


def test_an_empty_secret_disables_verification():
    """Matches the Go verifier: the mTLS transport still authenticates."""
    assert verify_signature({HEADER_PROJECT_ID: "7"}, b"")


def test_a_v1_signature_cannot_carry_an_execution_id():
    """The asymmetry, transcribed from the Go verifier.

    v1 does not cover the execution id, so accepting a v1 signature on a
    request that carries one would make the id caller-attachable — exactly
    what signing it prevents. This is the case a naive "try both versions"
    fallback gets wrong.
    """
    identity = Identity(project_id="7", user_id="42", tenant_id="t")
    headers = sign_headers(identity, SECRET)  # signs v1: no execution id
    assert verify_signature(headers, SECRET)

    headers[HEADER_EXECUTION_ID] = "smuggled"
    assert not verify_signature(headers, SECRET)


# ---------------------------------------------------------------------------
# the middleware
# ---------------------------------------------------------------------------


def client_for(settings: Settings) -> AsyncClient:
    app = create_app(settings=settings)
    return AsyncClient(
        transport=ASGITransport(app=app), base_url="https://deepwiki.test"
    )


async def test_without_mtls_configured_the_service_serves_normally():
    """A dev stack with no certificates must still work."""
    async with client_for(Settings()) as http:
        assert (await http.get("/descriptor")).status_code == 200


async def test_with_mtls_required_an_unauthenticated_hop_is_refused():
    """ADR-0022 decision 5: the service refuses non-mTLS traffic.

    The ASGI transport presents no client certificate, which is precisely the
    misconfiguration this refuses: TLS terminated somewhere that did not verify
    a client, or plain HTTP forwarded in.
    """
    settings = Settings(tls_ca_file="/etc/deepwiki/ca.pem")
    async with client_for(settings) as http:
        response = await http.get("/descriptor")

    assert response.status_code == 496
    assert response.json()["errorCode"] == "496"


async def test_health_is_reachable_without_a_client_certificate():
    """A readiness probe has no project and no certificate."""
    settings = Settings(tls_ca_file="/etc/deepwiki/ca.pem")
    async with client_for(settings) as http:
        assert (await http.get("/health")).status_code == 200


async def test_client_supplied_identity_headers_never_reach_a_handler():
    """ADR-0022 decision 5: stripped at the edge.

    The strongest form of the property: whatever a client sends, no handler
    can read it. Asserted by looking at the scope the handler actually sees,
    because asserting only that `request.state.identity` is empty would leave
    the raw header readable by the next handler someone writes.
    """
    seen: dict[str, object] = {}
    settings = Settings(identity_secret="s3cret")
    app = create_app(settings=settings)

    @app.get("/_probe")
    async def _probe(request: Request):
        seen["headers"] = {
            name.decode().lower() for name, _ in request.scope["headers"]
        }
        seen["identity"] = request.state.identity
        return {"ok": True}

    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://deepwiki.test"
    ) as http:
        await http.get(
            "/_probe",
            headers={
                HEADER_PROJECT_ID: "999",
                HEADER_USER_ID: "attacker",
                HEADER_SIGNATURE: "sha256=deadbeef",
            },
        )

    assert HEADER_PROJECT_ID not in seen["headers"]
    assert HEADER_USER_ID not in seen["headers"]
    assert HEADER_SIGNATURE not in seen["headers"]
    assert seen["identity"].is_empty()


async def test_a_correctly_signed_identity_is_resolved():
    seen: dict[str, object] = {}
    app = create_app(settings=Settings(identity_secret="s3cret"))

    @app.get("/_probe")
    async def _probe(request: Request):
        seen["identity"] = request.state.identity
        return {"ok": True}

    identity = Identity(project_id="7", user_id="42", tenant_id="t")
    async with AsyncClient(
        transport=ASGITransport(app=app), base_url="https://deepwiki.test"
    ) as http:
        await http.get("/_probe", headers=sign_headers(identity, b"s3cret"))

    assert seen["identity"] == identity


async def test_health_reports_the_boundary_rather_than_assuming_it():
    """Both controls off is a valid dev stack and an invalid production one.

    Saying so in /health is what lets an operator tell the difference without
    reading the deployment.
    """
    async with client_for(Settings()) as http:
        body = (await http.get("/health")).json()["extra_info"]
    assert body["mtls_required"] is False
    assert body["identity_verified"] is False
    assert body["git_egress"]["configured"] is False

    settings = Settings(
        tls_ca_file="/ca.pem", identity_secret="s", git_allowlist="github.com"
    )
    async with client_for(settings) as http:
        body = (await http.get("/health")).json()["extra_info"]
    assert body["mtls_required"] is True
    assert body["identity_verified"] is True
    assert body["git_egress"] == {
        "configured": True,
        "unrestricted": False,
        "entries": ["github.com"],
    }


# ---------------------------------------------------------------------------
# the egress allowlist
# ---------------------------------------------------------------------------


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


async def test_a_forbidden_clone_is_refused_before_the_engine_runs():
    """End to end, and before any credential is used.

    The tool callable raises if it is ever reached: the refusal must happen
    before dispatch, which is what "before any credential is used" means when
    the credential is in the request body.
    """
    from elitea_deepwiki.invocations import InvocationContext, InvocationManager
    from elitea_deepwiki.legacy_runner import LegacyToolRunner
    from elitea_deepwiki.toolkits import ToolkitFamily

    def must_not_run(**_kwargs):
        raise AssertionError("the engine was reached despite a forbidden host")

    runner = LegacyToolRunner(
        settings=Settings(git_allowlist="github.com"),
        tools={"generate_wiki": must_not_run},
    )
    manager = InvocationManager()
    invocation = await manager.submit("Wikis", "generate_wiki", lambda _c: None)
    try:
        with pytest.raises(EgressRefused):
            await runner.invoke(
                family=ToolkitFamily.MAIN,
                toolkit_name="Wikis",
                tool_name="generate_wiki",
                request_data={
                    "configuration": {
                        "parameters": {
                            "code_toolkit": {
                                "github_configuration": {
                                    "base_url": "https://ghe.attacker.example",
                                    "access_token": "a-real-looking-token",
                                },
                                "repository": "owner/repo",
                            }
                        }
                    },
                    "parameters": {"query": "doc it"},
                },
                context=InvocationContext(invocation, manager),
            )
    finally:
        await manager.stop()


def test_a_refusal_classifies_as_invalid_input():
    """So it reaches the caller as a tool error, not an internal fault."""
    from elitea_deepwiki.errors import classify

    assert classify(EgressRefused("nope")) == "invalid_input"


async def test_registry_tools_are_not_blocked_by_the_allowlist():
    """wiki_query operates on the registry and clones nothing.

    Refusing it for want of a repository would break a whole toolkit for a
    control that does not apply to it.
    """
    from elitea_deepwiki.invocations import InvocationContext, InvocationManager
    from elitea_deepwiki.legacy_runner import LegacyToolRunner
    from elitea_deepwiki.toolkits import ToolkitFamily

    runner = LegacyToolRunner(
        settings=Settings(git_allowlist=None),  # nothing allowed
        tools={"list_wikis": lambda **_k: {"success": True, "result": "[]"}},
    )
    manager = InvocationManager()
    invocation = await manager.submit("wiki_query", "list_wikis", lambda _c: None)
    try:
        body = await runner.invoke(
            family=ToolkitFamily.WIKI_QUERY,
            toolkit_name="wiki_query",
            tool_name="list_wikis",
            request_data={"parameters": {}},
            context=InvocationContext(invocation, manager),
        )
    finally:
        await manager.stop()

    assert body["status"] == "Completed"


# ---------------------------------------------------------------------------
# model-download egress
# ---------------------------------------------------------------------------


def test_no_model_allowlist_forces_offline():
    """Fail-closed, and enforced rather than declared.

    huggingface_hub reads HF_HUB_OFFLINE; the engine is a verbatim copy that
    calls the library directly, so a policy object it never consults would be
    decoration. Setting the variable is the control.
    """
    from elitea_deepwiki.security.egress import apply_model_egress

    environ: dict[str, str] = {}
    assert apply_model_egress(EgressPolicy.parse(None), environ) == "offline"
    assert environ["HF_HUB_OFFLINE"] == "1"


def test_the_public_hub_on_the_allowlist_permits_downloads():
    from elitea_deepwiki.security.egress import apply_model_egress

    environ: dict[str, str] = {"HF_HUB_OFFLINE": "1"}
    assert apply_model_egress(EgressPolicy.parse("huggingface.co"), environ) == "allowed"
    assert "HF_HUB_OFFLINE" not in environ


def test_an_allowlisted_mirror_is_left_alone():
    from elitea_deepwiki.security.egress import apply_model_egress

    environ = {"HF_ENDPOINT": "https://models.internal"}
    assert apply_model_egress(EgressPolicy.parse("models.internal"), environ) == "mirror"
    assert environ["HF_ENDPOINT"] == "https://models.internal"
    assert "HF_HUB_OFFLINE" not in environ


def test_a_mirror_off_the_allowlist_is_forced_offline():
    """Configuring an endpoint does not exempt it from the allowlist."""
    from elitea_deepwiki.security.egress import apply_model_egress

    environ = {"HF_ENDPOINT": "https://models.attacker.example"}
    assert apply_model_egress(EgressPolicy.parse("models.internal"), environ) == "offline"
    assert environ["HF_HUB_OFFLINE"] == "1"


def test_git_and_model_allowlists_are_independent():
    """Different trust decisions.

    A deployment may allow an internal model mirror and no public git host, or
    the reverse. Sharing one list would force them together.
    """
    settings = Settings(git_allowlist="github.com", model_allowlist="models.internal")
    assert EgressPolicy.parse(settings.git_allowlist).permits("github.com")
    assert not EgressPolicy.parse(settings.model_allowlist).permits("github.com")
    assert EgressPolicy.parse(settings.model_allowlist).permits("models.internal")


# ---------------------------------------------------------------------------
# readiness
# ---------------------------------------------------------------------------


async def test_readiness_is_separate_from_the_provider_health_document():
    """`/health` is the SPI's frozen shape; `/ready` answers a probe's question.

    Answering both from one path would mean either widening a frozen contract
    or having a probe that passes while the service cannot work.
    """
    async with client_for(Settings()) as http:
        health = await http.get("/health")
        ready = await http.get("/ready")

    assert health.status_code == 200
    assert ready.status_code == 200
    assert ready.json()["status"] == "READY"
    # The two documents are not the same shape.
    assert "providerVersion" in health.json()
    assert "providerVersion" not in ready.json()


async def test_readiness_fails_when_the_database_is_unreachable():
    """503 is what takes a replica out of rotation.

    A replica that cannot reach the index database cannot serve queries; one
    that reports READY anyway keeps receiving them.
    """
    settings = Settings(database_url="postgresql://nobody@127.0.0.1:1/nope")
    async with client_for(settings) as http:
        response = await http.get("/ready")

    assert response.status_code == 503
    body = response.json()
    assert body["status"] == "NOT_READY"
    assert body["checks"]["database"] is False


async def test_probes_are_reachable_without_a_client_certificate():
    """Both of them. Requiring one would empty the rotation when mTLS is on."""
    settings = Settings(tls_ca_file="/etc/deepwiki/ca.pem")
    async with client_for(settings) as http:
        assert (await http.get("/health")).status_code == 200
        assert (await http.get("/ready")).status_code == 200
        # And a real SPI route is still refused.
        assert (await http.get("/descriptor")).status_code == 496
