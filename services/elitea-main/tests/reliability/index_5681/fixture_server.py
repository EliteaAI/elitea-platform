#!/usr/bin/env python3
"""Deterministic Confluence and LiteLLM fixture for issue #5681.

The fixture deliberately keeps the 62 MiB source payload on HTTP.  It never
publishes source or model bytes to Redis and it exposes only aggregate,
non-secret counters through the receipt endpoint.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import random
import struct
import threading
import zlib
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import BinaryIO
from urllib.parse import parse_qs, urlparse


MIB = 1 << 20
THREE_MIB = 3 * MIB
THIRTY_TWO_MIB = 32 * MIB
ATTACHMENT_COUNT = 11
SOURCE_PAYLOAD_BYTES = 10 * THREE_MIB + THIRTY_TWO_MIB
RECEIPT_SCHEMA = "elitea.issue-5681.fixture-receipt.v1"
PROFILE_SCHEMA = "elitea.issue-5681.confluence-images.v1"
RECEIPT_PATH = "/__elitea_issue_5681/receipt"
HEALTH_PATH = "/__elitea_issue_5681/health"
MAX_MODEL_REQUEST_BYTES = 64 * MIB


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return (
        struct.pack(">I", len(data))
        + kind
        + data
        + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    )


def _write_idat(output: BinaryIO, compressor: zlib.compressobj, value: bytes) -> None:
    compressed = compressor.compress(value)
    if compressed:
        output.write(_png_chunk(b"IDAT", compressed))


def generate_deterministic_png(
    path: Path,
    *,
    target_bytes: int,
    width: int,
    height: int,
    seed: int,
) -> str:
    """Write one valid, incompressible PNG padded to an exact source size."""

    if target_bytes <= 0 or width <= 0 or height <= 0:
        raise ValueError("PNG dimensions and target size must be positive")
    path.parent.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    with path.open("wb") as output:
        output.write(b"\x89PNG\r\n\x1a\n")
        output.write(
            _png_chunk(
                b"IHDR",
                struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0),
            )
        )
        compressor = zlib.compressobj(level=0)
        row_bytes = width * 3
        for _ in range(height):
            _write_idat(output, compressor, b"\x00" + rng.randbytes(row_bytes))
        tail = compressor.flush()
        if tail:
            output.write(_png_chunk(b"IDAT", tail))
        output.write(_png_chunk(b"IEND", b""))
        current = output.tell()
        if current > target_bytes:
            raise ValueError(
                f"generated PNG is {current} bytes, above target {target_bytes}"
            )
        # PNG decoders ignore trailing bytes. Padding keeps source transfer
        # size exact while the decoded random pixels still produce a >32 MiB
        # base64 model request for the large image.
        remaining = target_bytes - current
        padding = hashlib.sha256(f"elitea-5681:{seed}".encode()).digest()
        while remaining:
            chunk = padding[: min(remaining, len(padding))]
            output.write(chunk)
            remaining -= len(chunk)

    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(64 * 1024), b""):
            digest.update(chunk)
    if path.stat().st_size != target_bytes:
        raise RuntimeError("fixture PNG size drifted")
    return digest.hexdigest()


@dataclass(slots=True)
class Receipt:
    project_id: int
    small_sha256: str
    large_sha256: str
    source_completed_requests: dict[str, int] = field(default_factory=dict)
    source_completed_bytes: int = 0
    chat_requests: int = 0
    max_chat_request_bytes: int = 0
    embedding_requests: int = 0
    max_embedding_request_bytes: int = 0
    rejected_model_requests: int = 0
    lock: threading.Lock = field(default_factory=threading.Lock)

    def snapshot(self) -> dict[str, object]:
        with self.lock:
            return {
                "schema": RECEIPT_SCHEMA,
                "profile": PROFILE_SCHEMA,
                "declared_source_payload_bytes": SOURCE_PAYLOAD_BYTES,
                "small_image_sha256": self.small_sha256,
                "large_image_sha256": self.large_sha256,
                "source_completed_requests": dict(
                    sorted(self.source_completed_requests.items())
                ),
                "source_completed_bytes": self.source_completed_bytes,
                "chat_requests": self.chat_requests,
                "max_chat_request_bytes": self.max_chat_request_bytes,
                "embedding_requests": self.embedding_requests,
                "max_embedding_request_bytes": self.max_embedding_request_bytes,
                "rejected_model_requests": self.rejected_model_requests,
            }

    def record_source(self, name: str, byte_length: int) -> None:
        with self.lock:
            self.source_completed_requests[name] = (
                self.source_completed_requests.get(name, 0) + 1
            )
            self.source_completed_bytes += byte_length

    def record_model(self, *, chat: bool, byte_length: int) -> None:
        with self.lock:
            if chat:
                self.chat_requests += 1
                self.max_chat_request_bytes = max(
                    self.max_chat_request_bytes, byte_length
                )
            else:
                self.embedding_requests += 1
                self.max_embedding_request_bytes = max(
                    self.max_embedding_request_bytes, byte_length
                )

    def reject_model(self) -> None:
        with self.lock:
            self.rejected_model_requests += 1


@dataclass(frozen=True, slots=True)
class Fixture:
    root: Path
    small_path: Path
    large_path: Path
    receipt: Receipt

    @property
    def attachments(self) -> list[dict[str, object]]:
        result: list[dict[str, object]] = []
        for ordinal in range(10):
            name = f"diagram-{ordinal:02d}.png"
            result.append(
                {
                    "id": f"att-small-{ordinal:02d}",
                    "title": name,
                    "_links": {
                        "download": f"/download/attachments/page-5681/{name}"
                    },
                    "metadata": {
                        "mediaType": "image/png",
                        "labels": {"results": []},
                    },
                    "extensions": {"fileSize": THREE_MIB},
                }
            )
        result.append(
            {
                "id": "att-large",
                "title": "diagram-32mib.png",
                "_links": {
                    "download": (
                        "/download/attachments/page-5681/diagram-32mib.png"
                    )
                },
                "metadata": {
                    "mediaType": "image/png",
                    "labels": {"results": []},
                },
                "extensions": {"fileSize": THIRTY_TWO_MIB},
            }
        )
        return result

    @property
    def page(self) -> dict[str, object]:
        return {
            "id": "page-5681",
            "title": "Issue 5681 production-scale image corpus",
            "_links": {"webui": "/spaces/ENG/pages/page-5681"},
            "version": {"when": "2026-07-27T08:00:00.000Z"},
            "body": {
                "view": {
                    "value": (
                        "<h1>Issue 5681</h1>"
                        "<p>Ten 3 MiB diagrams and one 32 MiB diagram.</p>"
                    )
                },
                "storage": {
                    "value": (
                        "<h1>Issue 5681</h1>"
                        "<p>Deterministic production-scale fixture.</p>"
                    )
                },
            },
        }


class FixtureHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "EliteaIssue5681Fixture/1"

    def log_message(self, _format: str, *_args: object) -> None:
        return

    @property
    def fixture(self) -> Fixture:
        return self.server.fixture  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        path = parsed.path
        if path == HEALTH_PATH:
            self._json(200, {"status": "ready", "profile": PROFILE_SCHEMA})
            return
        if path == RECEIPT_PATH:
            self._json(200, self.fixture.receipt.snapshot())
            return
        if path.endswith("/rest/api/content"):
            start = int(parse_qs(parsed.query).get("start", ["0"])[0])
            results = [self.fixture.page] if start == 0 else []
            self._json(
                200,
                {
                    "results": results,
                    "start": start,
                    "limit": 1,
                    "size": len(results),
                    "_links": {},
                },
            )
            return
        if path.endswith("/rest/api/content/page-5681"):
            self._json(200, self.fixture.page)
            return
        if path.endswith("/rest/api/content/page-5681/child/attachment"):
            self._json(
                200,
                {
                    "results": self.fixture.attachments,
                    "start": 0,
                    "limit": ATTACHMENT_COUNT,
                    "size": ATTACHMENT_COUNT,
                    "_links": {},
                },
            )
            return
        if "/rest/api/content/" in path and path.endswith("/history"):
            attachment_id = path.split("/")[-2]
            self._json(
                200,
                {
                    "createdBy": {"displayName": "Issue 5681 Fixture"},
                    "createdDate": "2026-07-27T07:00:00.000Z",
                    "lastUpdated": {"when": "2026-07-27T08:00:00.000Z"},
                    "attachment_id": attachment_id,
                },
            )
            return
        if path.endswith("/diagram-32mib.png"):
            self._stream_attachment("diagram-32mib.png", self.fixture.large_path)
            return
        if "/download/attachments/page-5681/diagram-" in path and path.endswith(
            ".png"
        ):
            name = path.rsplit("/", 1)[-1]
            if name not in {f"diagram-{ordinal:02d}.png" for ordinal in range(10)}:
                self._json(404, {"message": "unknown fixture image"})
                return
            self._stream_attachment(name, self.fixture.small_path)
            return
        self._json(404, {"message": "unknown fixture path"})

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path in {"/llm/v1/chat/completions", "/v1/chat/completions"}:
            self._chat_completion()
            return
        if parsed.path in {"/llm/v1/embeddings", "/v1/embeddings"}:
            self._embeddings()
            return
        self._json(404, {"message": "unknown fixture path"})

    def _stream_attachment(self, name: str, path: Path) -> None:
        byte_length = path.stat().st_size
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(byte_length))
        self.end_headers()
        completed = 0
        try:
            with path.open("rb") as source:
                for chunk in iter(lambda: source.read(64 * 1024), b""):
                    self.wfile.write(chunk)
                    completed += len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            return
        if completed == byte_length:
            self.fixture.receipt.record_source(name, byte_length)

    def _read_model_body(self) -> bytes | None:
        raw_length = self.headers.get("Content-Length")
        if raw_length is None:
            self._json(411, {"error": {"message": "Content-Length is required"}})
            return None
        try:
            length = int(raw_length)
        except ValueError:
            self._json(400, {"error": {"message": "invalid Content-Length"}})
            return None
        if length <= 0 or length > MAX_MODEL_REQUEST_BYTES:
            self._json(413, {"error": {"message": "fixture request too large"}})
            return None
        body = bytearray()
        while len(body) < length:
            chunk = self.rfile.read(min(64 * 1024, length - len(body)))
            if not chunk:
                break
            body.extend(chunk)
        if len(body) != length:
            self._json(400, {"error": {"message": "truncated request"}})
            return None
        return bytes(body)

    def _authorized_model_request(self) -> bool:
        authorization = self.headers.get("Authorization", "")
        organization = self.headers.get("OpenAI-Organization", "")
        valid = (
            authorization.startswith("Bearer ")
            and len(authorization) > len("Bearer ")
            and organization == str(self.fixture.receipt.project_id)
        )
        if not valid:
            self.fixture.receipt.reject_model()
            self._json(
                401,
                {
                    "error": {
                        "message": "fixture workload authorization rejected",
                        "type": "authentication_error",
                        "code": "401",
                    }
                },
            )
        return valid

    def _chat_completion(self) -> None:
        if not self._authorized_model_request():
            return
        body = self._read_model_body()
        if body is None:
            return
        if b'"image_url"' not in body or b"data:image/png;base64," not in body:
            self._json(400, {"error": {"message": "image payload is required"}})
            return
        self.fixture.receipt.record_model(chat=True, byte_length=len(body))
        self._json(
            200,
            {
                "id": "issue-5681-vision",
                "object": "chat.completion",
                "created": 1_900_000_000,
                "model": "fixture-vision",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": "ISSUE_5681_IMAGE_DESCRIPTION",
                        },
                        "finish_reason": "stop",
                    }
                ],
                "usage": {
                    "prompt_tokens": 1,
                    "completion_tokens": 1,
                    "total_tokens": 2,
                },
            },
        )

    def _embeddings(self) -> None:
        if not self._authorized_model_request():
            return
        body = self._read_model_body()
        if body is None:
            return
        try:
            value = json.loads(body)
            inputs = value.get("input", [])
            if isinstance(inputs, str):
                inputs = [inputs]
            if not isinstance(inputs, list) or not inputs:
                raise ValueError("input")
        except (json.JSONDecodeError, ValueError, AttributeError):
            self._json(400, {"error": {"message": "invalid embeddings input"}})
            return
        self.fixture.receipt.record_model(chat=False, byte_length=len(body))
        self._json(
            200,
            {
                "object": "list",
                "data": [
                    {
                        "object": "embedding",
                        "index": index,
                        "embedding": [
                            float(index + offset + 1) for offset in range(8)
                        ],
                    }
                    for index, _ in enumerate(inputs)
                ],
                "model": "fixture-embedding",
            },
        )

    def _json(self, status: int, value: object) -> None:
        body = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def prepare_fixture(root: Path, project_id: int) -> Fixture:
    root.mkdir(parents=True, exist_ok=True)
    os.chmod(root, 0o700)
    small_path = root / "diagram-3mib.png"
    large_path = root / "diagram-32mib.png"
    small_sha256 = generate_deterministic_png(
        small_path,
        target_bytes=THREE_MIB,
        width=1024,
        height=1000,
        seed=5681003,
    )
    large_sha256 = generate_deterministic_png(
        large_path,
        target_bytes=THIRTY_TWO_MIB,
        width=4096,
        height=2720,
        seed=5681032,
    )
    return Fixture(
        root=root,
        small_path=small_path,
        large_path=large_path,
        receipt=Receipt(
            project_id=project_id,
            small_sha256=small_sha256,
            large_sha256=large_sha256,
        ),
    )


def profile_description() -> dict[str, object]:
    return {
        "schema": PROFILE_SCHEMA,
        "attachment_count": ATTACHMENT_COUNT,
        "small_attachment_count": 10,
        "small_attachment_bytes": THREE_MIB,
        "large_attachment_count": 1,
        "large_attachment_bytes": THIRTY_TWO_MIB,
        "source_payload_bytes": SOURCE_PAYLOAD_BYTES,
        "receipt_path": RECEIPT_PATH,
        "health_path": HEALTH_PATH,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--describe", action="store_true")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int)
    parser.add_argument("--project-id", type=int)
    parser.add_argument("--root", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.describe:
        print(json.dumps(profile_description(), sort_keys=True))
        return 0
    if (
        args.port is None
        or not 1 <= args.port <= 65535
        or args.project_id is None
        or args.project_id <= 0
        or args.root is None
        or not args.root.is_absolute()
    ):
        raise SystemExit(
            "--port, --project-id and an absolute --root are required"
        )
    fixture = prepare_fixture(args.root.resolve(), args.project_id)
    server = ThreadingHTTPServer((args.host, args.port), FixtureHandler)
    server.fixture = fixture  # type: ignore[attr-defined]
    print(
        json.dumps(
            {
                **profile_description(),
                "status": "ready",
                "port": args.port,
                "small_image_sha256": fixture.receipt.small_sha256,
                "large_image_sha256": fixture.receipt.large_sha256,
            },
            sort_keys=True,
        ),
        flush=True,
    )
    try:
        server.serve_forever()
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
