"""Replay the phase-P0 SPI fixtures against the ported ASGI service.

Each test drives the real application over ASGI and compares the answer with
the body recorded off the legacy Pylon service. This is the gate ADR-0022
decision 2 calls for — the SPI is a frozen contract, and "frozen" only means
something if something fails when it moves.

Where a fixture value is genuinely volatile (an invocation id, a timestamp, an
uptime) the test asserts the shape and the invariant, never the recorded
literal; the fixture marks those fields itself.
"""

from __future__ import annotations

import asyncio
import json

import pytest
from httpx import AsyncClient

from elitea_deepwiki.app import create_app
from elitea_deepwiki.config import Settings
from elitea_deepwiki.invocations import InvocationContext
from elitea_deepwiki.toolkits import ToolkitFamily

from ..conftest import load_fixture, make_client

TOOLKIT = "Wikis"
TOOL = "generate_wiki"
INVOKE_URL = f"/tools/{TOOLKIT}/{TOOL}/invoke"


def invocation_url(invocation_id: str) -> str:
    return f"/tools/{TOOLKIT}/{TOOL}/invocations/{invocation_id}"


# ---------------------------------------------------------------------------
# GET /descriptor
# ---------------------------------------------------------------------------


async def test_descriptor_is_byte_identical_to_the_golden_fixture(
    client: AsyncClient,
):
    response = await client.get("/descriptor")
    assert response.status_code == 200

    golden = load_fixture("descriptor", "legacy-v0", "provider_descriptor.json")
    served = response.json()

    assert served == golden
    # Key order is part of the recorded document; a reordered descriptor is a
    # different document to a byte-comparing conversion pipeline.
    assert list(served) == list(golden)
    assert json.dumps(served) == json.dumps(golden)


async def test_descriptor_route_is_not_in_the_legacy_spi_openapi(client: AsyncClient):
    """A guard on the route table fixture, not on the service.

    /descriptor and /slots are DeepWiki extensions rather than SPI operations;
    P2's facade has to proxy them explicitly.
    """
    routes = load_fixture("spi", "routes.json")
    table = {route["path"]: route for route in routes["routes"]}
    assert table["/descriptor"]["in_legacy_spi_openapi"] is False
    assert table["/slots"]["in_legacy_spi_openapi"] is False


# ---------------------------------------------------------------------------
# GET /health
# ---------------------------------------------------------------------------


async def test_health_matches_the_recorded_shape(client: AsyncClient):
    fixture = load_fixture("spi", "health.get.json")
    recorded = fixture["success"]["body"]

    response = await client.get("/health")
    assert response.status_code == fixture["success"]["status_code"]
    body = response.json()

    assert set(body) == set(recorded)
    assert body["status"] == "UP"
    assert body["providerVersion"] == recorded["providerVersion"]
    assert isinstance(body["uptime"], int)
    # The recorded timestamp format, asserted as a format rather than a value.
    assert body["timestamp"].endswith("+00:00")
    assert len(body["timestamp"]) == len("2026-01-01T00:00:00+00:00")
    assert set(body["extra_info"]) >= {"hostname", "pod_ip"}


async def test_health_reports_whether_invocation_state_survives_a_restart(
    client: AsyncClient,
):
    """The in-memory store must not be able to claim durability by silence.

    spec-provider-service requires durable provider-side operation state. This
    build does not have it, so the health document says so; when the
    PostgreSQL store lands, this flips to True and this test is what notices.
    """
    body = (await client.get("/health")).json()
    assert body["extra_info"]["durable_invocations"] is False
    assert body["extra_info"]["engine"] == "unavailable"


# ---------------------------------------------------------------------------
# GET /slots
# ---------------------------------------------------------------------------


async def test_slots_subprocess_mode_matches_the_recorded_body(client: AsyncClient):
    fixture = load_fixture("spi", "slots.get.json")
    recorded = fixture["cases"]["subprocess_without_worker_pool_module"]["recorded"]

    response = await client.get("/slots")
    assert response.status_code == recorded["status_code"]
    body = response.json()

    assert body["mode"] == "subprocess"
    assert body["total"] == 3  # settings fixture pins max_parallel_workers
    assert body["active"] == 0
    assert body["available"] == 3
    assert body["can_start"] is True
    # The camelCase alias the vendored UI reads. Legacy always emitted both.
    assert body["canStart"] == body["can_start"]


async def test_slots_counts_an_in_flight_invocation():
    """`active` has to move, or the number is decoration."""
    started = asyncio.Event()
    release = asyncio.Event()

    class SlowEngine:
        name = "slow"

        async def invoke(self, *, context: InvocationContext, **_kwargs):
            started.set()
            await release.wait()
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

    app = create_app(settings=Settings(max_parallel_workers=1), engine=SlowEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            assert (await http.get("/slots")).json()["can_start"] is True

            await http.post(INVOKE_URL, json={})
            await asyncio.wait_for(started.wait(), timeout=5)

            busy = (await http.get("/slots")).json()
            assert busy["active"] == 1
            assert busy["available"] == 0
            assert busy["can_start"] is False
            assert busy["canStart"] is False

            release.set()


async def test_jobs_mode_refuses_rather_than_reporting_subprocess_capacity():
    """The one deliberate behavioural change, pinned.

    Legacy fell back to per-pod subprocess numbers with HTTP 200 whenever the
    Kubernetes API could not be reached, so an outage read as healthy
    capacity. This build answers `can_start: false` with an explanation.
    """
    app = create_app(settings=Settings(jobs_enabled=True, max_concurrent_jobs=5))
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            body = (await http.get("/slots")).json()

    assert body["mode"] == "jobs"
    assert body["can_start"] is False
    assert body["canStart"] is False
    assert body["available"] == 0
    assert body["total"] == 5
    assert body["error"]


# ---------------------------------------------------------------------------
# POST .../invoke
# ---------------------------------------------------------------------------


async def test_invoke_returns_started_with_an_invocation_id(client: AsyncClient):
    fixture = load_fixture("spi", "invoke.post.json")
    request_body = fixture["request"]["example"]

    response = await client.post(INVOKE_URL, json=request_body)
    assert response.status_code == fixture["accepted"]["status_code"]

    body = response.json()
    assert set(body) == set(fixture["accepted"]["body"])
    assert body["status"] == "Started"
    assert body["invocation_id"].startswith("invocation_")


async def test_invoke_rejects_a_malformed_body(client: AsyncClient):
    fixture = load_fixture("spi", "invoke.post.json")["malformed_json"]

    response = await client.post(
        INVOKE_URL, content=b"{not json", headers={"content-type": "application/json"}
    )
    assert response.status_code == fixture["status_code"]
    assert response.json() == fixture["body"]


async def test_invoke_is_async_even_for_a_tool_that_advertises_sync(
    client: AsyncClient,
):
    """Every descriptor tool sets sync_invocation_supported; none is honoured."""
    descriptor = load_fixture("descriptor", "legacy-v0", "provider_descriptor.json")
    for toolkit in descriptor["provided_toolkits"]:
        for tool in toolkit["provided_tools"]:
            assert tool["sync_invocation_supported"] is True

    response = await client.post(INVOKE_URL, json={})
    assert response.json()["status"] == "Started"


# ---------------------------------------------------------------------------
# GET .../invocations/{id}
# ---------------------------------------------------------------------------


async def test_poll_of_an_unknown_invocation_is_404(client: AsyncClient):
    fixture = load_fixture("spi", "invocations.get.json")["get"]["unknown_invocation"]

    response = await client.get(invocation_url("invocation_does_not_exist"))
    assert response.status_code == fixture["status_code"]
    assert response.json() == fixture["body"]


@pytest.mark.parametrize(
    "toolkit,tool",
    [
        ("NotAToolkit", TOOL),
        (TOOLKIT, "not_a_tool"),
    ],
    ids=["unknown-toolkit", "unknown-tool"],
)
async def test_unknown_toolkit_and_tool_are_indistinguishable_from_an_unknown_id(
    client: AsyncClient, toolkit: str, tool: str
):
    """Legacy 404s all three the same way; the fixture records that."""
    response = await client.get(
        f"/tools/{toolkit}/{tool}/invocations/invocation_whatever"
    )
    assert response.status_code == 404
    assert response.json()["errorCode"] == "404"


async def test_poll_projects_in_flight_status_and_then_the_terminal_result():
    fixture = load_fixture("spi", "invocations.get.json")
    assert fixture["status_projection"]["pending"] == "Started"
    assert fixture["status_projection"]["running"] == "InProgress"

    release = asyncio.Event()
    running = asyncio.Event()

    class SlowEngine:
        name = "slow"

        async def invoke(self, *, context: InvocationContext, **_kwargs):
            running.set()
            await release.wait()
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": json.dumps(
                    [
                        {
                            "object_type": "message",
                            "result_target": "response",
                            "result_encoding": "plain",
                            "data": "Wiki generation completed successfully",
                        }
                    ]
                ),
                "result_type": "String",
            }

    app = create_app(engine=SlowEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            invocation_id = (await http.post(INVOKE_URL, json={})).json()[
                "invocation_id"
            ]
            await asyncio.wait_for(running.wait(), timeout=5)

            in_flight = (await http.get(invocation_url(invocation_id))).json()
            assert in_flight == {
                "invocation_id": invocation_id,
                "status": "InProgress",
            }

            release.set()
            terminal = await _poll_until_terminal(http, invocation_id)

    recorded = fixture["get"]["completed"]["body"]
    assert set(terminal) == set(recorded)
    assert terminal["status"] == "Completed"
    assert terminal["result_type"] == "String"
    assert json.loads(terminal["result"]) == json.loads(recorded["result"])


async def test_terminal_result_is_returned_on_every_poll():
    """It is not consumed by reading — only pruning removes it."""

    class DoneEngine:
        name = "done"

        async def invoke(self, *, context: InvocationContext, **_kwargs):
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

    app = create_app(engine=DoneEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            invocation_id = (await http.post(INVOKE_URL, json={})).json()[
                "invocation_id"
            ]
            first = await _poll_until_terminal(http, invocation_id)
            second = (await http.get(invocation_url(invocation_id))).json()

    assert first == second


async def test_custom_events_accumulate_and_drain_on_read():
    fixture = load_fixture("spi", "invocations.get.json")["get"]
    envelope = load_fixture("spi", "custom_events.json")["envelope"]

    emitted = asyncio.Event()
    release = asyncio.Event()

    class ChattyEngine:
        name = "chatty"

        async def invoke(self, *, context: InvocationContext, **_kwargs):
            await context.thinking("Cloning repository")
            await context.thinking("Indexing 128 files")
            emitted.set()
            await release.wait()
            return {
                "invocation_id": context.invocation_id,
                "status": "Completed",
                "result": "[]",
                "result_type": "String",
            }

    app = create_app(engine=ChattyEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            invocation_id = (await http.post(INVOKE_URL, json={})).json()[
                "invocation_id"
            ]
            await asyncio.wait_for(emitted.wait(), timeout=5)

            first = (await http.get(invocation_url(invocation_id))).json()
            second = (await http.get(invocation_url(invocation_id))).json()
            release.set()

    assert first["custom_events"] == fixture["running_with_events"]["body"][
        "custom_events"
    ]
    # The envelope shape itself, exactly as recorded.
    for event in first["custom_events"]:
        assert list(event) == list(envelope["custom_events"][0])
        assert list(event["data"]) == list(envelope["custom_events"][0]["data"])

    # Drained: a second poll must not repeat them.
    assert "custom_events" not in second
    assert second == fixture["running_after_drain"]["body"] | {
        "invocation_id": invocation_id
    }


# ---------------------------------------------------------------------------
# DELETE .../invocations/{id}
# ---------------------------------------------------------------------------


async def test_cancel_returns_204_and_an_unknown_id_404s():
    fixture = load_fixture("spi", "invocations.delete.json")

    cancelled = asyncio.Event()

    class CancellableEngine:
        name = "cancellable"

        async def invoke(self, *, context: InvocationContext, **_kwargs):
            for _ in range(200):
                await context.checkpoint()
                await asyncio.sleep(0.01)
            cancelled.set()
            raise AssertionError("engine was never cancelled")

    app = create_app(engine=CancellableEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            invocation_id = (await http.post(INVOKE_URL, json={})).json()[
                "invocation_id"
            ]

            response = await http.delete(invocation_url(invocation_id))
            assert response.status_code == fixture["known_invocation"]["status_code"]
            assert response.content == b""

            terminal = await _poll_until_terminal(http, invocation_id)

            unknown = await http.delete(invocation_url("invocation_nope"))

    assert unknown.status_code == fixture["unknown_invocation"]["status_code"]
    assert unknown.json() == fixture["unknown_invocation"]["body"]

    # Cancellation is cooperative: the invocation ends, and it ends as an error.
    assert terminal["status"] == "Error"
    assert not cancelled.is_set()


# ---------------------------------------------------------------------------
# the error contract
# ---------------------------------------------------------------------------


async def test_a_failing_tool_is_http_200_with_status_error():
    class BrokenEngine:
        name = "broken"

        async def invoke(self, **_kwargs):
            raise RuntimeError("worker exited with code 1")

    app = create_app(engine=BrokenEngine())
    async with make_client(app) as http:
        async with app.router.lifespan_context(app):
            invocation_id = (await http.post(INVOKE_URL, json={})).json()[
                "invocation_id"
            ]
            response = await http.get(invocation_url(invocation_id))
            body = response.json()
            while body.get("status") in ("Started", "InProgress"):
                await asyncio.sleep(0.01)
                body = (await http.get(invocation_url(invocation_id))).json()

    # HTTP 200 — the errorCode envelope is for transport failures only.
    assert response.status_code == 200
    assert body["status"] == "Error"
    assert body["error_category"] == "runtime_error"
    assert body["error_type"] == "RuntimeError"
    assert body["result_type"] == "String"

    objects = json.loads(body["result"])
    assert objects[0]["object_type"] == "message"
    assert objects[0]["result_target"] == "response"
    # The traceback the legacy service shipped to callers is not in the body.
    assert "Traceback" not in objects[0]["data"]


async def test_error_categories_match_the_recorded_classifier():
    """Every recorded category, produced by the ported classifier."""
    from elitea_deepwiki.errors import classify

    recorded = load_fixture("spi", "errors.json")["recorded"]
    cases = {
        "resource_not_found": FileNotFoundError("Wiki not found for repository"),
        "service_busy": RuntimeError("[SERVICE_BUSY] DeepWiki service is busy"),
        "artifact_error": RuntimeError("Failed to download artifact"),
        "out_of_memory": MemoryError("out of memory while embedding"),
        "timeout_error": RuntimeError("Clone timeout after 300s"),
        "inference_failed": RuntimeError("LLM generation failed"),
        "runtime_error": RuntimeError("worker exited with code 1"),
        "invalid_input": ValueError("query must not be empty"),
        "unknown_error": KeyError("llm_settings"),
    }
    assert set(cases) == set(recorded)
    for category, exception in cases.items():
        assert classify(exception) == recorded[category]["error_category"]
        assert type(exception).__name__ == recorded[category]["error_type"]


async def test_an_unknown_toolkit_terminates_the_invocation_as_resource_not_found(
    client: AsyncClient,
):
    """Legacy accepted the request and rejected it as the terminal result."""
    accepted = await client.post("/tools/NotAToolkit/generate_wiki/invoke", json={})
    assert accepted.status_code == 200
    invocation_id = accepted.json()["invocation_id"]

    body = await _poll_until_terminal(
        client, invocation_id, toolkit="NotAToolkit", tool="generate_wiki"
    )
    assert body["status"] == "Error"
    assert body["error_category"] == "resource_not_found"
    assert body["error_type"] == "FileNotFoundError"


async def test_every_advertised_toolkit_name_is_accepted(client: AsyncClient):
    """A dropped alias silently breaks stored toolkit configurations."""
    aliases = load_fixture("spi", "toolkit_aliases.json")
    accepted: set[str] = set()
    for names in aliases["accepted_toolkit_names"].values():
        accepted.update(names)

    from elitea_deepwiki.toolkits import ALL_TOOLKIT_NAMES, resolve_family

    assert set(ALL_TOOLKIT_NAMES) == accepted
    for name in aliases["declared_toolkit_names"]:
        assert name in ALL_TOOLKIT_NAMES
        resolve_family(name)  # must not raise


async def test_tool_admission_per_family_matches_the_fixture():
    from elitea_deepwiki.toolkits import validate_tool

    aliases = load_fixture("spi", "toolkit_aliases.json")
    per_family = aliases["tools_per_family"]

    for tool in per_family["wiki_query"]:
        validate_tool(ToolkitFamily.WIKI_QUERY, tool)
    for tool in per_family["query"]:
        validate_tool(ToolkitFamily.QUERY, tool)
    for tool in per_family["main"]:
        validate_tool(ToolkitFamily.MAIN, tool)

    # The exception types differ by family, and the difference is the category.
    with pytest.raises(FileNotFoundError):
        validate_tool(ToolkitFamily.MAIN, "list_wikis")
    with pytest.raises(ValueError):
        validate_tool(ToolkitFamily.QUERY, "generate_wiki")
    with pytest.raises(ValueError):
        validate_tool(ToolkitFamily.WIKI_QUERY, "ask")


# ---------------------------------------------------------------------------


async def _poll_until_terminal(
    http: AsyncClient,
    invocation_id: str,
    *,
    toolkit: str = TOOLKIT,
    tool: str = TOOL,
    timeout: float = 5.0,
) -> dict:
    url = f"/tools/{toolkit}/{tool}/invocations/{invocation_id}"
    deadline = asyncio.get_running_loop().time() + timeout
    while asyncio.get_running_loop().time() < deadline:
        body = (await http.get(url)).json()
        if body.get("status") not in ("Started", "InProgress"):
            return body
        await asyncio.sleep(0.01)
    raise AssertionError(f"invocation {invocation_id} never reached a terminal state")
