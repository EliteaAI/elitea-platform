"""Loading a graph: the transport, the two settings shapes, and the space check.

``_get_or_create_wrapper`` is the one method every read tool goes through — 27
call sites in the copied tool layer — so what it does or fails to do is what
every query tool does. It is exercised here against a stub wrapper rather than
the real retrieval class, because the question is the ACCESS decision, not the
graph.
"""

from __future__ import annotations

import json
import sys
import types
from pathlib import Path

import pytest

from elitea_inventory import artifacts, embeddings
from elitea_inventory.v1_overrides import V1Overrides


class StubGraph:
    def __init__(self, metadata=None):
        self._metadata = dict(metadata or {})


class StubWrapper:
    """Stands in for InventoryRetrievalApiWrapper."""

    def __init__(self, graph_path="", base_directory=None, source_toolkits=None, metadata=None):
        self.graph_path = graph_path
        self._knowledge_graph = StubGraph(metadata)


class Host(V1Overrides):
    """The mixin over the minimum the overridden methods reach for."""

    def __init__(self, downloads=None):
        self.graph_instances = {}
        self.tls_ca_file = None
        self.source_types = ("github", "ado_repos")
        self.thoughts = []
        self.downloads = downloads if downloads is not None else {}
        self.download_calls = []

    def invocation_thinking(self, message):
        self.thoughts.append(message)

    def invocation_stop_checkpoint(self):
        return None


@pytest.fixture
def stub_engine(monkeypatch):
    """Make `from .engine.inventory import InventoryRetrievalApiWrapper` resolve."""
    module = types.ModuleType("elitea_inventory.engine.inventory")
    module.InventoryRetrievalApiWrapper = StubWrapper
    monkeypatch.setitem(sys.modules, "elitea_inventory.engine", types.ModuleType("elitea_inventory.engine"))
    monkeypatch.setitem(sys.modules, "elitea_inventory.engine.inventory", module)
    return module


@pytest.fixture
def fake_requests(monkeypatch):
    """A `requests` whose GET answers from a dict of {object name: (status, body)}."""
    store: dict[str, tuple[int, bytes]] = {}

    class Response:
        def __init__(self, status, content):
            self.status_code = status
            self.content = content
            self.text = content.decode("utf-8", "replace")

        def json(self):
            return json.loads(self.content)

    def get(url, **_):
        name = url.rsplit("/", 1)[-1]
        status, content = store.get(name, (404, b""))
        return Response(status, content)

    module = types.ModuleType("requests")
    module.get = get
    monkeypatch.setitem(sys.modules, "requests", module)
    return store


def llm_settings():
    return {
        "api_base": "https://elitea.example/llm/v1",
        "api_key": "bearer-for-this-invocation",
        "organization": "7",
    }


def test_the_graph_is_downloaded_as_the_caller_and_cached_locally(
    stub_engine, fake_requests, tmp_path
):
    """The legacy read used an ADMIN token from the plugin's own config.

    Here the bearer is the one the facade minted for THIS invocation, so a
    caller who cannot see the bucket gets a 403 rather than someone else's
    graph. The local file is a cache; the bucket is the home.
    """
    fake_requests["graph.json"] = (200, json.dumps({"nodes": []}).encode())
    graph_path = tmp_path / "graphs" / "7" / "42" / "graph.json"

    host = Host()
    host._get_or_create_wrapper(
        str(graph_path),
        {
            "configuration": {
                "project_id": 7,
                "application_id": 42,
                "parameters": {"bucket": "code-graphs", "llm_settings": llm_settings()},
            }
        },
    )
    assert graph_path.exists()
    assert json.loads(graph_path.read_text()) == {"nodes": []}


def test_the_chat_layers_settings_shape_is_read_too(stub_engine, fake_requests, tmp_path):
    """chat_operations calls this with `configuration.settings`, not `.parameters`.

    Reading only `parameters` would leave `investigate` — the one search tool
    that drives the chat agent — with no bucket and no transport, so it would
    answer "no graph configured" for a graph that is in the bucket.
    """
    fake_requests["graph.json"] = (200, b'{"nodes": []}')
    graph_path = tmp_path / "graph.json"

    host = Host()
    host._get_or_create_wrapper(
        str(graph_path),
        {
            "configuration": {
                "project_id": 7,
                "application_id": 42,
                "settings": {"bucket": "code-graphs", "llm_settings": llm_settings()},
            }
        },
    )
    assert graph_path.exists()


def test_a_bucket_without_the_graph_is_not_an_error(stub_engine, fake_requests, tmp_path):
    """"This toolkit has no graph yet" is the state every toolkit starts in.

    The legacy code decided this by sniffing the response BODY for the string
    `"error"` in its first 100 characters, so a graph whose own content
    contained that word was silently treated as missing.
    """
    graph_path = tmp_path / "graph.json"
    host = Host()
    wrapper = host._get_or_create_wrapper(
        str(graph_path),
        {"configuration": {"parameters": {"llm_settings": llm_settings()}}},
    )
    assert wrapper is not None
    assert not graph_path.exists()


def test_no_transport_downloads_nothing_and_still_answers(stub_engine, tmp_path):
    """A direct SPI call carries no llm_settings, and must not raise."""
    host = Host()
    wrapper = host._get_or_create_wrapper(str(tmp_path / "graph.json"), {"configuration": {}})
    assert wrapper is not None


def test_the_wrapper_is_cached_per_graph_path(stub_engine, tmp_path):
    host = Host()
    first = host._get_or_create_wrapper(str(tmp_path / "a.json"), None)
    second = host._get_or_create_wrapper(str(tmp_path / "a.json"), None)
    third = host._get_or_create_wrapper(str(tmp_path / "b.json"), None)
    assert first is second
    assert first is not third


def test_a_graph_in_another_embedding_space_is_refused_on_every_read(stub_engine, tmp_path):
    """The check is HERE, not in each of the 27 read tools.

    Putting it in `semantic_search` alone would leave every other tool
    answering over a graph this toolkit cannot correctly search, and the
    refusal would depend on which tool the user happened to call.
    """
    host = Host()
    path = str(tmp_path / "graph.json")
    host.graph_instances[path] = StubWrapper(
        metadata={embeddings.METADATA_MODEL_KEY: "text-embedding-3-small"}
    )
    with pytest.raises(embeddings.EmbeddingsModelMismatch):
        host._get_or_create_wrapper(
            path, {"configuration": {"parameters": {"embedding_model": "text-embedding-3-large"}}}
        )


def test_a_forbidden_bucket_raises_rather_than_reading_as_empty(
    stub_engine, fake_requests, tmp_path
):
    """403 and 404 are different answers.

    Treating a refused read as "no graph" would tell a user their graph is
    gone when what happened is that their credential does not reach it.
    """
    fake_requests["graph.json"] = (403, b"forbidden")
    host = Host()
    with pytest.raises(PermissionError):
        host._get_or_create_wrapper(
            str(tmp_path / "graph.json"),
            {"configuration": {"parameters": {"llm_settings": llm_settings()}}},
        )


def test_the_bucket_comes_from_the_toolkit_configuration(stub_engine, monkeypatch, tmp_path):
    seen = {}

    class Client:
        def download(self, bucket, name):
            seen[name] = bucket
            return None

        def list(self, bucket):
            return []

    monkeypatch.setattr(artifacts, "client_from", lambda *_a, **_k: Client())
    host = Host()
    host._get_or_create_wrapper(
        str(tmp_path / "graph.json"),
        {"configuration": {"parameters": {"bucket": "code-graphs", "llm_settings": llm_settings()}}},
    )
    assert seen["graph.json"] == "code-graphs"


def test_the_admin_client_is_gone_and_says_so():
    host = Host()
    with pytest.raises(RuntimeError) as raised:
        host._get_elitea_client(1)
    assert "no platform admin credential" in str(raised.value)
    with pytest.raises(RuntimeError):
        host._get_platform_connection_settings()


def test_the_kubernetes_job_path_refuses():
    host = Host()
    with pytest.raises(RuntimeError) as raised:
        host._run_ingestion_job({}, "/tmp/graph.json", {})
    assert "not as a Kubernetes Job" in str(raised.value)


# -- the ingestion's artifact hand-back -------------------------------------------


def test_the_graph_is_handed_back_only_on_success_and_the_status_always(tmp_path):
    """A failed run's graph must not overwrite the good one in the bucket.

    What is in the file after a failure is the previous run plus a partial
    write. `sources_status.json` DOES go up either way — it is the only record
    the UI has of why a source is red, and the legacy code uploaded it on both
    paths for that reason.
    """
    from elitea_inventory.v1_overrides import _artifact_objects

    (tmp_path / "graph.json").write_text('{"nodes": []}')
    (tmp_path / ".ingestion-checkpoint-repo.json").write_text("{}")
    (tmp_path / "sources_status.json").write_text('{"sources": []}')

    succeeded = _artifact_objects(str(tmp_path / "graph.json"), tmp_path, "repo", True)
    assert [o["name"] for o in succeeded] == [
        "graph.json",
        ".ingestion-checkpoint-repo.json",
        "sources_status.json",
    ]

    failed = _artifact_objects(str(tmp_path / "graph.json"), tmp_path, "repo", False)
    assert [o["name"] for o in failed] == ["sources_status.json"]


def test_the_saved_graph_carries_the_embedding_model_it_was_built_with(tmp_path):
    """Stamped into the FILE, because the file is what gets uploaded.

    The in-memory graph the pipeline stamped is discarded at the end of the
    ingestion; a graph uploaded without the stamp is one this service cannot
    later refuse to search in the wrong space.
    """
    from elitea_inventory.v1_overrides import _stamp_saved_graph

    path = tmp_path / "graph.json"
    path.write_text(json.dumps({"nodes": [], "_metadata": {"version": "2.1"}}))
    _stamp_saved_graph(str(path), "text-embedding-3-small", 1536)

    metadata = json.loads(path.read_text())["_metadata"]
    assert metadata[embeddings.METADATA_MODEL_KEY] == "text-embedding-3-small"
    assert metadata[embeddings.METADATA_DIMENSION_KEY] == 1536
    assert metadata["version"] == "2.1", "the stamp must not replace the graph's own metadata"


def test_no_model_leaves_the_graph_unstamped(tmp_path):
    """A toolkit with no embedding_model builds a graph with no vectors.

    Stamping one anyway would make a later run with a model configured refuse
    over a graph that has nothing to be in the wrong space.
    """
    from elitea_inventory.v1_overrides import _stamp_saved_graph

    path = tmp_path / "graph.json"
    path.write_text(json.dumps({"nodes": []}))
    _stamp_saved_graph(str(path), None, None)
    assert embeddings.METADATA_MODEL_KEY not in json.loads(path.read_text()).get("_metadata", {})
