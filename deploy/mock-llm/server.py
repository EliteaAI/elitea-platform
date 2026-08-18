"""Deterministic OpenAI-compatible mock upstream for the standalone stack.

Why vendored rather than a pulled image: the acceptance test has to be
byte-predictable and offline, and the stack already builds two images from
source. Standard library only — no pip install, no network at build or run time.

What it serves, which is exactly what bifrost's vLLM provider asks for:

  POST /v1/chat/completions   streaming (SSE) and unary
  POST /v1/embeddings         deterministic vectors for the index plane (#93)
  GET  /v1/models             so a model list through the gateway is not empty
  GET  /healthz               for the compose healthcheck

It also keeps a REQUEST JOURNAL, and serves it (issue #470):

  GET    /__journal           the recorded requests, newest last
  DELETE /__journal           empty the journal

The journal is the only place a test can read what the gateway actually put on
the wire. A vector width does not identify a model, and a 200 does not prove
which project's credential resolved. The journal records both: the model name
as it arrived, and a label for the credential the gateway sent. Seed a
different mock key per project and that label names the project the gateway
resolved.

The journal holds no secret. A credential that starts with the literal prefix
`mock-key-` is recorded as it is, because the seed script writes that prefix
and the value is not a secret. Any other credential is recorded as a SHA-256
prefix, so a real key can never reach the journal even if an operator points a
real credential at this mock.

The reply is an echo of the last user message, prefixed, so a test can assert
on content it supplied rather than on a fixed string that could also come from
a cached or misrouted response.

It is reached as a vLLM-class credential, not an OpenAI one, and that is not
cosmetic: internal/account/account.go:235 sets AllowPrivateNetwork only for
schemas.VLLM and schemas.Ollama, and only when GATEWAY_EGRESS_ALLOWLIST is
non-empty. An `open_ai` credential pointing at this service would be refused by
bifrost's SSRF-safe dialer no matter what the allowlist says — the guard that
stops a tenant steering the gateway into the cluster.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_LLM_PORT", "8090"))
MODEL = os.environ.get("MOCK_LLM_MODEL", "E2E-MOCK-MODEL")
EMBEDDING_MODEL = os.environ.get("MOCK_LLM_EMBEDDING_MODEL", "E2E-MOCK-EMBEDDING")
# 1536 because that is the width every embedding artefact in this workspace is
# already cut to — `elitea-sdk/tests/tools/index/fixtures/rag_corpus_embeddings.sql`
# (text-embedding-ada-002) stores 1536-element vectors — so a corpus dumped by
# the SDK's own fixtures and one produced here are dimensionally interchangeable.
# Nothing in the platform PINS a width: the table the Go writer creates declares
# `embedding vector` with no dimension modifier
# (internal/infra/pgvector/index_meta_writer.go:660) and langchain_postgres
# leaves `embedding_length` unset, so pgvector accepts any consistent width and
# a mismatch would surface only as an operator error between two differently
# sized vectors in the SAME collection. Overridable so a test can prove the
# width actually travels end to end rather than being assumed.
EMBEDDING_DIMENSIONS = int(os.environ.get("MOCK_LLM_EMBEDDING_DIMENSIONS", "1536"))
MAX_EMBEDDING_DIMENSIONS = 4096
MAX_EMBEDDING_INPUTS = 2048
PREFIX = os.environ.get("MOCK_LLM_PREFIX", "MOCK:")
# Per-chunk delay, default 0 (fast). The chat streaming journey sets it so that
# "a token rendered before the turn finished" is a DETERMINISTIC observation
# rather than a race against a reply that arrives in one paint: with no delay
# every chunk lands within a few milliseconds and a browser can legitimately
# show the finished answer without ever painting a partial one, which would
# make an incremental assertion flaky rather than wrong.
CHUNK_DELAY_SECONDS = float(os.environ.get("MOCK_LLM_CHUNK_DELAY_MS", "0")) / 1000.0
# 16 MiB rather than 1: an embeddings batch is up to MAX_EMBEDDING_INPUTS
# token-id arrays, which is an order of magnitude larger than any chat body and
# would otherwise be rejected as "body too large" on the index path alone.
MAX_BODY_BYTES = 16 << 20
# The journal is bounded so a long soak run cannot grow the process without a
# limit. A test reads it after a few requests, so the oldest entries are the
# ones to drop.
MAX_JOURNAL_ENTRIES = int(os.environ.get("MOCK_LLM_JOURNAL_LIMIT", "500"))
# The prefix that marks a credential as a seeded mock value rather than a
# secret. Keep it in step with `seed-llm` in deploy/scripts/standalone-stack.sh.
MOCK_CREDENTIAL_PREFIX = "mock-key-"

_JOURNAL: list[dict] = []
_JOURNAL_LOCK = threading.Lock()


def _credential_label(authorization: str) -> str:
    """Name the credential the caller sent, without ever storing a secret.

    A seeded mock key is recorded as it is, because the test asserts on it and
    the value is public. Anything else becomes a digest prefix, which still
    tells two credentials apart but discloses nothing.
    """
    token = (authorization or "").strip()
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    if not token:
        return "none"
    if token.startswith(MOCK_CREDENTIAL_PREFIX):
        return token
    return "sha256:" + hashlib.sha256(token.encode()).hexdigest()[:16]


def _record(entry: dict) -> None:
    with _JOURNAL_LOCK:
        _JOURNAL.append(entry)
        if len(_JOURNAL) > MAX_JOURNAL_ENTRIES:
            del _JOURNAL[:-MAX_JOURNAL_ENTRIES]


def _reply_for(messages: list[dict]) -> str:
    """Echo the last user turn. Deterministic and attributable to the input."""
    for message in reversed(messages or []):
        if message.get("role") == "user":
            content = message.get("content")
            if isinstance(content, str):
                return f"{PREFIX} {content}".strip()
            # Multimodal content arrives as a list of typed parts.
            if isinstance(content, list):
                text = " ".join(
                    part.get("text", "")
                    for part in content
                    if isinstance(part, dict) and part.get("type") == "text"
                ).strip()
                return f"{PREFIX} {text}".strip()
    return f"{PREFIX} (no user message)"


def _embedding_key(item: object) -> str:
    """Canonicalize one `input` element to the string the vector is derived from.

    The OpenAI embeddings input is a union, and the index path exercises more
    than one arm of it: langchain_openai's default `check_embedding_ctx_length`
    tokenizes with tiktoken and posts LISTS OF TOKEN IDS rather than text, so a
    server that only understands strings answers the chat path and fails the
    index path. Both arms canonicalize here, which also keeps the vector for a
    given input stable no matter which arm delivered it.
    """
    if isinstance(item, str):
        return item
    if isinstance(item, list):
        return ",".join(_embedding_key(part) for part in item)
    return json.dumps(item, sort_keys=True, separators=(",", ":"))


def _split_embedding_inputs(raw_input: object) -> list:
    """Split the OpenAI `input` union into the list of items to embed.

    A bare string, or a bare token-id list, is ONE input. A list of strings, or
    a list of token-id lists, is a batch. That is how the OpenAI API
    disambiguates the same union, and the journal counts items the same way the
    handler does.
    """
    if isinstance(raw_input, list) and raw_input and isinstance(raw_input[0], (str, list)):
        return list(raw_input)
    return [raw_input]


def _input_count(raw_input: object) -> int:
    """How many items an embeddings request asks for. 0 for any other route."""
    if raw_input is None or raw_input == [] or raw_input == "":
        return 0
    return len(_split_embedding_inputs(raw_input))


def _embedding_for(text: str, dimensions: int) -> list[float]:
    """A deterministic UNIT vector of `dimensions` floats derived from `text`.

    Deterministic rather than random so a run is reproducible and a test can
    assert the exact stored vector; unit-length because langchain_openai
    averages the per-chunk vectors of a long document and divides by the norm,
    which is a ZeroDivisionError/NaN for an all-zero vector — so the zero vector
    is the one output this must never produce.

    The bytes come from SHA-256 over `text` with a counter, which gives an
    output that is fixed for a given (text, dimensions) pair, differs between
    different texts, and has no chance of being uniformly zero.
    """
    raw = text.encode("utf-8", "replace")
    values: list[float] = []
    counter = 0
    while len(values) < dimensions:
        digest = hashlib.sha256(raw + b"|" + str(counter).encode()).digest()
        # Two bytes per component, mapped into [-1, 1); 16 components per digest.
        for offset in range(0, len(digest), 2):
            if len(values) >= dimensions:
                break
            word = int.from_bytes(digest[offset:offset + 2], "big")
            values.append((word / 32768.0) - 1.0)
        counter += 1
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0.0:
        # Unreachable for SHA-256 output, but a zero vector must never escape.
        values[0] = 1.0
        norm = 1.0
    return [value / norm for value in values]


def _encode_embedding(values: list[float], encoding_format: str) -> object:
    """`float` -> a JSON array; `base64` -> little-endian float32, as OpenAI does.

    base64 is not an exotic branch to skip: the `openai` python client injects
    `encoding_format="base64"` itself when the caller did not ask for a format
    and numpy is importable, and decodes it back transparently. A mock that
    only ever returns JSON arrays therefore breaks under the very client the
    SDK uses (`elitea_sdk/runtime/clients/client.py:374`'s `OpenAIEmbeddings`).
    """
    if encoding_format == "base64":
        return base64.b64encode(struct.pack(f"<{len(values)}f", *values)).decode("ascii")
    return values


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    server_version = "elitea-mock-llm/1"

    # The default logger writes one line per request to stderr, which makes the
    # compose logs unreadable during a streamed run. Errors still surface via
    # log_error, which does not go through this.
    def log_message(self, fmt: str, *args: object) -> None:
        return

    def _send(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self) -> None:  # noqa: N802 - stdlib naming
        """Empty the journal, so a test can bound the window it asserts over."""
        if self.path.split("?", 1)[0] != "/__journal":
            self._send(404, {"error": {"message": "not found", "type": "invalid_request_error"}})
            return
        with _JOURNAL_LOCK:
            _JOURNAL.clear()
        self._send(200, {"object": "list", "data": [], "count": 0})

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self._send(200, {"status": "ok"})
            return
        if path == "/__journal":
            with _JOURNAL_LOCK:
                entries = list(_JOURNAL)
            self._send(200, {"object": "list", "data": entries, "count": len(entries)})
            return
        if path == "/v1/models":
            self._send(200, {
                "object": "list",
                "data": [
                    {"id": MODEL, "object": "model", "owned_by": "elitea-mock"},
                    {"id": EMBEDDING_MODEL, "object": "model", "owned_by": "elitea-mock"},
                ],
            })
            return
        self._send(404, {"error": {"message": "not found", "type": "invalid_request_error"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]
        if path not in ("/v1/chat/completions", "/v1/completions", "/v1/embeddings"):
            self._send(404, {"error": {"message": "not found", "type": "invalid_request_error"}})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length < 0 or length > MAX_BODY_BYTES:
            self._send(413, {"error": {"message": "body too large", "type": "invalid_request_error"}})
            return
        try:
            request = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self._send(400, {"error": {"message": "invalid JSON", "type": "invalid_request_error"}})
            return

        # Recorded BEFORE the request is served, and recorded for every POST,
        # so a request that this server then rejects is still visible. A journal
        # that only held successes could not prove the negative direction: that
        # a refused model made NO upstream call at all.
        #
        # `model` is the name exactly as it arrived. Do not strip the provider
        # prefix here — the point of the record is to show what the gateway put
        # on the wire, and the prefix is part of that.
        raw_model = request.get("model")
        _record({
            "path": path,
            "model": raw_model if isinstance(raw_model, str) else None,
            "credential": _credential_label(self.headers.get("Authorization") or ""),
            "inputs": _input_count(request.get("input")),
            "encoding_format": request.get("encoding_format"),
            "dimensions": request.get("dimensions"),
            "at": time.time(),
        })

        if path == "/v1/embeddings":
            self._embeddings(request)
            return

        # The model echoed back is whatever was asked for, minus any
        # `provider/` prefix bifrost may not have stripped, so a client
        # comparing request and response model names is not surprised.
        model = str(request.get("model") or MODEL).split("/")[-1]
        reply = _reply_for(request.get("messages") or [])
        created = int(time.time())
        completion_id = "chatcmpl-mock"

        if request.get("stream"):
            self._stream(completion_id, created, model, reply)
        else:
            self._unary(completion_id, created, model, reply)

    def _embeddings(self, request: dict) -> None:
        """`POST /v1/embeddings` — what the index plane's embedding hop calls.

        Without this route the toolkit's `index_data` run reaches the gateway,
        the gateway reaches this upstream, and the upstream answers 404 — which
        surfaces to the browser only as a generic
        `index.ingest.completed {"status":"error"}`, i.e. a whole-stack failure
        whose real cause is a missing four-line handler.
        """
        raw_input = request.get("input")
        if raw_input is None or raw_input == [] or raw_input == "":
            self._send(400, {"error": {"message": "input is required", "type": "invalid_request_error"}})
            return
        # A bare string, or a bare token-id list, is ONE input; a list of
        # strings or a list of token-id lists is a batch. The discriminator is
        # whether the first element is itself a str/list, which is exactly how
        # the OpenAI API disambiguates the same union.
        items = _split_embedding_inputs(raw_input)
        if len(items) > MAX_EMBEDDING_INPUTS:
            self._send(400, {"error": {"message": "too many inputs", "type": "invalid_request_error"}})
            return

        # `dimensions` is honoured when the caller asks (text-embedding-3
        # semantics) so a test can pin a width; otherwise the configured one.
        requested = request.get("dimensions")
        dimensions = EMBEDDING_DIMENSIONS
        if isinstance(requested, int) and not isinstance(requested, bool):
            if requested < 1 or requested > MAX_EMBEDDING_DIMENSIONS:
                self._send(400, {"error": {"message": "invalid dimensions", "type": "invalid_request_error"}})
                return
            dimensions = requested

        encoding_format = request.get("encoding_format") or "float"
        if encoding_format not in ("float", "base64"):
            self._send(400, {"error": {"message": "invalid encoding_format", "type": "invalid_request_error"}})
            return

        model = str(request.get("model") or EMBEDDING_MODEL).split("/")[-1]
        data = []
        prompt_tokens = 0
        for index, item in enumerate(items):
            key = _embedding_key(item)
            prompt_tokens += max(1, len(key.split()))
            data.append({
                "object": "embedding",
                "index": index,
                "embedding": _encode_embedding(_embedding_for(key, dimensions), encoding_format),
            })
        self._send(200, {
            "object": "list",
            "model": model,
            "data": data,
            # Non-zero for the same reason the completion path's are: the
            # gateway bills against them.
            "usage": {"prompt_tokens": prompt_tokens, "total_tokens": prompt_tokens},
        })

    def _unary(self, completion_id: str, created: int, model: str, reply: str) -> None:
        self._send(200, {
            "id": completion_id,
            "object": "chat.completion",
            "created": created,
            "model": model,
            "choices": [{
                "index": 0,
                "message": {"role": "assistant", "content": reply},
                "finish_reason": "stop",
            }],
            # Non-zero and deterministic: the gateway bills against these, so
            # zeros would make the billing path untestable.
            "usage": {
                "prompt_tokens": 1,
                "completion_tokens": max(1, len(reply.split())),
                "total_tokens": 1 + max(1, len(reply.split())),
            },
        })

    def _stream(self, completion_id: str, created: int, model: str, reply: str) -> None:
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        # Chunked rather than Content-Length: the body length is not known up
        # front, and HTTP/1.1 keep-alive without either framing hangs the client.
        self.send_header("Transfer-Encoding", "chunked")
        self.end_headers()

        def event(payload: dict) -> None:
            chunk = f"data: {json.dumps(payload)}\n\n".encode()
            self.wfile.write(f"{len(chunk):X}\r\n".encode() + chunk + b"\r\n")
            self.wfile.flush()

        base = {
            "id": completion_id,
            "object": "chat.completion.chunk",
            "created": created,
            "model": model,
        }
        event({**base, "choices": [{"index": 0, "delta": {"role": "assistant"}, "finish_reason": None}]})
        # One word per chunk: a consumer that only ever sees a single chunk is
        # not actually exercising incremental streaming.
        for word in reply.split(" "):
            event({**base, "choices": [{"index": 0, "delta": {"content": word + " "}, "finish_reason": None}]})
            if CHUNK_DELAY_SECONDS:
                time.sleep(CHUNK_DELAY_SECONDS)
        event({**base, "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}],
               "usage": {"prompt_tokens": 1,
                         "completion_tokens": max(1, len(reply.split())),
                         "total_tokens": 1 + max(1, len(reply.split()))}})
        done = b"data: [DONE]\n\n"
        self.wfile.write(f"{len(done):X}\r\n".encode() + done + b"\r\n")
        self.wfile.write(b"0\r\n\r\n")
        self.wfile.flush()


def main() -> None:
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"elitea mock LLM listening on :{PORT} (model={MODEL})", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
