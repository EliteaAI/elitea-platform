#!/usr/bin/env python3
"""
Minimal HTTP-to-RPC bridge for pylon-indexer predict calls.
Exposes POST /predict that forwards to pylon-indexer's applications_predict_sio_llm RPC.
"""

import gzip
import hmac
import pickle
import json
import time
import uuid
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
import redis


REDIS_HOST = "redis"
REDIS_PORT = 6379
RPC_QUEUE = "elitea_rpc"
HMAC_KEY = None  # Set from RPC_HMAC_KEY env if needed


class RPCClient:
    def __init__(self):
        self.redis = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=False)
        self.callbacks = {}
        self.lock = threading.Lock()
        self.listener_thread = threading.Thread(target=self._listener, daemon=True)
        self.listener_thread.start()
        self.callback_channel = f"rpc_bridge_{uuid.uuid4().hex[:8]}"
        self.pubsub = self.redis.pubsub()
        self.pubsub.subscribe(self.callback_channel)

    def _listener(self):
        """Listen for RPC replies on our callback channel."""
        time.sleep(0.1)  # Let subscribe settle
        while True:
            try:
                for msg in self.pubsub.listen():
                    if msg["type"] != "message":
                        continue
                    data = msg["data"]
                    # Decompress and unpickle
                    try:
                        decompressed = gzip.decompress(data)
                        event = pickle.loads(decompressed)
                    except Exception:
                        # Try without gzip (raw pickle)
                        try:
                            event = pickle.loads(data)
                        except Exception:
                            continue

                    name = event.get("name", "")
                    payload = event.get("payload")

                    with self.lock:
                        if name in self.callbacks:
                            self.callbacks[name].append(payload)
            except Exception as e:
                print(f"Listener error: {e}")
                time.sleep(1)

    def call(self, method, payload, timeout=60):
        """Call an RPC method on pylon-indexer."""
        callback_id = f"callback_{uuid.uuid4().hex}"

        with self.lock:
            self.callbacks[callback_id] = []

        # Build the RPC event
        event = {
            "name": method,
            "payload": {
                "args": [payload] if payload else [],
                "kwargs": payload if isinstance(payload, dict) else {},
                "callback_event": callback_id,
                "callback_channel": self.callback_channel,
            }
        }

        # Serialize: pickle + gzip
        data = gzip.compress(pickle.dumps(event, protocol=pickle.HIGHEST_PROTOCOL))

        if HMAC_KEY:
            digest = hmac.digest(HMAC_KEY.encode(), data, "sha512")
            data = data + digest

        # Publish to RPC queue
        self.redis.publish(RPC_QUEUE, data)

        # Wait for response
        start = time.time()
        while time.time() - start < timeout:
            with self.lock:
                if self.callbacks.get(callback_id):
                    result = self.callbacks.pop(callback_id)[0]
                    return result
            time.sleep(0.1)

        with self.lock:
            self.callbacks.pop(callback_id, None)

        return {"error": "RPC timeout"}


rpc_client = None


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        global rpc_client
        if rpc_client is None:
            rpc_client = RPCClient()

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length)

        try:
            request = json.loads(body)
        except json.JSONDecodeError:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b'{"error":"invalid json"}')
            return

        method = request.get("method", "applications_predict_sio_llm")
        payload = request.get("payload", {})
        timeout = request.get("timeout", 60)

        try:
            result = rpc_client.call(method, payload, timeout=timeout)
            response = json.dumps({"result": result}, default=str)
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(response.encode())
        except Exception as e:
            self.send_response(500)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"error": str(e)}).encode())

    def log_message(self, format, *args):
        pass  # Suppress access logs


if __name__ == "__main__":
    import os
    REDIS_HOST = os.environ.get("REDIS_HOST", "redis")
    REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
    HMAC_KEY = os.environ.get("RPC_HMAC_KEY") or None

    port = int(os.environ.get("BRIDGE_PORT", 9090))
    server = HTTPServer(("0.0.0.0", port), Handler)
    print(f"RPC Bridge listening on port {port}")
    server.serve_forever()
