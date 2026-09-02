"""The fixture runner, and the artifact upload it shares with the real one.

The upload tests drive :class:`LegacyToolRunner` with a stubbed tool and a
fake artifact client — the same shape as the composition tests — so what
they pin is the wiring: which objects go where, under which key, and what a
caller is told when that fails.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from elitea_deepwiki.config import Settings
from elitea_deepwiki.fixture_runner import FIXTURE_TOOLS, FixtureToolRunner, wiki_id_for
from elitea_deepwiki.invocations import InvocationContext, InvocationManager
from elitea_deepwiki.legacy_runner import LegacyToolRunner
from elitea_deepwiki.toolkits import ToolkitFamily
from elitea_deepwiki.toolrunner import build_runner

TRANSPORT = {"api_base": "http://elitea-main:8080/llm/v1", "api_key": "minted", "organization": "90200"}


class FakeArtifactClient:
    def __init__(self, fail: set[str] | None = None) -> None:
        self.uploads: list[tuple[str, str, str]] = []
        self.fail = fail or set()

    def upload_artifact(self, bucket: str, name: str, data: Any) -> dict[str, Any]:
        if name in self.fail:
            raise RuntimeError("bucket is read-only")
        self.uploads.append((bucket, name, data if isinstance(data, str) else data.decode()))
        return {"key": name}


def request(query: str = "GO", llm_settings: dict[str, Any] | None = None) -> dict[str, Any]:
    parameters: dict[str, Any] = {
        "code_toolkit": {
            "github_configuration": {
                "url": "https://github.com",
                "repository": "acme/e2e-service",
                "active_branch": "main",
            }
        },
    }
    if llm_settings is not None:
        parameters["llm_settings"] = llm_settings
    return {"configuration": {"parameters": parameters}, "parameters": {"query": query}}


async def run(runner: LegacyToolRunner, tool: str, request_data: dict[str, Any]) -> tuple[dict, list]:
    manager = InvocationManager()
    invocation = await manager.submit("Wikis", tool, lambda _c: None)
    try:
        body = await runner.invoke(
            family=ToolkitFamily.MAIN,
            toolkit_name="Wikis",
            tool_name=tool,
            request_data=request_data,
            context=InvocationContext(invocation, manager),
        )
    finally:
        await manager.stop()
    return body, list(invocation.custom_events)


def objects_of(body: dict[str, Any]) -> list[dict[str, Any]]:
    assert body["status"] == "Completed"
    return json.loads(body["result"])


def settings(**overrides: Any) -> Settings:
    return Settings(git_allowlist="github.com,*.github.com", fixture_step_seconds=0.0, **overrides)


def test_the_setting_selects_it():
    runner = build_runner(settings(runner="fixture"))
    assert isinstance(runner, FixtureToolRunner)
    assert runner.name == "fixture"


def test_the_wiki_id_is_the_engine_canonical_form():
    assert wiki_id_for({"repository": "acme/e2e-service"}, "main") == "acme--e2e-service--main"
    assert wiki_id_for({"provider_config": {"repository": "octocat/hello"}}, None) == "octocat--hello--main"
    assert wiki_id_for(None, "") == "fixture--repository--main"


@pytest.mark.asyncio
async def test_generation_lands_every_object_under_the_wiki_id():
    client = FakeArtifactClient()
    runner = FixtureToolRunner(settings(), artifact_client_factory=lambda _s: client)

    body, events = await run(runner, "generate_wiki", request(llm_settings=TRANSPORT))

    objects = objects_of(body)
    assert objects[0] == {
        "object_type": "message",
        "result_target": "response",
        "result_encoding": "plain",
        "data": "Wiki generated: 3 pages",
    }
    uploaded = {name for _b, name, _d in client.uploads}
    expected = {obj["name"] for obj in objects if obj["result_target"] == "artifact"}
    assert uploaded == expected
    assert all(name.startswith("acme--e2e-service--main/") for name in uploaded)
    assert {b for b, _n, _d in client.uploads} == {"wiki-artifacts"}
    # The three families the browser reads, plus the context the engine keeps.
    kinds = {obj["object_type"] for obj in objects[1:]}
    assert kinds == {"wiki_structure", "wiki_page", "wiki_manifest", "repository_context"}
    # The manifest names every page it uploaded, so the browser's index is complete.
    manifest = next(obj for obj in objects if obj["object_type"] == "wiki_manifest")
    assert json.loads(manifest["data"])["pages"] == [
        "wiki_pages/overview/getting-started.md",
        "wiki_pages/architecture/request-flow.md",
        "wiki_pages/components/storage.md",
    ]
    text = json.dumps(events)
    assert "Cloning the repository" in text and "Uploaded 6 wiki objects" in text


@pytest.mark.asyncio
async def test_one_page_carries_a_broken_mermaid_block_for_the_quick_fix():
    client = FakeArtifactClient()
    runner = FixtureToolRunner(settings(), artifact_client_factory=lambda _s: client)
    await run(runner, "generate_wiki", request(llm_settings=TRANSPORT))
    page = next(d for _b, n, d in client.uploads if n.endswith("request-flow.md"))
    assert "```mermaid\ngraph TD\n  A[Client] -->\n```" in page


@pytest.mark.asyncio
async def test_a_failed_upload_is_reported_in_band_and_the_run_still_completes():
    client = FakeArtifactClient(fail={"acme--e2e-service--main/wiki_pages/components/storage.md"})
    runner = FixtureToolRunner(settings(), artifact_client_factory=lambda _s: client)

    body, events = await run(runner, "generate_wiki", request(llm_settings=TRANSPORT))

    objects = objects_of(body)
    warning = objects[-1]
    assert warning["object_type"] == "message"
    assert warning["data"].startswith("⚠️ The wiki was generated but 1 of 6 objects could not be uploaded")
    assert "components/storage.md: bucket is read-only" in warning["data"]
    # The five that did land, landed.
    assert len(client.uploads) == 5
    assert "Uploading FAILED for 1 object(s)" in json.dumps(events)


@pytest.mark.asyncio
async def test_without_a_transport_nothing_is_uploaded_and_the_result_is_unchanged(caplog):
    calls: list[dict[str, Any]] = []

    def factory(llm_settings: dict[str, Any]):
        calls.append(llm_settings)
        return None

    runner = FixtureToolRunner(settings(), artifact_client_factory=factory)
    with caplog.at_level("WARNING"):
        body, _events = await run(runner, "generate_wiki", request())
    objects = objects_of(body)
    assert calls == [{}]
    assert not any("could not be uploaded" in obj.get("data", "") for obj in objects)
    assert "returned inline only" in caplog.text


@pytest.mark.asyncio
async def test_the_default_factory_needs_both_halves_of_the_transport():
    from elitea_deepwiki.legacy_runner import _artifact_client_from

    assert _artifact_client_from({}) is None
    assert _artifact_client_from({"api_base": "http://x/llm/v1"}) is None
    assert _artifact_client_from({"api_key": "k"}) is None
    client = _artifact_client_from(TRANSPORT)
    assert client is not None
    # The callback base is the artifact base: `/llm/v1` stripped, the project from `organization`.
    assert client.base_url == "http://elitea-main:8080"
    assert client.project_id == "90200"
    assert client.api_key == "minted"


@pytest.mark.asyncio
async def test_the_real_runner_uploads_too_not_only_the_fixture():
    """The gap is closed in LegacyToolRunner; the fixture only inherits it."""
    client = FakeArtifactClient()
    runner = LegacyToolRunner(
        settings=settings(),
        tools={"generate_wiki": FIXTURE_TOOLS["generate_wiki"]},
        artifact_client_factory=lambda _s: client,
    )
    body, _events = await run(runner, "generate_wiki", request(llm_settings=TRANSPORT))
    assert len(client.uploads) == 6
    assert objects_of(body)[0]["data"] == "Wiki generated: 3 pages"


@pytest.mark.asyncio
async def test_ask_answers_with_sources_and_uploads_nothing():
    client = FakeArtifactClient()
    runner = FixtureToolRunner(settings(), artifact_client_factory=lambda _s: client)
    body, _events = await run(
        runner,
        "ask",
        {**request(llm_settings=TRANSPORT), "parameters": {"question": "Where do pages live?"}},
    )
    objects = objects_of(body)
    assert objects[0]["data"] == "Fixture answer to: Where do pages live?"
    assert objects[1]["data"].startswith("\n\nSources:\n- wiki_pages/overview/getting-started.md")
    assert client.uploads == []


@pytest.mark.asyncio
async def test_a_cancelled_run_stops_before_the_tool_answers():
    client = FakeArtifactClient()
    runner = FixtureToolRunner(settings(), artifact_client_factory=lambda _s: client)
    manager = InvocationManager()
    invocation = await manager.submit("Wikis", "generate_wiki", lambda _c: None)
    context = InvocationContext(invocation, manager)
    try:
        await manager.cancel("Wikis", "generate_wiki", invocation.invocation_id)
        with pytest.raises(BaseException):
            await runner.invoke(
                family=ToolkitFamily.MAIN,
                toolkit_name="Wikis",
                tool_name="generate_wiki",
                request_data=request(llm_settings=TRANSPORT),
                context=context,
            )
    finally:
        await manager.stop()
    assert client.uploads == []
