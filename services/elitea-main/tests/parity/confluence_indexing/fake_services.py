from __future__ import annotations

import base64
import json
import threading
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from io import BytesIO
from typing import Any
from urllib.parse import parse_qs, urlparse

import requests
from PIL import Image


def deterministic_png() -> bytes:
    image = Image.new("RGB", (320, 200), color=(19, 91, 137))
    image.putpixel((0, 0), (231, 177, 52))
    output = BytesIO()
    image.save(output, format="PNG", optimize=False)
    return output.getvalue()


@dataclass(frozen=True, slots=True)
class RequestRecord:
    method: str
    path: str
    query: dict[str, tuple[str, ...]]
    body: bytes


@dataclass(slots=True)
class ConfluenceFixture:
    page_status: int = 200
    page_status_sequence: list[int] = field(default_factory=list)
    attachment_list_status: int = 200
    attachment_status: dict[str, int] = field(default_factory=dict)
    records: list[RequestRecord] = field(default_factory=list)

    image_bytes: bytes = field(default_factory=deterministic_png)
    text_bytes: bytes = b"release notes from the text attachment\n"

    @property
    def page(self) -> dict[str, Any]:
        return {
            "id": "page-1",
            "title": "Architecture",
            "_links": {"webui": "/spaces/ENG/pages/page-1"},
            "version": {"when": "2026-07-27T08:00:00.000Z"},
            "body": {
                "view": {
                    "value": (
                        "<h1>Architecture</h1>"
                        "<p>Parent content before the diagram and after it.</p>"
                    )
                }
            },
        }

    @property
    def attachments(self) -> list[dict[str, Any]]:
        return [
            {
                "id": "att-text",
                "title": "notes.txt",
                "_links": {"download": "/download/attachments/page-1/notes.txt"},
                "metadata": {"mediaType": "text/plain", "labels": {"results": []}},
                "extensions": {"fileSize": len(self.text_bytes)},
            },
            {
                "id": "att-image",
                "title": "diagram.png",
                "_links": {"download": "/download/attachments/page-1/diagram.png"},
                "metadata": {"mediaType": "image/png", "labels": {"results": []}},
                "extensions": {"fileSize": len(self.image_bytes)},
            },
        ]


@dataclass(slots=True)
class LiteLLMFixture:
    records: list[RequestRecord] = field(default_factory=list)
    vision_responses: list[str] = field(
        default_factory=lambda: [
            "PARENT_IMAGE_DESCRIPTION",
            "DEPENDENT_IMAGE_DESCRIPTION",
        ]
    )
    embedding_dimension: int = 8


class FixtureHTTPServer:
    def __init__(
        self,
        fixture: ConfluenceFixture | LiteLLMFixture,
        handler: type[BaseHTTPRequestHandler],
    ) -> None:
        self.fixture = fixture
        self._server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        self._server.fixture = fixture  # type: ignore[attr-defined]
        self._thread = threading.Thread(target=self._server.serve_forever, daemon=True)

    @property
    def base_url(self) -> str:
        host, port = self._server.server_address
        return f"http://{host}:{port}"

    def __enter__(self) -> FixtureHTTPServer:
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._server.shutdown()
        self._server.server_close()
        self._thread.join(timeout=5)


class _QuietHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, _: str, *__: object) -> None:
        return

    def _record(self, body: bytes = b"") -> RequestRecord:
        parsed = urlparse(self.path)
        query = {
            key: tuple(values)
            for key, values in sorted(parse_qs(parsed.query).items())
        }
        record = RequestRecord(self.command, parsed.path, query, body)
        self.server.fixture.records.append(record)  # type: ignore[attr-defined]
        return record

    def _json(self, status: int, value: Any) -> None:
        body = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _bytes(self, status: int, value: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(value)))
        self.end_headers()
        self.wfile.write(value)


class ConfluenceHandler(_QuietHandler):
    def do_GET(self) -> None:
        record = self._record()
        fixture: ConfluenceFixture = self.server.fixture  # type: ignore[attr-defined]
        if record.path == "/rest/api/content":
            status = (
                fixture.page_status_sequence.pop(0)
                if fixture.page_status_sequence
                else fixture.page_status
            )
            if status != 200:
                self._json(status, {"message": "page fixture failure"})
                return
            start = int(record.query.get("start", ("0",))[0])
            self._json(200, {"results": [fixture.page] if start == 0 else []})
            return
        if record.path == "/rest/api/content/page-1/child/attachment":
            if fixture.attachment_list_status != 200:
                self._json(
                    fixture.attachment_list_status,
                    {"message": "attachment list fixture failure"},
                )
                return
            self._json(200, {"results": fixture.attachments})
            return
        if record.path.startswith("/rest/api/content/") and record.path.endswith("/history"):
            attachment_id = record.path.split("/")[-2]
            self._json(
                200,
                {
                    "createdBy": {"displayName": "Fixture User"},
                    "createdDate": "2026-07-27T07:00:00.000Z",
                    "lastUpdated": {"when": "2026-07-27T08:00:00.000Z"},
                    "attachment_id": attachment_id,
                },
            )
            return
        if record.path.endswith("/notes.txt"):
            self._attachment(
                fixture,
                "notes.txt",
                fixture.text_bytes,
                "text/plain",
            )
            return
        if record.path.endswith("/diagram.png"):
            self._attachment(
                fixture,
                "diagram.png",
                fixture.image_bytes,
                "image/png",
            )
            return
        self._json(404, {"message": "unknown Confluence fixture path"})

    def _attachment(
        self,
        fixture: ConfluenceFixture,
        name: str,
        content: bytes,
        content_type: str,
    ) -> None:
        status = fixture.attachment_status.get(name, 200)
        if status != 200:
            self._json(status, {"message": f"{name} fixture failure"})
            return
        self._bytes(200, content, content_type)


class LiteLLMHandler(_QuietHandler):
    def do_POST(self) -> None:
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        record = self._record(body)
        fixture: LiteLLMFixture = self.server.fixture  # type: ignore[attr-defined]
        value = json.loads(body)
        if record.path == "/v1/chat/completions":
            index = sum(
                item.path == "/v1/chat/completions" for item in fixture.records
            ) - 1
            response = fixture.vision_responses[
                min(index, len(fixture.vision_responses) - 1)
            ]
            self._json(
                200,
                {
                    "id": f"vision-{index + 1}",
                    "choices": [
                        {
                            "index": 0,
                            "message": {"role": "assistant", "content": response},
                            "finish_reason": "stop",
                        }
                    ],
                },
            )
            return
        if record.path == "/v1/embeddings":
            inputs = value.get("input", [])
            if isinstance(inputs, str):
                inputs = [inputs]
            self._json(
                200,
                {
                    "object": "list",
                    "data": [
                        {
                            "object": "embedding",
                            "index": index,
                            "embedding": [
                                float(index + offset + 1)
                                for offset in range(fixture.embedding_dimension)
                            ],
                        }
                        for index, _ in enumerate(inputs)
                    ],
                    "model": value.get("model", "fixture-embedding"),
                },
            )
            return
        self._json(404, {"message": "unknown LiteLLM fixture path"})


class HTTPConfluenceClient:
    """Small atlassian-client surface backed by the fake HTTP service."""

    def __init__(self, base_url: str) -> None:
        self.url = base_url
        self.session = requests.Session()

    def get_all_pages_from_space(self, **params: Any) -> list[dict[str, Any]]:
        response = self.session.get(
            f"{self.url}/rest/api/content",
            params=params,
            timeout=5,
        )
        response.raise_for_status()
        return response.json()["results"]

    def get_attachments_from_content(self, page_id: str) -> dict[str, Any]:
        response = self.session.get(
            f"{self.url}/rest/api/content/{page_id}/child/attachment",
            timeout=5,
        )
        response.raise_for_status()
        return response.json()

    def history(self, attachment_id: str) -> dict[str, Any]:
        response = self.session.get(
            f"{self.url}/rest/api/content/{attachment_id}/history",
            timeout=5,
        )
        response.raise_for_status()
        return response.json()

    def request(
        self,
        *,
        method: str = "GET",
        path: str,
        absolute: bool = False,
        advanced_mode: bool = False,
        headers: dict[str, str] | None = None,
    ) -> requests.Response:
        del advanced_mode
        url = path if absolute and path.startswith("http") else f"{self.url}/{path.lstrip('/')}"
        return self.session.request(method, url, headers=headers, timeout=5)


class HTTPRecordingLLM:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def invoke(self, messages: Any) -> Any:
        from langchain_core.messages import AIMessage

        serialized = []
        for message in messages:
            role = "user" if message.__class__.__name__ == "HumanMessage" else "assistant"
            serialized.append({"role": role, "content": message.content})
        response = requests.post(
            f"{self.base_url}/v1/chat/completions",
            json={"model": "fixture-vision", "messages": serialized},
            timeout=5,
        )
        response.raise_for_status()
        return AIMessage(content=response.json()["choices"][0]["message"]["content"])


class HTTPRecordingEmbeddings:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url

    def embed_documents(self, texts: list[str]) -> list[list[float]]:
        response = requests.post(
            f"{self.base_url}/v1/embeddings",
            json={"model": "fixture-embedding", "input": texts},
            timeout=5,
        )
        response.raise_for_status()
        return [item["embedding"] for item in response.json()["data"]]

    def embed_query(self, text: str) -> list[float]:
        return self.embed_documents([text])[0]


def decoded_requests(records: list[RequestRecord], path: str) -> list[dict[str, Any]]:
    return [json.loads(record.body) for record in records if record.path == path]


def image_urls(request: dict[str, Any]) -> list[str]:
    urls: list[str] = []
    for message in request.get("messages", []):
        content = message.get("content", [])
        if not isinstance(content, list):
            continue
        for part in content:
            if part.get("type") == "image_url":
                urls.append(part.get("image_url", {}).get("url", ""))
    return urls


def decode_data_url(value: str) -> bytes:
    prefix, encoded = value.split(",", 1)
    assert prefix.startswith("data:image/")
    return base64.b64decode(encoded)
