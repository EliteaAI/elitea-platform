"""Deterministic OpenAI-compatible mock upstream for the standalone stack.

Why vendored rather than a pulled image: the acceptance test has to be
byte-predictable and offline, and the stack already builds two images from
source. Standard library only — no pip install, no network at build or run time.

What it serves, which is exactly what bifrost's vLLM provider asks for:

  POST /v1/chat/completions   streaming (SSE) and unary
  GET  /v1/models             so a model list through the gateway is not empty
  GET  /healthz               for the compose healthcheck

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

import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("MOCK_LLM_PORT", "8090"))
MODEL = os.environ.get("MOCK_LLM_MODEL", "E2E-MOCK-MODEL")
PREFIX = os.environ.get("MOCK_LLM_PREFIX", "MOCK:")
# Per-chunk delay, default 0 (fast). The chat streaming journey sets it so that
# "a token rendered before the turn finished" is a DETERMINISTIC observation
# rather than a race against a reply that arrives in one paint: with no delay
# every chunk lands within a few milliseconds and a browser can legitimately
# show the finished answer without ever painting a partial one, which would
# make an incremental assertion flaky rather than wrong.
CHUNK_DELAY_SECONDS = float(os.environ.get("MOCK_LLM_CHUNK_DELAY_MS", "0")) / 1000.0
MAX_BODY_BYTES = 1 << 20


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

    def do_GET(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]
        if path == "/healthz":
            self._send(200, {"status": "ok"})
            return
        if path == "/v1/models":
            self._send(200, {
                "object": "list",
                "data": [{"id": MODEL, "object": "model", "owned_by": "elitea-mock"}],
            })
            return
        self._send(404, {"error": {"message": "not found", "type": "invalid_request_error"}})

    def do_POST(self) -> None:  # noqa: N802 - stdlib naming
        path = self.path.split("?", 1)[0]
        if path not in ("/v1/chat/completions", "/v1/completions"):
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
