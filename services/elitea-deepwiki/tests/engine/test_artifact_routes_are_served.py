"""The artifact client speaks routes elitea-main actually serves (issue #665).

WHY THIS EXISTS. The client used to call
``/api/v2/artifacts/artifacts/default/{project}/{bucket}`` and its siblings.
That family is pylon's. elitea-main serves three object families and that is
not one of them, so on the standalone stack and on the Go target platform every
artifact call was a 404. It worked only where pylon was still in the request
path.

The failure was silent in the worst way: uploads failed, no wiki content
reached the store the native UI reads, and the browser showed an empty list
that no screen could tell from "you have not generated a wiki yet".

248 tests passed while that was true. Every one of them mocked ``requests``, so
the URL was an input to the mock and never a claim about anything. This test
reads the OTHER SIDE — elitea-main's OpenAPI document — and asserts the client's
paths appear in it.

IT MUST NOT SKIP. A missing spec means this gate measured nothing, and the whole
point of it is that a negative result was believed once already.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

from elitea_deepwiki.engine.artifacts_platform_client import PlatformArtifactClient

SERVICE_ROOT = Path(__file__).resolve().parents[2]
SPEC = SERVICE_ROOT.parent / "elitea-main" / "api" / "openapi" / "v2.yaml"

SETTINGS = {
    "base_url": "https://elitea.example.com",
    "api_key": "k",
    "project_id": "7",
}
BUCKET = "wiki-artifacts"
# Multi-segment on purpose: it is the shape every wiki page has.
KEY = "wiki-1/wiki_pages/architecture/router.md"


@pytest.fixture(scope="module")
def served_paths() -> set[str]:
    assert SPEC.is_file(), (
        f"elitea-main's OpenAPI document was not found at {SPEC}. This gate "
        "compares the client's URLs against the routes that are served; "
        "without the document it would pass while measuring nothing, which is "
        "exactly how #665 survived."
    )
    document = yaml.safe_load(SPEC.read_text(encoding="utf-8"))
    paths = set(document["paths"])
    assert len(paths) > 100, "the spec parsed but carries almost no paths"
    return paths


def template_of(url: str) -> str:
    """The URL, reduced to the spec's own path-template form."""
    path = url.removeprefix(SETTINGS["base_url"]).removeprefix("/api/v2")
    path = path.replace(f"/{SETTINGS['project_id']}/", "/{projectID}/", 1)
    path = re.sub(r"/wiki-artifacts(?=/|$)", "/{bucket}", path, count=1)
    return path


@pytest.fixture()
def client() -> PlatformArtifactClient:
    return PlatformArtifactClient(SETTINGS)


def test_the_bucket_url_is_a_served_route(client, served_paths):
    template = template_of(client._artifact_url(BUCKET))
    assert template == "/artifacts/objects/{projectID}/{bucket}"
    assert template in served_paths


def test_the_object_url_is_a_served_route(client, served_paths):
    url = client._single_artifact_url(BUCKET, KEY)
    # The key's own separators survive: the route declares that the key "may
    # itself contain `/` characters", and percent-escaping them would ask for
    # one object whose name contains slashes.
    assert url.endswith(f"/{KEY}")
    template = template_of(url).replace(f"/{KEY}", "/{key}")
    assert template == "/artifacts/objects/{projectID}/{bucket}/{key}"
    assert template in served_paths


def test_delete_addresses_the_object_by_path(client):
    # The legacy route took the name as a `filename` QUERY parameter. The
    # object route ignores it, so a delete sent that way would remove nothing
    # and report success.
    assert client._delete_artifact_url(BUCKET, KEY) == client._single_artifact_url(BUCKET, KEY)


def test_no_legacy_artifact_path_survives_anywhere_in_the_client():
    source = (
        SERVICE_ROOT / "src" / "elitea_deepwiki" / "engine" / "artifacts_platform_client.py"
    ).read_text(encoding="utf-8")
    # Comments are stripped first: the module header explains the defect by
    # name, and a raw search would fail on the explanation rather than on a
    # call — a gate that forbids writing down why it exists.
    code = "\n".join(
        line for line in source.splitlines() if not line.lstrip().startswith("#")
    )
    header_end = code.index('"""', code.index('"""') + 3) + 3
    code = code[header_end:]
    for legacy in ("artifacts/artifacts", "artifacts/artifact/", "/default/"):
        assert legacy not in code, f"the legacy path fragment {legacy!r} is still in the client"
    # And the stripper is not vacuous — the explanation IS in the file.
    assert "artifacts/artifacts" in source


def test_the_upload_asks_to_overwrite(client, monkeypatch):
    # The object route answers 409 AlreadyExists by default. Every caller here
    # rewrites — a manifest on each generation, a page on each edit — so a
    # missing overwrite turns the second generation of any wiki into a failure.
    seen = {}

    class Response:
        status_code = 201

        @staticmethod
        def json():
            return {}

    def fake_post(url, **kwargs):
        seen["url"] = url
        seen["params"] = kwargs.get("params")
        seen["files"] = kwargs.get("files")
        return Response()

    import requests

    monkeypatch.setattr(requests, "post", fake_post)
    client.upload_artifact(BUCKET, KEY, b"content")

    assert seen["params"] == {"overwrite": "true"}
    # The KEY travels as the multipart filename, multi-segment and unescaped.
    assert seen["files"]["file"][0] == KEY


def test_the_listing_reads_the_object_schema_and_follows_the_cursor(client, monkeypatch):
    # A different response shape (`objects`/`key`/`size_bytes`/`modified_at`,
    # not `rows`/`name`/`size`) and a cursor. A reader that took only the first
    # page would show a wiki with most of its pages missing.
    pages = [
        {
            "objects": [{"key": "wiki-1/a.md", "size_bytes": 10, "modified_at": "2026-01-01T00:00:00Z"}],
            "common_prefixes": [],
            "next_cursor": "page-2",
        },
        {
            "objects": [{"key": "wiki-1/b.md", "size_bytes": 20, "modified_at": "2026-01-02T00:00:00Z"}],
            "common_prefixes": [],
        },
    ]
    calls = []

    class Response:
        status_code = 200

        def __init__(self, body):
            self._body = body

        def json(self):
            return self._body

    def fake_get(url, **kwargs):
        calls.append(kwargs.get("params"))
        return Response(pages[len(calls) - 1])

    import requests

    monkeypatch.setattr(requests, "get", fake_get)
    result = client.list_artifacts(BUCKET, prefix="wiki-1/")

    assert [item["name"] for item in result] == ["wiki-1/a.md", "wiki-1/b.md"]
    assert [item["size"] for item in result] == [10, 20]
    # The prefix is applied SERVER-side; filtering afterwards would page
    # through the whole bucket to find one wiki's files.
    assert calls[0] == {"prefix": "wiki-1/"}
    assert calls[1] == {"prefix": "wiki-1/", "cursor": "page-2"}


def test_the_listing_stops_when_the_server_stops_paging(client, monkeypatch):
    class Response:
        status_code = 200

        @staticmethod
        def json():
            return {"objects": [], "common_prefixes": []}

    import requests

    calls = []

    def fake_get(url, **kwargs):
        calls.append(1)
        return Response()

    monkeypatch.setattr(requests, "get", fake_get)
    assert client.list_artifacts(BUCKET) == []
    assert len(calls) == 1
