"""The dispatch and composition adapter, checked against the P0 fixtures.

None of this needs the engine's dependency closure: the runner takes its tool
callables by injection, so the composition path — which is what the fixtures
pin — runs with a stub in place of a ~90k-line analysis engine.

That is also how ``conformance/fixtures/generation/composed_result.json`` was
recorded: by running the *legacy* composer with only ``generate_wiki`` stubbed.
Both sides of the comparison are therefore the same experiment.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from elitea_deepwiki.invocations import InvocationManager
from elitea_deepwiki.legacy_runner import (
    LegacyToolRunner,
    compose_result_objects,
    merge_parameters,
    transform_query_request,
)
from elitea_deepwiki.repo_config import _extract_repo_config_from_toolkit
from elitea_deepwiki.toolkits import ToolkitFamily

FIXTURES = Path(__file__).resolve().parents[2] / "conformance" / "fixtures"
COMPOSED = json.loads(
    (FIXTURES / "generation" / "composed_result.json").read_text(encoding="utf-8")
)


def worker_result() -> dict:
    """Rebuild the engine result the fixture's composition was recorded from.

    The fixture stores the composer's *output*; this is the input that produced
    it, reconstructed from the recorded artifact objects. Round-tripping it
    back through the ported composer is the comparison.
    """
    objects = COMPOSED["result_objects"]
    artifacts = []
    for obj in objects:
        if obj["object_type"] == "wiki_page":
            artifacts.append(
                {"name": obj["name"], "type": "text/markdown", "data": obj["data"]}
            )
        elif obj["object_type"] in ("wiki_structure", "wiki_manifest"):
            artifacts.append(
                {"name": obj["name"], "type": "application/json", "data": obj["data"]}
            )

    context = next(
        obj for obj in objects if obj["object_type"] == "repository_context"
    )
    wiki_id = context["name"].split("/")[0]

    return {
        "success": True,
        "result": objects[0]["data"],
        "artifacts": artifacts,
        "repository_context": context["data"],
        "wiki_id": wiki_id,
    }


# ---------------------------------------------------------------------------
# composition
# ---------------------------------------------------------------------------


def test_generate_wiki_composition_matches_the_recorded_objects():
    """The frozen artifact set, object for object.

    ADR-0022 decision 2 freezes the composed generate_wiki result. This is the
    assertion that makes that binding: order, object_type, target, extension,
    encoding, bucket, name and body.
    """
    composed = compose_result_objects("generate_wiki", worker_result())
    assert composed == COMPOSED["result_objects"]


def test_the_message_object_is_always_first():
    composed = compose_result_objects("generate_wiki", worker_result())
    assert composed[0]["object_type"] == "message"
    assert composed[0]["result_target"] == "response"


def test_every_artifact_carries_the_invoke_time_bucket():
    """`wiki-artifacts`, which disagrees with the descriptor's `wiki`.

    The disagreement is legacy behaviour and the invoke-time value is the one
    that reached the platform, so it is the one preserved. Pinned here so a
    future tidy-up has to be deliberate.
    """
    from elitea_deepwiki.legacy_runner import DEFAULT_BUCKET

    descriptor = json.loads(
        (FIXTURES / "descriptor" / "legacy-v0" / "provider_descriptor.json").read_text()
    )
    declared = {
        obj.get("result_bucket")
        for toolkit in descriptor["provided_toolkits"]
        for tool in toolkit["provided_tools"]
        for obj in (tool.get("tool_metadata") or {}).get("result_objects", [])
        if obj.get("result_bucket")
    }
    assert declared == {"wiki"}
    assert DEFAULT_BUCKET == "wiki-artifacts"

    for obj in compose_result_objects("generate_wiki", worker_result())[1:]:
        assert obj["result_bucket"] == DEFAULT_BUCKET


def test_partial_failures_are_reported_in_band():
    result = {
        **worker_result(),
        "failed_pages": [
            {"page_id": "1#2", "title": "Search Ranking", "status": "failed"},
            "a bare string entry",
        ],
        "errors": ["llm timeout", "rate limited"],
    }
    composed = compose_result_objects("generate_wiki", result)
    messages = [obj["data"] for obj in composed if obj["object_type"] == "message"]

    assert messages[1].startswith("⚠️ Partial issues detected:")
    assert "Failed pages: 2" in messages[1]
    assert "Errors: 2" in messages[1]
    assert messages[2] == (
        "Failed pages:\n- 1#2 Search Ranking (failed)\n- a bare string entry"
    )
    assert messages[3] == "Errors:\n- llm timeout\n- rate limited"


def test_a_nameless_manifest_is_recognised_by_its_body():
    """The legacy content sniff, which the worker relied on.

    A JSON artifact with no name but a body carrying wiki_version_id and a
    pages list is a manifest, and gets a synthesised filename.
    """
    body = json.dumps({"wiki_version_id": "20260101T000000Z-abcdef12", "pages": []})
    composed = compose_result_objects(
        "generate_wiki",
        {"success": True, "result": "ok", "artifacts": [
            {"name": None, "type": "application/json", "data": body}
        ]},
    )
    manifest = composed[1]
    assert manifest["object_type"] == "wiki_manifest"
    assert manifest["name"] == "wiki_manifest_20260101T000000Z-abcdef12.json"


def test_a_nameless_json_body_without_manifest_markers_is_the_structure():
    composed = compose_result_objects(
        "generate_wiki",
        {"success": True, "result": "ok", "artifacts": [
            {"name": "", "type": "application/json", "data": '{"wiki_title": "x"}'}
        ]},
    )
    assert composed[1]["object_type"] == "wiki_structure"
    assert composed[1]["name"] == "wiki_structure.json"


def test_artifacts_the_worker_already_uploaded_are_skipped():
    """`_uploaded_directly` — set by the Kubernetes-Job worker.

    Re-emitting them would duplicate every page, because the legacy
    result_objects path strips directory prefixes from artifact names.
    """
    result = worker_result()
    for artifact in result["artifacts"]:
        artifact["_uploaded_directly"] = True
    composed = compose_result_objects("generate_wiki", result)
    assert [obj["object_type"] for obj in composed] == ["message", "repository_context"]


def test_ask_emits_the_answer_and_a_separate_sources_message():
    composed = compose_result_objects(
        "ask",
        {
            "success": True,
            "answer": "Notes are stored in SQLite.",
            "sources": [{"source": f"file{i}.py"} for i in range(8)],
        },
    )
    assert len(composed) == 2
    assert composed[0]["data"] == "Notes are stored in SQLite."
    # Five sources at most, exactly as the legacy slice did.
    assert composed[1]["data"].count("- file") == 5


def test_deep_research_prefers_report_then_answer():
    assert compose_result_objects(
        "deep_research", {"success": True, "report": "R", "answer": "A"}
    )[0]["data"] == "R"
    assert compose_result_objects(
        "deep_research", {"success": True, "answer": "A"}
    )[0]["data"] == "A"


def test_repository_context_is_absent_for_query_tools():
    """Only generate_wiki emitted it, even when the result carried one."""
    composed = compose_result_objects(
        "ask", {"success": True, "answer": "x", "repository_context": "ctx"}
    )
    assert [obj["object_type"] for obj in composed] == ["message"]


# ---------------------------------------------------------------------------
# parameter merge
# ---------------------------------------------------------------------------


def test_tool_parameters_land_when_absent_from_the_configuration():
    merged = merge_parameters(
        {"configuration": {"parameters": {"a": 1}}, "parameters": {"b": 2}}
    )
    assert merged == {"a": 1, "b": 2}


def test_a_falsy_tool_parameter_does_not_override_the_configuration():
    """The legacy asymmetry: `if key not in params or value`.

    Passing `exclude_tests=False` explicitly does NOT override a configured
    `True`. It is surprising, callers may depend on it, and it is the kind of
    thing a rewrite silently "fixes" — so it is pinned.
    """
    merged = merge_parameters(
        {
            "configuration": {"parameters": {"exclude_tests": True}},
            "parameters": {"exclude_tests": False},
        }
    )
    assert merged["exclude_tests"] is True

    # A truthy value does override.
    merged = merge_parameters(
        {
            "configuration": {"parameters": {"exclude_tests": False}},
            "parameters": {"exclude_tests": True},
        }
    )
    assert merged["exclude_tests"] is True


# ---------------------------------------------------------------------------
# repo_config
# ---------------------------------------------------------------------------


def test_repo_config_reproduces_the_recorded_engine_call():
    recorded = COMPOSED["engine_call"]["repo_config"]
    params = merge_parameters(
        {
            "configuration": {
                "parameters": {
                    "code_toolkit": {
                        "github_configuration": {
                            "url": "https://github.com",
                            "repository": "acme/notes-service",
                            "active_branch": "main",
                        }
                    }
                }
            },
            "parameters": {},
        }
    )
    assert _extract_repo_config_from_toolkit(params) == recorded


@pytest.mark.parametrize(
    "key,expected_provider",
    [
        ("github_configuration", "github"),
        ("gitlab_configuration", "gitlab"),
        ("bitbucket_configuration", "bitbucket"),
        ("ado_configuration", "ado_repos"),
    ],
)
def test_every_provider_family_is_recognised(key: str, expected_provider: str):
    """Only GitHub has a fixture; the other three are smoke-checked here.

    spec-provider-service requires compatibility fixtures for GitHub, GitLab,
    Bitbucket and Azure DevOps repository access. This is not that — it only
    proves the provider is selected — and the gap is named in the README.
    """
    config = _extract_repo_config_from_toolkit(
        {"code_toolkit": {key: {"url": "https://example.test"}}}
    )
    assert config["provider_type"] == expected_provider
    assert config["provider_config"] == {"url": "https://example.test"}


# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------


async def test_the_runner_dispatches_and_composes():
    calls = []

    def generate_wiki(**kwargs):
        calls.append(kwargs)
        return worker_result()

    runner = LegacyToolRunner(tools={"generate_wiki": generate_wiki})
    manager = InvocationManager()
    invocation = await manager.submit("Wikis", "generate_wiki", lambda _c: None)
    context_holder = {}

    from elitea_deepwiki.invocations import InvocationContext

    context = InvocationContext(invocation, manager)
    context_holder["c"] = context

    body = await runner.invoke(
        family=ToolkitFamily.MAIN,
        toolkit_name="Wikis",
        tool_name="generate_wiki",
        request_data={
            "configuration": {
                "parameters": {
                    "code_toolkit": {
                        "github_configuration": {
                            "url": "https://github.com",
                            "repository": "acme/notes-service",
                            "active_branch": "main",
                        }
                    },
                    "llm_settings": COMPOSED["engine_call"]["llm_settings"],
                    "embedding_model": COMPOSED["engine_call"]["embedding_model"],
                }
            },
            "parameters": {"query": "Document the notes service"},
        },
        context=context,
    )
    await manager.stop()

    assert body["status"] == "Completed"
    assert body["result_type"] == "String"
    assert json.loads(body["result"]) == COMPOSED["result_objects"]

    # The keyword set the legacy handler passed, as recorded.
    assert set(calls[0]) == set(COMPOSED["engine_call"])
    assert calls[0]["repo_config"] == COMPOSED["engine_call"]["repo_config"]
    assert calls[0]["run_in_subprocess"] is True


async def test_an_unsuccessful_engine_result_raises_the_right_exception_type():
    """The category the caller sees comes from the exception type."""
    from elitea_deepwiki.errors import classify

    cases = [
        ({"success": False, "error": "boom"}, RuntimeError, "runtime_error"),
        (
            {"success": False, "error": "bad query", "error_category": "invalid_input"},
            ValueError,
            "invalid_input",
        ),
        # See test_the_service_busy_marker_defeats_its_own_classifier.
        (
            {"success": False, "error": "[SERVICE_BUSY] too many jobs"},
            RuntimeError,
            "runtime_error",
        ),
        (
            {"success": False, "error": "[SERVICE_BUSY]"},
            RuntimeError,
            "service_busy",
        ),
    ]

    manager = InvocationManager()
    invocation = await manager.submit("Wikis", "ask", lambda _c: None)
    from elitea_deepwiki.invocations import InvocationContext

    context = InvocationContext(invocation, manager)

    for result, exception_type, category in cases:
        runner = LegacyToolRunner(tools={"ask": lambda **_k: result})
        with pytest.raises(exception_type) as caught:
            await runner.invoke(
                family=ToolkitFamily.MAIN,
                toolkit_name="Wikis",
                tool_name="ask",
                request_data={"parameters": {"question": "?"}},
                context=context,
            )
        assert classify(caught.value) == category

    await manager.stop()


async def test_an_unknown_tool_is_refused_before_the_engine_is_touched():
    runner = LegacyToolRunner(tools={})
    manager = InvocationManager()
    invocation = await manager.submit("Wikis", "nope", lambda _c: None)
    from elitea_deepwiki.invocations import InvocationContext

    with pytest.raises(FileNotFoundError):
        await runner.invoke(
            family=ToolkitFamily.MAIN,
            toolkit_name="Wikis",
            tool_name="nope",
            request_data={},
            context=InvocationContext(invocation, manager),
        )
    await manager.stop()


# ---------------------------------------------------------------------------
# wikis_query
# ---------------------------------------------------------------------------


def test_an_expanded_toolkit_reference_is_merged():
    transformed = transform_query_request(
        {
            "configuration": {
                "parameters": {
                    "wikis_toolkit": {"code_toolkit": {"github_configuration": {}}},
                    "llm_settings": {"model_name": "gpt-4o"},
                }
            },
            "parameters": {"question": "?"},
        }
    )
    merged = transformed["configuration"]["parameters"]
    assert "code_toolkit" in merged
    assert merged["llm_settings"] == {"model_name": "gpt-4o"}
    assert transformed["parameters"] == {"question": "?"}


def test_the_legacy_deepwiki_toolkit_key_is_still_accepted():
    transformed = transform_query_request(
        {"configuration": {"parameters": {"deepwiki_toolkit": {"code_toolkit": {}}}}}
    )
    assert "code_toolkit" in transformed["configuration"]["parameters"]


def test_a_bare_toolkit_id_is_refused_rather_than_resolved():
    """Resolving a toolkit id is the facade's job (ADR-0022 decision 6).

    The legacy service called the platform's configuration API itself. Doing
    that here would mean the service holding a platform credential, which is
    exactly what decision 6 removes — so an unresolved reference is an error,
    not something to guess at.
    """
    with pytest.raises(ValueError, match="must arrive expanded"):
        transform_query_request(
            {"configuration": {"parameters": {"wikis_toolkit": 42}}}
        )


def test_a_missing_toolkit_reference_is_refused():
    with pytest.raises(ValueError, match="wikis_toolkit parameter is required"):
        transform_query_request({"configuration": {"parameters": {}}})


async def test_the_service_busy_marker_defeats_its_own_classifier():
    """A legacy defect, preserved because the SPI is frozen — and named.

    The handler strips the ``[SERVICE_BUSY]`` prefix before building the
    exception, and the category classifier then looks for that same marker (or
    the literal phrase "service is busy") in the message. So a busy signal that
    carries its own explanation classifies as ``runtime_error``: the caller
    cannot tell "retry in a minute" from "this broke". Only a *bare* marker
    falls through to the default text, which happens to contain the phrase, and
    classifies as ``service_busy``.

    Verified against the legacy `_create_error_response` directly, not
    inferred: both branches were run through it and produce these categories.

    It is preserved because ADR-0022 decision 2 freezes the error contract and
    a provider worker may already branch on ``runtime_error`` here. Fixing it
    means changing a category a caller can see, which needs its own fixture
    and its own decision — it is not a tidy-up to fold into the engine copy.
    """
    from elitea_deepwiki.errors import classify
    from elitea_deepwiki.legacy_runner import _engine_error

    explained = _engine_error(
        {"success": False, "error": "[SERVICE_BUSY] too many jobs"}
    )
    assert str(explained) == "too many jobs"
    assert classify(explained) == "runtime_error"

    bare = _engine_error({"success": False, "error": "[SERVICE_BUSY]"})
    assert str(bare) == "DeepWiki service is busy. Please try again later."
    assert classify(bare) == "service_busy"
