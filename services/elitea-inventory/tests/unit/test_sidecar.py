"""The sidecar protocol: what the Go host actually speaks to.

The host's engine client (``internal/engine/engine.go``) is tested against a
fake sidecar; this is the other half — the real sidecar against a fake runner.
Neither half alone can catch a disagreement about the wire, so the shapes
asserted here are the ones that file parses.
"""

from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from elitea_inventory.config import Settings
from elitea_inventory.sidecar import create_sidecar
from elitea_inventory.toolrunner import UnavailableToolRunner


class RecordingRunner:
    name = "recording"

    def __init__(self, result=None, error=None, steps=("one", "two")):
        self.result = result if result is not None else {"success": True, "result": "ok"}
        self.error = error
        self.steps = steps
        self.calls: list[tuple[str, dict]] = []
        self.published: list[dict] = []

    async def run_engine_tool(self, tool_name, arguments, context):
        self.calls.append((tool_name, arguments))
        for step in self.steps:
            await context.checkpoint()
            await context.thinking(step)
        if self.error is not None:
            raise self.error
        return self.result

    async def publish(self, result, context):
        self.published.append(result)


def client(runner) -> TestClient:
    return TestClient(create_sidecar(Settings(), runner=runner))


def lines(response) -> list[dict]:
    return [json.loads(line) for line in response.text.splitlines() if line.strip()]


def test_health_names_the_active_runner():
    response = client(RecordingRunner()).get("/engine/health")
    assert response.status_code == 200
    assert response.json()["status"] == "UP"
    assert response.json()["runner"] == "recording"


def test_health_says_unavailable_when_no_engine_is_wired():
    """A host with no engine must LOOK broken, not idle.

    The refusing runner is the default, so /engine/health on a container built
    without the engine extra reports it by name — the one place an operator can
    see the difference before an invocation fails.
    """
    response = client(UnavailableToolRunner()).get("/engine/health")
    assert response.json()["runner"] == "unavailable"


def test_invoke_streams_thinking_then_the_result():
    runner = RecordingRunner(result={"success": True, "result": "done", "artifacts": []})
    response = client(runner).post(
        "/engine/invoke",
        json={
            "invocation_id": "inv-1",
            "tool": "get_stats",
            "arguments": {"family": "inventory", "params": {}},
        },
    )
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/x-ndjson")
    stream = lines(response)
    assert [item.get("thinking") for item in stream[:2]] == ["one", "two"]
    assert stream[-1]["result"] == {"success": True, "result": "done", "artifacts": []}


def test_a_failing_tool_becomes_an_error_line_with_its_python_type():
    """``error_type`` is the Python class name, which the host maps to a Kind.

    The host's ``engine.KindOf`` switches on exactly these strings; a runner
    that reported a category and no type would classify as `unknown_error`.
    """
    runner = RecordingRunner(error=ValueError("source is required"))
    stream = lines(
        client(runner).post(
            "/engine/invoke",
            json={"invocation_id": "inv-2", "tool": "run_ingestion", "arguments": {}},
        )
    )
    error = stream[-1]["error"]
    assert error["error_type"] == "ValueError"
    assert error["error_category"] == "invalid_input"
    assert error["message"] == "source is required"


def test_a_missing_graph_classifies_as_resource_not_found():
    runner = RecordingRunner(error=FileNotFoundError("graph.json not found"))
    stream = lines(
        client(runner).post(
            "/engine/invoke",
            json={"invocation_id": "inv-3", "tool": "get_stats", "arguments": {}},
        )
    )
    assert stream[-1]["error"]["error_category"] == "resource_not_found"


@pytest.mark.parametrize(
    "body,detail",
    [
        ({"tool": "get_stats", "arguments": {}}, "invocation_id is required"),
        (
            {"invocation_id": "x", "tool": "generate_wiki", "arguments": {}},
            "Unknown tool: generate_wiki",
        ),
        (
            {"invocation_id": "x", "tool": "get_stats", "arguments": []},
            "arguments must be an object",
        ),
    ],
)
def test_a_malformed_invoke_is_refused_before_the_stream_opens(body, detail):
    """400, not an error LINE.

    The distinction is load-bearing: the host reports a non-200 as "the engine
    refused the invocation", which is a wiring fault an operator must see, and
    an error line as the tool failing, which is a user-visible result.
    """
    response = client(RecordingRunner()).post("/engine/invoke", json=body)
    assert response.status_code == 400
    assert response.json()["detail"] == detail


def test_a_tool_from_another_application_is_not_served():
    """DeepWiki's tools are refused here by name, not attempted.

    Both sub-applications' engines answer the same socket protocol. A host
    misconfigured with the wrong sidecar must fail at the door.
    """
    response = client(RecordingRunner()).post(
        "/engine/invoke",
        json={"invocation_id": "x", "tool": "ask", "arguments": {}},
    )
    assert response.status_code == 400


async def test_the_same_invocation_id_cannot_run_twice_concurrently():
    """A retried invoke must not start a SECOND run under one invocation id.

    The host retries nothing on its own, but a dropped connection and a client
    that reconnects would otherwise ingest the same repository twice into the
    same graph, concurrently.

    Driven over ASGI rather than through TestClient: TestClient runs the app in
    one portal thread, so a second request issued while a stream is open
    deadlocks instead of being refused — the test would hang rather than fail.
    """
    import asyncio

    import httpx

    release = asyncio.Event()
    started = asyncio.Event()

    class BlockingRunner(RecordingRunner):
        async def run_engine_tool(self, tool_name, arguments, context):
            await context.thinking("holding")
            started.set()
            await release.wait()
            return {"success": True, "result": "released"}

    app = create_sidecar(Settings(), runner=BlockingRunner())
    transport = httpx.ASGITransport(app=app)
    body = {"invocation_id": "dup", "tool": "get_stats", "arguments": {}}
    async with httpx.AsyncClient(transport=transport, base_url="http://engine") as http:
        first = asyncio.create_task(http.post("/engine/invoke", json=body))
        await asyncio.wait_for(started.wait(), timeout=5)
        second = await http.post("/engine/invoke", json=body)
        assert second.status_code == 409
        release.set()
        assert (await first).status_code == 200


def test_stop_is_accepted_for_a_running_invocation_and_declined_otherwise():
    app_client = client(RecordingRunner())
    assert app_client.post("/engine/invocations/nobody/stop").json() == {"stopped": False}


def test_a_stop_raises_at_the_next_checkpoint():
    """The stop lands mid-run, which is the whole point of checkpointing.

    An ingestion reads a whole repository; a stop that only took effect after
    the tool returned would be indistinguishable from no stop at all.
    """

    class StoppingRunner(RecordingRunner):
        async def run_engine_tool(self, tool_name, arguments, context):
            await context.thinking("started")
            context.stop_requested = True
            await context.checkpoint()  # raises InvocationCancelled
            return {"success": True, "result": "should not be reached"}

    stream = lines(
        client(StoppingRunner()).post(
            "/engine/invoke",
            json={"invocation_id": "stop-me", "tool": "get_stats", "arguments": {}},
        )
    )
    assert stream[-1]["error"]["message"] == "Invocation cancelled"
    assert not any("result" in item for item in stream)


def test_publish_runs_only_for_a_successful_result():
    runner = RecordingRunner(result={"success": False, "error": "nope"})
    client(runner).post(
        "/engine/invoke",
        json={"invocation_id": "p", "tool": "get_stats", "arguments": {}},
    )
    assert runner.published == []


def test_the_arguments_reach_the_runner_unchanged():
    """The sidecar is a transport: it does not merge, default or rewrite.

    The parameter merge is the HOST's (``MergeParameters``), pinned by the
    conformance fixtures. A second merge here would be a second answer to the
    same question.
    """
    runner = RecordingRunner()
    arguments = {
        "family": "inventory_search",
        "params": {"query": "auth", "top_k": 5},
        "project_id": 7,
        "application_id": 42,
    }
    client(runner).post(
        "/engine/invoke",
        json={
            "invocation_id": "a",
            "tool": "search_knowledge_graph",
            "arguments": arguments,
        },
    )
    assert runner.calls == [("search_knowledge_graph", arguments)]
