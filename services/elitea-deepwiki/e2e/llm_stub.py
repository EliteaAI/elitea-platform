"""A deterministic, prompt-aware OpenAI-compatible stub.

The standalone stack's llm-mock answers every chat completion with
"MOCK: <prompt>", which is fine for transport tests and useless for a pipeline
that asks the model for JSON. This stub inspects what is being asked and
returns a plausible, well-formed answer of the right SHAPE — a WikiStructureSpec
for a structure request, markdown for a page request, prose otherwise.

It is not an LLM and does not pretend to be. The content is canned; what is
being proven is that the ported pipeline runs end to end and composes the
frozen artifact set. Every response is a pure function of the request, so a
run is reproducible.

Embeddings are deterministic too: a seeded hash-bucket projection, the same
idea as the P0 retrieval fixtures' StubEmbedder.
"""
import hashlib, json, math, re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DIM = 1536

STRUCTURE = {
    "wiki_title": "notes-service",
    "overview": "A small notes service with SQLite persistence, ranked search and bearer-token auth.",
    "total_pages": 3,
    "sections": [
        {
            "section_name": "Overview", "section_order": 0,
            "description": "What the service is and how a request flows through it.",
            "rationale": "Readers need orientation before any component detail.",
            "pages": [
                {"page_name": "Getting Started", "page_order": 0,
                 "description": "What the notes service does.",
                 "content_focus": "purpose and entry points",
                 "rationale": "First contact for a new reader.",
                 "target_symbols": ["handle_create_note", "handle_search"],
                 "key_files": ["api.py", "README.md"], "retrieval_query": "notes service overview"},
            ],
        },
        {
            "section_name": "Components", "section_order": 1,
            "description": "The three modules and what each owns.",
            "rationale": "Each module has a distinct responsibility worth its own page.",
            "pages": [
                {"page_name": "Note Storage", "page_order": 0,
                 "description": "How notes are persisted.",
                 "content_focus": "NoteStore and the SQLite schema",
                 "rationale": "Persistence is the core of the service.",
                 "target_symbols": ["NoteStore", "save_note", "load_note", "delete_note"],
                 "key_files": ["notes/store.py"], "retrieval_query": "how are notes stored"},
                {"page_name": "Bearer Tokens", "page_order": 1,
                 "description": "How requests are authenticated.",
                 "content_focus": "issue_token and verify_token",
                 "rationale": "Auth gates every write.",
                 "target_symbols": ["issue_token", "verify_token"],
                 "key_files": ["auth/tokens.py"], "retrieval_query": "verify bearer token signature"},
            ],
        },
    ],
}


def embed(text: str) -> list:
    vector = [0.0] * DIM
    for token in re.findall(r"[A-Za-z][A-Za-z0-9]+", text.lower()):
        digest = hashlib.sha256(f"deepwiki-e2e:{token}".encode()).hexdigest()
        vector[int(digest[:8], 16) % DIM] += 1.0
    norm = math.sqrt(sum(v * v for v in vector)) or 1.0
    return [v / norm for v in vector]


def answer(prompt: str) -> str:
    lowered = prompt.lower()
    wants_json = "json" in lowered or "wiki_title" in lowered or "sections" in lowered
    if wants_json and ("structure" in lowered or "sections" in lowered or "wiki_title" in lowered):
        return json.dumps(STRUCTURE)
    if wants_json:
        # Repository analysis and other JSON asks: a generic well-formed object.
        return json.dumps({
            "executive_summary": "A small notes service: store, search and authorise notes.",
            "core_purpose": "Persist notes and answer ranked searches over them.",
            "key_components": ["NoteStore", "rank_notes", "verify_token"],
            "architecture": "A thin HTTP layer over a SQLite store and an in-memory index.",
        })
    return (
        "## Overview\n\n"
        "The notes service stores notes in SQLite, ranks search results by term "
        "overlap, and authenticates writes with signed bearer tokens.\n\n"
        "```mermaid\nflowchart LR\n  api --> store\n  api --> auth\n```\n\n"
        "See `notes/store.py` for persistence and `auth/tokens.py` for signing.\n"
    )


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_a):
        pass

    def _send(self, payload):
        body = json.dumps(payload).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.endswith("/models"):
            self._send({"object": "list", "data": [
                {"id": "gpt-4o", "object": "model", "owned_by": "stub"},
                {"id": "text-embedding-3-small", "object": "model", "owned_by": "stub"},
            ]})
        else:
            self.send_response(404); self.end_headers()

    def do_POST(self):
        length = int(self.headers.get("content-length", 0))
        request = json.loads(self.rfile.read(length) or b"{}")

        if self.path.endswith("/embeddings"):
            inputs = request.get("input")
            if isinstance(inputs, str):
                inputs = [inputs]
            self._send({"object": "list", "model": request.get("model", "stub"),
                        "data": [{"object": "embedding", "index": i, "embedding": embed(str(t))}
                                 for i, t in enumerate(inputs or [""])],
                        "usage": {"prompt_tokens": 1, "total_tokens": 1}})
            return

        if self.path.endswith("/chat/completions"):
            prompt = "\n".join(
                str(m.get("content", "")) for m in request.get("messages", [])
            )
            content = answer(prompt)

            # The subprocess workers build their LLM with streaming=True and
            # fail with "No generations found in stream" against a
            # non-streaming endpoint, so the stub speaks SSE too.
            if request.get("stream"):
                self.send_response(200)
                self.send_header("content-type", "text/event-stream")
                self.end_headers()
                base = {"id": "chatcmpl-stub", "object": "chat.completion.chunk",
                        "created": 0, "model": request.get("model", "stub")}
                for start in range(0, len(content), 400):
                    chunk = dict(base, choices=[{
                        "index": 0, "finish_reason": None,
                        "delta": {"content": content[start:start + 400]}}])
                    self.wfile.write(b"data: " + json.dumps(chunk).encode() + b"\n\n")
                final = dict(base, choices=[
                    {"index": 0, "finish_reason": "stop", "delta": {}}])
                self.wfile.write(b"data: " + json.dumps(final).encode() + b"\n\n")
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
                return

            self._send({"id": "chatcmpl-stub", "object": "chat.completion",
                        "created": 0, "model": request.get("model", "stub"),
                        "choices": [{"index": 0, "finish_reason": "stop",
                                     "message": {"role": "assistant", "content": content}}],
                        "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}})
            return

        self.send_response(404); self.end_headers()


if __name__ == "__main__":
    ThreadingHTTPServer(("127.0.0.1", 18901), Handler).serve_forever()
