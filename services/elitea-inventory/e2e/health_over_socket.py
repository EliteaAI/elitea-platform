#!/usr/bin/env python3
"""Prove the sidecar answers on a real Unix socket, in the image.

What this proves: ``python -m elitea_inventory`` binds
``ELITEA_INVENTORY_ENGINE_SOCKET``, serves ``/engine/health`` over it, names its
active runner, and refuses a tool it does not serve — over the socket, in the
process, exactly as the Go host reaches it. Nothing here is mocked: the
transport is the same ``http+unix`` hop ``internal/engine/engine.go`` makes.

What it does NOT prove: that a tool runs. That needs a repository, a source
toolkit and an LLM; the ``legacy`` runner's own tests cover the composition and
the refusals, and stage I7's real-engine run covers execution.

It exists because the failure it catches is invisible to every in-process test:
a socket the sidecar cannot bind (a root-owned directory on a fresh mount, a
path over the 104-byte limit), or an entrypoint that starts and serves nothing.

    # from a checkout
    cd services/elitea-inventory && PYTHONPATH=src python e2e/health_over_socket.py

    # in the image (this file is not installed into it, so mount it)
    podman run --rm \\
        -v "$PWD/e2e:/e2e:ro" \\
        --entrypoint python \\
        localhost/elitea-inventory:local-engine /e2e/health_over_socket.py
"""

from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import tempfile
import time


def request(path: str, method: str = "GET", body: bytes | None = None) -> tuple[int, str]:
    """One HTTP/1.1 request over the socket, by hand.

    By hand rather than with a client library so that this script needs nothing
    the runtime image does not already have — the point is to test the IMAGE,
    and an extra dependency would be tested instead.
    """
    connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    connection.settimeout(10)
    connection.connect(SOCKET)
    headers = [f"{method} {path} HTTP/1.1", "Host: engine", "Connection: close"]
    if body is not None:
        headers += ["Content-Type: application/json", f"Content-Length: {len(body)}"]
    request_bytes = ("\r\n".join(headers) + "\r\n\r\n").encode() + (body or b"")
    connection.sendall(request_bytes)
    chunks = []
    while True:
        chunk = connection.recv(65536)
        if not chunk:
            break
        chunks.append(chunk)
    connection.close()
    raw = b"".join(chunks).decode("utf-8", "replace")
    head, _, payload = raw.partition("\r\n\r\n")
    status = int(head.split(" ", 2)[1])
    return status, payload


def main() -> int:
    global SOCKET
    directory = tempfile.mkdtemp(prefix="inv-e2e-")
    SOCKET = os.path.join(directory, "engine.sock")

    environment = dict(os.environ)
    environment["ELITEA_INVENTORY_ENGINE_SOCKET"] = SOCKET
    environment.setdefault("PYTHONPATH", "src")
    process = subprocess.Popen(  # noqa: S603
        [sys.executable, "-m", "elitea_inventory"], env=environment
    )
    try:
        for _ in range(100):
            if os.path.exists(SOCKET):
                break
            if process.poll() is not None:
                print("the sidecar exited before binding its socket", file=sys.stderr)
                return 1
            time.sleep(0.1)
        else:
            print(f"the sidecar never bound {SOCKET}", file=sys.stderr)
            return 1

        status, payload = request("/engine/health")
        print(f"GET /engine/health -> {status} {payload}")
        assert status == 200, payload
        health = json.loads(payload)
        assert health["status"] == "UP", health
        assert "runner" in health, health

        # A tool this application does not serve is refused at the door, with a
        # 400 rather than a stream that fails later.
        status, payload = request(
            "/engine/invoke",
            "POST",
            json.dumps(
                {"invocation_id": "e2e", "tool": "generate_wiki", "arguments": {}}
            ).encode(),
        )
        print(f"POST /engine/invoke (foreign tool) -> {status} {payload}")
        assert status == 400, payload

        # A tool it DOES serve reaches the runner, which — with no engine wired
        # — refuses in band on the stream rather than at the transport.
        status, payload = request(
            "/engine/invoke",
            "POST",
            json.dumps(
                {
                    "invocation_id": "e2e-2",
                    "tool": "get_stats",
                    "arguments": {"family": "inventory", "params": {}},
                }
            ).encode(),
        )
        print(f"POST /engine/invoke (served tool) -> {status} {payload.strip()}")
        assert status == 200, payload

        print("\nOK: the sidecar serves /engine/health and /engine/invoke on a Unix socket")
        return 0
    finally:
        process.terminate()
        process.wait(timeout=10)


if __name__ == "__main__":
    raise SystemExit(main())
