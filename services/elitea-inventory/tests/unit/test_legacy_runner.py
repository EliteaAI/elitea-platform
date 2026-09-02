"""Dispatch, the graph path, and the artifact hand-back.

These run WITHOUT the engine closure: the runner takes an injected tool table,
which is how the dispatch decisions are testable at all — the alternative is a
test that needs an LLM, a repository and 700 MB of dependencies to prove that
five tool names are refused.
"""

from __future__ import annotations

import pytest

from elitea_inventory.config import Settings
from elitea_inventory.legacy_runner import LegacyToolRunner, _result_dict
from elitea_inventory.v1_overrides import DEFERRED_TOOLS, DeferredTool


class Context:
    invocation_id = "inv-1"

    def __init__(self):
        self.thoughts: list[str] = []

    async def thinking(self, message):
        self.thoughts.append(message)

    async def checkpoint(self):
        return None


def runner(**tools):
    return LegacyToolRunner(settings=Settings(scratch_path="/scratch"), tools=tools)


async def run(subject, tool, **arguments):
    return await subject.run_engine_tool(tool, arguments, Context())


# -- dispatch ------------------------------------------------------------------


@pytest.mark.parametrize("tool", sorted(DEFERRED_TOOLS))
async def test_a_deferred_tool_refuses_even_though_its_handler_exists(tool):
    """The advertised tools with nothing behind them.

    The refusal is a ``FileNotFoundError`` subclass, so the contract classifies
    it ``resource_not_found``: the tool is advertised and there is nothing
    behind it. It is refused HERE as well as at the Go host, because the
    handler is in the copy and is one line of dispatch away from being served
    with no test behind it.
    """
    subject = runner(**{tool: lambda *a, **k: "should not run"})
    with pytest.raises(DeferredTool) as raised:
        await run(subject, tool, family="inventory", params={})
    # The reason is the tool's own, not one shared text: four were never routed
    # and one is a stub that answered success, and a caller deserves to know
    # which.
    assert DEFERRED_TOOLS[tool] in str(raised.value)
    assert "has ever run on this platform" in str(raised.value)


async def test_a_tool_the_family_does_not_route_is_invalid_input():
    """The legacy refusal text, verbatim in shape: ``Unknown tool: x``."""
    with pytest.raises(ValueError) as raised:
        await run(runner(), "query_graph", family="inventory", params={})
    assert "Unknown tool: query_graph" in str(raised.value)


async def test_query_graph_is_served_on_the_search_family():
    subject = runner(query_graph=lambda params, path, request: "rows")
    result = await run(subject, "query_graph", family="inventory_search", params={})
    assert result["result"] == "rows"


async def test_an_unknown_family_is_refused_with_the_legacy_text():
    with pytest.raises(ValueError) as raised:
        await run(runner(), "get_stats", family="wikis", params={})
    assert "Expected: inventory or inventory_search" in str(raised.value)


# -- the graph path -------------------------------------------------------------


def test_the_graph_path_is_under_the_service_scratch_not_the_legacy_volume():
    """Legacy: ``/data/graphs/<project>/<app>/graph.json`` on a persistent volume.

    That volume WAS the graph's home, so losing it lost the graph. Here the
    bucket is the home and this is a cache — losing it costs one download.
    """
    subject = runner()
    assert subject.graph_path(7, 42) == "/scratch/graphs/7/42/graph.json"


def test_a_call_with_no_project_or_toolkit_has_no_graph_path():
    """The legacy handler built ``/data/graphs/None/None/graph.json`` instead.

    A path with the literal string None in it is a directory that gets created,
    written to, and shared by every request that also lost its ids.
    """
    subject = runner()
    assert subject.graph_path(None, 42) is None
    assert subject.graph_path(7, None) is None


async def test_the_handler_receives_the_derived_path_and_the_request_shape():
    seen = {}

    def handler(params, graph_path, request_data):
        seen["params"] = params
        seen["path"] = graph_path
        seen["request"] = request_data
        return "ok"

    subject = runner(get_stats=handler)
    await run(subject, "get_stats", family="inventory", params={"a": 1}, project_id=7, application_id=42)
    assert seen["path"] == "/scratch/graphs/7/42/graph.json"
    assert seen["params"] == {"a": 1}
    # The copied handlers read the ids and the settings off `configuration`,
    # and `_tool_investigate`'s callers read `project_id` off the root. Both
    # shapes are present because both are read.
    assert seen["request"]["configuration"]["project_id"] == 7
    assert seen["request"]["configuration"]["application_id"] == 42
    assert seen["request"]["project_id"] == 7


async def test_investigate_is_called_with_the_ids_not_a_path():
    """It drives the chat agent, which resolves its own graph.

    Called with the common signature it would receive the graph PATH where it
    expects a project id, and build a graph path out of it.
    """
    seen = {}

    def handler(params, project_id, toolkit_id, request_data):
        seen.update(project_id=project_id, toolkit_id=toolkit_id)
        return "answered"

    subject = runner(investigate=handler)
    result = await run(
        subject, "investigate", family="inventory_search", params={}, project_id=7, application_id=42
    )
    assert seen == {"project_id": 7, "toolkit_id": 42}
    assert result["result"] == "answered"


# -- the result dict the host composes from -------------------------------------


def test_a_plain_string_result_becomes_a_successful_result_dict():
    assert _result_dict("hello") == {"success": True, "result": "hello", "artifacts": []}


def test_the_tuple_return_carries_artifacts_for_the_host_to_upload():
    """``(text, artifacts)`` is the legacy shape ``_handle_inventory_tool`` checked.

    The engine no longer uploads: it hands the objects back and the Go host
    puts them in the bucket through the transport the facade supplied. One
    uploader, one Content-Type rule, one place a failed upload is reported.
    """
    objects = [{"name": "graph.json", "type": "application/json", "data": "{}"}]
    assert _result_dict(("done", objects)) == {
        "success": True,
        "result": "done",
        "artifacts": objects,
    }


def test_a_handler_that_answers_nothing_still_produces_a_readable_result():
    """The legacy composer would have put `None` into the message body."""
    assert _result_dict(None)["result"] == ""


async def test_artifacts_reach_the_result_unchanged():
    objects = [{"name": "sources_status.json", "type": "application/json", "data": "{}"}]
    subject = runner(run_ingestion=lambda *a: ("ingested", objects))
    result = await run(subject, "run_ingestion", family="inventory", params={}, project_id=1, application_id=2)
    assert result["artifacts"] == objects


async def test_progress_is_emitted_before_the_tool_runs():
    """The host turns each line into a thinking event on the invocation.

    A tool that takes an hour with no progress is indistinguishable from a
    hung one.
    """
    context = Context()
    subject = runner(get_stats=lambda *a: "ok")
    await subject.run_engine_tool(
        "get_stats", {"family": "inventory", "params": {}}, context
    )
    assert context.thoughts == ["Running get_stats"]


async def test_publish_is_a_no_op_because_the_bucket_is_the_index():
    """DeepWiki publishes to PostgreSQL so query replicas are stateless.

    Inventory's equivalent is the graph object in the bucket, which every
    replica downloads on demand — so there is nothing to publish, and the
    sidecar protocol keeps the hook rather than growing a per-application
    branch.
    """
    assert await runner().publish({"success": True}, Context()) is None
